// Coach reference library: upload, AI-driven preprocessing, and retrieval.
// Installation-wide methodological reference texts for the didactic AI persona.
//
// Flow:
// 1. Upload: store original file + extract text to .txt — NO chunking
// 2. Preprocess (triggered by user): Coach (configured AI provider) reads the
//    text, detects chapters, creates orientation document with summaries/questions
// 3. Retrieval: search orientation document to find relevant chapters, pull text

import { query, queryOne } from '../db/index.js';
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { chat, getModel, getProvider } from './client.js';
import { logInteraction } from './index.js';

const LIBRARY_DIR = join(process.cwd(), 'coach-library');
const ORIGINALS_DIR = join(LIBRARY_DIR, 'originals');

function ensureDir(dir: string) {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── CRUD ─────────────────────────────────────────────────────────

export async function listReferences() {
	await autoImportIfNeeded();
	return (await query(
		`SELECT r.*,
		   (SELECT COUNT(*) FROM coach_chunks c WHERE c.reference_id = r.id) as chunk_count,
		   (SELECT COALESCE(SUM(c.word_count), 0) FROM coach_chunks c WHERE c.reference_id = r.id) as total_words
		 FROM coach_references r
		 ORDER BY r.created_at DESC`
	)).rows;
}

export async function getReference(id: string) {
	return queryOne(
		`SELECT r.*,
		   (SELECT COUNT(*) FROM coach_chunks c WHERE c.reference_id = r.id) as chunk_count,
		   (SELECT COALESCE(SUM(c.word_count), 0) FROM coach_chunks c WHERE c.reference_id = r.id) as total_words
		 FROM coach_references r WHERE r.id = $1`,
		[id]
	);
}

export async function getReferenceChunks(referenceId: string) {
	return (await query(
		`SELECT id, section, content, chunk_index, word_count, summary, questions, key_concepts, relevance
		 FROM coach_chunks WHERE reference_id = $1
		 ORDER BY chunk_index`,
		[referenceId]
	)).rows;
}

export async function deleteReference(id: string) {
	const ref = await queryOne<{ filename: string | null; text_file: string | null }>(
		'SELECT filename, text_file FROM coach_references WHERE id = $1', [id]
	);
	// Clean up files
	if (ref?.text_file) {
		const p = join(LIBRARY_DIR, ref.text_file);
		if (existsSync(p)) unlinkSync(p);
	}
	if (ref?.filename) {
		// Check both library dir and originals dir
		for (const dir of [LIBRARY_DIR, ORIGINALS_DIR]) {
			const p = join(dir, ref.filename);
			if (existsSync(p)) unlinkSync(p);
		}
	}
	// Chunks cascade-deleted via FK
	await query('DELETE FROM coach_references WHERE id = $1', [id]);
}

// ── Upload (store only, no chunking) ─────────────────────────────

export async function addReference(opts: {
	title: string;
	author?: string;
	description?: string;
	content: string;       // raw text (already extracted if PDF)
	filename?: string;
	format: 'pdf' | 'text' | 'markdown';
	fileBuffer?: Buffer;   // original file to store on disk
	userId?: string;
}): Promise<string> {
	ensureDir(LIBRARY_DIR);

	// Store original file on disk
	let storedFilename: string | null = null;
	if (opts.fileBuffer && opts.filename) {
		const safe = opts.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
		storedFilename = `${Date.now()}-${safe}`;
		writeFileSync(join(LIBRARY_DIR, storedFilename), opts.fileBuffer);
	}

	// Save extracted text as .txt
	const textFilename = `${Date.now()}-${(opts.title || 'ref').replace(/[^a-zA-Z0-9._-]/g, '_')}.txt`;
	writeFileSync(join(LIBRARY_DIR, textFilename), opts.content, 'utf-8');

	// Create reference record — NO chunks created here
	const ref = await queryOne<{ id: string }>(
		`INSERT INTO coach_references (title, author, description, filename, format, uploaded_by, text_file)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		[opts.title, opts.author || null, opts.description || null, storedFilename, opts.format, opts.userId || null, textFilename]
	);

	return ref!.id;
}

// ── Text extraction ──────────────────────────────────────────────

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
	const { PDFParse } = await import('pdf-parse');
	const parser = new PDFParse({ data: new Uint8Array(buffer) });
	const result = await parser.getText();
	return result.text;
}

// ── AI Preprocessing ─────────────────────────────────────────────
// Coach (the configured AI provider) reads the full text, detects chapters,
// creates chapter-level chunks with summaries, and builds an orientation document.

const CHAPTER_DETECT_PROMPT = `You are analyzing the structure of a methodological text. Identify all chapters or major sections.

Return a JSON array of objects, each with:
- "heading": the chapter/section title as it appears in the text
- "start_marker": a unique string (10-30 chars) from the FIRST line of that chapter's content (not the heading itself, but the first sentence after it) — this will be used to locate the chapter in the full text

Only include real chapters/sections, not sub-subsections. For books: chapters. For articles: major sections (Introduction, Methods, Results, etc.).

Respond ONLY with the JSON array.`;

const INDEX_CHAPTER_PROMPT = `You are Coach, a didactic AI companion for Situational Analysis (Clarke). You are reading a chapter from a methodological reference text and creating your personal reading notes.

Produce a JSON object with:
- "summary": 2-4 sentences — what this chapter covers, from your perspective as a methodology coach
- "questions": array of 3-8 questions that a researcher might ask which this chapter helps answer
- "key_concepts": array of key methodological concepts discussed (e.g., "situational map", "CCS gradient", "social worlds", "coding")
- "relevance": "high" | "medium" | "low" — how important is this chapter for coaching SA/GT methodology?
- "teaching_notes": 1-2 sentences — what you would want to remember when a researcher asks about this topic

Match the language of the source text. Respond ONLY with the JSON object.`;

export async function preprocessReference(referenceId: string) {
	const ref = await getReference(referenceId);
	if (!ref) throw new Error('Reference not found');

	// Ensure we have a text file — extract from PDF if needed
	if (!ref.text_file) {
		if (ref.format === 'pdf' && ref.filename) {
			const pdfPath = join(LIBRARY_DIR, ref.filename);
			if (!existsSync(pdfPath)) throw new Error('Original PDF not found');
			const pdfBuffer = readFileSync(pdfPath);
			const extracted = await extractTextFromPdf(pdfBuffer);
			const textFilename = ref.filename.replace(/\.pdf$/i, '.txt');
			writeFileSync(join(LIBRARY_DIR, textFilename), extracted, 'utf-8');
			await query('UPDATE coach_references SET text_file = $1 WHERE id = $2', [textFilename, referenceId]);
			ref.text_file = textFilename;
		} else {
			throw new Error('No text file and no PDF to extract from');
		}
	}

	// Read the full text
	const textPath = join(LIBRARY_DIR, ref.text_file);
	if (!existsSync(textPath)) throw new Error('Text file not found: ' + ref.text_file);
	const fullText = readFileSync(textPath, 'utf-8');

	const wordCount = fullText.split(/\s+/).filter(Boolean).length;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;

	// Delete old chunks (from previous mechanical chunking or previous preprocessing)
	await query('DELETE FROM coach_chunks WHERE reference_id = $1', [referenceId]);

	// Step 1: Detect chapter structure using AI
	// Send first ~8000 words (enough for TOC + first pages)
	const previewWords = fullText.split(/\s+/).slice(0, 8000).join(' ');

	const structureResponse = await chat({
		system: CHAPTER_DETECT_PROMPT,
		messages: [{
			role: 'user',
			content: `Title: "${ref.title}"${ref.author ? ` by ${ref.author}` : ''}\nTotal words: ${wordCount}\n\nText (first ~8000 words):\n${previewWords}`
		}],
		maxTokens: 2000
	});
	totalInputTokens += structureResponse.inputTokens;
	totalOutputTokens += structureResponse.outputTokens;

	let chapters: Array<{ heading: string; start_marker: string }> = [];
	try {
		const jsonMatch = structureResponse.text.match(/\[[\s\S]*\]/);
		if (jsonMatch) chapters = JSON.parse(jsonMatch[0]);
	} catch (e) {
		console.warn('Coach preprocessing: failed to detect chapters:', e);
	}

	// Step 2: Split text by detected chapters
	let chapterTexts: Array<{ heading: string; content: string }> = [];

	if (chapters.length > 1) {
		// Find each chapter's start position using the marker
		const positions: Array<{ heading: string; pos: number }> = [];
		for (const ch of chapters) {
			const idx = fullText.indexOf(ch.start_marker);
			if (idx >= 0) {
				positions.push({ heading: ch.heading, pos: idx });
			}
		}
		positions.sort((a, b) => a.pos - b.pos);

		for (let i = 0; i < positions.length; i++) {
			const start = positions[i].pos;
			const end = i + 1 < positions.length ? positions[i + 1].pos : fullText.length;
			const content = fullText.slice(start, end).trim();
			if (content) {
				chapterTexts.push({ heading: positions[i].heading, content });
			}
		}

		// If we missed a lot of text before the first chapter, include it as "Front Matter"
		if (positions.length > 0 && positions[0].pos > 500) {
			const frontMatter = fullText.slice(0, positions[0].pos).trim();
			if (frontMatter) {
				chapterTexts.unshift({ heading: 'Front Matter', content: frontMatter });
			}
		}
	}

	// Fallback: if chapter detection failed or text is short, treat as one piece
	if (chapterTexts.length === 0) {
		chapterTexts = [{ heading: ref.title, content: fullText }];
	}

	// Step 3: For each chapter, create a chunk and get AI annotation
	const sections: any[] = [];
	const titleSlug = (ref.title || 'ref').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);

	for (let i = 0; i < chapterTexts.length; i++) {
		const ch = chapterTexts[i];
		const chWordCount = ch.content.split(/\s+/).filter(Boolean).length;

		// Store chapter as chunk in DB
		const chunkRes = await queryOne<{ id: string }>(
			`INSERT INTO coach_chunks (reference_id, section, content, chunk_index, word_count)
			 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			[referenceId, ch.heading, ch.content, i, chWordCount]
		);

		// Send chapter to AI for annotation (truncate if too long for context)
		const maxChars = 30000; // ~7-8k tokens, safe for most providers
		const chapterPreview = ch.content.length > maxChars
			? ch.content.slice(0, maxChars) + `\n\n[... truncated, ${chWordCount} words total]`
			: ch.content;

		try {
			const indexResponse = await chat({
				system: INDEX_CHAPTER_PROMPT,
				messages: [{
					role: 'user',
					content: `Reference: "${ref.title}"${ref.author ? ` by ${ref.author}` : ''}\nChapter: "${ch.heading}" (${chWordCount} words)\n\n${chapterPreview}`
				}],
				maxTokens: 1000
			});
			totalInputTokens += indexResponse.inputTokens;
			totalOutputTokens += indexResponse.outputTokens;

			const jsonMatch = indexResponse.text.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const entry = JSON.parse(jsonMatch[0]);

				// Update chunk with AI annotations
				await query(
					`UPDATE coach_chunks SET summary = $1, questions = $2, key_concepts = $3, relevance = $4
					 WHERE id = $5`,
					[entry.summary, entry.questions || [], entry.key_concepts || [], entry.relevance || 'medium', chunkRes!.id]
				);

				sections.push({
					chapter_index: i,
					heading: ch.heading,
					word_count: chWordCount,
					summary: entry.summary,
					questions: entry.questions,
					key_concepts: entry.key_concepts,
					relevance: entry.relevance,
					teaching_notes: entry.teaching_notes
				});
			}
		} catch (e) {
			console.warn(`Coach preprocessing: failed to index chapter "${ch.heading}":`, e);
			sections.push({ chapter_index: i, heading: ch.heading, word_count: chWordCount, summary: null });
		}
	}

	// Step 4: Build orientation document
	const allConcepts = [...new Set(sections.flatMap((s: any) => s.key_concepts || []))];
	const highRelevance = sections.filter((s: any) => s.relevance === 'high');

	const indexData = {
		title: ref.title,
		author: ref.author,
		total_words: wordCount,
		chapters: chapterTexts.length,
		high_relevance_chapters: highRelevance.length,
		key_concepts: allConcepts,
		sections
	};

	// Step 5: Move original non-txt file to originals/ folder
	if (ref.filename && ref.format === 'pdf') {
		ensureDir(ORIGINALS_DIR);
		const src = join(LIBRARY_DIR, ref.filename);
		const dst = join(ORIGINALS_DIR, ref.filename);
		if (existsSync(src)) {
			renameSync(src, dst);
		}
	}

	// Step 6: Save index and mark as indexed
	await query(
		`UPDATE coach_references SET index_data = $1, indexed_at = now() WHERE id = $2`,
		[JSON.stringify(indexData), referenceId]
	);

	console.log(`Coach preprocessing complete: "${ref.title}" — ${chapterTexts.length} chapters, ${highRelevance.length} high-relevance, ${totalInputTokens + totalOutputTokens} tokens`);

	// Auto-export library.json so the folder is portable
	await exportLibrary();

	return indexData;
}

// ── Retrieval ────────────────────────────────────────────────────

export async function searchChunks(queryText: string, limit: number = 3) {
	const words = queryText
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter(w => w.length > 2)
		.slice(0, 15);

	if (words.length === 0) return [];

	const tsquery = words.map(w => `${w}:*`).join(' | ');

	// Search indexed chapters: match against summaries + questions
	const results = (await query(
		`SELECT r.title as reference_title, r.author as reference_author,
		        c.section, c.content, c.summary, c.questions, c.word_count,
		        ts_rank(
		          setweight(to_tsvector('simple', coalesce(c.summary, '')), 'A')
		          || setweight(to_tsvector('simple', coalesce(array_to_string(c.questions, ' '), '')), 'B')
		          || setweight(to_tsvector('simple', coalesce(c.section, '')), 'C'),
		          to_tsquery('simple', $1)
		        ) as rank
		 FROM coach_chunks c
		 JOIN coach_references r ON r.id = c.reference_id
		 WHERE (
		   -- Search in AI-generated index (preprocessed)
		   (c.summary IS NOT NULL AND (
		     to_tsvector('simple', coalesce(c.summary, '') || ' ' || coalesce(array_to_string(c.questions, ' '), ''))
		     @@ to_tsquery('simple', $1)
		   ))
		   OR
		   -- Fallback: search in raw content (not yet preprocessed)
		   (c.summary IS NULL AND c.tsv @@ to_tsquery('simple', $1))
		 )
		 ORDER BY rank DESC
		 LIMIT $2`,
		[tsquery, limit]
	)).rows;

	return results;
}

// ── Export / Import (portable library.json) ──────────────────────

const LIBRARY_JSON = join(LIBRARY_DIR, 'library.json');

export async function exportLibrary() {
	ensureDir(LIBRARY_DIR);

	const refs = (await query(
		`SELECT * FROM coach_references ORDER BY created_at`
	)).rows;

	const data: any[] = [];
	for (const ref of refs) {
		const chunks = (await query(
			`SELECT section, content, chunk_index, word_count, summary, questions, key_concepts, relevance
			 FROM coach_chunks WHERE reference_id = $1 ORDER BY chunk_index`,
			[ref.id]
		)).rows;

		data.push({
			id: ref.id,
			title: ref.title,
			author: ref.author,
			description: ref.description,
			filename: ref.filename,
			format: ref.format,
			text_file: ref.text_file,
			indexed_at: ref.indexed_at,
			index_data: ref.index_data,
			created_at: ref.created_at,
			chunks
		});
	}

	writeFileSync(LIBRARY_JSON, JSON.stringify(data, null, 2), 'utf-8');
	console.log(`Coach library exported: ${data.length} references → library.json`);
}

export async function importLibrary() {
	if (!existsSync(LIBRARY_JSON)) return { imported: 0, skipped: 0 };

	const data = JSON.parse(readFileSync(LIBRARY_JSON, 'utf-8'));
	let imported = 0;
	let skipped = 0;

	for (const entry of data) {
		// Skip if already in DB (by title + author match)
		const existing = await queryOne(
			`SELECT id FROM coach_references WHERE title = $1 AND coalesce(author, '') = coalesce($2, '')`,
			[entry.title, entry.author]
		);
		if (existing) {
			skipped++;
			continue;
		}

		// Insert reference
		const ref = await queryOne<{ id: string }>(
			`INSERT INTO coach_references (title, author, description, filename, format, text_file, indexed_at, index_data, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
			[entry.title, entry.author, entry.description, entry.filename, entry.format,
			 entry.text_file, entry.indexed_at, entry.index_data ? JSON.stringify(entry.index_data) : null,
			 entry.created_at || new Date().toISOString()]
		);

		// Insert chunks
		for (const ch of entry.chunks || []) {
			await query(
				`INSERT INTO coach_chunks (reference_id, section, content, chunk_index, word_count, summary, questions, key_concepts, relevance)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				[ref!.id, ch.section, ch.content, ch.chunk_index, ch.word_count,
				 ch.summary, ch.questions || [], ch.key_concepts || [], ch.relevance]
			);
		}

		imported++;
	}

	console.log(`Coach library imported: ${imported} new, ${skipped} skipped (already present)`);
	return { imported, skipped };
}

// Auto-import on first call if DB is empty but library.json exists
let _autoImportDone = false;
export async function autoImportIfNeeded() {
	if (_autoImportDone) return;
	_autoImportDone = true;

	const count = await queryOne<{ n: string }>('SELECT COUNT(*) as n FROM coach_references');
	if (parseInt(count?.n || '0') === 0 && existsSync(LIBRARY_JSON)) {
		console.log('Coach: DB empty but library.json found — auto-importing...');
		await importLibrary();
	}
}
