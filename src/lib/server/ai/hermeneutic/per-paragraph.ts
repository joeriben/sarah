// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Per-paragraph hermeneutic pass (H2 — paragraph_synthetic).
//
// Pulls the paragraph and its surrounding context, assembles the cached system
// block (persona, criteria, work header, completed sections, reflective
// chain in current subchapter) and a fresh user message (predecessor +
// current paragraph + successor + position label), calls the LLM, parses the
// structured prose response, and writes the formulierend + reflektierend
// memos.
//
// The reflective chain in the current subchapter is the architectural
// device that makes the section-end kontextualisierende memo synthesizable:
// each paragraph's interpretation is position-aware against the subchapter's
// progression so far, so the later collapse pass has a chain of
// position-aware reads to work from.

import { z } from 'zod';
import { query, queryOne, transaction } from '../../db/index.js';
import { type Provider } from '../client.js';
import { RepairCallExhaustedError } from '../json-extract.js';
import {
	runProseCallWithRepair,
	describeProseFormat,
	type SectionSpec,
	type FieldKind,
} from '../prose-extract.js';

// ── Output schema ─────────────────────────────────────────────────

const ParagraphPassResultSchema = z.object({
	formulierend: z.string().min(1).optional(),  // present iff brief.include_formulierend
	reflektierend: z.string().min(1),
});

export type ParagraphPassResult = z.infer<typeof ParagraphPassResultSchema>;

// Section-Headered-Prose-Schema. FORMULIEREND is conditionally included; if
// the brief opts out, the section is omitted from the spec entirely so the
// parser does not default an empty string that would fail Zod's min(1).
function buildSectionSpec(caseCtx: CaseContext): SectionSpec {
	const singletons: Record<string, FieldKind> = {
		REFLEKTIEREND: 'multiline',
	};
	if (caseCtx.brief.includeFormulierend) {
		singletons.FORMULIEREND = 'multiline';
	}
	return {
		singletons,
		lists: {},
	};
}

// ── Internal context types ────────────────────────────────────────

export interface CaseContext {
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

export interface ParagraphContext {
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
	reflectiveChain: { positionInSubchapter: number; content: string }[];
}

// ── Context loaders ───────────────────────────────────────────────

export async function loadCaseContext(caseId: string): Promise<CaseContext> {
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

export async function loadParagraphContext(
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

	// Reflective chain: prior reflektierende memos in this subchapter.
	// Linien-Trennung: nur Forward-Memos (`[reflektierend]%`), nicht
	// `[reflektierend-retrograde]%` — der Retrograde-Pass läuft über die
	// vollständige Forward-Kette und darf hier nicht eingeflochten werden.
	const chainRows = (
		await query<{ char_start: number; content: string }>(
			`SELECT de.char_start, mc.content
			 FROM memo_content mc
			 JOIN namings n ON n.id = mc.naming_id
			 JOIN document_elements de ON de.id = mc.scope_element_id
			 WHERE mc.memo_type = 'reflektierend'
			   AND mc.scope_level = 'paragraph'
			   AND n.inscription LIKE '[reflektierend]%'
			   AND n.deleted_at IS NULL
			   AND de.document_id = $1
			   AND de.char_start >= $2 AND de.char_start < $3
			 ORDER BY de.char_start`,
			[caseCtx.centralDocumentId, heading.char_start, para.char_start]
		)
	).rows;
	const reflectiveChain = chainRows.map(r => ({
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
		reflectiveChain,
	};
}

// ── Prompt assembly ───────────────────────────────────────────────

/**
 * Build a stable, cache-friendly prefix containing only case-level invariants
 * (PERSONA, KRITERIEN, WERK metadata, OUTPUT-FORMAT). The prefix never depends
 * on the current paragraph or subchapter.
 *
 * Use together with `buildSystemSuffix(paraCtx)` and pass both to chat() as
 * `cacheableSystemPrefix` and `system` respectively.
 */
export function buildSystemPrefix(caseCtx: CaseContext): string {
	return `[PERSONA]
${caseCtx.brief.persona}

Hypothesen über die Werkrichtung dürfen formuliert werden, aber als Hypothesen markiert ("ist zu vermuten", "wird sich zeigen müssen", "deutet darauf hin" o.ä.) — nicht als bereits getroffene Beobachtungen.

[KRITERIEN ALS LESEFOLIE]
${caseCtx.brief.criteria}

[WERK]
Titel: ${caseCtx.documentTitle}
Werktyp: ${caseCtx.brief.work_type}
Umfang Hauptteil: ${caseCtx.mainHeadingCount} Hauptkapitel-Überschriften, ${caseCtx.mainParagraphCount} Hauptabsätze.

[OUTPUT-FORMAT]${buildOutputFormatSection(caseCtx)}`;
}

/**
 * Build the variable suffix containing per-call context: outline with current-
 * scope marker, completed kontextualisierungen, reflective chain. Pass to
 * chat() as `system`.
 */
export function buildSystemSuffix(paraCtx: ParagraphContext, caseCtx: CaseContext): string {
	const outlineLines = caseCtx.mainHeadings
		.map(h => h === paraCtx.subchapterLabel ? `- ${h}           ← AKTUELL HIER` : `- ${h}`)
		.join('\n');

	const completed = paraCtx.completedKontextualisierungen.length === 0
		? '(Noch keine Sektionen abgeschlossen — dies ist der erste analysierte Absatz im Werk.)'
		: paraCtx.completedKontextualisierungen
			.map(k => `## "${k.sectionLabel}"\n${k.content}`)
			.join('\n\n');

	const chain = paraCtx.reflectiveChain.length === 0
		? '(Noch keine vorherigen reflektierenden Memos — dies ist der erste Absatz im Unterkapitel.)'
		: paraCtx.reflectiveChain
			.map(c => `### Absatz ${c.positionInSubchapter}\n${c.content}`)
			.join('\n\n');

	return `[OUTLINE & POSITION]
Outline (Hauptüberschriften, sequentiell):
${outlineLines}

[BISHERIGE GUTACHTERLICHE LEKTÜRE — kontextualisierende Memos abgeschlossener Sektionen]
${completed}

[REFLEKTIERENDE KETTE IM AKTUELLEN UNTERKAPITEL "${paraCtx.subchapterLabel}"]
${chain}`;
}

// Backward-compat: legacy single-string builder. Concatenates prefix + suffix.
export function buildSystemPrompt(caseCtx: CaseContext, paraCtx: ParagraphContext): string {
	return buildSystemPrefix(caseCtx) + '\n\n' + buildSystemSuffix(paraCtx, caseCtx);
}

function buildOutputFormatSection(caseCtx: CaseContext): string {
	const spec = buildSectionSpec(caseCtx);
	const formatDesc = describeProseFormat(spec);

	// `includeFormulierend = true` ist faktisch nicht in der Pipeline gefahren:
	// FORMULIEREND ist eine Reviewer-Reading-Aid (Audit-Trail-Spalte „was wird
	// gesagt"), kein Pipeline-Pfad — Default `false` ist der Standard. Die
	// aktuelle Implementation ist ausserdem defekt: FORMULIEREND und
	// REFLEKTIEREND laufen in EINEM Call mit zwei Sektionen, müssten aber zwei
	// unabhängige Calls sein, weil sich die Aufgaben sonst kontaminieren (die
	// Reflexions-Aufgabe färbt schon die formulierende Verdichtung und
	// umgekehrt). Eine Reaktivierung erfordert deshalb einen Refactor: zwei
	// getrennte LLM-Calls in Folge, FORMULIEREND zuerst, REFLEKTIEREND auf
	// dessen Ergebnis aufsetzend. Bis dahin bleibt der `true`-Branch
	// unangetastet (Karteileiche), und der `false`-Branch trägt die einzige
	// produktive Hint-Formulierung.
	const formulierendHint = caseCtx.brief.includeFormulierend
		? `FORMULIEREND — inhaltliche Verdichtung des aktuellen Absatzes: was wird gesagt, in 1–3 Sätzen, in Deinen Worten. Textnah, ohne Wertung oder Argumentations-Reflexion.\n\n`
		: '';

	const reflektierendHint = caseCtx.brief.includeFormulierend
		? `REFLEKTIEREND — argumentative/funktionale Reflexion: was tut dieser Absatz im aktuellen Verlauf des Unterkapitels (vor dem Hintergrund der bisherigen reflektierenden Kette)? Welche Bewegung vollzieht er, welcher Stelle im Argumentations-Aufbau dient er? 1–3 Sätze.`
		: `REFLEKTIEREND — 2–4 Sätze. Die ersten 1–2 Sätze: Inhaltsanker — was wird zum Thema gemacht, welche Position bezogen, in Deinen Worten, knapp und textnah. Die folgenden 1–2 Sätze in hermeneutisch-bewegungsorientierter Diktion: welche Bewegung vollzieht der Absatz im Verlauf des Unterkapitels — eine Begriffs-Klärung, eine Position-Setzung, eine Forschungsstand-Aufnahme, ein Spannungs-Aufbau, eine Wiederaufnahme Vorhergehender, ein Übergang zwischen Modi (Phänomen → Theorie, Deskription → Diagnose, etc.)? Falls erkennbar: knüpft der Absatz an eine konkrete Bewegung der vorhergehenden reflektierenden Kette an (Wiederaufnahme, Begriffs-Switch, Modus-Wechsel)? Die Bewegung benennen, nicht den Inhalt nacherzählen — dafür sind die ersten Sätze.`;

	return `
${formatDesc}
${formulierendHint}${reflektierendHint}`;
}

export function buildUserMessage(paraCtx: ParagraphContext): string {
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

Erzeuge die Sektionen für den AKTUELLEN ABSATZ.`;
}

// ── Storage ───────────────────────────────────────────────────────

interface StoreResult {
	reflektierendMemoId: string;
	formulierendMemoId: string | null;
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
			memoType: 'formulierend' | 'reflektierend',
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
		const reflektierendMemoId = await insertParagraphMemo('reflektierend', result.reflektierend);

		return { reflektierendMemoId, formulierendMemoId };
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
	userId: string,
	opts: { modelOverride?: { provider: Provider; model: string }; maxTokens?: number } = {}
): Promise<ParagraphPassRun> {
	const caseCtx = await loadCaseContext(caseId);
	const paraCtx = await loadParagraphContext(caseCtx, paragraphId);

	const cacheableSystemPrefix = buildSystemPrefix(caseCtx);
	const system = buildSystemSuffix(paraCtx, caseCtx);
	const user = buildUserMessage(paraCtx);
	const spec = buildSectionSpec(caseCtx);

	let repairResult;
	try {
		repairResult = await runProseCallWithRepair({
			cacheableSystemPrefix,
			system,
			user,
			spec,
			schema: ParagraphPassResultSchema,
			label: 'per-paragraph',
			maxTokens: opts.maxTokens ?? 2000,
			modelOverride: opts.modelOverride,
			caseId,
			paragraphId,
		});
	} catch (err) {
		if (err instanceof RepairCallExhaustedError) {
			const dumpPath = `/tmp/per-paragraph-failure-${paragraphId}.txt`;
			const fs = await import('node:fs/promises');
			await fs.writeFile(
				dumpPath,
				`paragraph_id: ${paragraphId}\nattempts: ${err.attempts}\nlast_stage: ${err.lastStage}\nlast_error: ${err.lastError}\n\n--- STAGES PER ATTEMPT ---\n${err.stagesPerAttempt.map((s, i) => `attempt ${i}: ${s.join(' -> ')}`).join('\n')}\n\n--- LAST RAW RESPONSE ---\n${err.lastRawText}\n`,
				'utf8'
			);
			console.error(`     dumped raw response to ${dumpPath}`);
		}
		throw err;
	}

	const parsed = repairResult.value;
	const stored = await storeResult(caseCtx, paraCtx, parsed, userId);

	return {
		result: parsed,
		stored,
		tokens: {
			input: repairResult.tokens.input,
			output: repairResult.tokens.output,
			cacheCreation: repairResult.tokens.cacheCreation,
			cacheRead: repairResult.tokens.cacheRead,
			total: repairResult.tokens.total,
		},
		model: repairResult.model,
		provider: repairResult.provider,
	};
}
