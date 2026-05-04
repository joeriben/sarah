// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sonnet-4.6 baseline for the EXPOSITION fallback prompt on BA H3 dev,
// to compare against mimo-quality-exposition.json. Same prompt and same
// container — only the model changes.

import { writeFileSync, mkdirSync } from 'node:fs';
import { chat } from '../src/lib/server/ai/client.ts';
import { pool, query, queryOne } from '../src/lib/server/db/index.ts';

const SONNET = { provider: 'openrouter' as const, model: 'anthropic/claude-sonnet-4.6' };

const BA_H3_DEV_DOC_ID   = 'd1993e8a-f25b-479c-9526-d527215969c6';
const BA_EXPOSITION_HEAD = '081aafdc-6c70-4558-8b5c-e5f4f8f5fb23';

mkdirSync('docs/experiments', { recursive: true });

const heading = (await queryOne<{ heading_text: string; char_start: number; char_end: number }>(
	`SELECT SUBSTRING(dc.full_text FROM de.char_start + 1 FOR de.char_end - de.char_start) AS heading_text, de.char_start, de.char_end
	 FROM document_elements de JOIN document_content dc ON dc.naming_id = de.document_id WHERE de.id = $1`,
	[BA_EXPOSITION_HEAD]
))!;
const nextHeading = await queryOne<{ char_start: number }>(
	`SELECT char_start FROM document_elements WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main' AND char_start > $2 ORDER BY char_start LIMIT 1`,
	[BA_H3_DEV_DOC_ID, heading.char_end]
);
const upperBound = nextHeading?.char_start
	?? (await queryOne<{ end: number }>(`SELECT length(full_text) AS end FROM document_content WHERE naming_id = $1`, [BA_H3_DEV_DOC_ID]))!.end;

const paragraphs = (await query<{ text: string }>(
	`SELECT SUBSTRING(dc.full_text FROM p.char_start + 1 FOR p.char_end - p.char_start) AS text
	 FROM document_elements p JOIN document_content dc ON dc.naming_id = p.document_id
	 WHERE p.document_id = $1 AND p.element_type = 'paragraph' AND p.section_kind = 'main' AND p.char_start > $2 AND p.char_start < $3
	 ORDER BY p.char_start`,
	[BA_H3_DEV_DOC_ID, heading.char_end, upperBound]
)).rows.map(r => r.text.trim());

console.log(`Container "${heading.heading_text.trim()}": ${paragraphs.length} ¶`);

// Same prompt as scripts/test-mimo-quality.ts (lifted from exposition.ts:357-385)
const system = [
	'Du bist ein analytisches Werkzeug. Eine deterministische Vorprüfung hat im Einleitungs-Container kein Frage-Marker-Muster gefunden; jetzt sollst du den ganzen Container prüfen.',
	'',
	'Aufgaben:',
	'  1. Identifiziere, in welchen Absätzen die FORSCHUNGSFRAGESTELLUNG steckt (Indizes der nummerierten Liste).',
	'  2. Rekonstruiere die Frage als kompakte, lesbare Frage (Frage trennen von Methodenrahmen).',
	'  3. Identifiziere die MOTIVATIONS-Absätze (Begründungen, was die Frage motiviert) — typischerweise davor.',
	'  4. Fasse die Motivation in 1–3 Sätzen zusammen.',
	'',
	'Wenn keine Forschungsfrage identifizierbar ist, antworte mit found=false und alle anderen Felder null.',
	'',
	'JSON-Schema:',
	'{',
	'  "found": true | false,',
	'  "fragestellung": "<rekonstruierte Frage>" | null,',
	'  "fragestellung_paragraph_indices": [<int>, ...] | null,',
	'  "motivation": "<1–3 Sätze>" | null,',
	'  "motivation_paragraph_indices": [<int>, ...] | null',
	'}',
].join('\n');

const userMessage = [
	`Container (Heading): ${heading.heading_text.trim()}`,
	'',
	'Nummerierte Absatzliste:',
	...paragraphs.map((p, i) => `[${i}] ${p}`),
].join('\n\n');

const t0 = Date.now();
const r = await chat({
	system,
	messages: [{ role: 'user', content: userMessage }],
	maxTokens: 1500,
	responseFormat: 'json',
	modelOverride: SONNET,
	documentIds: [BA_H3_DEV_DOC_ID],
});
const dt = (Date.now() - t0) / 1000;
console.log(`${dt.toFixed(1)}s in=${r.inputTokens} out=${r.outputTokens}`);

let parsed: unknown = null;
try {
	const start = r.text.indexOf('{');
	const end = r.text.lastIndexOf('}');
	if (start !== -1 && end !== -1) parsed = JSON.parse(r.text.slice(start, end + 1));
} catch {}

const out = {
	model: SONNET,
	wall_seconds: dt,
	tokens: { input: r.inputTokens, output: r.outputTokens },
	provider: r.provider, model_returned: r.model,
	raw_text: r.text,
	parsed_json: parsed,
};
writeFileSync('docs/experiments/sonnet-baseline-exposition.json', JSON.stringify(out, null, 2));
console.log(`→ docs/experiments/sonnet-baseline-exposition.json`);

await pool.end();
