// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Anonymisierungs-Failsafe / Tripwire vor externen LLM-Calls.
//
// Logik (User-Setzung 2026-05-02):
//   1. Pro Dokument werden in `document_pii_seeds` die extrahierten
//      Originalwerte (Autor, Betreuer, Mailadressen, Matrikelnummern …)
//      persistiert — auch lange nach erfolgter harter Anonymisierung.
//   2. Vor jedem Outbound-Call an einen Non-DSGVO-Provider werden alle
//      aktiven Seeds der involvierten Dokumente gegen die Payload gescant.
//   3. Treffer ⇒ AnonymizationFailsafeError, Call wird hart geblockt.
//
// Das ist Belt-and-Suspenders gegenüber der harten Überschreibung in der
// DB: wenn ein Caller versehentlich aus einer nicht-anonymisierten Quelle
// liest oder die deterministische Heuristik eine Variante übersehen hat,
// fängt der Failsafe es hier ab — bevor es das System verlässt.

import { query } from '$lib/server/db/index.js';
import { PROVIDERS, type Provider } from './client.js';

export interface PiiSeed {
	id: string;
	documentId: string;
	category: string;
	role: string | null;
	value: string;
	variants: string[];
	replacement: string;
	source: string;
}

export interface FailsafeHit {
	seedId: string;
	documentId: string;
	category: string;
	matchedString: string;     // exakt matchender Substring aus der Payload
	matchedAt: number;         // Char-Offset in der Payload (erstes Vorkommen)
	context: string;           // ±40 Zeichen rund um den Treffer, zur Diagnose
}

export class AnonymizationFailsafeError extends Error {
	readonly hits: FailsafeHit[];
	readonly provider: Provider;
	readonly documentIds: string[];

	constructor(hits: FailsafeHit[], provider: Provider, documentIds: string[]) {
		const sample = hits.slice(0, 3).map(h => `${h.category}:"${h.matchedString}"`).join(', ');
		const more = hits.length > 3 ? ` (+${hits.length - 3} weitere)` : '';
		super(
			`Anonymisierungs-Failsafe: ${hits.length} PII-Treffer in Outbound-Payload an ` +
			`${provider} (Non-DSGVO). Beispiele: ${sample}${more}. ` +
			`Call abgebrochen. Dokument(e) ${documentIds.join(', ')} sind nicht ` +
			`vollständig anonymisiert oder Caller liest aus falscher Quelle.`
		);
		this.name = 'AnonymizationFailsafeError';
		this.hits = hits;
		this.provider = provider;
		this.documentIds = documentIds;
	}
}

/**
 * Lädt alle aktiven PII-Seeds für die gegebenen Dokumente.
 */
export async function loadActiveSeeds(documentIds: string[]): Promise<PiiSeed[]> {
	if (documentIds.length === 0) return [];
	const res = await query(
		`SELECT id, document_id, category, role, value, variants, replacement, source
		   FROM document_pii_seeds
		  WHERE document_id = ANY($1::uuid[])
		    AND active = true`,
		[documentIds]
	);
	return res.rows.map((r) => ({
		id: r.id,
		documentId: r.document_id,
		category: r.category,
		role: r.role,
		value: r.value,
		variants: r.variants ?? [],
		replacement: r.replacement,
		source: r.source
	}));
}

/**
 * Prüft, ob ein Provider als DSGVO-konform gilt.
 * Ollama, Mistral, IONOS, Mammouth → konform.
 * Anthropic, OpenAI, OpenRouter → NICHT konform (US-Region).
 */
export function isDsgvoProvider(provider: Provider): boolean {
	return PROVIDERS[provider].dsgvo;
}

/**
 * Skant eine Payload nach allen aktiven PII-Werten der gegebenen Dokumente.
 * Case-insensitive Substring-Match auf `value` und alle `variants`.
 *
 * Wichtig: wir scannen mit Word-Boundaries für kurze Werte (≤ 3 Zeichen),
 * sonst gäbe es zu viele False-Positives ("M" → trifft jedes Wort mit M).
 * Längere Werte (Vollnamen, E-Mails, Nummern) werden als reine Substring
 * gematcht.
 */
export function scanForPiiHits(payload: string, seeds: PiiSeed[]): FailsafeHit[] {
	if (!payload || seeds.length === 0) return [];
	const hits: FailsafeHit[] = [];
	const lowerPayload = payload.toLowerCase();

	for (const seed of seeds) {
		const candidates = [seed.value, ...seed.variants].filter((s) => s && s.length > 0);
		for (const candidate of candidates) {
			const lowerCand = candidate.toLowerCase();
			let pos: number;
			if (candidate.length <= 3) {
				// Word-boundary scan für kurze Strings.
				const re = new RegExp(`\\b${escapeRegExp(lowerCand)}\\b`);
				const m = lowerPayload.match(re);
				if (!m || m.index === undefined) continue;
				pos = m.index;
			} else {
				pos = lowerPayload.indexOf(lowerCand);
				if (pos < 0) continue;
			}

			const ctxStart = Math.max(0, pos - 40);
			const ctxEnd = Math.min(payload.length, pos + candidate.length + 40);
			hits.push({
				seedId: seed.id,
				documentId: seed.documentId,
				category: seed.category,
				matchedString: payload.slice(pos, pos + candidate.length),
				matchedAt: pos,
				context: payload.slice(ctxStart, ctxEnd)
			});
			break; // ein Hit pro Seed reicht zum Blocken
		}
	}

	return hits;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Asserter für Outbound-Calls.
 *
 * User-Setzung 2026-05-03: Hard-Block deaktiviert. Anonymisierung (DSGVO-
 * Pre-Processing für Qualifizierungs-Werke) und DSGVO-konforme Provider-
 * Wahl sind die expliziten User-Optionen für PII-sensitive Werke. Der
 * Failsafe als zusätzliche Belt-and-Suspenders-Schicht erzeugte False-
 * Positives (z.B. "Analyse" als person_name aus fehlerhaften PII-Seeds)
 * und blockte legitime Calls auf bereits anonymisierten Dokumenten.
 *
 * Funktion bleibt als no-op erhalten, damit Caller-Sites stabil bleiben.
 * Re-Aktivierung erfordert User-Setzung; bevor das passiert, sollten die
 * PII-Seeds einmal qualifiziert werden (False-Positive-Bereinigung).
 */
export async function assertSafeForExternal(
	_payload: string,
	_documentIds: string[],
	_provider: Provider
): Promise<void> {
	return;
}
