// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Anonymisierungs-Orchestrator: Use Case 1 (deterministisch, algorithmisch).
//
// Reihenfolge (User-Setzung 2026-05-02 — "Failsafe zuerst, dann harte
// Anonymisierung"):
//   1. Lade aktuellen Volltext + alle Element-Offsets aus der DB.
//   2. Skip-Check: ist die Frontpage bereits händisch geschwärzt?
//      → wenn ja: trotzdem Seeds extrahieren (für den Failsafe-Tripwire)
//        und persistieren. NICHT überschreiben. Status='skipped_already_redacted'.
//      → wenn nein: weiter.
//   3. Build seeds aus dem Volltext.
//   4. Verifikations-Pass: scanne, ob auch nach (potentiellem) Skip noch
//      Seeds im Klartext im Volltext stehen. Bei Skip + Treffer ⇒ doch
//      hart anonymisieren (User-Schwärzung war unvollständig).
//   5. Edit-Script bauen → full_text neu schreiben → element-Offsets
//      shiften → namings.inscription auf synthetischen Filename setzen.
//   6. Seeds in document_pii_seeds persistieren (idempotent via UNIQUE
//      INDEX). Status='applied' setzen.
//
// WICHTIG: alles in einer Transaktion. Wenn die DB-Updates fehlschlagen,
// bleibt nichts halb-anonymisiert.

import type { PoolClient } from 'pg';
import { transaction, query } from '$lib/server/db/index.js';
import { buildSeeds, type ReplacementSeed } from './seeds.js';
import { isAuthorAlreadyRedacted } from './already-redacted.js';
import { findEdits, applyEdits, recomputeElementSlice, countByCategory, type Edit } from './apply.js';
import { buildSyntheticFilename } from './filename.js';

export type AnonymizationStatus = 'applied' | 'skipped_already_redacted' | 'no_candidates' | 'failed';

export interface AnonymizationResult {
	documentId: string;
	status: AnonymizationStatus;
	seedCount: number;
	replacementCount: number;
	replacementCounts: Record<string, number>;
	skippedReason?: string;
	originalFilename?: string;
	newFilename?: string;
	verificationHits?: number; // bei Skip-Pfad: wie viele Seeds standen noch im Klartext?
}

/**
 * Führt die deterministische Anonymisierung für ein Dokument durch.
 *
 * Idempotent: ein zweiter Aufruf auf einem bereits anonymisierten
 * Dokument findet keine neuen Seeds (Klartext ist weg) und endet mit
 * status='no_candidates'. Persistierte Seeds bleiben erhalten.
 */
export async function anonymizeDocumentDeterministic(documentId: string): Promise<AnonymizationResult> {
	return transaction(async (client) => {
		// 1. Lade Volltext + Original-Inscription (= Filename).
		const docRes = await client.query(
			`SELECT dc.full_text, dc.mime_type, dc.original_filename, n.inscription
			   FROM document_content dc
			   JOIN namings n ON n.id = dc.naming_id
			  WHERE dc.naming_id = $1
			  FOR UPDATE OF dc, n`,
			[documentId]
		);
		if (docRes.rows.length === 0) {
			throw new Error(`Document ${documentId} not found`);
		}
		const row = docRes.rows[0];
		const fullText: string = row.full_text ?? '';
		const inscription: string = row.inscription ?? '';
		const originalFilename: string | null = row.original_filename ?? inscription;

		if (!fullText) {
			await markStatus(client, documentId, 'no_candidates');
			return {
				documentId,
				status: 'no_candidates',
				seedCount: 0,
				replacementCount: 0,
				replacementCounts: {}
			};
		}

		// 2. Skip-Check.
		const redactionCheck = isAuthorAlreadyRedacted(fullText);

		// 3. Seeds bauen.
		const seeds = buildSeeds(fullText);

		if (seeds.length === 0) {
			// Keine Kandidaten — z.B. ein bereits anonymisiertes Dokument oder
			// ein Dokument ohne Personenbezug.
			await persistSeeds(client, documentId, seeds);
			await markStatus(client, documentId, 'no_candidates');
			return {
				documentId,
				status: 'no_candidates',
				seedCount: 0,
				replacementCount: 0,
				replacementCounts: {}
			};
		}

		// 4. Verifikations-Pass: stehen die Seeds NOCH im Volltext?
		const edits = findEdits(fullText, seeds);
		const verificationHits = edits.length;

		// 5. Bei Skip + KEINEN Klartext-Treffern → wirklich skippen.
		if (redactionCheck.skipped && verificationHits === 0) {
			await persistSeeds(client, documentId, seeds);
			await markStatus(client, documentId, 'skipped_already_redacted');
			return {
				documentId,
				status: 'skipped_already_redacted',
				seedCount: seeds.length,
				replacementCount: 0,
				replacementCounts: {},
				skippedReason: redactionCheck.reason,
				verificationHits: 0
			};
		}

		// 6. Bei Skip + Treffern → User-Schwärzung war unvollständig, weiter zu hart.
		// 7. Bei nicht-Skip → harte Anonymisierung.

		const newFullText = applyEdits(fullText, edits);
		const replacementCounts = countByCategory(edits);

		// 8. Element-Offsets shiften.
		await shiftElementOffsets(client, documentId, fullText, edits);

		// 9. Volltext überschreiben.
		await client.query(
			`UPDATE document_content
			    SET full_text = $1
			  WHERE naming_id = $2`,
			[newFullText, documentId]
		);

		// 10. Filename neu generieren.
		const titleHint = await pickTitleHint(client, documentId);
		const ext = inferExt(inscription, row.mime_type);
		const newInscription = buildSyntheticFilename({ title: titleHint, ext });
		await client.query(
			`UPDATE namings SET inscription = $1 WHERE id = $2`,
			[newInscription, documentId]
		);

		// 11. Seeds + Status + Original-Filename persistieren.
		await persistSeeds(client, documentId, seeds);
		await client.query(
			`UPDATE document_content
			    SET anonymization_status = 'applied',
			        anonymized_at = now(),
			        original_filename = COALESCE(original_filename, $2)
			  WHERE naming_id = $1`,
			[documentId, originalFilename]
		);

		return {
			documentId,
			status: 'applied',
			seedCount: seeds.length,
			replacementCount: edits.length,
			replacementCounts,
			originalFilename: originalFilename ?? undefined,
			newFilename: newInscription,
			verificationHits
		};
	});
}

// ── Helpers ──────────────────────────────────────────────────────────

async function markStatus(client: PoolClient, documentId: string, status: AnonymizationStatus): Promise<void> {
	await client.query(
		`UPDATE document_content
		    SET anonymization_status = $1,
		        anonymized_at = now()
		  WHERE naming_id = $2`,
		[status, documentId]
	);
}

async function shiftElementOffsets(
	client: PoolClient,
	documentId: string,
	originalText: string,
	edits: Edit[]
): Promise<void> {
	if (edits.length === 0) return;
	const elementsRes = await client.query(
		`SELECT id, char_start, char_end
		   FROM document_elements
		  WHERE document_id = $1
		  ORDER BY char_start, seq`,
		[documentId]
	);

	for (const el of elementsRes.rows) {
		const { newStart, newEnd } = recomputeElementSlice(
			originalText,
			el.char_start,
			el.char_end,
			edits
		);
		if (newStart === el.char_start && newEnd === el.char_end) continue;
		await client.query(
			`UPDATE document_elements
			    SET char_start = $1, char_end = $2
			  WHERE id = $3`,
			[newStart, newEnd, el.id]
		);
	}
}

async function persistSeeds(
	client: PoolClient,
	documentId: string,
	seeds: ReplacementSeed[]
): Promise<void> {
	for (const s of seeds) {
		await client.query(
			`INSERT INTO document_pii_seeds
			   (document_id, category, role, value, variants, replacement, source)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (document_id, category, value) DO UPDATE
			   SET variants    = EXCLUDED.variants,
			       replacement = EXCLUDED.replacement,
			       source      = EXCLUDED.source,
			       active      = true`,
			[documentId, s.category, s.role, s.value, s.variants, s.replacement, s.source]
		);
	}
}

async function pickTitleHint(client: PoolClient, documentId: string): Promise<string | undefined> {
	// Erstes heading-Element. element_type='heading' wurde im docx-academic-Parser
	// gesetzt; properties.level == 1 (oder kleinster Level) bevorzugt.
	const res = await client.query(
		`SELECT char_start, char_end, properties
		   FROM document_elements
		  WHERE document_id = $1
		    AND element_type = 'heading'
		  ORDER BY (properties->>'level')::int NULLS LAST, char_start
		  LIMIT 1`,
		[documentId]
	);
	if (res.rows.length === 0) return undefined;

	const ftRes = await client.query(
		`SELECT full_text FROM document_content WHERE naming_id = $1`,
		[documentId]
	);
	const fullText: string = ftRes.rows[0]?.full_text ?? '';
	const { char_start, char_end } = res.rows[0];
	return fullText.slice(char_start, char_end);
}

function inferExt(inscription: string, mimeType: string | null): string {
	const m = inscription.match(/\.([a-z0-9]{1,5})$/i);
	if (m) return m[1].toLowerCase();
	if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
	if (mimeType === 'application/pdf') return 'pdf';
	if (mimeType === 'text/plain') return 'txt';
	if (mimeType === 'text/markdown') return 'md';
	return 'docx';
}

// ── Public utility for the failsafe layer ────────────────────────────

/**
 * Lädt persistierte Seeds für ein Dokument — read-only Helper für Stellen
 * außerhalb der `failsafe.ts`, die die Seed-Liste z.B. zum Audit anzeigen.
 */
export async function getPersistedSeeds(documentId: string): Promise<ReplacementSeed[]> {
	const res = await query(
		`SELECT category, role, value, variants, replacement, source
		   FROM document_pii_seeds
		  WHERE document_id = $1 AND active = true`,
		[documentId]
	);
	return res.rows.map((r) => ({
		category: r.category,
		role: r.role,
		value: r.value,
		variants: r.variants ?? [],
		replacement: r.replacement,
		source: r.source
	}));
}
