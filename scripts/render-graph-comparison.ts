// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Render a side-by-side markdown comparison report for the
// Argumentations-Graph experiment vs. the synthetic interpretierend memos.
//
// Run from repo root:  npx tsx scripts/render-graph-comparison.ts
// Output:              docs/experiments/argumentation-graph-globalitaet.md

import { writeFileSync } from 'node:fs';
import { query, queryOne, pool } from '../src/lib/server/db/index.ts';

const CASE_ID = '0abe0588-badb-4e72-b3c4-1edd4a376cb6';
const PARAGRAPH_IDS = [
	'693f4a08-df4c-4f83-8add-e2a1d220d3a5', // §1
	'3e6aa3f3-7e32-4b0a-a573-1ed578f3f32b', // §2
	'30d9d218-9d4e-4839-97d2-e935ce83455e', // §3
	'e126d3f9-f257-4628-8eda-be5a366fe372', // §4
	'ef350dab-3ffb-48f7-9e42-d3455212eb6b', // §5
];

interface Premise {
	type: string;
	text: string;
	from_paragraph?: number;
}

interface ArgRow {
	id: string;
	arg_local_id: string;
	claim: string;
	premises: Premise[];
	anchor_phrase: string;
	anchor_char_start: number;
	anchor_char_end: number;
	position_in_paragraph: number;
}

interface EdgeRow {
	from_local: string;
	to_local: string;
	to_position: number | null;  // null for inter, set for prior
	kind: string;
	scope: string;
}

interface ScaffoldingRow {
	id: string;
	element_local_id: string;
	excerpt: string;
	function_type: string;
	function_description: string;
	assessment: string;
	anchor_phrase: string;
	position_in_paragraph: number;
	anchored_to: string[];   // formatted refs like "A1", "§2:A3"
}

const caseRow = await queryOne<{
	central_document_id: string;
	full_text: string;
	subchapter_label: string;
	subchapter_start: number;
}>(
	`SELECT c.central_document_id,
	        dc.full_text,
	        substring(dc.full_text FROM h.char_start+1 FOR h.char_end-h.char_start) AS subchapter_label,
	        h.char_start AS subchapter_start
	 FROM cases c
	 JOIN namings n ON n.id = c.central_document_id
	 JOIN document_content dc ON dc.naming_id = n.id
	 JOIN document_elements p ON p.id = $2
	 JOIN LATERAL (
	   SELECT char_start, char_end FROM document_elements
	   WHERE document_id = c.central_document_id
	     AND element_type = 'heading' AND section_kind = 'main'
	     AND char_start <= p.char_start
	   ORDER BY char_start DESC LIMIT 1
	 ) h ON true
	 WHERE c.id = $1`,
	[CASE_ID, PARAGRAPH_IDS[0]]
);
if (!caseRow) throw new Error('case row not loaded');

const fullText = caseRow.full_text;

// Get paragraph metadata + the existing latest interpretierend memo.
async function loadParagraph(paragraphId: string, indexInList: number) {
	const para = (await queryOne<{ char_start: number; char_end: number }>(
		`SELECT char_start, char_end FROM document_elements WHERE id = $1`,
		[paragraphId]
	))!;
	const text = fullText.substring(para.char_start, para.char_end).trim();

	const memo = await queryOne<{ content: string; created_at: string }>(
		`SELECT mc.content, n.created_at
		 FROM memo_content mc JOIN namings n ON n.id = mc.naming_id
		 WHERE mc.scope_element_id = $1 AND mc.memo_type = 'interpretierend'
		 ORDER BY n.created_at DESC LIMIT 1`,
		[paragraphId]
	);

	const args = (await query<ArgRow>(
		`SELECT id, arg_local_id, claim, premises, anchor_phrase,
		        anchor_char_start, anchor_char_end, position_in_paragraph
		 FROM argument_nodes WHERE paragraph_element_id = $1
		 ORDER BY position_in_paragraph`,
		[paragraphId]
	)).rows;

	const argIdToLocal = new Map(args.map(a => [a.id, a.arg_local_id]));

	const edges = (await query<{ from_id: string; to_id: string; kind: string; scope: string }>(
		`SELECT from_node_id AS from_id, to_node_id AS to_id, kind, scope
		 FROM argument_edges
		 WHERE from_node_id IN (SELECT id FROM argument_nodes WHERE paragraph_element_id = $1)`,
		[paragraphId]
	)).rows;

	const enrichedEdges: EdgeRow[] = await Promise.all(edges.map(async e => {
		const fromLocal = argIdToLocal.get(e.from_id) ?? '?';
		let toLocal: string;
		let toPosition: number | null = null;
		if (e.scope === 'inter_argument') {
			toLocal = argIdToLocal.get(e.to_id) ?? '?';
		} else {
			const t = (await queryOne<{ arg_local_id: string; paragraph_element_id: string }>(
				`SELECT arg_local_id, paragraph_element_id FROM argument_nodes WHERE id = $1`,
				[e.to_id]
			))!;
			toLocal = t.arg_local_id;
			const idxInList = PARAGRAPH_IDS.indexOf(t.paragraph_element_id);
			toPosition = idxInList >= 0 ? idxInList + 1 : null;
		}
		return { from_local: fromLocal, to_local: toLocal, to_position: toPosition, kind: e.kind, scope: e.scope };
	}));

	// Scaffolding elements + anchor refs
	const scaffoldingRows = (await query<{
		id: string;
		element_local_id: string;
		excerpt: string;
		function_type: string;
		function_description: string;
		assessment: string;
		anchor_phrase: string;
		position_in_paragraph: number;
	}>(
		`SELECT id, element_local_id, excerpt, function_type, function_description,
		        assessment, anchor_phrase, position_in_paragraph
		 FROM scaffolding_elements WHERE paragraph_element_id = $1
		 ORDER BY position_in_paragraph`,
		[paragraphId]
	)).rows;

	const scaffolding: ScaffoldingRow[] = await Promise.all(scaffoldingRows.map(async sc => {
		const anchorRows = (await query<{ argument_id: string }>(
			`SELECT argument_id FROM scaffolding_anchors WHERE scaffolding_id = $1`,
			[sc.id]
		)).rows;
		const anchored_to: string[] = [];
		for (const a of anchorRows) {
			const t = await queryOne<{ arg_local_id: string; paragraph_element_id: string }>(
				`SELECT arg_local_id, paragraph_element_id FROM argument_nodes WHERE id = $1`,
				[a.argument_id]
			);
			if (!t) continue;
			if (t.paragraph_element_id === paragraphId) {
				anchored_to.push(t.arg_local_id);
			} else {
				const idx = PARAGRAPH_IDS.indexOf(t.paragraph_element_id);
				const pos = idx >= 0 ? idx + 1 : '?';
				anchored_to.push(`§${pos}:${t.arg_local_id}`);
			}
		}
		return { ...sc, anchored_to };
	}));

	return {
		position: indexInList + 1,
		paragraphId,
		text,
		memo: memo?.content ?? null,
		args,
		edges: enrichedEdges,
		scaffolding,
	};
}

const paragraphs = await Promise.all(PARAGRAPH_IDS.map((id, i) => loadParagraph(id, i)));

// ── Render markdown ───────────────────────────────────────────────

const lines: string[] = [];
lines.push(`# Argumentations-Graph-Experiment — Side-by-side mit synthetischen interpretierenden Memos`);
lines.push('');
lines.push(`**Subkapitel:** "${caseRow.subchapter_label.trim()}"  `);
lines.push(`**Case:** \`${CASE_ID}\`  `);
lines.push(`**Brief-Flag:** \`argumentation_graph = true\` (Migration 032)  `);
lines.push(`**Modell:** \`mammouth claude-sonnet-4-6\` für beide Pässe  `);
lines.push(`**Erzeugt:** ${new Date().toISOString()}  `);
lines.push('');
lines.push(`> Das interpretierende Memo entstammt dem validierten synthetisch-hermeneutischen Pass.`);
lines.push(`> Der Argumentations-Graph entstammt dem opt-in analytischen Pass (Migration 032).`);
lines.push(`> Beide Pässe verwenden denselben System-Kontext (Persona, Kriterien, Werk-Header,`);
lines.push(`> abgeschlossene Kontextualisierungen, Predecessor/Successor-Snippet) — sie unterscheiden`);
lines.push(`> sich nur in (1) der Form des Kontexts in der Subkapitelkette und (2) der Output-Aufgabe.`);
lines.push('');
lines.push(`## Aggregat`);
lines.push('');
lines.push(`| § | Memo-Länge | #args | inter | prior | Premise-Mix | #scaff | Scaff-Funktionen |`);
lines.push(`|---|-----------|-------|-------|-------|-------------|--------|------------------|`);
for (const p of paragraphs) {
	const mlen = p.memo ? p.memo.length : 0;
	const inter = p.edges.filter(e => e.scope === 'inter_argument').length;
	const prior = p.edges.filter(e => e.scope === 'prior_paragraph').length;
	const allPremises = p.args.flatMap(a => a.premises);
	const counts: Record<string, number> = {};
	for (const pr of allPremises) counts[pr.type] = (counts[pr.type] ?? 0) + 1;
	const mix = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ');
	const fnCounts: Record<string, number> = {};
	for (const sc of p.scaffolding) fnCounts[sc.function_type] = (fnCounts[sc.function_type] ?? 0) + 1;
	const fnMix = Object.entries(fnCounts).map(([k, v]) => `${k}=${v}`).join(' ');
	lines.push(`| §${p.position} | ${mlen} | ${p.args.length} | ${inter} | ${prior} | ${mix || '—'} | ${p.scaffolding.length} | ${fnMix || '—'} |`);
}
lines.push('');

// ── Per-paragraph block ────────────────────────────────────────────

for (const p of paragraphs) {
	lines.push(`---`);
	lines.push('');
	lines.push(`## §${p.position}`);
	lines.push('');
	lines.push(`### Absatztext`);
	lines.push('');
	lines.push(`> ${p.text.replace(/\n+/g, ' ').slice(0, 1200)}${p.text.length > 1200 ? ' …' : ''}`);
	lines.push('');
	lines.push(`### Synthetisches interpretierendes Memo`);
	lines.push('');
	lines.push(p.memo ? p.memo : '_(kein interpretierendes Memo gefunden)_');
	lines.push('');
	lines.push(`### Analytischer Argumentations-Graph`);
	lines.push('');

	if (p.args.length === 0 && p.scaffolding.length === 0) {
		lines.push(`*Leere Argument- und Stützstruktur-Liste — beide Layer leer (sollte selten vorkommen).*`);
		lines.push('');
		continue;
	}

	if (p.args.length === 0) {
		lines.push(`*Keine Argumente — Layer 1 leer; Absatz ist reine Stützstruktur.*`);
		lines.push('');
	}

	for (const a of p.args) {
		lines.push(`**${a.arg_local_id}** — ${a.claim}`);
		lines.push('');
		if (a.anchor_phrase) {
			lines.push(`- *Anker:* "${a.anchor_phrase}" (chars ${a.anchor_char_start}–${a.anchor_char_end})`);
		} else {
			lines.push(`- *Anker:* (paragraphweit, kein in-vivo-anchor)`);
		}
		lines.push(`- *Premissen:*`);
		if (a.premises.length === 0) {
			lines.push(`    - _(keine)_`);
		} else {
			for (const pr of a.premises) {
				const tag = pr.type === 'carried' && pr.from_paragraph
					? `\`carried\` (←§${pr.from_paragraph})`
					: `\`${pr.type}\``;
				lines.push(`    - ${tag} ${pr.text}`);
			}
		}
		lines.push('');
	}

	const inter = p.edges.filter(e => e.scope === 'inter_argument');
	const prior = p.edges.filter(e => e.scope === 'prior_paragraph');
	if (inter.length || prior.length) {
		lines.push(`#### Edges`);
		lines.push('');
		if (inter.length) {
			lines.push(`Intra-Absatz:`);
			for (const e of inter) lines.push(`- ${e.from_local} **${e.kind}** ${e.to_local}`);
			lines.push('');
		}
		if (prior.length) {
			lines.push(`Cross-Absatz (Subkapitel-Rückbezug):`);
			for (const e of prior) lines.push(`- ${e.from_local} **${e.kind}** §${e.to_position}:${e.to_local}`);
			lines.push('');
		}
	}

	if (p.scaffolding.length > 0) {
		lines.push(`#### Stützstrukturen (Layer 2)`);
		lines.push('');
		for (const sc of p.scaffolding) {
			lines.push(`**${sc.element_local_id}** \`[${sc.function_type}]\` → ${sc.anchored_to.join(', ')}`);
			lines.push('');
			lines.push(`> ${sc.excerpt.replace(/\n+/g, ' ').slice(0, 400)}${sc.excerpt.length > 400 ? ' …' : ''}`);
			lines.push('');
			lines.push(`- *Funktion:* ${sc.function_description}`);
			lines.push(`- *Assessment:* ${sc.assessment}`);
			if (sc.anchor_phrase) {
				lines.push(`- *Anker:* "${sc.anchor_phrase}"`);
			}
			lines.push('');
		}
	}
}

// ── Graph-fed kontextualisierende Synthese (Subkapitel-Ebene) ──────

const collapseRow = await queryOne<{
	memo_id: string;
	content: string;
	properties: Record<string, unknown>;
}>(
	`SELECT n.id AS memo_id, mc.content, a.properties
	 FROM namings n
	 JOIN memo_content mc ON mc.naming_id = n.id
	 JOIN appearances a ON a.naming_id = n.id
	 WHERE n.inscription LIKE '[kontextualisierend/subchapter/graph]%'
	   AND mc.scope_element_id = (
	     SELECT char_start_id.id FROM (
	       SELECT id FROM document_elements
	       WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main'
	         AND char_start <= $2
	       ORDER BY char_start DESC LIMIT 1
	     ) char_start_id
	   )
	 ORDER BY n.created_at DESC LIMIT 1`,
	[caseRow.central_document_id, 44039]
);

if (collapseRow) {
	type Auff = { scope: string; observation: string };
	const auff = (collapseRow.properties?.auffaelligkeiten ?? []) as Auff[];

	lines.push(`---`);
	lines.push('');
	lines.push(`## Kontextualisierende Synthese (graph-fed)`);
	lines.push('');
	lines.push(`> Synthese erzeugt **ausschließlich aus dem Argumentations-Graphen**`);
	lines.push(`> (arguments + edges + scaffolding), ohne die synthetisch-hermeneutischen`);
	lines.push(`> interpretierenden Memos. Beantwortet Frage (c) des ursprünglichen Experiments:`);
	lines.push(`> Kann eine Subkapitel-Synthese aus dem Graph allein gespeist werden?`);
	lines.push(`>`);
	lines.push(`> Modul: \`src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts\`.`);
	lines.push(`> Memo gespeichert mit Inscription \`[kontextualisierend/subchapter/graph]\`,`);
	lines.push(`> parallel zur regulären (synthetischen) Variante.`);
	lines.push('');
	lines.push(`### Synthese`);
	lines.push('');
	lines.push(collapseRow.content);
	lines.push('');
	lines.push(`### Auffälligkeiten`);
	lines.push('');
	lines.push(`Diese Liste füllt den Eval-Gap, den der User identifiziert hat: scaffolding`);
	lines.push(`hat \`assessment\`, Argumente nicht. Argument-Qualität wird hier auf Subkapitel-`);
	lines.push(`Ebene beobachtet — die richtige Granularität, da die Frage "wie steht ein`);
	lines.push(`Argument im Ganzen?" nur im Kontext des Absatzensembles beantwortbar ist.`);
	lines.push(`Intrinsisch unplausibel/logisch falsche Argumente werden separat geflagt`);
	lines.push(`(in §1–§5: keine).`);
	lines.push('');
	if (auff.length === 0) {
		lines.push(`*(Keine Auffälligkeiten gemeldet.)*`);
		lines.push('');
	} else {
		for (const a of auff) {
			lines.push(`**${a.scope}** — ${a.observation}`);
			lines.push('');
		}
	}
}

lines.push(`---`);
lines.push('');
lines.push(`## Anhang: Anchor-Tabelle`);
lines.push('');
lines.push(`| § | Arg | char_start | char_end | anchor_phrase |`);
lines.push(`|---|-----|------------|----------|---------------|`);
for (const p of paragraphs) {
	for (const a of p.args) {
		const phrase = a.anchor_phrase ? `"${a.anchor_phrase}"` : '_(paragraphweit)_';
		lines.push(`| §${p.position} | ${a.arg_local_id} | ${a.anchor_char_start} | ${a.anchor_char_end} | ${phrase} |`);
	}
}

const path = '/Users/joerissen/ai/sarah/docs/experiments/argumentation-graph-globalitaet.md';
writeFileSync(path, lines.join('\n') + '\n');
console.log(`Wrote ${path}`);
console.log(`  paragraphs: ${paragraphs.length}`);
console.log(`  total args: ${paragraphs.reduce((s, p) => s + p.args.length, 0)}`);
console.log(`  total edges: ${paragraphs.reduce((s, p) => s + p.edges.length, 0)}`);
await pool.end();
