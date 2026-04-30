// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Subchapter-collapse pass. Triggered when sequential reading reaches a
// section boundary. Synthesizes a kontextualisierende memo that captures
// what the subchapter contributes to the work's overall argument, drawing
// on the chain of formulierend + interpretierend memos accumulated during
// the per-paragraph passes.
//
// "A step back — less detail, more figure of movement." That's the brief
// for this pass; it must NOT recapitulate the paragraphs but synthesize
// their argumentative arc.
//
// Storage: a single memo with memo_type='kontextualisierend' and
// scope_level='subchapter', anchored at the subchapter heading. Provenance
// (which paragraph memos / codes carry it) is recorded as participations.

import { z } from 'zod';
import { query, queryOne, transaction } from '../../db/index.js';
import { chat } from '../client.js';

// ── Output schema ─────────────────────────────────────────────────

const SubchapterCollapseResultSchema = z.object({
	kontextualisierend: z.string().min(1),
});

export type SubchapterCollapseResult = z.infer<typeof SubchapterCollapseResultSchema>;

// ── Context type ──────────────────────────────────────────────────

interface CollapseContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	fullText: string;
	brief: { name: string; work_type: string; criteria: string; persona: string };
	mainHeadings: string[];
	mainHeadingCount: number;
	mainParagraphCount: number;

	subchapterHeadingId: string;
	subchapterLabel: string;
	subchapterStart: number;
	subchapterEnd: number;

	paragraphs: {
		paragraphId: string;
		positionInSubchapter: number;
		interpretierendId: string | null;
		interpretierend: string | null;
	}[];

	completedKontextualisierungen: { sectionLabel: string; content: string }[];
}

// ── Loader ────────────────────────────────────────────────────────

async function loadCollapseContext(
	caseId: string,
	subchapterHeadingId: string
): Promise<CollapseContext> {
	const caseRow = await queryOne<{
		project_id: string;
		central_document_id: string;
		brief_name: string;
		work_type: string;
		criteria: string;
		persona: string;
	}>(
		`SELECT c.project_id, c.central_document_id,
		        b.name AS brief_name, b.work_type, b.criteria, b.persona
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
	if (!docRow) throw new Error(`Central document not found`);

	const heading = await queryOne<{ char_start: number; char_end: number; section_kind: string | null }>(
		`SELECT char_start, char_end, section_kind FROM document_elements
		 WHERE id = $1 AND document_id = $2 AND element_type = 'heading'`,
		[subchapterHeadingId, caseRow.central_document_id]
	);
	if (!heading) throw new Error(`Subchapter heading not found: ${subchapterHeadingId}`);
	if (heading.section_kind !== 'main') {
		throw new Error(`Heading ${subchapterHeadingId} is in section_kind=${heading.section_kind}, not 'main'`);
	}

	const nextHeading = await queryOne<{ char_start: number }>(
		`SELECT char_start FROM document_elements
		 WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main'
		   AND char_start > $2
		 ORDER BY char_start ASC LIMIT 1`,
		[caseRow.central_document_id, heading.char_start]
	);
	const subchapterEnd = nextHeading?.char_start ?? docRow.full_text.length;

	const paragraphsWithMemos = (
		await query<{
			paragraph_id: string;
			char_start: number;
			interpretierend_id: string | null;
			interpretierend: string | null;
		}>(
			`SELECT
			   de.id AS paragraph_id,
			   de.char_start,
			   i.naming_id AS interpretierend_id,
			   i.content AS interpretierend
			 FROM document_elements de
			 LEFT JOIN memo_content i ON i.scope_element_id = de.id
			   AND i.memo_type = 'interpretierend' AND i.scope_level = 'paragraph'
			 WHERE de.document_id = $1
			   AND de.element_type = 'paragraph'
			   AND de.section_kind = 'main'
			   AND de.char_start >= $2 AND de.char_start < $3
			 ORDER BY de.char_start`,
			[caseRow.central_document_id, heading.char_start, subchapterEnd]
		)
	).rows;

	const completedKontextualisierungen = (
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
			[docRow.full_text, caseRow.central_document_id, heading.char_start]
		)
	).rows;

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
		},
		mainHeadings,
		mainHeadingCount: parseInt(counts?.headings ?? '0', 10),
		mainParagraphCount: parseInt(counts?.paragraphs ?? '0', 10),
		subchapterHeadingId,
		subchapterLabel: docRow.full_text.substring(heading.char_start, heading.char_end).trim(),
		subchapterStart: heading.char_start,
		subchapterEnd,
		paragraphs: paragraphsWithMemos.map((p, i) => ({
			paragraphId: p.paragraph_id,
			positionInSubchapter: i + 1,
			interpretierendId: p.interpretierend_id,
			interpretierend: p.interpretierend,
		})),
		completedKontextualisierungen: completedKontextualisierungen.map(r => ({
			sectionLabel: r.section_label.trim(),
			content: r.content,
		})),
	};
}

// ── Prompt assembly ───────────────────────────────────────────────

function buildSystemPrompt(ctx: CollapseContext): string {
	const outlineLines = ctx.mainHeadings
		.map(h => h === ctx.subchapterLabel ? `- ${h}           ← AKTUELL HIER (Synthese-Pass)` : `- ${h}`)
		.join('\n');

	const completed = ctx.completedKontextualisierungen.length === 0
		? '(Noch keine Sektionen abgeschlossen — dies ist die erste Subkapitel-Synthese im Werk.)'
		: ctx.completedKontextualisierungen
			.map(k => `## "${k.sectionLabel}"\n${k.content}`)
			.join('\n\n');

	return `[PERSONA]
${ctx.brief.persona}

Hypothesen über die Werkrichtung dürfen formuliert werden, aber als Hypothesen markiert ("ist zu vermuten", "wird sich zeigen müssen", "deutet darauf hin" o.ä.) — nicht als bereits getroffene Beobachtungen.

[KONTEXT DIESES PASSES — SYNTHESE-MODUS]
Du hast jetzt ein vollständiges Subkapitel sequentiell gelesen und pro Absatz eine Verdichtung + interpretierende Reflexion verfasst. Jetzt synthetisiert Du das **kontextualisierende Memo** für dieses Subkapitel — einen Schritt zurück: weniger Absatzdetail, stärker die argumentative Bewegungsfigur. Was leistet dieses Subkapitel für das Werk-Ganze? Welche Position wurde bezogen, welche Voraussetzung für nachfolgende Subkapitel geschaffen, welche Spannungen sind offen?

Wichtig: rekapituliere nicht die Absätze einzeln. Konstruiere die *Bewegung* der Argumentation. Nenne tragende Begriffe oder Schlüsselstellen, wenn sie für die Werkrichtung tragen — nicht aus Vollständigkeit.

[KRITERIEN ALS LESEFOLIE]
${ctx.brief.criteria}

[WERK]
Titel: ${ctx.documentTitle}
Werktyp: ${ctx.brief.work_type}
Umfang Hauptteil: ${ctx.mainHeadingCount} Hauptkapitel-Überschriften, ${ctx.mainParagraphCount} Hauptabsätze.

Outline (Hauptüberschriften, sequentiell):
${outlineLines}

[BISHERIGE KONTEXTUALISIERENDE MEMOS abgeschlossener Subkapitel]
${completed}

[OUTPUT-FORMAT]
Antworte mit einem einzelnen JSON-Objekt der folgenden Struktur und nichts sonst (kein Vor-/Nachtext, kein Markdown-Codefence):

{
  "kontextualisierend": "<Synthese der Subkapitel-Bewegung — was wurde hier geleistet? 4-8 Sätze, in argumentativer Diktion (welche Position, welche Bewegung, welche Spannung), nicht in Inhalts-Diktion (was steht da).>"
}`;
}

function buildUserMessage(ctx: CollapseContext): string {
	const memoBlock = ctx.paragraphs.map(p => {
		const i = p.interpretierend ?? '(keine interpretierende Memo)';
		return `## Absatz ${p.positionInSubchapter}
${i}`;
	}).join('\n\n');

	return `Subkapitel: "${ctx.subchapterLabel}"
Anzahl Absätze: ${ctx.paragraphs.length}

[KETTE DER INTERPRETIERENDEN MEMOS]

${memoBlock}

Synthetisiere jetzt das kontextualisierende Memo für dieses Subkapitel.`;
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

async function storeCollapseMemo(
	ctx: CollapseContext,
	result: SubchapterCollapseResult,
	userId: string
): Promise<{ memoId: string }> {
	return transaction(async (client) => {
		// Memo-system perspective (lazy-create matches per-paragraph storage)
		let perspective = (await client.query(
			`SELECT n.id FROM namings n
			 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
			 WHERE n.project_id = $1 AND a.mode = 'perspective'
			   AND a.properties->>'role' = 'memo-system'
			   AND n.deleted_at IS NULL
			 LIMIT 1`,
			[ctx.projectId]
		)).rows[0];
		if (!perspective) {
			const r = await client.query(
				`INSERT INTO namings (project_id, inscription, created_by)
				 VALUES ($1, 'Memo System', $2) RETURNING id`,
				[ctx.projectId, userId]
			);
			await client.query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
				 VALUES ($1, $1, 'perspective', '{"role": "memo-system"}')`,
				[r.rows[0].id]
			);
			perspective = r.rows[0];
		}

		const label = `[kontextualisierend/subchapter] ${ctx.subchapterLabel}`;
		const memo = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[ctx.projectId, label, userId]
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
			 VALUES ($1, $2, 'text', 'active', 'kontextualisierend', $3, 'subchapter')`,
			[memoId, result.kontextualisierend, ctx.subchapterHeadingId]
		);

		return { memoId };
	});
}

// ── Public orchestration ──────────────────────────────────────────

export interface SubchapterCollapseRun {
	result: SubchapterCollapseResult;
	stored: { memoId: string };
	tokens: {
		input: number;
		output: number;
		cacheCreation: number;
		cacheRead: number;
		total: number;
	};
	model: string;
	provider: string;
	paragraphsSynthesized: number;
}

export async function runSubchapterCollapse(
	caseId: string,
	subchapterHeadingId: string,
	userId: string
): Promise<SubchapterCollapseRun> {
	const ctx = await loadCollapseContext(caseId, subchapterHeadingId);

	if (ctx.paragraphs.length === 0) {
		throw new Error(`No paragraphs in subchapter "${ctx.subchapterLabel}"`);
	}
	const missing = ctx.paragraphs.filter(p => !p.interpretierend);
	if (missing.length > 0) {
		throw new Error(
			`Cannot collapse subchapter — ${missing.length} paragraph(s) missing interpretierend memo. ` +
			`Run runParagraphPass on them first.`
		);
	}

	const system = buildSystemPrompt(ctx);
	const user = buildUserMessage(ctx);

	const response = await chat({
		system,
		cacheSystem: true,
		messages: [{ role: 'user', content: user }],
		maxTokens: 1500,
	});

	const json = extractJSON(response.text);
	const parsed = SubchapterCollapseResultSchema.parse(JSON.parse(json));
	const stored = await storeCollapseMemo(ctx, parsed, userId);

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
		paragraphsSynthesized: ctx.paragraphs.length,
	};
}
