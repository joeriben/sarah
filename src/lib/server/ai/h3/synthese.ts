// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:SYNTHESE — Forward-Integration der DURCHFÜHRUNGS-BEFUNDE gegen die FRAGESTELLUNG.
//
// Mother-Setzung (project_three_heuristics_architecture.md):
//   "Eine SYNTHESE positioniert und systematisiert die ERKENNTNISSE
//   im Hinblick auf die FORSCHUNGSFRAGE. Das ist das GESAMTERGEBNIS
//   der Arbeit."
//   Konstrukte: GESAMTERGEBNIS, FRAGESTELLUNGS_ANTWORT.
//   Tools: H2-Baustein über das ganze Kapitel + ERKENNTNIS_INTEGRATION_PRÜFEN
//   + FRAGESTELLUNG_BEANTWORTUNG_EXTRAHIEREN.
//
// User-Setzungen 2026-05-04:
//   - Ein Konstrukt mit reichem content (Mother-Plural ist Felder-Plural,
//     nicht Konstrukt-Plural) — gesamtergebnisText, fragestellungsAntwortText
//     und erkenntnisIntegration[] in einem `construct_kind='GESAMTERGEBNIS'`-
//     Konstrukt. Sonst landeten zwei Konstrukte am selben Anker mit
//     überlappendem Inhalt.
//   - Werk-Aggregat (analog FORSCHUNGSGEGENSTAND): ein GESAMTERGEBNIS pro
//     Werk, anchor_element_ids = alle ¶ aller SYNTHESE-Container.
//     Begründung: "Gesamtergebnis der Arbeit" ist Werk-Ebene; FRAGESTELLUNG
//     ist Werk-Werk; mehrere SYNTHESE-Container werden im LLM-Prompt
//     getrennt benannt, aber zu einer GESAMTERGEBNIS-Lesart aggregiert.
//   - ERKENNTNIS_INTEGRATION-Output: binär (integriert/nicht-integriert)
//     + optional synthesisAnchorParagraphIndex (1-basiert; im Server-Code
//     auf paragraph_id gemappt) + optional hinweis (Critical-Friend-
//     Bemerkung bei nicht-Integration). coverageRatio berechnet aus
//     count(integriert=true) / count(BEFUNDE mit text!=null).
//   - Idempotenz: delete-before-insert auf GESAMTERGEBNIS für (case_id,
//     document_id). SYNTHESE wird nicht von späteren Heuristiken
//     re-spezifiziert; SCHLUSSREFLEXION setzt sich daneben, nicht
//     modifizierend. Kein version_stack jenseits des origin-Eintrags.
//
// Critical-Friend-Identität (project_critical_friend_identity.md):
//   Tool BESCHREIBT, was die SYNTHESE als Gesamtergebnis leistet und
//   wie die FRAGESTELLUNG beantwortet wird. Bei nicht-integrierten
//   BEFUNDEN: hinweis als Critical-Friend-Bemerkung ("Befund X bleibt
//   unberücksichtigt"), keine Wertung der SYNTHESE selbst ("schwach",
//   "lückenhaft").
//
// Cross-Typ-Reads (alle Pflicht):
//   - FRAGESTELLUNG aus EXPOSITION
//   - FORSCHUNGSGEGENSTAND aus GRUNDLAGENTHEORIE (ggf. EXKURS-modifiziert
//     — automatisch via SELECT, kein Aggregator-Read nötig)
//   - alle BEFUND-Konstrukte aus DURCHFÜHRUNG mit text!=null
//
// Persistenz: function_constructs mit construct_kind='GESAMTERGEBNIS',
//   outline_function_type='SYNTHESE', anchor_element_ids = alle ¶ aller
//   SYNTHESE-Container des Werks. version_stack mit origin-Eintrag.

import { z } from 'zod';
import { query, queryOne } from '../../db/index.js';
import { chat, type Provider } from '../client.js';
import { extractAndValidateJSON, type ExtractResult } from '../json-extract.js';

// ── Container-Loading ─────────────────────────────────────────────

export interface SyntheseParagraph {
	paragraphId: string;
	charStart: number;
	charEnd: number;
	text: string;
	indexInContainer: number;
	indexInWerk: number; // 1-basiert über alle SYNTHESE-Container
}

export interface SyntheseContainer {
	headingId: string;
	headingText: string;
	paragraphs: SyntheseParagraph[];
}

export async function loadSyntheseContainers(
	documentId: string
): Promise<SyntheseContainer[]> {
	// Identisches Container-Loading-Pattern wie GRUNDLAGENTHEORIE/
	// DURCHFÜHRUNG/EXKURS: ¶ über LATERAL-Lookup dem nächstgelegenen
	// Heading mit outline_function_type='SYNTHESE' zugeordnet.
	const rows = (await query<{
		paragraph_id: string;
		char_start: number;
		char_end: number;
		text: string;
		heading_id: string;
		heading_text: string;
	}>(
		`WITH heading_with_type AS (
		   SELECT de.id AS heading_id,
		          de.char_start,
		          de.char_end,
		          hc.outline_function_type,
		          SUBSTRING(dc.full_text FROM de.char_start + 1
		                                 FOR de.char_end - de.char_start) AS heading_text
		   FROM document_elements de
		   JOIN heading_classifications hc ON hc.element_id = de.id
		   JOIN document_content dc ON dc.naming_id = de.document_id
		   WHERE de.document_id = $1
		     AND de.element_type = 'heading'
		     AND de.section_kind = 'main'
		     AND hc.outline_function_type IS NOT NULL
		     AND COALESCE(hc.excluded, false) = false
		 )
		 SELECT p.id AS paragraph_id,
		        p.char_start,
		        p.char_end,
		        SUBSTRING(dc.full_text FROM p.char_start + 1
		                              FOR p.char_end - p.char_start) AS text,
		        h.heading_id,
		        h.heading_text
		 FROM document_elements p
		 JOIN document_content dc ON dc.naming_id = p.document_id
		 JOIN LATERAL (
		   SELECT hwt.heading_id, hwt.heading_text, hwt.outline_function_type
		   FROM heading_with_type hwt
		   WHERE hwt.char_start <= p.char_start
		   ORDER BY hwt.char_start DESC
		   LIMIT 1
		 ) h ON h.outline_function_type = 'SYNTHESE'
		 WHERE p.document_id = $1
		   AND p.element_type = 'paragraph'
		   AND p.section_kind = 'main'
		 ORDER BY p.char_start`,
		[documentId]
	)).rows;

	const byHeading = new Map<string, SyntheseContainer>();
	let werkIndex = 1;
	for (const r of rows) {
		let c = byHeading.get(r.heading_id);
		if (!c) {
			c = {
				headingId: r.heading_id,
				headingText: r.heading_text.trim(),
				paragraphs: [],
			};
			byHeading.set(r.heading_id, c);
		}
		c.paragraphs.push({
			paragraphId: r.paragraph_id,
			charStart: r.char_start,
			charEnd: r.char_end,
			text: r.text.trim(),
			indexInContainer: c.paragraphs.length,
			indexInWerk: werkIndex++,
		});
	}
	return Array.from(byHeading.values());
}

// ── Cross-Typ-Reads ────────────────────────────────────────────────

interface ConstructDuplicateInfo {
	count: number;
	duplicate: boolean;
}

async function loadFragestellungWithDiagnostics(
	caseId: string,
	documentId: string
): Promise<{ text: string | null; diag: ConstructDuplicateInfo }> {
	const countRow = await queryOne<{ n: string }>(
		`SELECT count(*)::text AS n
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'EXPOSITION'
		   AND construct_kind = 'FRAGESTELLUNG'`,
		[caseId, documentId]
	);
	const count = countRow ? Number(countRow.n) : 0;
	const row = await queryOne<{ content: { text?: string } }>(
		`SELECT content
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'EXPOSITION'
		   AND construct_kind = 'FRAGESTELLUNG'
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[caseId, documentId]
	);
	return {
		text: row?.content?.text ?? null,
		diag: { count, duplicate: count > 1 },
	};
}

interface ForschungsgegenstandSnippet {
	text: string;
	subjectKeywords: string[];
}

async function loadForschungsgegenstandWithDiagnostics(
	caseId: string,
	documentId: string
): Promise<{ fg: ForschungsgegenstandSnippet | null; diag: ConstructDuplicateInfo }> {
	const countRow = await queryOne<{ n: string }>(
		`SELECT count(*)::text AS n
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'FORSCHUNGSGEGENSTAND'`,
		[caseId, documentId]
	);
	const count = countRow ? Number(countRow.n) : 0;
	const row = await queryOne<{
		content: { text: string; subjectKeywords?: string[] };
	}>(
		`SELECT content
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'FORSCHUNGSGEGENSTAND'
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[caseId, documentId]
	);
	if (!row) return { fg: null, diag: { count, duplicate: count > 1 } };
	return {
		fg: {
			text: row.content.text,
			subjectKeywords: row.content.subjectKeywords ?? [],
		},
		diag: { count, duplicate: count > 1 },
	};
}

interface BefundFromDb {
	id: string;
	text: string;
	anchorParagraphId: string;
	containerHeadingText: string | null;
}

async function loadBefundsWithText(
	caseId: string,
	documentId: string
): Promise<BefundFromDb[]> {
	// Lade alle BEFUND-Konstrukte aus DURCHFÜHRUNG mit text!=null
	// (nicht-leere ERKENNTNISSE). text=null ist Audit-Trail-Eintrag
	// (Hotspot geprüft, kein Befund extrahiert) — wird hier ausgeblendet.
	// Container-Heading-Verknüpfung ausgelassen: BEFUNDE sind ¶-anker;
	// das DURCHFÜHRUNGS-Container-Heading via virtual_function_containers
	// wäre eine Folge-Erweiterung (heute nicht im Prompt benötigt).
	const rows = (await query<{
		id: string;
		text: string;
		anchor_paragraph_id: string;
	}>(
		`SELECT fc.id,
		        fc.content->>'text' AS text,
		        (fc.anchor_element_ids[1])::text AS anchor_paragraph_id
		 FROM function_constructs fc
		 WHERE fc.case_id = $1
		   AND fc.document_id = $2
		   AND fc.outline_function_type = 'DURCHFUEHRUNG'
		   AND fc.construct_kind = 'BEFUND'
		   AND fc.content->>'text' IS NOT NULL
		   AND fc.content->>'text' <> ''
		 ORDER BY fc.created_at`,
		[caseId, documentId]
	)).rows;

	return rows.map((r) => ({
		id: r.id,
		text: r.text,
		anchorParagraphId: r.anchor_paragraph_id,
		containerHeadingText: null,
	}));
}

// ── LLM-Call: GESAMTERGEBNIS extrahieren ──────────────────────────

const ErkenntnisIntegrationItemSchema = z.object({
	befundIndex: z.number().int().min(1),
	integriert: z.boolean(),
	synthesisAnchorParagraphIndex: z.number().int().min(1).nullable(),
	hinweis: z.string().nullable(),
});

const GesamtergebnisLLMSchema = z.object({
	gesamtergebnisText: z.string().min(1),
	fragestellungsAntwortText: z.string().min(1),
	erkenntnisIntegration: z.array(ErkenntnisIntegrationItemSchema),
});
type GesamtergebnisLLMResult = z.infer<typeof GesamtergebnisLLMSchema>;

interface ExtractGesamtergebnisInput {
	fragestellung: string;
	forschungsgegenstand: ForschungsgegenstandSnippet;
	syntheseContainers: SyntheseContainer[];
	befunds: BefundFromDb[];
	documentId: string;
	maxTokens: number;
	modelOverride?: { provider: Provider; model: string };
}

async function extractGesamtergebnis(input: ExtractGesamtergebnisInput): Promise<{
	result: GesamtergebnisLLMResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	const system = [
		'Du bist ein analytisches Werkzeug, das aus den SYNTHESE-Kapiteln einer wissenschaftlichen Arbeit deren GESAMTERGEBNIS extrahiert und prüft, welche der zuvor in der DURCHFÜHRUNG extrahierten BEFUNDE in der SYNTHESE adressiert werden.',
		'',
		'Begriffe (für das Verständnis der Aufgabe):',
		'',
		'  FRAGESTELLUNG: die in der Einleitung formulierte Forschungsfrage.',
		'',
		'  FORSCHUNGSGEGENSTAND: die durch die Theoriearbeit erfolgte begriffliche Spezifizierung der FRAGESTELLUNG (ggf. nach EXKURS-Re-Spezifikationen).',
		'',
		'  BEFUNDE (DURCHFÜHRUNG): die im Analyse-Teil der Arbeit identifizierten empirischen oder theoretischen Ergebnisse — jeweils ein 1–3-Satz-Extrakt aus einem Hotspot-Absatz.',
		'',
		'  SYNTHESE: das/die Kapitel, in dem/denen die Arbeit ihre BEFUNDE positioniert und systematisiert, im Hinblick auf die FRAGESTELLUNG.',
		'',
		'  GESAMTERGEBNIS: die deskriptive Zusammenfassung dessen, was die SYNTHESE als Gesamtergebnis der Arbeit leistet — kein Urteil über die Qualität, sondern die Rekonstruktion des integrierten Befunds.',
		'',
		'  FRAGESTELLUNGS_ANTWORT: die Antwort, die die Arbeit auf die FRAGESTELLUNG gibt — wie sie aus der SYNTHESE hervorgeht.',
		'',
		'Aufgabe in drei Teilen:',
		'',
		'  TEIL A — gesamtergebnisText:',
		'    3–5 Sätze deskriptiv. Beschreibe, was die SYNTHESE als Gesamtergebnis der Arbeit leistet — welche zentrale Linie über die BEFUNDE gezogen wird, wie die theoretische Einordnung erfolgt. Eigene Worte, kein Zitat.',
		'',
		'  TEIL B — fragestellungsAntwortText:',
		'    1–3 Sätze deskriptiv. Wie beantwortet die Arbeit die FRAGESTELLUNG? Wenn die SYNTHESE die Antwort nur teilweise oder implizit gibt, das so beschreiben (z.B. "Die Frage wird teilweise beantwortet — der Aspekt X bleibt offen"). Wenn die SYNTHESE eine klare Antwort gibt, diese knapp wiedergeben.',
		'',
		'  TEIL C — erkenntnisIntegration:',
		'    Pro vorgelegtem BEFUND (1-basierter Index): prüfe, ob er in der SYNTHESE adressiert wird — d.h. ob die SYNTHESE auf diesen Befund Bezug nimmt, ihn integriert oder weiterführt. Output pro Befund:',
		'      - befundIndex: 1-basierte Position in der vorgelegten Liste',
		'      - integriert: true/false',
		'      - synthesisAnchorParagraphIndex: wenn integriert=true, der 1-basierte Index des SYNTHESE-¶, der diesen Befund am deutlichsten aufgreift. Sonst null.',
		'      - hinweis: bei integriert=false, eine kurze Critical-Friend-Bemerkung (1 Satz) zum nicht-integrierten Befund (z.B. "Befund X zur Wirkung von Y bleibt unerwähnt"). Bei integriert=true: null oder ein knapper Bezugs-Hinweis.',
		'',
		'Stil: DESKRIPTIV. Du beschreibst, was die SYNTHESE leistet und welche BEFUNDE sie integriert. Du beurteilst die SYNTHESE NICHT (kein "stark", "schwach", "lückenhaft"). Critical-Friend-hinweise zu nicht-integrierten BEFUNDEN sind erlaubt — als Lese-Hinweis, nicht als Urteil.',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "gesamtergebnisText": "<3–5 Sätze deskriptiv>",',
		'  "fragestellungsAntwortText": "<1–3 Sätze deskriptiv>",',
		'  "erkenntnisIntegration": [',
		'    {"befundIndex": 1, "integriert": true|false, "synthesisAnchorParagraphIndex": <int>|null, "hinweis": "<text>"|null},',
		'    ...',
		'  ]',
		'}',
	].join('\n');

	// SYNTHESE-Text mit globalem ¶-Index aufbereiten
	const syntheseBlocks: string[] = [];
	for (const c of input.syntheseContainers) {
		syntheseBlocks.push(`### ${c.headingText} (${c.paragraphs.length} ¶)`);
		for (const p of c.paragraphs) {
			syntheseBlocks.push(`[¶${p.indexInWerk}] ${p.text}`);
		}
		syntheseBlocks.push('');
	}
	const syntheseText = syntheseBlocks.join('\n\n');

	// BEFUNDE-Liste mit Index
	const befundBlocks =
		input.befunds.length > 0
			? input.befunds
					.map((b, i) => `[Befund ${i + 1}] ${b.text}`)
					.join('\n\n')
			: '(keine BEFUND-Konstrukte aus DURCHFÜHRUNG mit text!=null vorhanden)';

	const subjectKeywordsBlock =
		input.forschungsgegenstand.subjectKeywords.length > 0
			? input.forschungsgegenstand.subjectKeywords.map((k) => `- ${k}`).join('\n')
			: '(keine subjectKeywords erfasst)';

	const userMessage = [
		`FRAGESTELLUNG der Arbeit:`,
		input.fragestellung,
		'',
		`FORSCHUNGSGEGENSTAND (aus GRUNDLAGENTHEORIE, ggf. nach EXKURS-Re-Spezifikationen):`,
		input.forschungsgegenstand.text,
		'',
		`Kernbegriffe (subjectKeywords):`,
		subjectKeywordsBlock,
		'',
		`BEFUNDE aus DURCHFÜHRUNG (insgesamt ${input.befunds.length}):`,
		'',
		befundBlocks,
		'',
		`SYNTHESE-Container (${input.syntheseContainers.length}, gesamt ${input.syntheseContainers.reduce((s, c) => s + c.paragraphs.length, 0)} ¶):`,
		'',
		syntheseText,
	].join('\n');

	const t0 = Date.now();
	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: input.maxTokens,
		responseFormat: 'json',
		documentIds: [input.documentId],
		modelOverride: input.modelOverride,
	});
	const timingMs = Date.now() - t0;

	const parsed: ExtractResult<GesamtergebnisLLMResult> = extractAndValidateJSON(
		response.text,
		GesamtergebnisLLMSchema
	);
	if (!parsed.ok) {
		const stage = 'stage' in parsed ? parsed.stage : 'unknown';
		const error = 'error' in parsed ? parsed.error : 'unknown';
		throw new Error(
			`SYNTHESE-GESAMTERGEBNIS: Antwort nicht parsbar (stage=${stage}): ${error}\n` +
				`Raw: ${response.text.slice(0, 500)}`
		);
	}

	return {
		result: parsed.value,
		model: response.model,
		provider: response.provider,
		timingMs,
		tokens: { input: response.inputTokens, output: response.outputTokens },
	};
}

// ── Persistenz ────────────────────────────────────────────────────

interface ErkenntnisIntegrationEntry {
	befundId: string;
	befundSnippet: string;
	integriert: boolean;
	synthesisAnchorParagraphId: string | null;
	hinweis: string | null;
}

interface GesamtergebnisContent {
	gesamtergebnisText: string;
	fragestellungsAntwortText: string;
	erkenntnisIntegration: ErkenntnisIntegrationEntry[];
	coverageRatio: number | null;
	containerOverview: Array<{ headingText: string; paragraphCount: number }>;
	befundCount: number;
	llmModel: string;
	llmTimingMs: number;
}

async function clearExistingGesamtergebnis(
	caseId: string,
	documentId: string
): Promise<number> {
	const result = await query(
		`DELETE FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'SYNTHESE'
		   AND construct_kind = 'GESAMTERGEBNIS'`,
		[caseId, documentId]
	);
	return result.rowCount ?? 0;
}

async function persistGesamtergebnis(
	caseId: string,
	documentId: string,
	allParagraphIds: string[],
	content: GesamtergebnisContent
): Promise<string> {
	if (allParagraphIds.length === 0) {
		throw new Error('GESAMTERGEBNIS: keine SYNTHESE-¶ als Anker.');
	}
	const stackEntry = {
		kind: 'origin' as const,
		at: new Date().toISOString(),
		by_user_id: null,
		source_run_id: null,
		content_snapshot: content,
	};
	const row = await queryOne<{ id: string }>(
		`INSERT INTO function_constructs
		   (case_id, document_id, outline_function_type, construct_kind,
		    anchor_element_ids, content, version_stack)
		 VALUES ($1, $2, 'SYNTHESE', 'GESAMTERGEBNIS', $3, $4, $5)
		 RETURNING id`,
		[
			caseId,
			documentId,
			allParagraphIds,
			JSON.stringify(content),
			JSON.stringify([stackEntry]),
		]
	);
	if (!row) throw new Error('Failed to persist GESAMTERGEBNIS');
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

const DEFAULT_SYNTHESE_MODEL: { provider: Provider; model: string } = {
	provider: 'openrouter',
	model: 'anthropic/claude-sonnet-4.6',
};

const DEFAULT_MAX_TOKENS = 2000;

export interface SynthesePassOptions {
	persistConstructs?: boolean;
	maxTokens?: number;
	modelOverride?: { provider: Provider; model: string };
}

export interface SyntheseContainerSummary {
	headingId: string;
	headingText: string;
	paragraphCount: number;
}

export interface SynthesePassResult {
	caseId: string;
	documentId: string;
	syntheseContainers: SyntheseContainerSummary[];
	befundCount: number;
	fragestellungSnippet: string | null;
	forschungsgegenstandSnippet: string | null;
	subjectKeywords: string[];
	gesamtergebnis: {
		text: string;
		fragestellungsAntwort: string;
		erkenntnisIntegration: ErkenntnisIntegrationEntry[];
		coverageRatio: number | null;
	} | null;
	constructId: string | null;
	deletedPriorCount: number;
	llmCalls: number;
	llmTimingMs: number;
	tokens: { input: number; output: number };
	provider: string;
	model: string;
	diagnostics: {
		fragestellungCount: number;
		forschungsgegenstandCount: number;
		warnings: string[];
	};
}

export async function runSynthesePass(
	caseId: string,
	options: SynthesePassOptions = {}
): Promise<SynthesePassResult> {
	const persistConstructs = options.persistConstructs !== false;
	const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
	const modelOverride = options.modelOverride ?? DEFAULT_SYNTHESE_MODEL;
	const warnings: string[] = [];

	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.central_document_id) {
		throw new Error(`Case ${caseId} has no central_document_id`);
	}
	const documentId = caseRow.central_document_id;

	const containers = await loadSyntheseContainers(documentId);

	const fsRes = await loadFragestellungWithDiagnostics(caseId, documentId);
	const fgRes = await loadForschungsgegenstandWithDiagnostics(caseId, documentId);

	if (fsRes.diag.duplicate) {
		warnings.push(
			`FRAGESTELLUNG: ${fsRes.diag.count} Konstrukte vorhanden — jüngstes wird verwendet. ` +
				`Cleanup empfohlen.`
		);
	}
	if (fgRes.diag.duplicate) {
		warnings.push(
			`FORSCHUNGSGEGENSTAND: ${fgRes.diag.count} Konstrukte vorhanden — jüngstes wird ` +
				`verwendet. Cleanup empfohlen.`
		);
	}

	// No-op: keine SYNTHESE-Container im Werk → leerer Pass.
	if (containers.length === 0) {
		return {
			caseId,
			documentId,
			syntheseContainers: [],
			befundCount: 0,
			fragestellungSnippet: fsRes.text?.slice(0, 200) ?? null,
			forschungsgegenstandSnippet: fgRes.fg?.text.slice(0, 200) ?? null,
			subjectKeywords: fgRes.fg?.subjectKeywords ?? [],
			gesamtergebnis: null,
			constructId: null,
			deletedPriorCount: 0,
			llmCalls: 0,
			llmTimingMs: 0,
			tokens: { input: 0, output: 0 },
			provider: '',
			model: '',
			diagnostics: {
				fragestellungCount: fsRes.diag.count,
				forschungsgegenstandCount: fgRes.diag.count,
				warnings,
			},
		};
	}

	if (!fsRes.text) {
		throw new Error(
			`Werk ${documentId}: FRAGESTELLUNG fehlt. ` +
				`Erst H3:EXPOSITION laufen (scripts/test-h3-exposition.ts <caseId>).`
		);
	}
	if (!fgRes.fg) {
		throw new Error(
			`Werk ${documentId}: FORSCHUNGSGEGENSTAND fehlt. ` +
				`Erst H3:GRUNDLAGENTHEORIE Schritt 4 ` +
				`(scripts/test-h3-forschungsgegenstand.ts <caseId>) laufen.`
		);
	}

	const befunds = await loadBefundsWithText(caseId, documentId);

	const llmRes = await extractGesamtergebnis({
		fragestellung: fsRes.text,
		forschungsgegenstand: fgRes.fg,
		syntheseContainers: containers,
		befunds,
		documentId,
		maxTokens,
		modelOverride,
	});

	// LLM-Indices auf paragraph_id und befund_id zurückmappen.
	// SYNTHESE-¶ haben indexInWerk (1-basiert über alle Container).
	const werkParagraphIndex = new Map<number, string>();
	for (const c of containers) {
		for (const p of c.paragraphs) {
			werkParagraphIndex.set(p.indexInWerk, p.paragraphId);
		}
	}

	const integrationEntries: ErkenntnisIntegrationEntry[] = [];
	for (const item of llmRes.result.erkenntnisIntegration) {
		const befund = befunds[item.befundIndex - 1];
		if (!befund) continue; // LLM hat ungültigen Index produziert — überspringen
		const synthesisAnchorParagraphId =
			item.synthesisAnchorParagraphIndex !== null
				? (werkParagraphIndex.get(item.synthesisAnchorParagraphIndex) ?? null)
				: null;
		integrationEntries.push({
			befundId: befund.id,
			befundSnippet: befund.text.slice(0, 200),
			integriert: item.integriert,
			synthesisAnchorParagraphId,
			hinweis: item.hinweis,
		});
	}

	const integratedCount = integrationEntries.filter((e) => e.integriert).length;
	const coverageRatio =
		integrationEntries.length > 0 ? integratedCount / integrationEntries.length : null;

	const allParagraphIds: string[] = [];
	for (const c of containers) {
		for (const p of c.paragraphs) {
			allParagraphIds.push(p.paragraphId);
		}
	}

	const content: GesamtergebnisContent = {
		gesamtergebnisText: llmRes.result.gesamtergebnisText,
		fragestellungsAntwortText: llmRes.result.fragestellungsAntwortText,
		erkenntnisIntegration: integrationEntries,
		coverageRatio,
		containerOverview: containers.map((c) => ({
			headingText: c.headingText,
			paragraphCount: c.paragraphs.length,
		})),
		befundCount: befunds.length,
		llmModel: llmRes.model,
		llmTimingMs: llmRes.timingMs,
	};

	let constructId: string | null = null;
	let deletedPriorCount = 0;
	if (persistConstructs) {
		deletedPriorCount = await clearExistingGesamtergebnis(caseId, documentId);
		constructId = await persistGesamtergebnis(
			caseId,
			documentId,
			allParagraphIds,
			content
		);
	}

	return {
		caseId,
		documentId,
		syntheseContainers: containers.map((c) => ({
			headingId: c.headingId,
			headingText: c.headingText,
			paragraphCount: c.paragraphs.length,
		})),
		befundCount: befunds.length,
		fragestellungSnippet: fsRes.text.slice(0, 200),
		forschungsgegenstandSnippet: fgRes.fg.text.slice(0, 200),
		subjectKeywords: fgRes.fg.subjectKeywords,
		gesamtergebnis: {
			text: content.gesamtergebnisText,
			fragestellungsAntwort: content.fragestellungsAntwortText,
			erkenntnisIntegration: content.erkenntnisIntegration,
			coverageRatio: content.coverageRatio,
		},
		constructId,
		deletedPriorCount,
		llmCalls: 1,
		llmTimingMs: llmRes.timingMs,
		tokens: llmRes.tokens,
		provider: llmRes.provider,
		model: llmRes.model,
		diagnostics: {
			fragestellungCount: fsRes.diag.count,
			forschungsgegenstandCount: fgRes.diag.count,
			warnings,
		},
	};
}
