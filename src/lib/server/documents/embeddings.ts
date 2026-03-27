/**
 * Embedding client: generates sentence embeddings using @huggingface/transformers.
 * Runs nomic-embed-text (768 dims) directly in Node.js — no external service needed.
 * Model is downloaded automatically on first use and cached locally.
 */

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { join } from 'node:path';

const EMBED_MODEL = 'nomic-ai/nomic-embed-text-v1.5';
const EMBED_DIMS = 768;

export { EMBED_DIMS };

// Cache models in project directory (portable, gitignored)
env.cacheDir = join(process.cwd(), '.model-cache');

// Lazy-loaded singleton pipeline
let _pipeline: FeatureExtractionPipeline | null = null;
let _loading: Promise<FeatureExtractionPipeline> | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
	if (_pipeline) return _pipeline;
	if (_loading) return _loading;

	_loading = pipeline('feature-extraction', EMBED_MODEL, {
		dtype: 'q8'
	}).then(p => {
		_pipeline = p;
		_loading = null;
		return p;
	});

	return _loading;
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
