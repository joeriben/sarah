// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Per-paragraph hermeneutic pass.
//
// Pulls the paragraph and its surrounding context, assembles the cached system
// block (persona, criteria, work header, completed sections, interpretive
// chain in current subchapter) and a fresh user message (predecessor +
// current paragraph + successor + position label), calls the LLM, parses the
// structured JSON response, and writes the formulierend + interpretierend
// memos plus 0..3 in-vivo-code namings with char anchors.
//
// The interpretive chain in the current subchapter is the architectural
// device that makes the section-end kontextualisierende memo synthesizable:
// each paragraph's interpretation is position-aware against the subchapter's
// progression so far, so the later collapse pass has a chain of
// position-aware reads to work from.

import { z } from 'zod';
import { query, queryOne, transaction } from '../../db/index.js';
import { chat } from '../client.js';

// ── Output schema ─────────────────────────────────────────────────

// Kernthesen-Code: a self-contained, retrieval-grade handle for the
// paragraph's argumentative core. The label must be unambiguous out of
// context (a future retrieval layer uses codes plus chapter titles to
// surface relevant paragraphs — fragments like "Wiederholung und
// Veränderung" or "long durée" fail that test). The anchor_phrase is an
// optional verbatim substring used for char-level binding; when no clean
// in-vivo phrase exists, anchor_phrase stays empty and the code anchors
// to the whole paragraph.
const CodeSchema = z.object({
	label: z.string().min(1).max(100),
	anchor_phrase: z.string().max(80).default(''),
	rationale: z.string().min(1).max(500),
});

const ParagraphPassResultSchema = z.object({
	formulierend: z.string().min(1).optional(),  // present iff brief.include_formulierend
	interpretierend: z.string().min(1),
	codes: z.array(CodeSchema).max(2),
});

export type ParagraphPassResult = z.infer<typeof ParagraphPassResultSchema>;

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
		includeFormulierend: boolean;
	};
	mainHeadings: string[];          // ordered, ~80-char-truncated labels
	mainParagraphCount: number;
	mainHeadingCount: number;
}

interface ParagraphContext {
	paragraphId: string;
	charStart: number;
	charEnd: number;
	text: string;
	subchapterHeadingId: string;
	subchapterLabel: string;
	subchapterStart: number;
	subchapterEnd: number;            // exclusive (char_start of next heading or full_text length)
	positionInSubchapter: number;     // 1-based
	subchapterTotalParagraphs: number;
	predecessorText: string | null;
	successorText: string | null;
	completedKontextualisierungen: { sectionLabel: string; content: string }[];
	interpretiveChain: { positionInSubchapter: number; content: string }[];
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
		include_formulierend: boolean;
	}>(
		`SELECT c.project_id, c.central_document_id,
		        b.name AS brief_name, b.work_type, b.criteria, b.persona,
		        b.include_formulierend
		 FROM cases c
		 LEFT JOIN assessment_briefs b ON b.id = c.assessment_brief_id
		 WHERE c.id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.criteria) throw new Error(`Case ${caseId} has no assessment_brief attached`);

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
			includeFormulierend: caseRow.include_formulierend,
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

	// Subchapter heading: latest heading at-or-before paragraph start
	const heading = await queryOne<{ id: string; char_start: number; char_end: number }>(
		`SELECT id, char_start, char_end FROM document_elements
		 WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main'
		   AND char_start <= $2
		 ORDER BY char_start DESC LIMIT 1`,
		[caseCtx.centralDocumentId, para.char_start]
	);
	if (!heading) throw new Error(`No subchapter heading found before paragraph ${paragraphId}`);

	// Subchapter end: char_start of next main heading, or full_text length
	const nextHeading = await queryOne<{ char_start: number }>(
		`SELECT char_start FROM document_elements
		 WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main'
		   AND char_start > $2
		 ORDER BY char_start ASC LIMIT 1`,
		[caseCtx.centralDocumentId, para.char_start]
	);
	const subchapterEnd = nextHeading?.char_start ?? caseCtx.fullText.length;

	// All paragraphs in this subchapter, ordered
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

	// Interpretive chain: prior interpretierende memos in this subchapter
	const chainRows = (
		await query<{ char_start: number; content: string }>(
			`SELECT de.char_start, mc.content
			 FROM memo_content mc
			 JOIN document_elements de ON de.id = mc.scope_element_id
			 WHERE mc.memo_type = 'interpretierend'
			   AND mc.scope_level = 'paragraph'
			   AND de.document_id = $1
			   AND de.char_start >= $2 AND de.char_start < $3
			 ORDER BY de.char_start`,
			[caseCtx.centralDocumentId, heading.char_start, para.char_start]
		)
	).rows;
	const interpretiveChain = chainRows.map(r => ({
		positionInSubchapter: subPars.findIndex(p => p.char_start === r.char_start) + 1,
		content: r.content,
	}));

	// Completed kontextualisierungen: subchapter-level memos for sections
	// strictly preceding the current subchapter
	const kontextRows = (
		await query<{ section_label: string; content: string; char_start: number }>(
			`SELECT
			   substring($1::text FROM de.char_start+1 FOR de.char_end-de.char_start) AS section_label,
			   mc.content,
			   de.char_start
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
		interpretiveChain,
	};
}

// ── Prompt assembly ───────────────────────────────────────────────

function buildSystemPrompt(caseCtx: CaseContext, paraCtx: ParagraphContext): string {
	const outlineLines = caseCtx.mainHeadings
		.map(h => h === paraCtx.subchapterLabel ? `- ${h}           ← AKTUELL HIER` : `- ${h}`)
		.join('\n');

	const completed = paraCtx.completedKontextualisierungen.length === 0
		? '(Noch keine Sektionen abgeschlossen — dies ist der erste analysierte Absatz im Werk.)'
		: paraCtx.completedKontextualisierungen
			.map(k => `## "${k.sectionLabel}"\n${k.content}`)
			.join('\n\n');

	const chain = paraCtx.interpretiveChain.length === 0
		? '(Noch keine vorherigen interpretierenden Memos — dies ist der erste Absatz im Unterkapitel.)'
		: paraCtx.interpretiveChain
			.map(c => `### Absatz ${c.positionInSubchapter}\n${c.content}`)
			.join('\n\n');

	return `[PERSONA]
${caseCtx.brief.persona}

Hypothesen über die Werkrichtung dürfen formuliert werden, aber als Hypothesen markiert ("ist zu vermuten", "wird sich zeigen müssen", "deutet darauf hin" o.ä.) — nicht als bereits getroffene Beobachtungen.

[KRITERIEN ALS LESEFOLIE]
${caseCtx.brief.criteria}

[WERK]
Titel: ${caseCtx.documentTitle}
Werktyp: ${caseCtx.brief.work_type}
Umfang Hauptteil: ${caseCtx.mainHeadingCount} Hauptkapitel-Überschriften, ${caseCtx.mainParagraphCount} Hauptabsätze.

Outline (Hauptüberschriften, sequentiell):
${outlineLines}

[BISHERIGE GUTACHTERLICHE LEKTÜRE — kontextualisierende Memos abgeschlossener Sektionen]
${completed}

[INTERPRETIERENDE KETTE IM AKTUELLEN UNTERKAPITEL "${paraCtx.subchapterLabel}"]
${chain}

[OUTPUT-FORMAT]
Antworte mit einem einzelnen JSON-Objekt der folgenden Struktur und nichts sonst (kein Vor-/Nachtext, kein Markdown-Codefence):

${caseCtx.brief.includeFormulierend ? `{
  "formulierend": "<inhaltliche Verdichtung des aktuellen Absatzes — was wird gesagt, in 1–3 Sätzen, in Deinen Worten. Textnah, ohne Wertung oder Argumentations-Reflexion.>",
  "interpretierend": "<argumentative/funktionale Reflexion: was tut dieser Absatz im aktuellen Verlauf des Unterkapitels (vor dem Hintergrund der bisherigen interpretierenden Kette)? Welche Bewegung vollzieht er, welcher Stelle im Argumentations-Aufbau dient er? 1–3 Sätze.>",
  "codes": [ … ]
}` : `{
  "interpretierend": "<2–4 Sätze. Die ersten 1–2 Sätze: was wird zum Thema gemacht, welche Position bezogen — knapp, als Inhaltsanker. Die folgenden 1–2 Sätze: welche argumentative Bewegung / Funktion vollzieht der Absatz vor dem Hintergrund der bisherigen interpretierenden Kette des Subkapitels?>",
  "codes": [ … ]
}`}

Codes-Struktur (für beide Fälle gleich):
{
  "label": "<3–5 Wörter, self-contained, retrieval-tauglich — auch isoliert vom Absatzkontext eindeutig verständlich>",
  "anchor_phrase": "<EXAKTE in-vivo-Wortgruppe aus dem aktuellen Absatz, höchstens 4 Wörter, oder leerer String wenn keine geeignete wörtliche Verankerung existiert>",
  "rationale": "<warum dieser Begriff die Kernthese / den argumentativen Schlüssel des Absatzes trägt, 1 Satz>"
}

**Kernthesen-Codes** — keine beliebigen markanten Begriffe, sondern die argumentativen Kerne des Absatzes. 0–2 pro Absatz.

Zwei harte Anforderungen pro Code:
(a) **Self-contained**: Das \`label\` ist auch ohne Absatzkontext eindeutig verständlich. Ein späteres Retrieval-System wird Codes verwenden, um relevante Absätze zu finden — Codes wie "Wiederholung und Veränderung", "long durée", "bis in die Gegenwart" sind isoliert mehrdeutig und damit retrieval-untauglich.
(b) **In-vivo verankert** wo möglich: \`anchor_phrase\` ist eine wörtliche Wortgruppe aus dem Absatz, dient der char-genauen Verankerung. Wenn keine geeignete wörtliche Wortgruppe existiert, bleibt \`anchor_phrase\` leer.

Drei Muster in Präferenz-Reihenfolge:

1. **In-vivo + self-contained** (Ideal): label und anchor_phrase identisch.
   Beispiel: \`{ "label": "Cultural Turn", "anchor_phrase": "Cultural Turn" }\`,
   \`{ "label": "Steigerung von Komplexität", "anchor_phrase": "Steigerung von Komplexität" }\`.

2. **In-vivo mit Topic-Prefix**: wörtliche Wortgruppe + ergänzender Topic-Bezug.
   Beispiel statt isoliertem "Wiederholung und Veränderung":
   \`{ "label": "Kultur: Wiederholung und Veränderung", "anchor_phrase": "Wiederholung und Veränderung" }\`.

3. **Paraphrase** (Notlösung): label ohne wörtlichen Anker.
   Beispiel: \`{ "label": "Kultur als iterativer Prozess", "anchor_phrase": "" }\`.

Wenn der Absatz keine kristalline Kernthese trägt, lieber keinen Code als einen schwachen oder mehrdeutigen.`;
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

[AKTUELLER ABSATZ — Fokus der Analyse]
"${paraCtx.text}"

${successor}

Erzeuge das JSON für den AKTUELLEN ABSATZ.`;
}

// ── Output extraction ─────────────────────────────────────────────

function extractJSON(text: string): string {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1 || end < start) {
		throw new Error('No JSON object found in LLM response');
	}
	return text.slice(start, end + 1);
}

// ── Storage ───────────────────────────────────────────────────────

interface StoreResult {
	interpretierendMemoId: string;
	formulierendMemoId: string | null;
	codeIds: string[];
	unanchoredCodes: string[];
}

async function storeResult(
	caseCtx: CaseContext,
	paraCtx: ParagraphContext,
	result: ParagraphPassResult,
	userId: string
): Promise<StoreResult> {
	return transaction(async (client) => {
		// Memo-system perspective (lazily created per project, mirrors createMemo pattern)
		let perspective = (await client.query(
			`SELECT n.id FROM namings n
			 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
			 WHERE n.project_id = $1 AND a.mode = 'perspective'
			   AND a.properties->>'role' = 'memo-system'
			   AND n.deleted_at IS NULL
			 LIMIT 1`,
			[caseCtx.projectId]
		)).rows[0];
		if (!perspective) {
			const r = await client.query(
				`INSERT INTO namings (project_id, inscription, created_by)
				 VALUES ($1, 'Memo System', $2) RETURNING id`,
				[caseCtx.projectId, userId]
			);
			await client.query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
				 VALUES ($1, $1, 'perspective', '{"role": "memo-system"}')`,
				[r.rows[0].id]
			);
			perspective = r.rows[0];
		}

		const insertParagraphMemo = async (
			memoType: 'formulierend' | 'interpretierend',
			content: string
		) => {
			const label = `[${memoType}] ${paraCtx.subchapterLabel} §${paraCtx.positionInSubchapter}`;
			const memo = await client.query(
				`INSERT INTO namings (project_id, inscription, created_by)
				 VALUES ($1, $2, $3) RETURNING id`,
				[caseCtx.projectId, label, userId]
			);
			const memoId = memo.rows[0].id;
			await client.query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
				 VALUES ($1, $2, 'entity', '{}')`,
				[memoId, perspective.id]
			);
			await client.query(
				`INSERT INTO memo_content
				   (naming_id, content, format, status, memo_type, scope_element_id, scope_level)
				 VALUES ($1, $2, 'text', 'active', $3, $4, 'paragraph')`,
				[memoId, content, memoType, paraCtx.paragraphId]
			);
			return memoId;
		};

		let formulierendMemoId: string | null = null;
		if (caseCtx.brief.includeFormulierend) {
			if (!result.formulierend) {
				throw new Error(
					'brief.include_formulierend is true but LLM did not return a formulierend field'
				);
			}
			formulierendMemoId = await insertParagraphMemo('formulierend', result.formulierend);
		}
		const interpretierendMemoId = await insertParagraphMemo('interpretierend', result.interpretierend);

		const codeIds: string[] = [];
		const unanchoredCodes: string[] = [];

		for (const code of result.codes) {
			const codeNaming = await client.query(
				`INSERT INTO namings (project_id, inscription, created_by)
				 VALUES ($1, $2, $3) RETURNING id`,
				[caseCtx.projectId, code.label, userId]
			);
			const codeId = codeNaming.rows[0].id;
			codeIds.push(codeId);

			// Anchor strategy:
			// - non-empty anchor_phrase that substring-matches → precise char anchor
			// - empty anchor_phrase OR no match → anchor spans the whole paragraph
			//   (the code is still bound to the paragraph element, just without a
			//   highlighted span; retrieval can still find it via element_id)
			let charStart: number;
			let charEnd: number;
			if (code.anchor_phrase) {
				const idx = paraCtx.text.indexOf(code.anchor_phrase);
				if (idx === -1) {
					unanchoredCodes.push(code.label);
					charStart = paraCtx.charStart;
					charEnd = paraCtx.charEnd;
				} else {
					charStart = paraCtx.charStart + idx;
					charEnd = charStart + code.anchor_phrase.length;
				}
			} else {
				charStart = paraCtx.charStart;
				charEnd = paraCtx.charEnd;
			}

			await client.query(
				`INSERT INTO code_anchors (code_naming_id, element_id, char_start, char_end)
				 VALUES ($1, $2, $3, $4)`,
				[codeId, paraCtx.paragraphId, charStart, charEnd]
			);
		}

		return { interpretierendMemoId, formulierendMemoId, codeIds, unanchoredCodes };
	});
}

// ── Public orchestration ──────────────────────────────────────────

export interface ParagraphPassRun {
	result: ParagraphPassResult;
	stored: StoreResult;
	tokens: {
		input: number;
		output: number;
		cacheCreation: number;
		cacheRead: number;
		total: number;
	};
	model: string;
	provider: string;
}

export async function runParagraphPass(
	caseId: string,
	paragraphId: string,
	userId: string
): Promise<ParagraphPassRun> {
	const caseCtx = await loadCaseContext(caseId);
	const paraCtx = await loadParagraphContext(caseCtx, paragraphId);

	const system = buildSystemPrompt(caseCtx, paraCtx);
	const user = buildUserMessage(paraCtx);

	const response = await chat({
		system,
		cacheSystem: true,
		messages: [{ role: 'user', content: user }],
		maxTokens: 2000,
	});

	const json = extractJSON(response.text);
	const parsed = ParagraphPassResultSchema.parse(JSON.parse(json));
	const stored = await storeResult(caseCtx, paraCtx, parsed, userId);

	return {
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
