// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:EXKURS — Re-Spezifikations-Akt am Forschungsgegenstand.
//
// Mother-Setzung (project_three_heuristics_architecture.md):
//   "EXKURSE sind iterativ spezifizierte GRUNDLAGENTHEORIE auf Basis
//   gewonnener ERKENNTNISSE." Konstrukte: EXKURS_ANKER (auslösende
//   Anlass-Stelle), RE_SPEC_AKT (neuer Designations-Akt im Stack des
//   betroffenen KERNBEGRIFFS, kein Overwrite).
//
// User-Setzung 2026-05-03 spätabends (Folge-Session zur Mother):
//   - EXKURS ist keine GRUNDLAGENTHEORIE-Spiegelung (keine Verweisprofil-
//     /Routing-Pipeline), sondern eine theoretische Wendung des Autors,
//     die einen externen Begriff einführt und damit Begriffe des bisherigen
//     FORSCHUNGSGEGENSTANDs in einer neuen Lesart re-spezifiziert.
//     Beispiel: Arbeit auf Bourdieus Habitus aufbauend; EXKURS diskutiert
//     Foucaults Dispositivbegriff; danach wird Habitus als foucaultsche
//     Disponierung verstanden.
//   - "Trigger-BEFUND" ist nicht systematisch herstellbar (weder FK auf
//     DURCHFÜHRUNGS-BEFUND noch sonst computable). Anlass-Text aus dem
//     EXKURS selbst (Eingangs-¶) reicht — wird in RE_SPEC_AKT.content.
//     exkursAnchorText abgelegt, kein separates EXKURS_ANKER-Konstrukt.
//   - RE_SPEC_AKT zielt auf den FORSCHUNGSGEGENSTAND (Werk-Konstrukt),
//     nicht auf isolierte subjectKeywords. Affected concepts werden
//     bevorzugt aus den vorgegebenen subjectKeywords gewählt.
//   - Stack-Repräsentation Option C (User-Bestätigung): RE_SPEC_AKT als
//     eigenes Konstrukt mit eigenem origin-Stack-Eintrag, KEIN Append-
//     Modify am vorgelagerten FORSCHUNGSGEGENSTAND.version_stack.
//     Stack-Diff (für Reviewer-Indikator) ist später per Query
//     rekonstruierbar: SELECT alle RE_SPEC_AKT WHERE document_id ORDER BY
//     created_at oder Outline-Position.
//   - Idempotenz: delete-before-insert pro EXKURS-Container, damit Re-Run
//     keine Duplikate erzeugt. EXKURS produziert NIEMALS einen neuen
//     FORSCHUNGSGEGENSTAND/FRAGESTELLUNG, nur RE_SPEC_AKT.
//
// Critical-Friend-Identität (project_critical_friend_identity.md):
//   Tool BESCHREIBT, was im EXKURS passiert (welcher Begriff wird neu
//   eingeführt, welcher wird umgedeutet, neue Lesart). KEINE Wertung
//   ("guter EXKURS" / "verkürzt"). Reviewer-Indikator (Stack-Diff
//   Erweiterung/Verschiebung/Regression) ist deferred bis WERK-Ebene
//   und arbeitet auf dem read-only-Aggregat der RE_SPEC_AKT-Konstrukte.
//
// Persistenz: function_constructs mit construct_kind='RE_SPEC_AKT',
//   outline_function_type='EXKURS'. Pro EXKURS-Container ein Konstrukt
//   (anchor_element_ids = alle ¶ des Containers). version_stack hat einen
//   origin-Eintrag mit content_snapshot — analog FORSCHUNGSGEGENSTAND.

import { z } from 'zod';
import { query, queryOne } from '../../db/index.js';
import { chat, type Provider } from '../client.js';
import { extractAndValidateJSON, type ExtractResult } from '../json-extract.js';

// ── Container-Loading ─────────────────────────────────────────────

export interface ExkursParagraph {
	paragraphId: string;
	charStart: number;
	charEnd: number;
	text: string;
	indexInContainer: number;
}

export interface ExkursContainer {
	headingId: string;
	headingText: string;
	paragraphs: ExkursParagraph[];
}

export async function loadExkursContainers(
	documentId: string
): Promise<ExkursContainer[]> {
	// Identisches Container-Loading-Pattern wie GRUNDLAGENTHEORIE/
	// DURCHFÜHRUNG: ¶ über LATERAL-Lookup dem nächstgelegenen Heading mit
	// outline_function_type='EXKURS' zugeordnet. Mother-Setzung:
	// "Default: Exkurs: Kapitel, immer (ist oft eh ein Unterkapitel)" —
	// also ein Heading = ein Container, gleich welche Outline-Tiefe.
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
		 ) h ON h.outline_function_type = 'EXKURS'
		 WHERE p.document_id = $1
		   AND p.element_type = 'paragraph'
		   AND p.section_kind = 'main'
		 ORDER BY p.char_start`,
		[documentId]
	)).rows;

	const byHeading = new Map<string, ExkursContainer>();
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
		});
	}
	return Array.from(byHeading.values());
}

// ── Cross-Typ-Reads (mit Duplikat-Diagnose) ───────────────────────

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

interface ForschungsgegenstandFromDb {
	id: string;
	text: string;
	subjectKeywords: string[];
}

async function loadForschungsgegenstandWithDiagnostics(
	caseId: string,
	documentId: string
): Promise<{
	fg: ForschungsgegenstandFromDb | null;
	diag: ConstructDuplicateInfo;
}> {
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
		id: string;
		content: { text: string; subjectKeywords?: string[] };
	}>(
		`SELECT id, content
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'FORSCHUNGSGEGENSTAND'
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[caseId, documentId]
	);

	if (!row) {
		return { fg: null, diag: { count, duplicate: count > 1 } };
	}
	return {
		fg: {
			id: row.id,
			text: row.content.text,
			subjectKeywords: row.content.subjectKeywords ?? [],
		},
		diag: { count, duplicate: count > 1 },
	};
}

// ── LLM-Call: RE_SPEC_AKT extrahieren ──────────────────────────────

const ImportedConceptSchema = z.object({
	name: z.string().min(1),
	sourceAuthor: z.string().nullable().optional(),
});

const RespecAktSchema = z.object({
	importedConcepts: z.array(ImportedConceptSchema),
	affectedConcepts: z.array(z.string().min(1)),
	reSpecText: z.string().min(1),
	exkursAnchorText: z.string().nullable(),
	noRespec: z.boolean().optional(),
});
type RespecAktResult = z.infer<typeof RespecAktSchema>;

interface ExtractRespecAktInput {
	fragestellung: string;
	forschungsgegenstand: string;
	subjectKeywords: string[];
	exkursContainer: ExkursContainer;
	documentId: string;
	maxTokens: number;
	modelOverride?: { provider: Provider; model: string };
}

async function extractRespecAkt(input: ExtractRespecAktInput): Promise<{
	result: RespecAktResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	const system = [
		'Du bist ein analytisches Werkzeug, das aus einem EXKURS einer wissenschaftlichen Arbeit den darin vollzogenen RE-SPEZIFIKATIONS-AKT extrahiert.',
		'',
		'Begriffe (für das Verständnis der Aufgabe):',
		'',
		'  FORSCHUNGSGEGENSTAND: die Spezifizierung der FRAGESTELLUNG durch die in der Theoriearbeit erfolgte begriffliche Verortung. Er bildet den begrifflichen Bezugsrahmen, gegen den der EXKURS gelesen wird.',
		'',
		'  EXKURS: ein theoretischer Detour innerhalb der Arbeit, der typischerweise einen externen Begriff einführt und damit einen oder mehrere Begriffe des bisherigen FORSCHUNGSGEGENSTANDs in einer neuen Lesart re-spezifiziert. Beispiel: Eine Arbeit baut auf Bourdieus Habitusbegriff auf; ein EXKURS diskutiert Foucaults Dispositivbegriff; danach wird Habitus als foucaultsche Disponierung verstanden.',
		'',
		'  RE_SPEC_AKT: die im EXKURS vollzogene begriffliche Umarbeitung. Sie hat drei Komponenten:',
		'    importedConcepts: die im EXKURS neu eingeführten Begriffe (mit Quellen-Autor, falls erkennbar — z.B. "Dispositiv (Foucault)"). Leer, wenn der EXKURS keinen externen Begriff einführt.',
		'    affectedConcepts: die Begriffe des bisherigen FORSCHUNGSGEGENSTANDs, die durch den EXKURS umgedeutet/erweitert werden. Bevorzugt aus den vorgegebenen subjectKeywords wählen; nur freie Begriffe nennen, wenn keiner der subjectKeywords passt. Leer, wenn der EXKURS keinen vorhandenen Begriff umdeutet.',
		'    reSpecText: 1–3 Sätze, die die neue Lesart darstellen — wie der affizierte Begriff jetzt im Lichte des importierten Begriffs zu verstehen ist. Bei keinem RE_SPEC: kurzer Hinweis "EXKURS vollzieht keinen Re-Spezifikations-Akt am Forschungsgegenstand; Inhalt: <kurze Beschreibung>".',
		'',
		'Zusätzlich, wenn der EXKURS am Anfang explizit seinen Anlass benennt ("Im Folgenden wird X diskutiert, weil…", "Bevor wir weitergehen, ist eine Klärung von Y nötig", etc.), extrahiere diesen Anlass-Text wörtlich oder paraphrasiert als exkursAnchorText. Sonst null.',
		'',
		'Sonderfall: Wenn der EXKURS nur ergänzende Hintergrundinfo liefert (z.B. historische Notiz, Autor-Biografie, Methoden-Klärung) und KEINE begriffliche Umarbeitung des FORSCHUNGSGEGENSTANDs vollzieht, setze noRespec=true und liefere leere Arrays für importedConcepts/affectedConcepts. reSpecText enthält dann den Hinweis wie oben.',
		'',
		'Stil: DESKRIPTIV. Du beschreibst, was im EXKURS passiert. Du beurteilst NICHT (kein "guter EXKURS", "verkürzt", "tiefgehend"). Eigene Worte, keine wörtlichen Zitate (außer für exkursAnchorText, wenn der Anlass explizit formuliert ist).',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "importedConcepts": [{"name": "<Begriff>", "sourceAuthor": "<Autor>"|null}, ...],',
		'  "affectedConcepts": ["<Begriff>", ...],',
		'  "reSpecText": "<1–3 Sätze beschreibend>",',
		'  "exkursAnchorText": "<vom EXKURS selbst formulierter Anlass>"|null,',
		'  "noRespec": true|false (optional, default false)',
		'}',
	].join('\n');

	const exkursText = input.exkursContainer.paragraphs
		.map((p, i) => `[¶${i + 1}] ${p.text}`)
		.join('\n\n');

	const subjectKeywordsBlock =
		input.subjectKeywords.length > 0
			? input.subjectKeywords.map((k) => `- ${k}`).join('\n')
			: '(keine subjectKeywords im FORSCHUNGSGEGENSTAND erfasst)';

	const userMessage = [
		`FRAGESTELLUNG der Arbeit:`,
		input.fragestellung,
		'',
		`FORSCHUNGSGEGENSTAND (aus GRUNDLAGENTHEORIE rekonstruiert):`,
		input.forschungsgegenstand,
		'',
		`Bisherige Kernbegriffe (subjectKeywords aus FORSCHUNGSGEGENSTAND):`,
		subjectKeywordsBlock,
		'',
		`EXKURS "${input.exkursContainer.headingText}" (${input.exkursContainer.paragraphs.length} ¶):`,
		'',
		exkursText,
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

	const parsed: ExtractResult<RespecAktResult> = extractAndValidateJSON(
		response.text,
		RespecAktSchema
	);
	if (!parsed.ok) {
		// Bestehender Project-Type-Issue: TS-Compiler erkennt das
		// Discriminated-Union-Narrowing nicht (gleicher Effekt in
		// grundlagentheorie_forschungsgegenstand.ts L379). Workaround:
		// Failure-Branch via Property-Access mit 'in'-Guard ausgelesen.
		const stage = 'stage' in parsed ? parsed.stage : 'unknown';
		const error = 'error' in parsed ? parsed.error : 'unknown';
		throw new Error(
			`RE_SPEC_AKT: Antwort nicht parsbar (stage=${stage}): ${error}\n` +
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

interface RespecAktContent {
	exkursHeadingText: string;
	importedConcepts: Array<{ name: string; sourceAuthor: string | null }>;
	affectedConcepts: string[];
	reSpecText: string;
	exkursAnchorText: string | null;
	noRespec: boolean;
	targetForschungsgegenstandId: string;
	llmModel: string;
	llmTimingMs: number;
}

async function clearExistingRespecActsForContainer(
	caseId: string,
	documentId: string,
	containerParagraphIds: string[]
): Promise<number> {
	// Idempotenz: alle RE_SPEC_AKT für DIESEN EXKURS-Container löschen,
	// bevor neuer eingefügt wird. Match über gleichen anchor_element_ids-
	// Set (= gleicher EXKURS-Container). Bei Re-Run mit veränderten
	// EXKURS-¶-Bestand (sehr selten — nur bei reparseDocument) werden
	// alte RE_SPEC_AKT als orphan im Bestand bleiben, bis ein zweiter
	// Cleanup-Pass dahinter läuft.
	if (containerParagraphIds.length === 0) return 0;
	const result = await query(
		`DELETE FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'EXKURS'
		   AND construct_kind = 'RE_SPEC_AKT'
		   AND anchor_element_ids = $3::uuid[]`,
		[caseId, documentId, containerParagraphIds]
	);
	return result.rowCount ?? 0;
}

async function persistRespecAkt(
	caseId: string,
	documentId: string,
	containerParagraphIds: string[],
	content: RespecAktContent
): Promise<string> {
	if (containerParagraphIds.length === 0) {
		throw new Error('RE_SPEC_AKT: keine EXKURS-¶ als Anker.');
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
		 VALUES ($1, $2, 'EXKURS', 'RE_SPEC_AKT', $3, $4, $5)
		 RETURNING id`,
		[
			caseId,
			documentId,
			containerParagraphIds,
			JSON.stringify(content),
			JSON.stringify([stackEntry]),
		]
	);
	if (!row) throw new Error('Failed to persist RE_SPEC_AKT');
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

const DEFAULT_EXKURS_MODEL: { provider: Provider; model: string } = {
	provider: 'openrouter',
	model: 'anthropic/claude-sonnet-4.6',
};

const DEFAULT_MAX_TOKENS = 1500;

export interface ExkursPassOptions {
	persistConstructs?: boolean;
	maxTokens?: number;
	modelOverride?: { provider: Provider; model: string };
}

export interface ExkursContainerSummary {
	headingId: string;
	headingText: string;
	paragraphCount: number;
}

export interface RespecActResult {
	constructId: string | null;
	headingId: string;
	headingText: string;
	importedConcepts: Array<{ name: string; sourceAuthor: string | null }>;
	affectedConcepts: string[];
	reSpecText: string;
	exkursAnchorText: string | null;
	noRespec: boolean;
	deletedPriorCount: number;
}

export interface ExkursPassResult {
	caseId: string;
	documentId: string;
	exkursContainers: ExkursContainerSummary[];
	fragestellungSnippet: string | null;
	forschungsgegenstandSnippet: string | null;
	forschungsgegenstandId: string | null;
	subjectKeywords: string[];
	respecActs: RespecActResult[];
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

export async function runExkursPass(
	caseId: string,
	options: ExkursPassOptions = {}
): Promise<ExkursPassResult> {
	const persistConstructs = options.persistConstructs !== false;
	const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
	const modelOverride = options.modelOverride ?? DEFAULT_EXKURS_MODEL;
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

	const containers = await loadExkursContainers(documentId);

	const fsRes = await loadFragestellungWithDiagnostics(caseId, documentId);
	const fgRes = await loadForschungsgegenstandWithDiagnostics(caseId, documentId);

	if (fsRes.diag.duplicate) {
		warnings.push(
			`FRAGESTELLUNG: ${fsRes.diag.count} Konstrukte vorhanden — jüngstes wird verwendet. ` +
				`Cleanup empfohlen (manuell oder via dedizierter Skript).`
		);
	}
	if (fgRes.diag.duplicate) {
		warnings.push(
			`FORSCHUNGSGEGENSTAND: ${fgRes.diag.count} Konstrukte vorhanden — jüngstes wird verwendet. ` +
				`Cleanup empfohlen.`
		);
	}

	// No-op: keine EXKURS-Container im Werk → leerer Pass, keine
	// Pflicht-Voraussetzungs-Prüfung. Sauberer Exit für Werke ohne EXKURS.
	if (containers.length === 0) {
		return {
			caseId,
			documentId,
			exkursContainers: [],
			fragestellungSnippet: fsRes.text?.slice(0, 200) ?? null,
			forschungsgegenstandSnippet: fgRes.fg?.text.slice(0, 200) ?? null,
			forschungsgegenstandId: fgRes.fg?.id ?? null,
			subjectKeywords: fgRes.fg?.subjectKeywords ?? [],
			respecActs: [],
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
	const fragestellung = fsRes.text;
	const fg = fgRes.fg;

	const respecActs: RespecActResult[] = [];
	let totalLlmCalls = 0;
	let totalLlmTimingMs = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let lastProvider = '';
	let lastModel = '';

	for (const container of containers) {
		if (container.paragraphs.length === 0) continue;

		const llmRes = await extractRespecAkt({
			fragestellung,
			forschungsgegenstand: fg.text,
			subjectKeywords: fg.subjectKeywords,
			exkursContainer: container,
			documentId,
			maxTokens,
			modelOverride,
		});

		totalLlmCalls += 1;
		totalLlmTimingMs += llmRes.timingMs;
		totalInputTokens += llmRes.tokens.input;
		totalOutputTokens += llmRes.tokens.output;
		lastProvider = llmRes.provider;
		lastModel = llmRes.model;

		const content: RespecAktContent = {
			exkursHeadingText: container.headingText,
			importedConcepts: llmRes.result.importedConcepts.map((c) => ({
				name: c.name,
				sourceAuthor: c.sourceAuthor ?? null,
			})),
			affectedConcepts: llmRes.result.affectedConcepts,
			reSpecText: llmRes.result.reSpecText,
			exkursAnchorText: llmRes.result.exkursAnchorText,
			noRespec: llmRes.result.noRespec ?? false,
			targetForschungsgegenstandId: fg.id,
			llmModel: llmRes.model,
			llmTimingMs: llmRes.timingMs,
		};

		const containerParagraphIds = container.paragraphs.map((p) => p.paragraphId);

		let constructId: string | null = null;
		let deletedPriorCount = 0;
		if (persistConstructs) {
			deletedPriorCount = await clearExistingRespecActsForContainer(
				caseId,
				documentId,
				containerParagraphIds
			);
			constructId = await persistRespecAkt(
				caseId,
				documentId,
				containerParagraphIds,
				content
			);
		}

		respecActs.push({
			constructId,
			headingId: container.headingId,
			headingText: container.headingText,
			importedConcepts: content.importedConcepts,
			affectedConcepts: content.affectedConcepts,
			reSpecText: content.reSpecText,
			exkursAnchorText: content.exkursAnchorText,
			noRespec: content.noRespec,
			deletedPriorCount,
		});
	}

	return {
		caseId,
		documentId,
		exkursContainers: containers.map((c) => ({
			headingId: c.headingId,
			headingText: c.headingText,
			paragraphCount: c.paragraphs.length,
		})),
		fragestellungSnippet: fragestellung.slice(0, 200),
		forschungsgegenstandSnippet: fg.text.slice(0, 200),
		forschungsgegenstandId: fg.id,
		subjectKeywords: fg.subjectKeywords,
		respecActs,
		llmCalls: totalLlmCalls,
		llmTimingMs: totalLlmTimingMs,
		tokens: { input: totalInputTokens, output: totalOutputTokens },
		provider: lastProvider,
		model: lastModel,
		diagnostics: {
			fragestellungCount: fsRes.diag.count,
			forschungsgegenstandCount: fgRes.diag.count,
			warnings,
		},
	};
}
