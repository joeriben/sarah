/**
 * Embedding client: generates sentence embeddings using @huggingface/transformers.
 * Runs nomic-embed-text (768 dims) directly in Node.js — no external service needed.
 * Model is downloaded from the Hugging Face Hub on first use and cached locally
 * under .model-cache/ (gitignored). Subsequent starts are offline.
 */

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { join } from 'node:path';

const EMBED_MODEL = 'nomic-ai/nomic-embed-text-v1.5';
const EMBED_DIMS = 768;

export { EMBED_MODEL, EMBED_DIMS };

// Cache models in project directory (portable, gitignored)
env.cacheDir = join(process.cwd(), '.model-cache');

export type EmbedStatus = {
	phase: 'idle' | 'downloading' | 'ready' | 'error';
	model: string;
	file?: string;
	loaded?: number;
	total?: number;
	percent?: number;
	error?: string;
};

let status: EmbedStatus = { phase: 'idle', model: EMBED_MODEL };

export function getEmbedStatus(): EmbedStatus {
	return status;
}

function handleProgress(ev: { status: string; name?: string; file?: string; loaded?: number; total?: number }) {
	if (ev.status === 'progress' && typeof ev.loaded === 'number' && typeof ev.total === 'number' && ev.total > 0) {
		status = {
			phase: 'downloading',
			model: EMBED_MODEL,
			file: ev.file,
			loaded: ev.loaded,
			total: ev.total,
			percent: Math.round((ev.loaded / ev.total) * 100)
		};
	}
}

// Lazy-loaded singleton pipeline
let _pipeline: FeatureExtractionPipeline | null = null;
let _loading: Promise<FeatureExtractionPipeline> | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
	if (_pipeline) return _pipeline;
	if (_loading) return _loading;

	console.log(`[embeddings] Loading model ${EMBED_MODEL} (first run downloads ~150 MB; subsequent starts are cached)`);

	_loading = pipeline('feature-extraction', EMBED_MODEL, {
		dtype: 'q8',
		progress_callback: handleProgress as unknown as undefined
	}).then(p => {
		_pipeline = p;
		_loading = null;
		status = { phase: 'ready', model: EMBED_MODEL };
		console.log('[embeddings] Model ready.');
		return p;
	}).catch(err => {
		_loading = null;
		status = { phase: 'error', model: EMBED_MODEL, error: err instanceof Error ? err.message : String(err) };
		throw err;
	});

	return _loading;
}

/**
 * Start model loading in the background. Safe to call multiple times —
 * it only triggers the first load. Use on server startup to prefetch.
 */
export function preloadEmbedModel(): void {
	void getPipeline().catch(err => console.warn('[embeddings] Preload failed:', err));
}

/**
 * Generate embedding for a single text string.
 */
export async function embed(text: string): Promise<number[]> {
	const pipe = await getPipeline();
	const result = await pipe(text, { pooling: 'mean', normalize: true });
	return Array.from(result.data as Float32Array);
}

/**
 * Generate embeddings for multiple texts.
 * Processes as a batch for efficiency.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return [];
	const pipe = await getPipeline();
	const results: number[][] = [];
	// Process individually to avoid memory issues with large batches
	for (const text of texts) {
		const result = await pipe(text, { pooling: 'mean', normalize: true });
		results.push(Array.from(result.data as Float32Array));
	}
	return results;
}

/**
 * Format a vector as PostgreSQL pgvector literal: '[0.1,0.2,...]'
 */
export function toPgVector(vec: number[]): string {
	return `[${vec.join(',')}]`;
}
