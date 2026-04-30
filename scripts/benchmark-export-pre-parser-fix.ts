// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Benchmark-Export VOR dem Re-Import nach dem Parser-Fix für Heading-Hierarchie.
//
// reparseDocument löscht via CASCADE alle abhängigen Daten — argument_nodes,
// argument_edges, scaffolding_elements, scaffolding_anchors, memo_content
// usw. Da die UUIDs nach Re-Import neu vergeben werden, wird über
// char_start/char_end + Heading-Text wieder-anschließbar gemacht.
//
// Lauf:   npx tsx scripts/benchmark-export-pre-parser-fix.ts

import { writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pool, queryOne, query } from '../src/lib/server/db/index.ts';

const DOCUMENT_ID = 'f7afee4b-729b-4a0d-963e-b3b31c6b3dcc';

const SUBCHAPTERS = [
	{
		slug: 'globalitaet',
		headingId: 'ac0a6c7a-d38c-48ea-9414-55cda02df246',
		expectedNumbering: '1.2.2',
		label: 'Globalität'
	},
	{
		slug: 'methodologische-grundlegung',
		headingId: '0a13d404-20d7-4422-9e67-72181cf98fa5',
		expectedNumbering: '2.1.2',
		label: 'Methodologische Grundlegung'
	},
	{
		slug: 'schule-und-globalitaet',
		headingId: '7dee784c-4097-4f7e-80b0-85f3bf7e6f85',
		expectedNumbering: '1.3.2',
		label: 'Schule und Globalität'
	},
	{
		slug: 'anforderungen-an-professionalitaet',
		headingId: '6e0a1737-8996-49ad-830e-7e2290c3d838',
		expectedNumbering: '1.3.3',
		label: 'Anforderungen an Professionalität'
	}
];

// Output liegt AUSSERHALB des Repos: das sind reale Habil-Daten, die nicht
// versioniert werden dürfen. Override per env: BENCHMARK_OUT_DIR=...
const OUT_DIR =
	process.env.BENCHMARK_OUT_DIR ||
	join(homedir(), 'sarah-benchmarks', 'benchmark-pre-parser-fix-2026-04-30');

interface HeadingRow {
	id: string;
	char_start: number;
	char_end: number;
	seq: number;
	properties: any;
	page_from: number | null;
	page_to: number | null;
}

interface ParagraphRow {
	id: string;
	seq: number;
	char_start: number;
	char_end: number;
	page_from: number | null;
	page_to: number | null;
	text: string;
}

interface ArgumentNodeRow {
	id: string;
	paragraph_element_id: string;
	arg_local_id: string;
	claim: string;
	premises: any;
	anchor_phrase: string;
	anchor_char_start: number;
	anchor_char_end: number;
	position_in_paragraph: number;
}

interface ArgumentEdgeRow {
	id: string;
	from_node_id: string;
	to_node_id: string;
	kind: string;
	scope: string;
}

interface ScaffoldingRow {
	id: string;
	paragraph_element_id: string;
	element_local_id: string;
	excerpt: string;
	function_type: string;
	function_description: string;
	assessment: string;
	anchor_phrase: string;
	anchor_char_start: number;
	anchor_char_end: number;
	position_in_paragraph: number;
}

interface MemoRow {
	naming_id: string;
	inscription: string;
	content: string;
	memo_type: string | null;
	scope_element_id: string | null;
	scope_level: string | null;
	auffaelligkeiten: any;
}

async function loadFullText(documentId: string): Promise<string> {
	const r = await queryOne<{ full_text: string }>(
		`SELECT full_text FROM document_content WHERE naming_id = $1`,
		[documentId]
	);
	if (!r) throw new Error(`No document_content for ${documentId}`);
	return r.full_text;
}

async function loadMainHeadings(documentId: string): Promise<HeadingRow[]> {
	const r = await query<HeadingRow>(
		`SELECT id, char_start, char_end, seq, properties, page_from, page_to
		 FROM document_elements
		 WHERE document_id = $1
		   AND element_type = 'heading'
		   AND section_kind = 'main'
		 ORDER BY char_start`,
		[documentId]
	);
	return r.rows;
}

async function loadSubchapterEnd(
	documentId: string,
	headingCharStart: number,
	fullTextLen: number
): Promise<number> {
	const next = await queryOne<{ char_start: number }>(
		`SELECT char_start FROM document_elements
		 WHERE document_id = $1
		   AND element_type = 'heading'
		   AND section_kind = 'main'
		   AND char_start > $2
		 ORDER BY char_start
		 LIMIT 1`,
		[documentId, headingCharStart]
	);
	return next?.char_start ?? fullTextLen;
}

async function loadParagraphs(
	documentId: string,
	subchapterStart: number,
	subchapterEnd: number,
	fullText: string
): Promise<ParagraphRow[]> {
	const r = await query<{
		id: string;
		seq: number;
		char_start: number;
		char_end: number;
		page_from: number | null;
		page_to: number | null;
	}>(
		`SELECT id, seq, char_start, char_end, page_from, page_to
		 FROM document_elements
		 WHERE document_id = $1
		   AND element_type = 'paragraph'
		   AND section_kind = 'main'
		   AND char_start >= $2
		   AND char_start < $3
		 ORDER BY char_start`,
		[documentId, subchapterStart, subchapterEnd]
	);
	return r.rows.map((p) => ({
		...p,
		text: fullText.substring(p.char_start, p.char_end)
	}));
}

async function loadArguments(paragraphIds: string[]): Promise<ArgumentNodeRow[]> {
	if (paragraphIds.length === 0) return [];
	const r = await query<ArgumentNodeRow>(
		`SELECT id, paragraph_element_id, arg_local_id, claim, premises,
		        anchor_phrase, anchor_char_start, anchor_char_end, position_in_paragraph
		 FROM argument_nodes
		 WHERE paragraph_element_id = ANY($1::uuid[])
		 ORDER BY paragraph_element_id, position_in_paragraph`,
		[paragraphIds]
	);
	return r.rows;
}

async function loadEdges(argumentIds: string[]): Promise<ArgumentEdgeRow[]> {
	if (argumentIds.length === 0) return [];
	const r = await query<ArgumentEdgeRow>(
		`SELECT id, from_node_id, to_node_id, kind, scope
		 FROM argument_edges
		 WHERE from_node_id = ANY($1::uuid[]) OR to_node_id = ANY($1::uuid[])`,
		[argumentIds]
	);
	return r.rows;
}

async function loadScaffolding(paragraphIds: string[]): Promise<ScaffoldingRow[]> {
	if (paragraphIds.length === 0) return [];
	const r = await query<ScaffoldingRow>(
		`SELECT id, paragraph_element_id, element_local_id, excerpt,
		        function_type, function_description, assessment,
		        anchor_phrase, anchor_char_start, anchor_char_end, position_in_paragraph
		 FROM scaffolding_elements
		 WHERE paragraph_element_id = ANY($1::uuid[])
		 ORDER BY paragraph_element_id, position_in_paragraph`,
		[paragraphIds]
	);
	return r.rows;
}

async function loadScaffoldingAnchors(
	scaffoldingIds: string[]
): Promise<{ scaffolding_id: string; argument_id: string }[]> {
	if (scaffoldingIds.length === 0) return [];
	const r = await query<{ scaffolding_id: string; argument_id: string }>(
		`SELECT scaffolding_id, argument_id
		 FROM scaffolding_anchors
		 WHERE scaffolding_id = ANY($1::uuid[])`,
		[scaffoldingIds]
	);
	return r.rows;
}

async function loadGraphMemo(headingId: string): Promise<MemoRow | null> {
	const r = await queryOne<MemoRow>(
		`SELECT n.id AS naming_id, n.inscription, mc.content,
		        mc.memo_type, mc.scope_element_id, mc.scope_level,
		        a.properties->'auffaelligkeiten' AS auffaelligkeiten
		 FROM memo_content mc
		 JOIN namings n ON n.id = mc.naming_id
		 LEFT JOIN appearances a
		   ON a.naming_id = n.id
		   AND a.properties->>'source' = 'argumentation_graph'
		 WHERE mc.scope_element_id = $1
		   AND mc.scope_level = 'subchapter'
		   AND mc.memo_type = 'kontextualisierend'
		   AND n.inscription LIKE '[kontextualisierend/subchapter/graph]%'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[headingId]
	);
	return r;
}

async function loadSyntheticSubchapterMemo(headingId: string): Promise<MemoRow | null> {
	const r = await queryOne<MemoRow>(
		`SELECT n.id AS naming_id, n.inscription, mc.content,
		        mc.memo_type, mc.scope_element_id, mc.scope_level,
		        NULL::jsonb AS auffaelligkeiten
		 FROM memo_content mc
		 JOIN namings n ON n.id = mc.naming_id
		 WHERE mc.scope_element_id = $1
		   AND mc.scope_level = 'subchapter'
		   AND mc.memo_type = 'kontextualisierend'
		   AND n.inscription LIKE '[kontextualisierend/subchapter]%'
		   AND n.inscription NOT LIKE '[kontextualisierend/subchapter/graph]%'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[headingId]
	);
	return r;
}

async function loadParagraphMemos(paragraphIds: string[]): Promise<MemoRow[]> {
	if (paragraphIds.length === 0) return [];
	const r = await query<MemoRow>(
		`SELECT n.id AS naming_id, n.inscription, mc.content,
		        mc.memo_type, mc.scope_element_id, mc.scope_level,
		        NULL::jsonb AS auffaelligkeiten
		 FROM memo_content mc
		 JOIN namings n ON n.id = mc.naming_id
		 WHERE mc.scope_element_id = ANY($1::uuid[])
		   AND mc.memo_type IN ('formulierend', 'interpretierend')
		   AND n.deleted_at IS NULL
		 ORDER BY mc.scope_element_id, mc.memo_type`,
		[paragraphIds]
	);
	return r.rows;
}

function renderMarkdown(
	sub: typeof SUBCHAPTERS[number],
	heading: HeadingRow,
	headingText: string,
	paragraphs: ParagraphRow[],
	argsByPara: Map<string, ArgumentNodeRow[]>,
	scaffByPara: Map<string, ScaffoldingRow[]>,
	edges: ArgumentEdgeRow[],
	anchorsByScaff: Map<string, string[]>,
	graphMemo: MemoRow | null,
	syntheticMemo: MemoRow | null,
	paraMemos: MemoRow[]
): string {
	const lines: string[] = [];
	lines.push(`# Benchmark — ${sub.label}`);
	lines.push('');
	lines.push(`**Slug:** \`${sub.slug}\`  `);
	lines.push(`**Heading-ID (vor Re-Import):** \`${heading.id}\`  `);
	lines.push(`**Erwartete Numerierung nach Fix:** \`${sub.expectedNumbering}\`  `);
	lines.push(`**Heading-Text:** ${headingText}  `);
	lines.push(
		`**char_start / char_end:** ${heading.char_start} / ${heading.char_end}  `
	);
	lines.push(`**Paragraphen:** ${paragraphs.length}`);
	lines.push('');

	if (graphMemo) {
		lines.push('## Graph-fed Subkapitel-Memo `[kontextualisierend/subchapter/graph]`');
		lines.push('');
		lines.push('### Synthese');
		lines.push('');
		lines.push(graphMemo.content);
		lines.push('');
		const auff = Array.isArray(graphMemo.auffaelligkeiten)
			? graphMemo.auffaelligkeiten
			: [];
		if (auff.length > 0) {
			lines.push('### Auffälligkeiten');
			lines.push('');
			for (const a of auff) {
				lines.push(`- **${a.scope}**: ${a.observation}`);
			}
			lines.push('');
		} else {
			lines.push('_(keine Auffälligkeiten gemeldet)_');
			lines.push('');
		}
	} else {
		lines.push('## Graph-fed Subkapitel-Memo');
		lines.push('');
		lines.push('_(nicht vorhanden in der DB)_');
		lines.push('');
	}

	if (syntheticMemo) {
		lines.push('## Synthetic Subkapitel-Memo `[kontextualisierend/subchapter]`');
		lines.push('');
		lines.push(syntheticMemo.content);
		lines.push('');
	}

	lines.push('## Argumente, Edges und Stützstrukturen pro Paragraph');
	lines.push('');

	const edgeByFrom = new Map<string, ArgumentEdgeRow[]>();
	for (const e of edges) {
		const list = edgeByFrom.get(e.from_node_id) ?? [];
		list.push(e);
		edgeByFrom.set(e.from_node_id, list);
	}

	const memoByPara = new Map<string, MemoRow[]>();
	for (const m of paraMemos) {
		if (!m.scope_element_id) continue;
		const list = memoByPara.get(m.scope_element_id) ?? [];
		list.push(m);
		memoByPara.set(m.scope_element_id, list);
	}

	let paraIdx = 0;
	for (const p of paragraphs) {
		paraIdx++;
		lines.push(`### §${paraIdx} (paragraph_id \`${p.id}\`)`);
		lines.push('');
		lines.push(
			`**char_start / char_end:** ${p.char_start} / ${p.char_end}  `
		);
		const preview = p.text.replace(/\s+/g, ' ').slice(0, 200);
		lines.push(
			`**Text-Anfang:** ${preview}${p.text.length > 200 ? '…' : ''}`
		);
		lines.push('');

		const args = argsByPara.get(p.id) ?? [];
		if (args.length > 0) {
			lines.push('**Argumente:**');
			lines.push('');
			for (const a of args) {
				const premises = Array.isArray(a.premises) ? a.premises : [];
				const premiseSummary = premises
					.map((pr: any) => `${pr.type}`)
					.join(', ');
				lines.push(
					`- **${a.arg_local_id}** _[${premiseSummary || 'keine'}]_: ${a.claim}`
				);
				const myEdges = edgeByFrom.get(a.id) ?? [];
				for (const e of myEdges) {
					lines.push(
						`  - edge \`${e.kind}\` (${e.scope}) → \`${e.to_node_id}\``
					);
				}
			}
			lines.push('');
		}

		const scaff = scaffByPara.get(p.id) ?? [];
		if (scaff.length > 0) {
			lines.push('**Stützstrukturen:**');
			lines.push('');
			for (const s of scaff) {
				const anchors = anchorsByScaff.get(s.id) ?? [];
				lines.push(
					`- **${s.element_local_id}** [${s.function_type}] → anker: ${anchors.length} arg(s)`
				);
				lines.push(`  - Beschreibung: ${s.function_description}`);
				lines.push(`  - Bewertung: ${s.assessment}`);
				const exPrev = s.excerpt.replace(/\s+/g, ' ').slice(0, 120);
				lines.push(
					`  - Excerpt: ${exPrev}${s.excerpt.length > 120 ? '…' : ''}`
				);
			}
			lines.push('');
		}

		const memos = memoByPara.get(p.id) ?? [];
		if (memos.length > 0) {
			for (const m of memos) {
				lines.push(`**Memo \`${m.memo_type}\`:**`);
				lines.push('');
				lines.push(m.content);
				lines.push('');
			}
		}
	}

	return lines.join('\n');
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });

	const fullText = await loadFullText(DOCUMENT_ID);
	console.log(`Loaded full_text: ${fullText.length} chars`);

	const allHeadings = await loadMainHeadings(DOCUMENT_ID);
	console.log(`Loaded ${allHeadings.length} main headings`);

	const indexEntries: any[] = [];

	for (const sub of SUBCHAPTERS) {
		console.log(`\n=== ${sub.label} (${sub.slug}) ===`);

		const heading = allHeadings.find((h) => h.id === sub.headingId);
		if (!heading) {
			console.log(`  SKIP: heading_id ${sub.headingId} not found`);
			continue;
		}

		const subchapterEnd = await loadSubchapterEnd(
			DOCUMENT_ID,
			heading.char_start,
			fullText.length
		);
		const headingText = fullText
			.substring(heading.char_start, heading.char_end)
			.trim();
		const paragraphs = await loadParagraphs(
			DOCUMENT_ID,
			heading.char_start,
			subchapterEnd,
			fullText
		);
		const paragraphIds = paragraphs.map((p) => p.id);

		const argNodes = await loadArguments(paragraphIds);
		const edges = await loadEdges(argNodes.map((a) => a.id));
		const scaff = await loadScaffolding(paragraphIds);
		const scaffAnchors = await loadScaffoldingAnchors(scaff.map((s) => s.id));
		const graphMemo = await loadGraphMemo(sub.headingId);
		const syntheticMemo = await loadSyntheticSubchapterMemo(sub.headingId);
		const paraMemos = await loadParagraphMemos(paragraphIds);

		console.log(
			`  paragraphs=${paragraphs.length} args=${argNodes.length} edges=${edges.length} scaff=${scaff.length} graph_memo=${graphMemo ? 'yes' : 'no'} synthetic_subchapter_memo=${syntheticMemo ? 'yes' : 'no'} para_memos=${paraMemos.length}`
		);

		const argsByPara = new Map<string, ArgumentNodeRow[]>();
		for (const a of argNodes) {
			const list = argsByPara.get(a.paragraph_element_id) ?? [];
			list.push(a);
			argsByPara.set(a.paragraph_element_id, list);
		}
		const scaffByPara = new Map<string, ScaffoldingRow[]>();
		for (const s of scaff) {
			const list = scaffByPara.get(s.paragraph_element_id) ?? [];
			list.push(s);
			scaffByPara.set(s.paragraph_element_id, list);
		}
		const anchorsByScaff = new Map<string, string[]>();
		for (const a of scaffAnchors) {
			const list = anchorsByScaff.get(a.scaffolding_id) ?? [];
			list.push(a.argument_id);
			anchorsByScaff.set(a.scaffolding_id, list);
		}

		const jsonOut = {
			exported_at: new Date().toISOString(),
			document_id: DOCUMENT_ID,
			subchapter: {
				slug: sub.slug,
				label: sub.label,
				expected_numbering: sub.expectedNumbering,
				heading_id_pre_reimport: heading.id,
				heading_char_start: heading.char_start,
				heading_char_end: heading.char_end,
				heading_text: headingText,
				heading_properties: heading.properties,
				heading_page_from: heading.page_from,
				heading_page_to: heading.page_to,
				subchapter_end: subchapterEnd
			},
			paragraphs,
			argument_nodes: argNodes,
			argument_edges: edges,
			scaffolding_elements: scaff,
			scaffolding_anchors: scaffAnchors,
			graph_memo: graphMemo,
			synthetic_subchapter_memo: syntheticMemo,
			paragraph_memos: paraMemos
		};

		const jsonPath = join(OUT_DIR, `subchapter-${sub.slug}.json`);
		await writeFile(jsonPath, JSON.stringify(jsonOut, null, 2));
		console.log(`  wrote ${jsonPath}`);

		const md = renderMarkdown(
			sub,
			heading,
			headingText,
			paragraphs,
			argsByPara,
			scaffByPara,
			edges,
			anchorsByScaff,
			graphMemo,
			syntheticMemo,
			paraMemos
		);
		const mdPath = join(OUT_DIR, `subchapter-${sub.slug}.md`);
		await writeFile(mdPath, md);
		console.log(`  wrote ${mdPath}`);

		indexEntries.push({
			slug: sub.slug,
			label: sub.label,
			expected_numbering: sub.expectedNumbering,
			heading_id_pre_reimport: heading.id,
			heading_char_start: heading.char_start,
			heading_char_end: heading.char_end,
			subchapter_end: subchapterEnd,
			paragraph_count: paragraphs.length,
			argument_count: argNodes.length,
			edge_count: edges.length,
			scaffolding_count: scaff.length,
			has_graph_memo: !!graphMemo,
			has_synthetic_subchapter_memo: !!syntheticMemo,
			paragraph_memo_count: paraMemos.length
		});
	}

	const indexJson = {
		exported_at: new Date().toISOString(),
		document_id: DOCUMENT_ID,
		full_text_length: fullText.length,
		main_heading_count: allHeadings.length,
		subchapters: indexEntries
	};
	await writeFile(
		join(OUT_DIR, 'index.json'),
		JSON.stringify(indexJson, null, 2)
	);
	console.log(`\nwrote ${join(OUT_DIR, 'index.json')}`);

	const indexMd: string[] = [];
	indexMd.push('# Benchmark Pre-Parser-Fix 2026-04-30');
	indexMd.push('');
	indexMd.push(
		`Export VOR \`reparseDocument\`. UUIDs werden nach Re-Import neu vergeben — Wieder-Anschluss über \`heading_char_start\` / \`heading_text\` und \`paragraph.char_start\` / \`paragraph.char_end\`.`
	);
	indexMd.push('');
	indexMd.push(`- **document_id:** \`${DOCUMENT_ID}\``);
	indexMd.push(`- **full_text length:** ${fullText.length}`);
	indexMd.push(`- **main heading count (vorher):** ${allHeadings.length}`);
	indexMd.push('');
	indexMd.push('## Subkapitel');
	indexMd.push('');
	indexMd.push(
		'| Slug | Label | Erwartet | Para | Args | Edges | Scaff | GraphMemo | SyntMemo | ParaMemos |'
	);
	indexMd.push(
		'|---|---|---|---:|---:|---:|---:|---|---|---:|'
	);
	for (const e of indexEntries) {
		indexMd.push(
			`| \`${e.slug}\` | ${e.label} | ${e.expected_numbering} | ${e.paragraph_count} | ${e.argument_count} | ${e.edge_count} | ${e.scaffolding_count} | ${e.has_graph_memo ? '✓' : '–'} | ${e.has_synthetic_subchapter_memo ? '✓' : '–'} | ${e.paragraph_memo_count} |`
		);
	}
	await writeFile(join(OUT_DIR, 'INDEX.md'), indexMd.join('\n'));
	console.log(`wrote ${join(OUT_DIR, 'INDEX.md')}`);

	await pool.end();
}

main().catch((e) => {
	console.error(e);
	pool.end();
	process.exit(1);
});
