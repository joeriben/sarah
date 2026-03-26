#!/usr/bin/env node
/**
 * Backfill: parse existing documents into elements + compute embeddings.
 * Run directly: node scripts/backfill-elements.js
 */

import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://tqda:tqda_dev@localhost:5432/transact_qda';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

// ── Plain-text parser (duplicated from parsers/plain-text.ts for standalone use) ──

const SENTENCE_BOUNDARY = /([.?!][)\]"'»]*)\s+(?=[A-ZÄÖÜ])/g;

function splitSentences(text, baseOffset) {
	const trimmed = text.trim();
	if (!trimmed) return [];
	const parts = [];
	let lastEnd = 0;
	SENTENCE_BOUNDARY.lastIndex = 0;
	let match;
	while ((match = SENTENCE_BOUNDARY.exec(trimmed)) !== null) {
		const splitAt = match.index + match[1].length;
		const part = trimmed.slice(lastEnd, splitAt).trim();
		if (part) {
			const start = trimmed.indexOf(part, lastEnd);
			parts.push({ text: part, start, end: start + part.length });
		}
		lastEnd = splitAt;
		while (lastEnd < trimmed.length && /\s/.test(trimmed[lastEnd])) lastEnd++;
	}
	const remaining = trimmed.slice(lastEnd).trim();
	if (remaining) {
		const start = trimmed.indexOf(remaining, lastEnd);
		parts.push({ text: remaining, start, end: start + remaining.length });
	}
	if (parts.length === 0) parts.push({ text: trimmed, start: 0, end: trimmed.length });
	const textStart = text.indexOf(trimmed);
	return parts.map(p => ({
		type: 'sentence', content: p.text,
		charStart: baseOffset + textStart + p.start,
		charEnd: baseOffset + textStart + p.end
	}));
}

function parsePlainText(text) {
	const elements = [];
	const paragraphPattern = /\n\s*\n/g;
	let lastEnd = 0;
	let match;
	const rawParagraphs = [];
	while ((match = paragraphPattern.exec(text)) !== null) {
		const chunk = text.slice(lastEnd, match.index);
		if (chunk.trim()) rawParagraphs.push({ text: chunk, start: lastEnd, end: match.index });
		lastEnd = match.index + match[0].length;
	}
	const lastChunk = text.slice(lastEnd);
	if (lastChunk.trim()) rawParagraphs.push({ text: lastChunk, start: lastEnd, end: text.length });
	for (const para of rawParagraphs) {
		const sentences = splitSentences(para.text, para.start);
		elements.push({ type: 'paragraph', content: null, charStart: para.start, charEnd: para.end, children: sentences });
	}
	return elements;
}

// ── Embedding ──

async function embed(text) {
	const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: EMBED_MODEL, prompt: text })
	});
	if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
	const data = await res.json();
	return data.embedding;
}

// ── Main ──

async function main() {
	const docs = (await pool.query(
		`SELECT naming_id, full_text, mime_type, n.inscription
		 FROM document_content dc JOIN namings n ON n.id = dc.naming_id
		 WHERE dc.full_text IS NOT NULL AND n.deleted_at IS NULL`
	)).rows;

	console.log(`Found ${docs.length} documents to process.\n`);

	for (const doc of docs) {
		console.log(`── ${doc.inscription} (${doc.full_text.length} chars) ──`);

		// Step 1: Parse
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			await client.query('DELETE FROM document_elements WHERE document_id = $1', [doc.naming_id]);

			const elements = parsePlainText(doc.full_text);
			let totalSentences = 0;
			const insertedIds = []; // { id, content } for embedding step

			for (let pi = 0; pi < elements.length; pi++) {
				const para = elements[pi];
				const paraRes = await client.query(
					`INSERT INTO document_elements (document_id, element_type, parent_id, seq, content, char_start, char_end, properties)
					 VALUES ($1, 'paragraph', NULL, $2, NULL, $3, $4, '{}') RETURNING id`,
					[doc.naming_id, pi, para.charStart, para.charEnd]
				);
				const paraId = paraRes.rows[0].id;

				for (let si = 0; si < (para.children || []).length; si++) {
					const sent = para.children[si];
					const sentRes = await client.query(
						`INSERT INTO document_elements (document_id, element_type, parent_id, seq, content, char_start, char_end, properties)
						 VALUES ($1, 'sentence', $2, $3, $4, $5, $6, '{}') RETURNING id`,
						[doc.naming_id, paraId, si, sent.content, sent.charStart, sent.charEnd]
					);
					insertedIds.push({ id: sentRes.rows[0].id, content: sent.content });
					totalSentences++;
				}
			}

			await client.query('COMMIT');
			console.log(`  Parsed: ${elements.length} paragraphs, ${totalSentences} sentences`);

			// Step 2: Embed
			let embedded = 0;
			for (const el of insertedIds) {
				if (!el.content?.trim()) continue;
				try {
					const vec = await embed(el.content);
					await pool.query(
						`UPDATE document_elements SET embedding = $1::vector WHERE id = $2`,
						[`[${vec.join(',')}]`, el.id]
					);
					embedded++;
					if (embedded % 50 === 0) process.stdout.write(`  Embedded ${embedded}/${insertedIds.length}\r`);
				} catch (err) {
					console.error(`  Embedding failed for ${el.id}: ${err.message}`);
				}
			}
			console.log(`  Embedded: ${embedded}/${insertedIds.length} sentences`);

		} catch (err) {
			await client.query('ROLLBACK');
			console.error(`  FAILED: ${err.message}`);
		} finally {
			client.release();
		}
	}

	console.log('\nDone.');
	await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
