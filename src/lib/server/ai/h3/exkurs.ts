// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:EXKURS — Re-Spezifikation des Forschungsgegenstands durch externen Begriff.
//
// Mother-Setzung (project_three_heuristics_architecture.md):
//   "EXKURSE sind iterativ spezifizierte GRUNDLAGENTHEORIE auf Basis
//   gewonnener ERKENNTNISSE."
//
// Architektur (Folge-Sessions zur Mother, 2026-05-04):
//
// EXKURS ist keine GRUNDLAGENTHEORIE-Spiegelung (keine Verweisprofil-/
// Routing-Pipeline), sondern eine theoretische Wendung des Autors, die
// einen externen Begriff einführt und damit Begriffe des bisherigen
// FORSCHUNGSGEGENSTANDs in einer neuen Lesart re-spezifiziert. Beispiel:
// Arbeit auf Bourdieus Habitus aufbauend; EXKURS diskutiert Foucaults
// Dispositivbegriff; danach wird Habitus als foucaultsche Disponierung
// verstanden.
//
// Persistenz-Modell (User-Setzung 2026-05-04 nach Variante-C-Verwerfung):
// EXKURS modifiziert das vorhandene FORSCHUNGSGEGENSTAND-Konstrukt direkt:
//   - content wird durch eine LLM-rekomponierte neue Version ersetzt,
//     die die importierten Begriffe einarbeitet
//   - version_stack bekommt einen 're_spec'-Eintrag (kind, at, source-
//     exkurs-anchors, imported/affected/reSpecText, content_snapshot des
//     vorigen Stands)
// Die destruktive Überschreibung ist gewollt: Konsumenten (FORSCHUNGSDESIGN,
// SYNTHESE, SR, WERK_*) lesen FG ganz normal per SELECT und bekommen ohne
// weiteres Coding den re-spezifizierten Stand. Der version_stack bewahrt
// den Audit-Trail; Stack-Diff als Reviewer-Indikator (Erkenntnisfortschritt
// vs. Regression) ist als Feinheit deferred (V.3.0 oder später) und nicht
// instrumentiert.
//
// Verworfene Variante C (Folge-Session zur Mother, vormittags 2026-05-04):
// "RE_SPEC_AKT als eigenes Konstrukt + Aggregator-Read am FG-Loader" —
// vom User als zu umständlich und weit weg von der epistemischen Bewegung
// erkannt. Würde alle FG-Konsumenten zu Aggregator-Reads zwingen ohne
// Mehrwert.
//
// "Trigger-BEFUND" ist nicht systematisch herstellbar (kein FK auf
// DURCHFÜHRUNGS-BEFUND möglich). Anlass-Text aus dem EXKURS selbst
// (Eingangs-¶) wird im Stack-Eintrag als exkursAnchorText abgelegt.
//
// Critical-Friend-Identität (project_critical_friend_identity.md):
// Tool BESCHREIBT die Re-Spezifikation; keine Wertung. Bei reiner
// Hintergrund-Notiz (kein Re-Spec-Akt) bleibt FG unverändert (noRespec=true).
//
// Idempotenz: vor Stack-Append werden bestehende re_spec-Einträge mit
// gleichen source_exkurs_anchors aus dem Stack entfernt; gleichzeitig
// wird das content-Feld auf "Re-Apply ab letztem origin" gerechnet, damit
// Re-Run für gleichen EXKURS keine Vermehrung erzeugt.
//
// Eintrittspunkte (Memory feedback_no_phase_layer_orchestrator.md):
//   runExkursForComplex(caseId, documentId, complex)
//     — primärer komplex-skopierter Eintritt für den Walk-Dispatcher,
//       genau ein EXKURS-Komplex pro Aufruf.
//   runExkursPass(caseId)
//     — Wrapper für Test-Skripte: lädt den Walk, iteriert alle EXKURS-
//       Komplexe in Walk-Reihenfolge und delegiert. Sequenzielle Re-Spec
//       entlang Walk-Order ist erhalten — jeder Aufruf liest den
//       aktuellen FG-Stand frisch.

import { z } from 'zod';
import { query, queryOne } from '../../db/index.js';
import { chat, type Provider } from '../client.js';
import { resolveTier } from '../model-tiers.js';
import { extractAndValidateJSON, type ExtractResult } from '../json-extract.js';
import { PreconditionFailedError } from './precondition.js';
import { loadH3ComplexWalk, type H3Complex } from '../../pipeline/h3-complex-walk.js';

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

interface ForschungsgegenstandRow {
	id: string;
	content: ForschungsgegenstandContent;
	versionStack: VersionStackEntry[];
	anchorElementIds: string[];
}

interface ForschungsgegenstandContent {
	text: string;
	subjectKeywords: string[];
	salientContainerIndices?: number[];
	containerOverview?: Array<{
		headingText: string;
		paragraphCount: number;
		topAuthors: string[];
	}>;
	llmModel?: string;
	llmTimingMs?: number;
}

interface VersionStackEntry {
	kind: 'origin' | 're_spec';
	at: string;
	by_user_id: string | null;
	source_run_id: string | null;
	source_construct_id?: string | null;
	source_exkurs_anchors?: string[];
	source_exkurs_heading_id?: string;
	source_exkurs_heading_text?: string;
	imported_concepts?: Array<{ name: string; sourceAuthor: string | null }>;
	affected_concepts?: string[];
	re_spec_text?: string;
	exkurs_anchor_text?: string | null;
	content_snapshot: ForschungsgegenstandContent;
}

async function loadForschungsgegenstandWithDiagnostics(
	caseId: string,
	documentId: string
): Promise<{
	fg: ForschungsgegenstandRow | null;
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
		content: ForschungsgegenstandContent;
		version_stack: VersionStackEntry[];
		anchor_element_ids: string[];
	}>(
		`SELECT id, content, version_stack, anchor_element_ids
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
			content: row.content,
			versionStack: Array.isArray(row.version_stack) ? row.version_stack : [],
			anchorElementIds: row.anchor_element_ids,
		},
		diag: { count, duplicate: count > 1 },
	};
}

// ── LLM-Call: Re-Spezifikation produzieren ─────────────────────────

const ImportedConceptSchema = z.object({
	name: z.string().min(1),
	sourceAuthor: z.string().nullable().optional(),
});

const RespecLLMSchema = z.object({
	importedConcepts: z.array(ImportedConceptSchema),
	affectedConcepts: z.array(z.string().min(1)),
	newForschungsgegenstandText: z.string().min(1),
	newSubjectKeywords: z.array(z.string().min(1)),
	reSpecText: z.string().min(1),
	exkursAnchorText: z.string().nullable(),
	noRespec: z.boolean().optional(),
});
type RespecLLMResult = z.infer<typeof RespecLLMSchema>;

interface ExtractRespecInput {
	fragestellung: string;
	priorForschungsgegenstandText: string;
	priorSubjectKeywords: string[];
	exkursContainer: ExkursContainer;
	documentId: string;
	maxTokens: number;
	modelOverride?: { provider: Provider; model: string };
}

async function extractRespec(input: ExtractRespecInput): Promise<{
	result: RespecLLMResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	const system = [
		'Du bist ein analytisches Werkzeug, das aus einem EXKURS einer wissenschaftlichen Arbeit eine RE-SPEZIFIKATION des bisherigen FORSCHUNGSGEGENSTANDs ableitet.',
		'',
		'Begriffe (für das Verständnis der Aufgabe):',
		'',
		'  FORSCHUNGSGEGENSTAND: die Spezifizierung der FRAGESTELLUNG durch die in der Theoriearbeit erfolgte begriffliche Verortung.',
		'',
		'  EXKURS: ein theoretischer Detour innerhalb der Arbeit, der typischerweise einen externen Begriff einführt und damit einen oder mehrere Begriffe des bisherigen FORSCHUNGSGEGENSTANDs in einer neuen Lesart re-spezifiziert. Beispiel: Eine Arbeit baut auf Bourdieus Habitusbegriff auf; ein EXKURS diskutiert Foucaults Dispositivbegriff; danach wird Habitus als foucaultsche Disponierung verstanden.',
		'',
		'  RE-SPEZIFIKATION: die im EXKURS vollzogene begriffliche Umarbeitung — wie sich der FORSCHUNGSGEGENSTAND nach dem EXKURS liest.',
		'',
		'Aufgabe in zwei Teilen:',
		'',
		'  TEIL A — Analyse des EXKURSes:',
		'    importedConcepts: die im EXKURS neu eingeführten Begriffe (mit Quellen-Autor, falls erkennbar — z.B. {"name": "Dispositiv", "sourceAuthor": "Foucault"}). Leer bei reiner Hintergrund-Notiz.',
		'    affectedConcepts: die Begriffe des bisherigen FORSCHUNGSGEGENSTANDs, die durch den EXKURS umgedeutet/erweitert werden. Bevorzugt aus den vorgegebenen subjectKeywords wählen; freie Begriffe nur, wenn keiner passt.',
		'    reSpecText: 1–3 Sätze, die die im EXKURS vollzogene Umdeutung deskriptiv beschreiben.',
		'    exkursAnchorText: vom EXKURS in den Eingangs-¶ explizit formulierter Anlass — wörtlich oder paraphrasiert. null, wenn nicht explizit benannt.',
		'',
		'  TEIL B — Re-Spezifizierter FORSCHUNGSGEGENSTAND (NEUE VERSION):',
		'    newForschungsgegenstandText: der vollständige neu formulierte FORSCHUNGSGEGENSTAND-Text (3–5 Sätze, deskriptiv, im selben Stil wie der priorForschungsgegenstand), der die Re-Spezifikation einarbeitet. Dies ersetzt den bisherigen Text — keine Diff-Notation, keine "wie zuvor + dazu kommt", sondern eine kohärente neue Gesamtformulierung.',
		'    newSubjectKeywords: die aktualisierte Kernbegriffs-Liste (3–7 Begriffe). Enthält die unveränderten alten Keywords und ergänzt um neue importierte Begriffe, soweit sie für den Forschungsgegenstand zentral werden. Begriffe, die durch den EXKURS in eine neue Lesart überführt werden, behalten ihre Bezeichnung (Bezeichnung bleibt "Habitus", auch wenn die Lesart jetzt foucaultsch ist).',
		'',
		'Sonderfall noRespec=true:',
		'  Wenn der EXKURS nur ergänzende Hintergrundinfo liefert (z.B. historische Notiz, Autor-Biografie, Methoden-Klärung) und KEINE begriffliche Umarbeitung des FORSCHUNGSGEGENSTANDs vollzieht, setze noRespec=true. In dem Fall:',
		'    - importedConcepts und affectedConcepts: leere Arrays',
		'    - reSpecText: kurze Hinweis-Notiz "EXKURS vollzieht keinen Re-Spezifikations-Akt am Forschungsgegenstand; Inhalt: <kurze Beschreibung>"',
		'    - newForschungsgegenstandText: identisch zum priorForschungsgegenstand (1:1, unverändert)',
		'    - newSubjectKeywords: identisch zu den priorSubjectKeywords',
		'    - exkursAnchorText: kann trotzdem extrahiert werden, falls Anlass formuliert',
		'',
		'Stil: DESKRIPTIV. Du beschreibst, was im EXKURS passiert und wie sich der FORSCHUNGSGEGENSTAND danach liest. Du beurteilst NICHT (kein "guter EXKURS", "verkürzt", "tiefgehend"). Eigene Worte; keine wörtlichen Zitate (Ausnahme: exkursAnchorText, wenn explizit formuliert).',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "importedConcepts": [{"name": "<Begriff>", "sourceAuthor": "<Autor>"|null}, ...],',
		'  "affectedConcepts": ["<Begriff>", ...],',
		'  "newForschungsgegenstandText": "<3–5 Sätze deskriptiver neuer FG-Text>",',
		'  "newSubjectKeywords": ["<begriff>", ...],',
		'  "reSpecText": "<1–3 Sätze beschreibend>",',
		'  "exkursAnchorText": "<vom EXKURS formulierter Anlass>"|null,',
		'  "noRespec": true|false (optional, default false)',
		'}',
	].join('\n');

	const exkursText = input.exkursContainer.paragraphs
		.map((p, i) => `[¶${i + 1}] ${p.text}`)
		.join('\n\n');

	const subjectKeywordsBlock =
		input.priorSubjectKeywords.length > 0
			? input.priorSubjectKeywords.map((k) => `- ${k}`).join('\n')
			: '(keine subjectKeywords im FORSCHUNGSGEGENSTAND erfasst)';

	const userMessage = [
		`FRAGESTELLUNG der Arbeit:`,
		input.fragestellung,
		'',
		`priorForschungsgegenstand (bisheriger Stand, ggf. nach früheren EXKURS-Re-Spezifikationen):`,
		input.priorForschungsgegenstandText,
		'',
		`priorSubjectKeywords (bisheriger Stand):`,
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

	const parsed: ExtractResult<RespecLLMResult> = extractAndValidateJSON(
		response.text,
		RespecLLMSchema
	);
	if (!parsed.ok) {
		// Bestehender Project-Type-Issue: TS-Compiler erkennt das
		// Discriminated-Union-Narrowing nicht (gleicher Effekt in
		// grundlagentheorie_forschungsgegenstand.ts L379). Workaround:
		// Failure-Branch via Property-Access mit 'in'-Guard ausgelesen.
		const stage = 'stage' in parsed ? parsed.stage : 'unknown';
		const error = 'error' in parsed ? parsed.error : 'unknown';
		throw new Error(
			`EXKURS-RE-SPEC: Antwort nicht parsbar (stage=${stage}): ${error}\n` +
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

// ── Persistenz: destruktiver Overwrite + Stack-Append ─────────────

interface ApplyRespecInput {
	fg: ForschungsgegenstandRow;
	exkursContainer: ExkursContainer;
	llmResult: RespecLLMResult;
	llmModel: string;
	llmTimingMs: number;
}

interface ApplyRespecResult {
	updatedFgId: string;
	noRespec: boolean;
	priorContent: ForschungsgegenstandContent;
	newContent: ForschungsgegenstandContent;
	stackEntriesBefore: number;
	stackEntriesAfter: number;
	replacedPriorRespecForThisExkurs: boolean;
}

function sameAnchorSet(a: string[] | undefined, b: string[]): boolean {
	if (!a) return false;
	if (a.length !== b.length) return false;
	const sortedA = [...a].sort();
	const sortedB = [...b].sort();
	for (let i = 0; i < sortedA.length; i++) {
		if (sortedA[i] !== sortedB[i]) return false;
	}
	return true;
}

function rebuildContentFromStack(
	originContent: ForschungsgegenstandContent,
	stack: VersionStackEntry[]
): ForschungsgegenstandContent {
	// Letzter re_spec-Eintrag (in Stack-Reihenfolge) bestimmt aktuellen Stand,
	// weil jede LLM-Re-Spec eine vollständige neue Version produziert.
	// Wenn keine re_spec-Einträge da sind, bleibt origin.
	let current = originContent;
	for (const entry of stack) {
		if (entry.kind === 're_spec') {
			current = entry.content_snapshot;
		}
	}
	return current;
}

async function applyRespecToForschungsgegenstand(
	input: ApplyRespecInput
): Promise<ApplyRespecResult> {
	const exkursAnchors = input.exkursContainer.paragraphs.map((p) => p.paragraphId);
	const stackBefore = input.fg.versionStack;
	const priorContent = input.fg.content;

	// noRespec-Pfad: nichts ändern, kein Stack-Eintrag, FG bleibt 1:1.
	if (input.llmResult.noRespec) {
		return {
			updatedFgId: input.fg.id,
			noRespec: true,
			priorContent,
			newContent: priorContent,
			stackEntriesBefore: stackBefore.length,
			stackEntriesAfter: stackBefore.length,
			replacedPriorRespecForThisExkurs: false,
		};
	}

	// Idempotenz: bestehende re_spec-Einträge mit identischem
	// source_exkurs_anchors-Set rauswerfen, damit Re-Run für gleichen
	// EXKURS keine Vermehrung erzeugt.
	const filteredStack: VersionStackEntry[] = [];
	let replacedPriorRespecForThisExkurs = false;
	for (const entry of stackBefore) {
		if (
			entry.kind === 're_spec' &&
			sameAnchorSet(entry.source_exkurs_anchors, exkursAnchors)
		) {
			replacedPriorRespecForThisExkurs = true;
			continue;
		}
		filteredStack.push(entry);
	}

	// Origin = erster Stack-Eintrag mit kind='origin' (Schritt-4-Persistenz
	// hat genau einen origin-Eintrag angelegt). Sicherheits-Fallback: wenn
	// kein origin-Eintrag im Stack, behandeln wir den heutigen FG-content
	// als "as-if-origin".
	const originEntry = filteredStack.find((e) => e.kind === 'origin');
	const originContent = originEntry ? originEntry.content_snapshot : priorContent;

	// Neuer FG-content aus dem LLM-Output. subjectKeywords explicitly
	// aus newSubjectKeywords übernommen — der LLM kann sie ergänzen.
	const newContent: ForschungsgegenstandContent = {
		...originContent,
		text: input.llmResult.newForschungsgegenstandText,
		subjectKeywords: input.llmResult.newSubjectKeywords,
		llmModel: input.llmModel,
		llmTimingMs: input.llmTimingMs,
	};

	const newStackEntry: VersionStackEntry = {
		kind: 're_spec',
		at: new Date().toISOString(),
		by_user_id: null,
		source_run_id: null,
		source_construct_id: null,
		source_exkurs_anchors: exkursAnchors,
		source_exkurs_heading_id: input.exkursContainer.headingId,
		source_exkurs_heading_text: input.exkursContainer.headingText,
		imported_concepts: input.llmResult.importedConcepts.map((c) => ({
			name: c.name,
			sourceAuthor: c.sourceAuthor ?? null,
		})),
		affected_concepts: input.llmResult.affectedConcepts,
		re_spec_text: input.llmResult.reSpecText,
		exkurs_anchor_text: input.llmResult.exkursAnchorText,
		content_snapshot: newContent,
	};

	const newStack = [...filteredStack, newStackEntry];

	// content wird via Re-Build aus dem Stack errechnet, damit nach dem
	// Filter (siehe oben) der aktuell sichtbare Stand korrekt aus dem
	// letzten re_spec (= newStackEntry) kommt.
	const finalContent = rebuildContentFromStack(originContent, newStack);

	await query(
		`UPDATE function_constructs
		 SET content = $2,
		     version_stack = $3,
		     updated_at = now()
		 WHERE id = $1`,
		[input.fg.id, JSON.stringify(finalContent), JSON.stringify(newStack)]
	);

	return {
		updatedFgId: input.fg.id,
		noRespec: false,
		priorContent,
		newContent: finalContent,
		stackEntriesBefore: stackBefore.length,
		stackEntriesAfter: newStack.length,
		replacedPriorRespecForThisExkurs,
	};
}

// ── Public API ────────────────────────────────────────────────────

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

export interface RespecResult {
	headingId: string;
	headingText: string;
	noRespec: boolean;
	importedConcepts: Array<{ name: string; sourceAuthor: string | null }>;
	affectedConcepts: string[];
	reSpecText: string;
	exkursAnchorText: string | null;
	priorForschungsgegenstandText: string;
	newForschungsgegenstandText: string;
	priorSubjectKeywords: string[];
	newSubjectKeywords: string[];
	stackEntriesBefore: number;
	stackEntriesAfter: number;
	replacedPriorRespecForThisExkurs: boolean;
}

export interface ExkursPassResult {
	caseId: string;
	documentId: string;
	exkursContainers: ExkursContainerSummary[];
	fragestellungSnippet: string | null;
	forschungsgegenstandSnippet: string | null;
	forschungsgegenstandId: string | null;
	finalSubjectKeywords: string[];
	respecs: RespecResult[];
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

export interface ExkursComplexPassResult {
	caseId: string;
	documentId: string;
	container: ExkursContainerSummary;
	/** Re-Spec für genau diesen Komplex; null nur, wenn der Komplex defensiv keine ¶ enthält. */
	respec: RespecResult | null;
	forschungsgegenstandId: string | null;
	finalSubjectKeywords: string[];
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

async function loadExkursParagraphsForComplex(
	documentId: string,
	complex: H3Complex
): Promise<ExkursContainer> {
	if (complex.paragraphIds.length === 0) {
		return {
			headingId: complex.headingId,
			headingText: complex.headingText,
			paragraphs: [],
		};
	}
	const rows = (
		await query<{
			paragraph_id: string;
			char_start: number;
			char_end: number;
			text: string;
		}>(
			`SELECT p.id AS paragraph_id,
			        p.char_start,
			        p.char_end,
			        SUBSTRING(dc.full_text FROM p.char_start + 1
			                              FOR p.char_end - p.char_start) AS text
			 FROM document_elements p
			 JOIN document_content dc ON dc.naming_id = p.document_id
			 WHERE p.document_id = $1
			   AND p.id = ANY($2::uuid[])
			 ORDER BY p.char_start`,
			[documentId, complex.paragraphIds]
		)
	).rows;

	return {
		headingId: complex.headingId,
		headingText: complex.headingText,
		paragraphs: rows.map((r, i) => ({
			paragraphId: r.paragraph_id,
			charStart: r.char_start,
			charEnd: r.char_end,
			text: r.text.trim(),
			indexInContainer: i,
		})),
	};
}

/**
 * Komplex-skopierter Eintritt für den H3-Walk-Dispatcher.
 *
 * Genau ein EXKURS-Komplex pro Aufruf. FRAGESTELLUNG und FORSCHUNGSGEGENSTAND
 * werden frisch aus der DB gelesen; sequenzielle Re-Spec entlang Walk-Order
 * ergibt sich automatisch, weil jeder Aufruf den aktuellsten FG-Stand sieht.
 */
export async function runExkursForComplex(
	caseId: string,
	documentId: string,
	complex: H3Complex,
	options: ExkursPassOptions = {}
): Promise<ExkursComplexPassResult> {
	if (complex.functionType !== 'EXKURS') {
		throw new Error(
			`runExkursForComplex erwartet functionType='EXKURS', erhielt '${complex.functionType}' (heading=${complex.headingId})`
		);
	}

	const persistConstructs = options.persistConstructs !== false;
	const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
	const modelOverride = options.modelOverride ?? resolveTier('h3.tier2');
	const warnings: string[] = [];

	const container = await loadExkursParagraphsForComplex(documentId, complex);

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
			`FORSCHUNGSGEGENSTAND: ${fgRes.diag.count} Konstrukte vorhanden — jüngstes wird ` +
				`modifiziert. Cleanup empfohlen.`
		);
	}

	if (container.paragraphs.length === 0) {
		return {
			caseId,
			documentId,
			container: {
				headingId: container.headingId,
				headingText: container.headingText,
				paragraphCount: 0,
			},
			respec: null,
			forschungsgegenstandId: fgRes.fg?.id ?? null,
			finalSubjectKeywords: fgRes.fg?.content.subjectKeywords ?? [],
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
		throw new PreconditionFailedError({
			heuristic: 'EXKURS',
			missing: 'FRAGESTELLUNG',
			diagnostic:
				`Werk ${documentId}: FRAGESTELLUNG fehlt. ` +
				`Erst H3:EXPOSITION laufen.`,
		});
	}
	if (!fgRes.fg) {
		throw new PreconditionFailedError({
			heuristic: 'EXKURS',
			missing: 'FORSCHUNGSGEGENSTAND',
			diagnostic:
				`Werk ${documentId}: FORSCHUNGSGEGENSTAND fehlt. ` +
				`Erst H3:GRUNDLAGENTHEORIE Schritt 4 laufen.`,
		});
	}

	const fragestellung = fsRes.text;
	const fg = fgRes.fg;
	const priorText = fg.content.text;
	const priorKeywords = fg.content.subjectKeywords;

	const llmRes = await extractRespec({
		fragestellung,
		priorForschungsgegenstandText: priorText,
		priorSubjectKeywords: priorKeywords,
		exkursContainer: container,
		documentId,
		maxTokens,
		modelOverride,
	});

	let applied: ApplyRespecResult;
	if (persistConstructs) {
		applied = await applyRespecToForschungsgegenstand({
			fg,
			exkursContainer: container,
			llmResult: llmRes.result,
			llmModel: llmRes.model,
			llmTimingMs: llmRes.timingMs,
		});
	} else {
		// Read-only: simulate apply für Output-Berichterstellung, ohne UPDATE.
		applied = {
			updatedFgId: fg.id,
			noRespec: llmRes.result.noRespec ?? false,
			priorContent: fg.content,
			newContent: {
				...fg.content,
				text: llmRes.result.newForschungsgegenstandText,
				subjectKeywords: llmRes.result.newSubjectKeywords,
			},
			stackEntriesBefore: fg.versionStack.length,
			stackEntriesAfter: fg.versionStack.length + (llmRes.result.noRespec ? 0 : 1),
			replacedPriorRespecForThisExkurs: false,
		};
	}

	const respec: RespecResult = {
		headingId: container.headingId,
		headingText: container.headingText,
		noRespec: applied.noRespec,
		importedConcepts: llmRes.result.importedConcepts.map((c) => ({
			name: c.name,
			sourceAuthor: c.sourceAuthor ?? null,
		})),
		affectedConcepts: llmRes.result.affectedConcepts,
		reSpecText: llmRes.result.reSpecText,
		exkursAnchorText: llmRes.result.exkursAnchorText,
		priorForschungsgegenstandText: priorText,
		newForschungsgegenstandText: applied.newContent.text,
		priorSubjectKeywords: priorKeywords,
		newSubjectKeywords: applied.newContent.subjectKeywords,
		stackEntriesBefore: applied.stackEntriesBefore,
		stackEntriesAfter: applied.stackEntriesAfter,
		replacedPriorRespecForThisExkurs: applied.replacedPriorRespecForThisExkurs,
	};

	return {
		caseId,
		documentId,
		container: {
			headingId: container.headingId,
			headingText: container.headingText,
			paragraphCount: container.paragraphs.length,
		},
		respec,
		forschungsgegenstandId: fg.id,
		finalSubjectKeywords: applied.newContent.subjectKeywords,
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

/**
 * Werk-skopierter Wrapper: lädt den H3-Komplex-Walk und delegiert pro
 * EXKURS-Komplex an `runExkursForComplex`. Aufrufer (Test-Skripte,
 * Legacy-Pfade) sehen weiter die werkweite Aggregat-Struktur.
 */
export async function runExkursPass(
	caseId: string,
	options: ExkursPassOptions = {}
): Promise<ExkursPassResult> {
	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.central_document_id) {
		throw new Error(`Case ${caseId} has no central_document_id`);
	}
	const documentId = caseRow.central_document_id;

	const walk = await loadH3ComplexWalk(documentId);
	const exkursComplexes = walk.filter((c) => c.functionType === 'EXKURS');

	const fsRes = await loadFragestellungWithDiagnostics(caseId, documentId);
	const fgRes = await loadForschungsgegenstandWithDiagnostics(caseId, documentId);
	const warnings: string[] = [];
	if (fsRes.diag.duplicate) {
		warnings.push(
			`FRAGESTELLUNG: ${fsRes.diag.count} Konstrukte vorhanden — jüngstes wird verwendet. ` +
				`Cleanup empfohlen (manuell oder via dedizierter Skript).`
		);
	}
	if (fgRes.diag.duplicate) {
		warnings.push(
			`FORSCHUNGSGEGENSTAND: ${fgRes.diag.count} Konstrukte vorhanden — jüngstes wird ` +
				`modifiziert. Cleanup empfohlen.`
		);
	}

	// Werk ohne EXKURS-Komplexe: sauberer No-Op-Exit, keine Pflicht-Voraussetzung.
	if (exkursComplexes.length === 0) {
		return {
			caseId,
			documentId,
			exkursContainers: [],
			fragestellungSnippet: fsRes.text?.slice(0, 200) ?? null,
			forschungsgegenstandSnippet: fgRes.fg?.content.text.slice(0, 200) ?? null,
			forschungsgegenstandId: fgRes.fg?.id ?? null,
			finalSubjectKeywords: fgRes.fg?.content.subjectKeywords ?? [],
			respecs: [],
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

	const containers: ExkursContainerSummary[] = [];
	const respecs: RespecResult[] = [];
	let totalLlmCalls = 0;
	let totalLlmTimingMs = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let lastProvider = '';
	let lastModel = '';

	for (const complex of exkursComplexes) {
		const result = await runExkursForComplex(caseId, documentId, complex, options);
		containers.push(result.container);
		if (result.respec) respecs.push(result.respec);
		totalLlmCalls += result.llmCalls;
		totalLlmTimingMs += result.llmTimingMs;
		totalInputTokens += result.tokens.input;
		totalOutputTokens += result.tokens.output;
		if (result.provider) lastProvider = result.provider;
		if (result.model) lastModel = result.model;
	}

	// Final-Snapshot der FG nach allen Re-Specs (für Reporting).
	const finalFgRes = await loadForschungsgegenstandWithDiagnostics(caseId, documentId);

	return {
		caseId,
		documentId,
		exkursContainers: containers,
		fragestellungSnippet: fsRes.text?.slice(0, 200) ?? null,
		forschungsgegenstandSnippet: finalFgRes.fg?.content.text.slice(0, 200) ?? null,
		forschungsgegenstandId: finalFgRes.fg?.id ?? null,
		finalSubjectKeywords: finalFgRes.fg?.content.subjectKeywords ?? [],
		respecs,
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
