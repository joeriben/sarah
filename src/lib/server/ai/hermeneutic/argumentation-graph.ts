// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Per-paragraph Argumentations-Graph pass — EXPERIMENTAL.
//
// Opt-in via `assessment_briefs.argumentation_graph` boolean. Runs PARALLEL
// to the validated synthetic per-paragraph pass; does not touch its memos.
// See migrations 032 and 033 for rationale and removal path.
//
// Output covers two layers per paragraph:
//   Layer 1 — arguments + edges (Migration 032).
//   Layer 2 — scaffolding_elements (Migration 033). Each scaffolding
//             element SHOULD anchor to ≥ 1 argument (in this paragraph or in
//             an earlier paragraph of the same subchapter) — that is the
//             principle: text-organisational/didactic quality is best
//             assessable in service of argumentative substance. But for
//             rein expositorische Absätze (definitions, paraphrases of
//             cited material, descriptive openings of a subchapter) where
//             no anchor target exists, the element is kept paragraph-
//             anchored (no scaffolding_anchors rows) rather than dropped.
//             Otherwise the pass would lose every annotation for purely
//             descriptive passages, which is wrong: such material is still
//             present in the text and the analyst should still see it.
//
// Architecture mirrors per-paragraph.ts on purpose so the comparison with
// the synthetic pass is fair: same persona/criteria/work-header/completed-
// kontextualisierungen in the cached system block, same predecessor+current
// +successor in the fresh user message. Only TWO things differ:
//
//   (1) the analytical pass receives a *prior arguments index* (structured
//       listing of arguments extracted from earlier paragraphs of this
//       subchapter) instead of the interpretive memo chain. Using the
//       memo chain would inject synthetic interpretation into the
//       analytical pass and contaminate the experiment.
//
//   (2) the output is structured JSON (arguments + edges + scaffolding),
//       not memo prose.
//
// Sequencing: prior_paragraph edges and scaffolding anchors require earlier
// paragraphs to be processed first. Run paragraphs in subchapter forward
// order — the dev driver scripts/run-argumentation-graphs.ts enforces this.
//
// Idempotence: if any argument_nodes OR scaffolding_elements already exist
// for the target paragraph, the pass returns early with `skipped: true`. To
// re-run, DELETE from both tables WHERE paragraph_element_id = ... (the
// FK cascades to edges and anchors).

import { z } from 'zod';
import { query, queryOne, transaction } from '../../db/index.js';
import { chat, type Provider } from '../client.js';
import { parseProseAG, PROSE_FORMAT_SPEC } from './argumentation-graph-prose-parser.js';

// ── Output schema ─────────────────────────────────────────────────

// Premise schema is intentionally permissive: the LLM may emit a premise
// type outside the three documented categories (e.g. "implicit", "definitional").
// Strict rejection would lose the whole paragraph's output for one bad type
// label, which is wasteful for the experiment. Unknown types are coerced
// to "background" with an inline marker so the deviation stays inspectable.
const PremiseRawSchema = z.object({
	type: z.string().min(1),
	text: z.string().min(1),
	from_paragraph: z.number().int().optional(),
});
type Premise =
	| { type: 'stated';     text: string }
	| { type: 'carried';    text: string; from_paragraph: number }
	| { type: 'background'; text: string };
const PremiseSchema = PremiseRawSchema.transform((p): Premise => {
	if (p.type === 'stated')     return { type: 'stated',     text: p.text };
	if (p.type === 'background') return { type: 'background', text: p.text };
	if (p.type === 'carried' && typeof p.from_paragraph === 'number' && p.from_paragraph >= 1) {
		return { type: 'carried', text: p.text, from_paragraph: p.from_paragraph };
	}
	if (p.type === 'carried') {
		// "carried" with missing/invalid from_paragraph (e.g. 0 emitted for first paragraph
		// of a subchapter): demote to background with a marker, don't lose the text.
		return { type: 'background', text: `[demoted from invalid carried/from_paragraph=${p.from_paragraph}] ${p.text}` };
	}
	return { type: 'background', text: `[unrecognised premise.type="${p.type}"] ${p.text}` };
});

const ArgumentSchema = z.object({
	id: z.string().regex(/^A\d+$/, 'argument id must look like "A1", "A2", ...'),
	claim: z.string().min(1),
	premises: z.array(PremiseSchema).default([]),
	// Sanity cap, not a style constraint. The "≤ 8 Wörter" guidance lives in the
	// prompt; schema only guards against pathological full-paragraph echoes.
	// Style overflow (> 80 chars) is logged in storeResult but doesn't fail.
	anchor_phrase: z.string().max(500).default(''),
	// Default-on Pflichtfeld (Migration 040). Pure Textanalyse: wie ist das
	// Argument im Text textbasiert belegt — Namensnennung, abstrakter Werk-
	// bezug, oder konkrete Stelle/Zitat? Niedriges Halluzinationsrisiko, daher
	// im Layer-1-AG-Pass mit-erfasst statt eigenem Pass. Bei fehlendem Wert
	// fällt der Parser auf 'none' zurück (kein hard fail).
	referential_grounding: z.enum(['none', 'namedropping', 'abstract', 'concrete']).default('none'),
});

const InterArgumentEdge = z.object({
	from: z.string().regex(/^A\d+$/),
	to:   z.string().regex(/^A\d+$/),
	kind: z.enum(['supports', 'refines', 'contradicts']),
	scope: z.literal('inter_argument'),
});

const PriorParagraphEdge = z.object({
	from: z.string().regex(/^A\d+$/),
	to:   z.string().regex(/^§\d+:A\d+$/, 'prior_paragraph edge target must look like "§3:A2"'),
	kind: z.enum(['supports', 'refines', 'contradicts', 'presupposes']),
	scope: z.literal('prior_paragraph'),
});

const EdgeSchema = z.discriminatedUnion('scope', [InterArgumentEdge, PriorParagraphEdge]);

// ── Scaffolding (Layer 2) — Pflicht-Anker auf Argumente ────────────
//
// The four function_type categories mirror the user's umbrella terms
// (textorganisatorisch / didaktisch / kontextualisierend / rhetorisch).
// Specific role lives in function_description ("Beleg von §3:A2",
// "Übergang zu §4", "Rückbezug auf §1:A1").
//
// anchored_to references must be either local ("A1") or cross-paragraph
// ("§N:AM"). Validation at storage time: orphan scaffolding (≥ 1 anchor
// required, none resolved) is dropped with logging.
const ScaffoldingFunctionType = z.enum([
	'textorganisatorisch',  // transitions, recaps, structural markers
	'didaktisch',           // illustrations, examples, contrasts for clarity
	'kontextualisierend',   // citations, definitions, theoretical embedding
	'rhetorisch',           // motivation framing, meta-comment, emphasis
]);

const ScaffoldingElementSchema = z.object({
	id: z.string().regex(/^S\d+$/, 'scaffolding id must look like "S1", "S2", ...'),
	// 1000 (was 500): habilitation prose can contain genuinely long parallel-
	// constructed sentences (e.g. dimensional parallelism with four members
	// in one sentence). 500 was a stylistic preference, not a content limit;
	// stylistic overflow (> 500) is logged in storeResult.
	excerpt: z.string().min(1).max(1000),
	function_type: ScaffoldingFunctionType,
	function_description: z.string().min(1),
	assessment: z.string().min(1),
	// Bevorzugt ≥ 1 Anker. Leer erlaubt für rein expositorische Absätze, in denen
	// weder lokale Args noch prior_paragraph-Args verfügbar sind (z.B. erster Absatz
	// eines deskriptiven Subkapitels). storeResult fällt dann auf paragraph-Verankerung
	// zurück; siehe Doc-Header oben.
	anchored_to: z.array(z.string().regex(/^(A\d+|§\d+:A\d+)$/)).default([]),
	// See ArgumentSchema.anchor_phrase note: 500 = sanity cap; style limit (≤ 8
	// Wörter) is prompt-side only.
	anchor_phrase: z.string().max(500).default(''),
});

const ArgumentationGraphResultSchema = z.object({
	arguments: z.array(ArgumentSchema),
	edges: z.array(EdgeSchema).default([]),
	scaffolding: z.array(ScaffoldingElementSchema).default([]),
});

export type ArgumentationGraphResult = z.infer<typeof ArgumentationGraphResultSchema>;

// ── Internal context types ────────────────────────────────────────

interface CaseContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	fullText: string;
	brief: {
		name: string;
		work_type: string;
		criteria: string;
		persona: string;
		argumentationGraph: boolean;
	};
	mainHeadings: string[];
	mainParagraphCount: number;
	mainHeadingCount: number;
}

interface PriorArgument {
	paragraphId: string;
	positionInSubchapter: number;
	argLocalId: string;
	claim: string;
}

interface PriorScaffolding {
	positionInSubchapter: number;
	elementLocalId: string;
	functionType: string;
	functionDescription: string;
}

interface ParagraphContext {
	paragraphId: string;
	charStart: number;
	charEnd: number;
	text: string;
	subchapterHeadingId: string;
	subchapterLabel: string;
	subchapterStart: number;
	subchapterEnd: number;
	positionInSubchapter: number;
	subchapterTotalParagraphs: number;
	predecessorText: string | null;
	successorText: string | null;
	completedKontextualisierungen: { sectionLabel: string; content: string }[];
	priorArguments: PriorArgument[];
	priorParagraphIdByPosition: Map<number, string>;  // pos-in-subchapter → paragraphId
	priorScaffolding: PriorScaffolding[];             // for prompt context only (not for anchor resolution)
}

// ── Context loaders ───────────────────────────────────────────────

async function loadCaseContext(caseId: string): Promise<CaseContext> {
	const caseRow = await queryOne<{
		project_id: string;
		central_document_id: string;
		brief_name: string;
		work_type: string;
		criteria: string;
		persona: string;
		argumentation_graph: boolean;
	}>(
		`SELECT c.project_id, c.central_document_id,
		        b.name AS brief_name, b.work_type, b.criteria, b.persona,
		        b.argumentation_graph
		 FROM cases c
		 LEFT JOIN assessment_briefs b ON b.id = c.assessment_brief_id
		 WHERE c.id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.criteria) throw new Error(`Case ${caseId} has no assessment_brief attached`);
	if (!caseRow.argumentation_graph) {
		throw new Error(
			`Brief on case ${caseId} does not have argumentation_graph=true; refusing to run experimental pass.`
		);
	}

	const docRow = await queryOne<{ inscription: string; full_text: string }>(
		`SELECT n.inscription, dc.full_text
		 FROM namings n JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.id = $1`,
		[caseRow.central_document_id]
	);
	if (!docRow) throw new Error(`Central document not found: ${caseRow.central_document_id}`);

	const headingRows = await query<{ char_start: number; char_end: number }>(
		`SELECT char_start, char_end FROM document_elements
		 WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main'
		 ORDER BY char_start`,
		[caseRow.central_document_id]
	);
	const mainHeadings = headingRows.rows.map(r =>
		docRow.full_text.substring(r.char_start, r.char_end).trim().slice(0, 100)
	);

	const counts = await queryOne<{ paragraphs: string; headings: string }>(
		`SELECT
		   COUNT(*) FILTER (WHERE element_type = 'paragraph') AS paragraphs,
		   COUNT(*) FILTER (WHERE element_type = 'heading')   AS headings
		 FROM document_elements
		 WHERE document_id = $1 AND section_kind = 'main'`,
		[caseRow.central_document_id]
	);

	return {
		caseId,
		projectId: caseRow.project_id,
		centralDocumentId: caseRow.central_document_id,
		documentTitle: docRow.inscription,
		fullText: docRow.full_text,
		brief: {
			name: caseRow.brief_name,
			work_type: caseRow.work_type,
			criteria: caseRow.criteria,
			persona: caseRow.persona,
			argumentationGraph: caseRow.argumentation_graph,
		},
		mainHeadings,
		mainParagraphCount: parseInt(counts?.paragraphs ?? '0', 10),
		mainHeadingCount: parseInt(counts?.headings ?? '0', 10),
	};
}

async function loadParagraphContext(
	caseCtx: CaseContext,
	paragraphId: string
): Promise<ParagraphContext> {
	const para = await queryOne<{ char_start: number; char_end: number; section_kind: string | null }>(
		`SELECT char_start, char_end, section_kind FROM document_elements
		 WHERE id = $1 AND document_id = $2 AND element_type = 'paragraph'`,
		[paragraphId, caseCtx.centralDocumentId]
	);
	if (!para) throw new Error(`Paragraph not found in document: ${paragraphId}`);
	if (para.section_kind !== 'main') {
		throw new Error(`Paragraph ${paragraphId} is in section_kind=${para.section_kind}, not 'main'`);
	}

	const heading = await queryOne<{ id: string; char_start: number; char_end: number }>(
		`SELECT id, char_start, char_end FROM document_elements
		 WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main'
		   AND char_start <= $2
		 ORDER BY char_start DESC LIMIT 1`,
		[caseCtx.centralDocumentId, para.char_start]
	);
	if (!heading) throw new Error(`No subchapter heading found before paragraph ${paragraphId}`);

	const nextHeading = await queryOne<{ char_start: number }>(
		`SELECT char_start FROM document_elements
		 WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main'
		   AND char_start > $2
		 ORDER BY char_start ASC LIMIT 1`,
		[caseCtx.centralDocumentId, heading.char_start]
	);
	const subchapterEnd = nextHeading?.char_start ?? caseCtx.fullText.length;

	const subPars = (
		await query<{ id: string; char_start: number; char_end: number }>(
			`SELECT id, char_start, char_end FROM document_elements
			 WHERE document_id = $1 AND element_type = 'paragraph' AND section_kind = 'main'
			   AND char_start >= $2 AND char_start < $3
			 ORDER BY char_start`,
			[caseCtx.centralDocumentId, heading.char_start, subchapterEnd]
		)
	).rows;

	const idx = subPars.findIndex(p => p.id === paragraphId);
	if (idx === -1) throw new Error(`Paragraph ${paragraphId} not found in its detected subchapter`);

	const slice = (s: number, e: number) => caseCtx.fullText.substring(s, e);
	const predecessor = idx > 0 ? subPars[idx - 1] : null;
	const successor = idx < subPars.length - 1 ? subPars[idx + 1] : null;

	// Prior arguments index — arguments extracted from earlier paragraphs
	// in this subchapter, ordered by paragraph position then arg position.
	// Used both to feed the LLM (for cross-paragraph references) and to
	// resolve §N:AM strings emitted in prior_paragraph edges to UUIDs.
	const priorArgRows = (
		await query<{ paragraph_id: string; char_start: number; arg_local_id: string; claim: string; position_in_paragraph: number }>(
			`SELECT an.paragraph_element_id AS paragraph_id, de.char_start, an.arg_local_id, an.claim, an.position_in_paragraph
			 FROM argument_nodes an
			 JOIN document_elements de ON de.id = an.paragraph_element_id
			 WHERE de.document_id = $1
			   AND de.char_start >= $2 AND de.char_start < $3
			 ORDER BY de.char_start, an.position_in_paragraph`,
			[caseCtx.centralDocumentId, heading.char_start, para.char_start]
		)
	).rows;

	const priorParagraphIdByPosition = new Map<number, string>();
	const priorArguments: PriorArgument[] = priorArgRows.map(r => {
		const positionInSubchapter = subPars.findIndex(p => p.char_start === r.char_start) + 1;
		priorParagraphIdByPosition.set(positionInSubchapter, r.paragraph_id);
		return {
			paragraphId: r.paragraph_id,
			positionInSubchapter,
			argLocalId: r.arg_local_id,
			claim: r.claim,
		};
	});

	// Prior scaffolding — for prompt context only, so the LLM does not
	// re-register what an earlier paragraph already covered (e.g., the same
	// citation chain). Not used for anchor resolution; anchors point to
	// arguments, not to other scaffolding.
	const priorScaffoldingRows = (
		await query<{ char_start: number; element_local_id: string; function_type: string; function_description: string }>(
			`SELECT de.char_start, se.element_local_id, se.function_type, se.function_description
			 FROM scaffolding_elements se
			 JOIN document_elements de ON de.id = se.paragraph_element_id
			 WHERE de.document_id = $1
			   AND de.char_start >= $2 AND de.char_start < $3
			 ORDER BY de.char_start, se.position_in_paragraph`,
			[caseCtx.centralDocumentId, heading.char_start, para.char_start]
		)
	).rows;
	const priorScaffolding: PriorScaffolding[] = priorScaffoldingRows.map(r => ({
		positionInSubchapter: subPars.findIndex(p => p.char_start === r.char_start) + 1,
		elementLocalId: r.element_local_id,
		functionType: r.function_type,
		functionDescription: r.function_description,
	}));

	const kontextRows = (
		await query<{ section_label: string; content: string }>(
			`SELECT
			   substring($1::text FROM de.char_start+1 FOR de.char_end-de.char_start) AS section_label,
			   mc.content
			 FROM memo_content mc
			 JOIN document_elements de ON de.id = mc.scope_element_id
			 WHERE mc.memo_type = 'kontextualisierend'
			   AND mc.scope_level = 'subchapter'
			   AND de.document_id = $2
			   AND de.char_start < $3
			 ORDER BY de.char_start`,
			[caseCtx.fullText, caseCtx.centralDocumentId, heading.char_start]
		)
	).rows;

	return {
		paragraphId,
		charStart: para.char_start,
		charEnd: para.char_end,
		text: slice(para.char_start, para.char_end),
		subchapterHeadingId: heading.id,
		subchapterLabel: slice(heading.char_start, heading.char_end).trim(),
		subchapterStart: heading.char_start,
		subchapterEnd,
		positionInSubchapter: idx + 1,
		subchapterTotalParagraphs: subPars.length,
		predecessorText: predecessor ? slice(predecessor.char_start, predecessor.char_end) : null,
		successorText: successor ? slice(successor.char_start, successor.char_end) : null,
		completedKontextualisierungen: kontextRows.map(r => ({
			sectionLabel: r.section_label.trim(),
			content: r.content,
		})),
		priorArguments,
		priorParagraphIdByPosition,
		priorScaffolding,
	};
}

// ── Prompt assembly ───────────────────────────────────────────────

function buildSystemPrefix(caseCtx: CaseContext): string {
	return `[PERSONA]
${caseCtx.brief.persona}

[KONTEXT DIESES PASSES — ANALYTISCHER MODUS, EXPERIMENTELL]
Du arbeitest in einem analytischen Modus parallel zur synthetisch-hermeneutischen Hauptlektüre. Du sollst diesen Absatz in zwei Layern erfassen:

  Layer 1 — **Argumente**: Aussagen mit Begründungen, isoliert bewertbar. Wissenschaftlich-argumentative Stringenz.
  Layer 2 — **Stützstrukturen** (scaffolding): textorganisatorische, didaktische, kontextualisierende, rhetorische Elemente. Sie sind selbst nicht argumentativ, sondern dienen der Lesbarkeit/Verstehbarkeit der Argumente — und sind genau deshalb NUR in Bezug auf konkrete Argumente sinnvoll bewertbar.

KEINE hermeneutische Synthese. KEINE Vorblicke. KEINE Bewegungsfiguren auf Werk-Ebene. Nur: was wird behauptet (Layer 1) und was tut der Text textorganisatorisch in Bezug auf diese Behauptungen (Layer 2).

Beide Layer zusammen sollen den Absatz vollständig abdecken — leere Felder sind nur dann korrekt, wenn der Absatz tatsächlich nichts der jeweiligen Sorte enthält. Ein Absatz, der ausschließlich Übergang/Beleg/Beispielssetzung/Rhetorik ist (kein Argument trägt), kann \`arguments: []\` haben, aber dann muss \`scaffolding\` nicht-leer sein. Bei \`anchored_to\` gilt: bevorzugt auf konkrete Args (lokal oder \`§N:AM\`); falls in einem rein deskriptiven Absatz weder lokal noch in den prior_arguments_index Args verfügbar sind, darf \`anchored_to\` leer bleiben — die Stützstruktur wird dann auf Absatz-Ebene verankert. Bitte keine A1/A2 erfinden.

[KRITERIEN ALS LESEFOLIE]
${caseCtx.brief.criteria}

[WERK]
Titel: ${caseCtx.documentTitle}
Werktyp: ${caseCtx.brief.work_type}
Umfang Hauptteil: ${caseCtx.mainHeadingCount} Hauptkapitel-Überschriften, ${caseCtx.mainParagraphCount} Hauptabsätze.

[OUTPUT-FORMAT — line-based prose, KEIN JSON]
Antworte ausschließlich in dem unten gezeigten Sektions-Format. Sektion-Header sind GROSSGESCHRIEBEN; Felder kommen als \`key: value\` auf eigener Zeile; mehrzeilige Werte schreibst du fortlaufend in den Folgezeilen ohne Zeilenumbruch-Escape; keine Markdown-Codefences; kein einleitender Erklärtext; keine abschließende Zusammenfassung.
${PROSE_FORMAT_SPEC}

[REGELN]

Zu **ARGUMENT-Sektionen**:
- IDs strikt "A1", "A2", ... in der Reihenfolge des Auftretens im Absatz.
- claim: self-contained — d.h. ein Leser, der den Absatz nicht kennt, kann den claim verstehen. Verwende ggf. Theorie-Begriffe explizit ("Globalität als Komplexitätssteigerung", nicht nur "diese Steigerung"). 1–2 Sätze.
- premises: nur was für die Geltung des claims **notwendig** ist. Drei Quellen-Typen:
  · stated      — wörtlich oder paraphrasiert im Absatz selbst.
  · carried §N  — aus früherem Absatz N des Unterkapitels übernommen; gib die Absatz-Position N hinter "carried §" als Zahl an.
  · background  — fachübliche Hintergrundannahme, die der claim implizit voraussetzt. Sparsam verwenden — wenn eine Annahme im Absatz steht, ist sie "stated", nicht "background".
- Eine leere premises-Liste ist erlaubt, wenn der claim wirklich freistehend ist (selten); dann lass den \`premises:\`-Block weg.
- grounding: rein textbasierte Klassifikation, wie das Argument im Absatz belegt wird. Pflichtfeld. Genau einer der vier Werte:
  · none          — keine Verweise oder Belege.
  · namedropping  — nur Autor:innen-/Theorienamen genannt, kein Werk- oder Stellenbezug ("nach Bourdieu", "wie Foucault zeigt", "Klafki sieht das ähnlich"). Auch mehrfache Wiederholung desselben Namens im Absatz bleibt namedropping, solange kein Werk-, Theorie- oder Studienname dazukommt.
  · abstract      — konkret BENANNTES Werk, BENANNTE Theorie oder BENANNTE Studie wird inhaltlich angesprochen, aber ohne Stelle/Zitat ("Bourdieus Habitus-Begriff", "die PISA-Studien", "Klafkis kategoriale Bildung", "Foucaults Diskurstheorie"). Bloßer Personenname OHNE benannten Werk-/Theorie-/Studienbezug ist NICHT abstract — das bleibt namedropping.
  · concrete      — konkrete Stelle, Zitat, Seitenzahl oder Studienangabe ("Bourdieu 1982, S. 42", "wörtlich: '…'", "n=438, p<.05").
  Maßstab ist allein der Text dieses Absatzes — nicht, ob die Behauptung in der Forschungsrealität gut belegt ist (das wäre eine separate Bewertung). "background"-Premissen zählen nicht als Grounding.
- anchor: bevorzugt wörtliche in-vivo-Wortgruppe (≤ 8 Wörter); wenn keine geeignete existiert, leer lassen.

Zu **EDGES-Sektion**:
- Eine Sektion EDGES, mehrere Kanten-Zeilen.
- inter_argument: Kanten zwischen zwei Argumenten DIESES Absatzes. Erlaubte kinds: supports, refines, contradicts.
- prior_paragraph: Kanten zu Argumenten aus früheren Absätzen des Unterkapitels. Erlaubte kinds: supports, refines, contradicts, presupposes. Ziel-Format: "§<Position>:<ArgID>".
- presupposes ist nur als prior_paragraph-Kante zulässig.
- Pfeil-Form strikt: "<id> -<kind>-> <id-oder-§N:Aid>".
- Keine Kanten erfinden — wenn ein Argument keine erkennbare Beziehung zu anderen hat, keine Kante.
- Wenn keine Edges, lass die EDGES-Sektion weg.

Zu **SCAFFOLDING-Sektionen** (Layer 2):
- IDs strikt "S1", "S2", ...
- function ist eine der vier Kategorien:
  · textorganisatorisch — Übergänge, Rückbezüge, Vorblicke (im Reichweite vorheriger Absätze), Strukturmarker, Aufzählungs-Bündelungen.
  · didaktisch          — Beispiele, Illustrationen, Kontrastsetzungen zur Verständnis-Erleichterung.
  · kontextualisierend  — Zitate als Beleg, Begriffsklärungen, Theorie-Einbettungen, Quellenverweise.
  · rhetorisch          — Relevanzmarkierungen, Meta-Reflexionen des Autors über das eigene Argument, Emphase, rhetorische Fragen.
- description: spezifische Funktion in Bezug auf konkrete Argumente. **Format**: nenne die Bezugsargumente explizit (z.B. "Beleg von §3:A2 durch Hornberg-Studie").
- assessment: Bewertung aus argumentationslogischer Sicht — was tut die Stützstruktur für die Tragfähigkeit/Verständlichkeit der bezogenen Argumente? **Nicht** Bewertung des stilistischen Werts isoliert, sondern: dient die Stützfunktion der Argumentation? Mögliche Befunde: "klar wirksam", "redundant", "bedingt plausibel — Beleg trägt nur indirekt", "rhetorisch wirksam, sachlich schwach", "trägt §X:AY entscheidend, ohne ihn wäre der claim unbelegt", etc.
- anchored_to: Komma-getrennte Liste von Argument-IDs (lokal "A1" oder Cross "§N:AM"), an die diese Stützstruktur gebunden ist. **Bevorzugt** ≥ 1 Anker auf tatsächlich extrahierte Args. Wenn keine geeigneten Args verfügbar sind (weder lokal in diesem Absatz noch in den prior_arguments_index früherer Absätze), darf die Liste leer bleiben (\`anchored_to: \` oder Feld weglassen) — die Stützstruktur wird dann auf Absatz-Ebene verankert. **Bitte keine A1/A2 erfinden**, wenn der Absatz tatsächlich keine Argumente enthält.
- excerpt: Textfragment des Absatzes, das die Stützfunktion trägt; bis 500 Zeichen.
- anchor: kürzere wörtliche Wortgruppe (≤ 8 Wörter) für char-genaue Verankerung.

Wichtig: ein Absatz, der ausschließlich aus textorganisatorisch-didaktisch-kontextualisierend-rhetorischen Elementen besteht (z.B. ein reiner Übergangsabsatz, eine Belegkette, ein Methodenkommentar, ein deskriptiver Erklärungsabsatz), hat dann KEINE ARGUMENT-Sektion und nur SCAFFOLDING-Sektionen. Falls in prior_arguments_index Args verfügbar sind, sollte anchored_to darauf zeigen; falls nicht (z.B. erster Absatz eines rein expositorischen Subkapitels, das eine Quelle/Institution einführt), darf anchored_to leer bleiben.

NICHT als scaffolding zu erfassen: Premissen sind Teil von Argumenten, nicht Stützstrukturen. Ein Belegzitat, das im Argument selbst aufgeht, gehört in dessen premises (stated), nicht ins scaffolding. scaffolding registriert nur Material, das *als textorganisatorische/didaktische Geste* erkennbar ist — also Material, das eine Argumentation rahmt, einleitet, illustriert, motiviert oder verbindet, ohne selbst behauptend zu sein.`;
}

function buildSystemSuffix(caseCtx: CaseContext, paraCtx: ParagraphContext): string {
	const outlineLines = caseCtx.mainHeadings
		.map(h => h === paraCtx.subchapterLabel ? `- ${h}           ← AKTUELL HIER` : `- ${h}`)
		.join('\n');

	const completed = paraCtx.completedKontextualisierungen.length === 0
		? '(Noch keine Sektionen abgeschlossen.)'
		: paraCtx.completedKontextualisierungen
			.map(k => `## "${k.sectionLabel}"\n${k.content}`)
			.join('\n\n');

	const priorArgsBlock = paraCtx.priorArguments.length === 0
		? '(Noch keine Argumente in vorherigen Absätzen dieses Unterkapitels — dies ist der erste analysierte Absatz im Unterkapitel.)'
		: paraCtx.priorArguments
			.map(a => `§${a.positionInSubchapter}:${a.argLocalId} — ${a.claim}`)
			.join('\n');

	const priorScaffoldingBlock = paraCtx.priorScaffolding.length === 0
		? '(Noch keine registrierten Stützstrukturen.)'
		: paraCtx.priorScaffolding
			.map(s => `§${s.positionInSubchapter}:${s.elementLocalId} [${s.functionType}] — ${s.functionDescription}`)
			.join('\n');

	return `[OUTLINE & POSITION]
Outline (Hauptüberschriften, sequentiell):
${outlineLines}

[BISHERIGE GUTACHTERLICHE LEKTÜRE — kontextualisierende Memos abgeschlossener Sektionen]
${completed}

[PRIOR-ARGUMENTE-INDEX — Argumente aus vorherigen Absätzen des aktuellen Unterkapitels "${paraCtx.subchapterLabel}"]
${priorArgsBlock}

[PRIOR-STÜTZSTRUKTUREN-INDEX — bereits registrierte Stützstrukturen aus vorherigen Absätzen]
${priorScaffoldingBlock}`;
}

// Backward-compat: legacy single-string builder.
function buildSystemPrompt(caseCtx: CaseContext, paraCtx: ParagraphContext): string {
	return buildSystemPrefix(caseCtx) + '\n\n' + buildSystemSuffix(caseCtx, paraCtx);
}

function buildUserMessage(paraCtx: ParagraphContext): string {
	const predecessor = paraCtx.predecessorText
		? `[Vorgänger-Absatz — Kontext, NICHT zu analysieren]\n"${paraCtx.predecessorText}"`
		: '[Vorgänger-Absatz: keiner — dies ist der erste Absatz im Unterkapitel.]';

	const successor = paraCtx.successorText
		? `[Nachfolger-Absatz — nur Vorblick, NICHT zu analysieren]\n"${paraCtx.successorText}"`
		: '[Nachfolger-Absatz: keiner — dies ist der letzte Absatz im Unterkapitel.]';

	return `Aktuelle Position im Werk:
Unterkapitel: "${paraCtx.subchapterLabel}"
Absatz ${paraCtx.positionInSubchapter} von ${paraCtx.subchapterTotalParagraphs} in diesem Unterkapitel.

${predecessor}

[AKTUELLER ABSATZ — Fokus der analytischen Zerlegung]
"${paraCtx.text}"

${successor}

Erzeuge das line-based prose-Output (ARGUMENT/EDGES/SCAFFOLDING-Sektionen) für den AKTUELLEN ABSATZ.`;
}

// ── Output extraction ─────────────────────────────────────────────
// (Moved to argumentation-graph-prose-parser.ts. The legacy JSON-extract
//  helpers — extractJSON, repairTypographicQuotes — live in
//  src/lib/server/ai/json-extract.ts for use by other passes that still
//  emit JSON [chapter-collapse, document-collapse, per-paragraph].)

// ── Storage ───────────────────────────────────────────────────────

interface StoreResult {
	nodeIds: string[];                     // UUIDs of stored argument_nodes (in order)
	unanchoredArguments: string[];         // arg_local_ids whose anchor_phrase didn't substring-match
	interEdgeCount: number;
	priorEdgeCount: number;
	skippedEdges: { reason: string; from: string; to: string }[];
	scaffoldingIds: string[];              // UUIDs of stored scaffolding_elements (in order)
	scaffoldingAnchorCount: number;        // total resolved scaffolding_anchors rows
	unanchoredScaffolding: string[];       // element_local_ids whose anchor_phrase didn't substring-match
	skippedScaffolding: { reason: string; element: string }[];      // dropped (e.g. all anchors unresolved)
	skippedScaffoldingAnchors: { element: string; ref: string; reason: string }[]; // dropped individual refs
}

async function storeResult(
	paraCtx: ParagraphContext,
	result: ArgumentationGraphResult
): Promise<StoreResult> {
	return transaction(async (client) => {
		const nodeIds: string[] = [];
		const unanchoredArguments: string[] = [];
		const localIdToNodeId = new Map<string, string>();

		// 1. Insert all arguments
		for (let i = 0; i < result.arguments.length; i++) {
			const arg = result.arguments[i];
			if (arg.anchor_phrase.length > 80) {
				console.warn(
					`     style: ${arg.id} anchor_phrase length=${arg.anchor_phrase.length} (> 80 chars; prompt asks for ≤ 8 Wörter)`
				);
			}
			let charStart: number;
			let charEnd: number;
			if (arg.anchor_phrase) {
				const idx = paraCtx.text.indexOf(arg.anchor_phrase);
				if (idx === -1) {
					unanchoredArguments.push(arg.id);
					charStart = paraCtx.charStart;
					charEnd = paraCtx.charEnd;
				} else {
					charStart = paraCtx.charStart + idx;
					charEnd = charStart + arg.anchor_phrase.length;
				}
			} else {
				charStart = paraCtx.charStart;
				charEnd = paraCtx.charEnd;
			}

			const r = await client.query(
				`INSERT INTO argument_nodes
				   (paragraph_element_id, arg_local_id, claim, premises, anchor_phrase,
				    anchor_char_start, anchor_char_end, position_in_paragraph,
				    referential_grounding)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				 RETURNING id`,
				[
					paraCtx.paragraphId,
					arg.id,
					arg.claim,
					JSON.stringify(arg.premises),
					arg.anchor_phrase,
					charStart,
					charEnd,
					i + 1,
					arg.referential_grounding,
				]
			);
			nodeIds.push(r.rows[0].id);
			localIdToNodeId.set(arg.id, r.rows[0].id);
		}

		// 2. Insert edges. Skip with logging if a reference cannot be resolved.
		let interEdgeCount = 0;
		let priorEdgeCount = 0;
		const skippedEdges: { reason: string; from: string; to: string }[] = [];

		for (const edge of result.edges) {
			const fromUuid = localIdToNodeId.get(edge.from);
			if (!fromUuid) {
				skippedEdges.push({ reason: `from-id "${edge.from}" not in this paragraph`, from: edge.from, to: edge.to });
				continue;
			}

			let toUuid: string | undefined;
			if (edge.scope === 'inter_argument') {
				toUuid = localIdToNodeId.get(edge.to);
				if (!toUuid) {
					skippedEdges.push({ reason: `to-id "${edge.to}" not in this paragraph`, from: edge.from, to: edge.to });
					continue;
				}
				if (toUuid === fromUuid) {
					skippedEdges.push({ reason: `self-edge`, from: edge.from, to: edge.to });
					continue;
				}
			} else {
				// prior_paragraph: parse "§N:AM"
				const m = edge.to.match(/^§(\d+):(A\d+)$/);
				if (!m) {
					skippedEdges.push({ reason: `malformed prior_paragraph reference "${edge.to}"`, from: edge.from, to: edge.to });
					continue;
				}
				const positionInSubchapter = parseInt(m[1], 10);
				const targetArgLocalId = m[2];

				const targetParagraphId = paraCtx.priorParagraphIdByPosition.get(positionInSubchapter);
				if (!targetParagraphId) {
					skippedEdges.push({
						reason: `referenced paragraph §${positionInSubchapter} has no extracted arguments yet`,
						from: edge.from,
						to: edge.to,
					});
					continue;
				}
				const targetRow = (await client.query<{ id: string }>(
					`SELECT id FROM argument_nodes
					 WHERE paragraph_element_id = $1 AND arg_local_id = $2`,
					[targetParagraphId, targetArgLocalId]
				)).rows[0];
				if (!targetRow) {
					skippedEdges.push({
						reason: `arg ${targetArgLocalId} not found in paragraph §${positionInSubchapter}`,
						from: edge.from,
						to: edge.to,
					});
					continue;
				}
				toUuid = targetRow.id;
			}

			await client.query(
				`INSERT INTO argument_edges (from_node_id, to_node_id, kind, scope)
				 VALUES ($1, $2, $3, $4)`,
				[fromUuid, toUuid, edge.kind, edge.scope]
			);
			if (edge.scope === 'inter_argument') interEdgeCount++; else priorEdgeCount++;
		}

		// 3. Insert scaffolding elements + anchors. Resolve each anchored_to ref
		//    (either local "Ax" or cross "§N:AM"); drop the ENTIRE element if
		//    all its refs are unresolvable (orphan); otherwise insert with the
		//    resolvable subset and log the dropped refs.
		const scaffoldingIds: string[] = [];
		const unanchoredScaffolding: string[] = [];
		const skippedScaffolding: { reason: string; element: string }[] = [];
		const skippedScaffoldingAnchors: { element: string; ref: string; reason: string }[] = [];
		let scaffoldingAnchorCount = 0;

		for (let i = 0; i < result.scaffolding.length; i++) {
			const el = result.scaffolding[i];

			// Resolve anchor refs to argument UUIDs
			const resolvedAnchorIds: string[] = [];
			for (const ref of el.anchored_to) {
				if (/^A\d+$/.test(ref)) {
					const uuid = localIdToNodeId.get(ref);
					if (uuid) {
						resolvedAnchorIds.push(uuid);
					} else {
						skippedScaffoldingAnchors.push({ element: el.id, ref, reason: `local arg "${ref}" not in this paragraph` });
					}
				} else {
					const m = ref.match(/^§(\d+):(A\d+)$/);
					if (!m) {
						skippedScaffoldingAnchors.push({ element: el.id, ref, reason: `malformed anchor ref` });
						continue;
					}
					const positionInSubchapter = parseInt(m[1], 10);
					const targetArgLocalId = m[2];
					const targetParagraphId = paraCtx.priorParagraphIdByPosition.get(positionInSubchapter);
					if (!targetParagraphId) {
						skippedScaffoldingAnchors.push({
							element: el.id,
							ref,
							reason: `paragraph §${positionInSubchapter} has no extracted arguments yet`,
						});
						continue;
					}
					const t = (await client.query<{ id: string }>(
						`SELECT id FROM argument_nodes WHERE paragraph_element_id = $1 AND arg_local_id = $2`,
						[targetParagraphId, targetArgLocalId]
					)).rows[0];
					if (!t) {
						skippedScaffoldingAnchors.push({
							element: el.id,
							ref,
							reason: `arg ${targetArgLocalId} not found in §${positionInSubchapter}`,
						});
						continue;
					}
					resolvedAnchorIds.push(t.id);
				}
			}

			// Leeres oder vollständig unauflösbares anchored_to ist kein Drop-Grund mehr:
			// rein expositorische Absätze (Definitionen, Paraphrasen, deskriptive Passagen
			// am Anfang eines Subkapitels) liefern legitim scaffolding ohne Argument-Anker.
			// Wir speichern das Element trotzdem (paragraph-anchored über die char_anchor-
			// Felder weiter unten) und legen einfach keine scaffolding_anchors-Rows an.
			if (resolvedAnchorIds.length === 0 && el.anchored_to.length > 0) {
				// LLM hat Anker geliefert, aber alle waren unauflösbar — das ist erwähnenswert
				// (Hallu auf nicht-existente A1/A2, oder prior-§ ohne Args), aber kein Drop.
				skippedScaffolding.push({ reason: `all anchored_to refs unresolved — kept paragraph-anchored`, element: el.id });
			}

			// Char anchor for the scaffolding element itself
			if (el.anchor_phrase.length > 80) {
				console.warn(
					`     style: ${el.id} anchor_phrase length=${el.anchor_phrase.length} (> 80 chars; prompt asks for ≤ 8 Wörter)`
				);
			}
			if (el.excerpt.length > 500) {
				console.warn(
					`     style: ${el.id} excerpt length=${el.excerpt.length} (> 500 chars; potential block echo)`
				);
			}
			let charStart: number;
			let charEnd: number;
			if (el.anchor_phrase) {
				const idx = paraCtx.text.indexOf(el.anchor_phrase);
				if (idx === -1) {
					unanchoredScaffolding.push(el.id);
					charStart = paraCtx.charStart;
					charEnd = paraCtx.charEnd;
				} else {
					charStart = paraCtx.charStart + idx;
					charEnd = charStart + el.anchor_phrase.length;
				}
			} else {
				charStart = paraCtx.charStart;
				charEnd = paraCtx.charEnd;
			}

			const r = await client.query(
				`INSERT INTO scaffolding_elements
				   (paragraph_element_id, element_local_id, excerpt, function_type,
				    function_description, assessment, anchor_phrase,
				    anchor_char_start, anchor_char_end, position_in_paragraph)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
				 RETURNING id`,
				[
					paraCtx.paragraphId,
					el.id,
					el.excerpt,
					el.function_type,
					el.function_description,
					el.assessment,
					el.anchor_phrase,
					charStart,
					charEnd,
					i + 1,
				]
			);
			const scaffoldingId = r.rows[0].id;
			scaffoldingIds.push(scaffoldingId);

			for (const argUuid of resolvedAnchorIds) {
				await client.query(
					`INSERT INTO scaffolding_anchors (scaffolding_id, argument_id) VALUES ($1, $2)
					 ON CONFLICT DO NOTHING`,
					[scaffoldingId, argUuid]
				);
				scaffoldingAnchorCount++;
			}
		}

		// Storage-empty guard: wenn der Pass gar nichts persistiert (weder
		// argument_nodes noch scaffolding_elements), würde der Orchestrator-
		// Loop diesen ¶ als immer noch pending sehen und mit echten LLM-Calls
		// in eine Endlosschleife geraten. Seit dem Relax von anchored_to
		// (siehe oben) tritt dieser Fall nur noch ein, wenn das LLM-Output
		// echt leer ist — also weder ARGUMENT- noch SCAFFOLDING-Sektion
		// extrahierbar war. Das ist ein echter Output-Fehler, kein Drop-
		// Effekt der Storage-Logik.
		if (nodeIds.length === 0 && scaffoldingIds.length === 0) {
			throw new Error(
				`AG-Pass lieferte für diesen Absatz weder Argumente noch Stützstrukturen ` +
				`(${result.arguments.length} args extrahiert, ${result.scaffolding.length} scaffolding extrahiert). ` +
				`Üblicherweise ein LLM-Output-Fehler: leerer Response oder vollständig unparseable Sektionen. ` +
				`Bei result.scaffolding.length > 0 zusätzlich diagnostisch: ` +
				`${skippedScaffolding.map((s) => s.reason).join(', ').slice(0, 200) || '(keine skipped scaffolding)'}.`
			);
		}

		return {
			nodeIds, unanchoredArguments,
			interEdgeCount, priorEdgeCount, skippedEdges,
			scaffoldingIds, scaffoldingAnchorCount,
			unanchoredScaffolding, skippedScaffolding, skippedScaffoldingAnchors,
		};
	});
}

// ── Public orchestration ──────────────────────────────────────────

export interface ArgumentationGraphRun {
	skipped: boolean;
	result: ArgumentationGraphResult | null;
	stored: StoreResult | null;
	tokens: {
		input: number;
		output: number;
		cacheCreation: number;
		cacheRead: number;
		total: number;
	} | null;
	model: string | null;
	provider: string | null;
}

export async function runArgumentationGraphPass(
	caseId: string,
	paragraphId: string,
	opts: { modelOverride?: { provider: Provider; model: string }; maxTokens?: number } = {}
): Promise<ArgumentationGraphRun> {
	const caseCtx = await loadCaseContext(caseId);
	const paraCtx = await loadParagraphContext(caseCtx, paragraphId);

	// Idempotence guard: skip if EITHER argument_nodes OR scaffolding_elements
	// already exist for this paragraph. To re-run, DELETE FROM both tables
	// WHERE paragraph_element_id = '...' (FK cascades to edges and anchors).
	const existing = await queryOne<{ n_args: string; n_scaff: string }>(
		`SELECT
		   (SELECT count(*) FROM argument_nodes WHERE paragraph_element_id = $1)::text AS n_args,
		   (SELECT count(*) FROM scaffolding_elements WHERE paragraph_element_id = $1)::text AS n_scaff`,
		[paragraphId]
	);
	if (parseInt(existing?.n_args ?? '0', 10) > 0 || parseInt(existing?.n_scaff ?? '0', 10) > 0) {
		return {
			skipped: true,
			result: null,
			stored: null,
			tokens: null,
			model: null,
			provider: null,
		};
	}

	const cacheableSystemPrefix = buildSystemPrefix(caseCtx);
	const system = buildSystemSuffix(caseCtx, paraCtx);
	const user = buildUserMessage(paraCtx);

	const response = await chat({
		cacheableSystemPrefix,
		system,
		messages: [{ role: 'user', content: user }],
		// 8000: prose-output is generally less verbose than the JSON it
		// replaces (no quote/bracket boilerplate); 8000 still safe upper.
		maxTokens: opts.maxTokens ?? 8000,
		modelOverride: opts.modelOverride,
	});

	const { result: parsedRaw, warnings, junkSections } = parseProseAG(response.text);

	// Sanity-validate the parser output against the schema. The parser is
	// permissive but produces shapes the schema expects; if Zod still rejects,
	// it usually means the parser dropped too much (zero args + zero scaff)
	// or the LLM emitted something the parser couldn't classify.
	const validation = ArgumentationGraphResultSchema.safeParse(parsedRaw);
	if (!validation.success || (validation.data.arguments.length === 0 && validation.data.scaffolding.length === 0)) {
		// Empty parse = either (a) genuinely empty paragraph (rare), or
		// (b) parser couldn't recognize anything (more common). Dump for
		// post-mortem; a 2B-fallback recovery layer can hook in later.
		const dumpPath = `/tmp/argumentation-graph-failure-${paragraphId}.txt`;
		const fs = await import('node:fs/promises');
		const errorBlob = validation.success
			? 'parser-empty-output (zero args + zero scaffolding)'
			: validation.error.message;
		await fs.writeFile(
			dumpPath,
			`paragraph_id: ${paragraphId}\noutput_tokens: ${response.outputTokens}\n` +
			`parser warnings (${warnings.length}):\n${warnings.map(w => '  - ' + w).join('\n')}\n` +
			`junk sections (${junkSections.length}):\n${junkSections.map((j, i) => `  [${i}] ${j.slice(0, 120)}`).join('\n')}\n` +
			`schema error: ${errorBlob}\n\n--- RAW RESPONSE ---\n${response.text}\n`,
			'utf8'
		);
		console.error(`     dumped raw response to ${dumpPath}`);
		throw new Error(`Argumentation-graph prose-parse produced no usable output (${warnings.length} warnings, ${junkSections.length} junk sections)`);
	}
	const parsed: ArgumentationGraphResult = validation.data;
	if (warnings.length > 0) {
		console.warn(`     parser warnings (${warnings.length}): ${warnings.slice(0, 3).join(' | ')}${warnings.length > 3 ? ' ...' : ''}`);
	}
	const stored = await storeResult(paraCtx, parsed);

	return {
		skipped: false,
		result: parsed,
		stored,
		tokens: {
			input: response.inputTokens,
			output: response.outputTokens,
			cacheCreation: response.cacheCreationTokens,
			cacheRead: response.cacheReadTokens,
			total: response.tokensUsed,
		},
		model: response.model,
		provider: response.provider,
	};
}
