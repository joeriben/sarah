// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// End-to-end H3-Orchestrator-Lauf gegen das HTTP-Endpoint mit live SSE-Trace.
//
// Triggert POST /api/cases/<caseId>/pipeline/run mit explizitem
// `heuristic: 'h3'` (überschreibt Brief-Default), folgt dem Server-Sent-
// Event-Stream und dokumentiert Phase-Übergänge, Step-Done-Events und
// Token-Cumulatives. H1, H2 und H3 sind exklusive Pfade pro Run — bei
// heuristic='h3' läuft AUSSCHLIESSLICH H3, kein H1 davor (Memory
// `project_three_heuristics_architecture.md`). Beim Abschluss (completed
// | failed | paused) wird der existing Smoke-Test inline ausgeführt zur
// Done-Verifikation.
//
// Auth: legt eine kurzlebige Session in der DB an für den Default-Test-User
// sarah@example.com (env: SARAH_TEST_USER_ID, default uuid hartkodiert),
// nutzt den Token als tqda_session-Cookie. Session läuft nach 2 h ab.
//
// Aufruf:
//   npx tsx scripts/test-h3-orchestrator-e2e-http.ts <caseId> [base-url]
//   # base-url default: http://127.0.0.1:12690
//
// Erwartete Laufzeit: 5-15 min für ein BA-Werk (~100k chars), ~$5-15 Sonnet.

import { pool, query, queryOne } from '../src/lib/server/db/index.js';
import {
	isH3PhaseDone,
	isH3PhaseValidated,
	type H3Phase,
} from '../src/lib/server/pipeline/h3-phases.js';

const TEST_USER_ID = process.env.SARAH_TEST_USER_ID ?? 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';
const PHASES: H3Phase[] = [
	'h3_exposition',
	'h3_grundlagentheorie',
	'h3_forschungsdesign',
	'h3_durchfuehrung',
	'h3_synthese',
	'h3_schlussreflexion',
	'h3_exkurs',
	'h3_werk_deskription',
	'h3_werk_gutacht',
];

type AtomRef = { id: string; label: string; headingId?: string };
type SseEvent =
	| { type: 'run-init'; runId: string; status: string; resumed: boolean }
	| { type: 'phase-start'; phase: string; total: number }
	| { type: 'step-start'; phase: string; atom: AtomRef; index: number; total: number }
	| {
			type: 'step-done';
			phase: string;
			atom: AtomRef;
			index: number;
			total: number;
			skipped: boolean;
			tokens: { input: number; output: number; cacheRead: number };
			cumulative: { input: number; output: number; cacheRead: number };
	  }
	| { type: 'step-error'; phase: string; atom: AtomRef; message: string }
	| { type: 'paused'; reason?: string }
	| { type: 'completed' }
	| { type: 'failed'; message: string };

function atomLabel(a: AtomRef): string {
	return a.label || a.id.slice(0, 8);
}

function fmtTime(d: Date): string {
	return d.toISOString().slice(11, 19);
}

function fmtTokens(t: { input: number; output: number; cacheRead: number }): string {
	return `in=${t.input} out=${t.output} cacheR=${t.cacheRead}`;
}

async function ensureSession(): Promise<string> {
	const row = await queryOne<{ token: string }>(
		`INSERT INTO sessions (user_id, token, expires_at)
		 VALUES ($1, encode(gen_random_bytes(32), 'hex'), now() + interval '2 hours')
		 RETURNING token`,
		[TEST_USER_ID]
	);
	if (!row) throw new Error('Failed to create session');
	return row.token;
}

async function postRun(baseUrl: string, caseId: string, token: string): Promise<Response> {
	const res = await fetch(`${baseUrl}/api/cases/${caseId}/pipeline/run`, {
		method: 'POST',
		headers: {
			'Cookie': `tqda_session=${token}`,
			'Accept': 'text/event-stream',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ heuristic: 'h3' }),
	});
	if (res.status !== 200) {
		const body = await res.text();
		throw new Error(`POST /pipeline/run returned ${res.status}: ${body}`);
	}
	if (!res.body) throw new Error('No SSE response body');
	return res;
}

async function streamEvents(res: Response, onEvent: (e: SseEvent) => boolean | Promise<boolean>) {
	// Node-fetch SSE: manuelles reader.read() bricht bei längeren Pausen
	// zwischen Events ab (gesehen: Stream endet nach erstem step-done, obwohl
	// Server weiter Events sendet). `for await ... of` über den Body
	// (Symbol.asyncIterator, Node 22+) hält die Verbindung stabiler.
	const decoder = new TextDecoder();
	let buffer = '';
	let stop = false;

	for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
		if (stop) break;
		buffer += decoder.decode(chunk, { stream: true });
		// SSE-Frames sind \n\n-separiert, jede `data: <json>` Zeile.
		let idx = buffer.indexOf('\n\n');
		while (idx !== -1) {
			const frame = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);
			for (const line of frame.split('\n')) {
				if (line.startsWith('data: ')) {
					const json = line.slice(6).trim();
					if (json) {
						try {
							const evt = JSON.parse(json) as SseEvent;
							const shouldStop = await onEvent(evt);
							if (shouldStop) {
								stop = true;
								break;
							}
						} catch (err) {
							console.error(`[parse error] ${(err as Error).message} :: ${json}`);
						}
					}
				}
			}
			if (stop) break;
			idx = buffer.indexOf('\n\n');
		}
	}
}

async function postRunCheck(caseId: string, documentId: string) {
	console.log('\n────────────────────────────────────────────────────────────');
	console.log('Post-Run Verifikation (Done- & Validation-Check)');
	console.log('────────────────────────────────────────────────────────────');
	console.log('Phase                       | Done | Validated');
	console.log('----------------------------+------+----------');
	for (const phase of PHASES) {
		const [done, validated] = await Promise.all([
			isH3PhaseDone(phase, caseId, documentId),
			isH3PhaseValidated(phase, caseId, documentId),
		]);
		const phaseLabel = phase.padEnd(27);
		const doneStr = (done ? '✓' : '·').padEnd(4);
		const validatedStr = (validated ? '✓' : '·');
		console.log(`${phaseLabel} | ${doneStr} | ${validatedStr}`);
	}

	// Konstrukt-Counts pro outline_function_type:
	const counts = (
		await query<{ outline_function_type: string; construct_kind: string; n: number }>(
			`SELECT outline_function_type, construct_kind, COUNT(*)::int AS n
			 FROM function_constructs
			 WHERE case_id = $1
			 GROUP BY outline_function_type, construct_kind
			 ORDER BY outline_function_type, construct_kind`,
			[caseId]
		)
	).rows;
	console.log('\nfunction_constructs nach Funktionstyp / construct_kind:');
	if (counts.length === 0) {
		console.log('  (keine Konstrukte)');
	} else {
		for (const c of counts) {
			console.log(`  ${(c.outline_function_type ?? '(null)').padEnd(20)} ${c.construct_kind.padEnd(28)} n=${c.n}`);
		}
	}
}

async function main() {
	const caseId = process.argv[2];
	const baseUrl = process.argv[3] ?? 'http://127.0.0.1:12690';
	if (!caseId) {
		console.error('Usage: npx tsx scripts/test-h3-orchestrator-e2e-http.ts <caseId> [base-url]');
		process.exit(1);
	}

	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow?.central_document_id) {
		console.error(`Case ${caseId} not found or has no central_document_id`);
		process.exit(1);
	}
	const documentId = caseRow.central_document_id;

	console.log(`> H3-Orchestrator E2E-HTTP-Lauf`);
	console.log(`  caseId:    ${caseId}`);
	console.log(`  documentId: ${documentId}`);
	console.log(`  baseUrl:   ${baseUrl}`);
	console.log(`  user:      sarah@example.com (${TEST_USER_ID})\n`);

	const token = await ensureSession();
	console.log(`  session token created\n`);

	const start = Date.now();
	const phaseStarts = new Map<string, number>();
	let runId: string | null = null;
	let finalEvent: 'completed' | 'failed' | 'paused' | null = null;
	let finalMessage = '';

	console.log('SSE-Stream:');
	console.log('────────────────────────────────────────────────────────────');

	const res = await postRun(baseUrl, caseId, token);
	await streamEvents(res, async (evt) => {
		const ts = fmtTime(new Date());
		switch (evt.type) {
			case 'run-init':
				runId = evt.runId;
				console.log(`[${ts}] run-init   runId=${evt.runId} status=${evt.status} resumed=${evt.resumed}`);
				break;
			case 'phase-start':
				phaseStarts.set(evt.phase, Date.now());
				console.log(`[${ts}] phase-start ${evt.phase}  (total=${evt.total})`);
				break;
			case 'step-start':
				console.log(`[${ts}]   step-start ${evt.phase} [${evt.index}/${evt.total}] atom=${atomLabel(evt.atom)}`);
				break;
			case 'step-done': {
				const phaseStart = phaseStarts.get(evt.phase);
				const dur = phaseStart ? `${((Date.now() - phaseStart) / 1000).toFixed(1)}s` : '?';
				const skipMark = evt.skipped ? ' [SKIPPED]' : '';
				console.log(
					`[${ts}]   step-done  ${evt.phase} [${evt.index}/${evt.total}]${skipMark} ` +
						`tokens(${fmtTokens(evt.tokens)}) cum(${fmtTokens(evt.cumulative)}) phase-elapsed=${dur}`
				);
				break;
			}
			case 'step-error':
				console.log(`[${ts}]   STEP-ERROR ${evt.phase} atom=${atomLabel(evt.atom)} :: ${evt.message}`);
				break;
			case 'paused':
				finalEvent = 'paused';
				finalMessage = evt.reason ?? '';
				console.log(`[${ts}] paused  ${evt.reason ?? ''}`);
				return true;
			case 'completed':
				finalEvent = 'completed';
				console.log(`[${ts}] completed`);
				return true;
			case 'failed':
				finalEvent = 'failed';
				finalMessage = evt.message;
				console.log(`[${ts}] FAILED  ${evt.message}`);
				return true;
		}
		return false;
	});

	const elapsed = ((Date.now() - start) / 1000).toFixed(1);
	console.log('────────────────────────────────────────────────────────────');
	console.log(`Gesamtdauer: ${elapsed}s, Endzustand: ${finalEvent ?? '(stream ended ohne Ende-Event)'}`);
	if (runId) console.log(`runId: ${runId}`);

	// Run-Detail aus DB nachladen für error_message und Token-Sums:
	if (runId) {
		const run = await queryOne<{
			status: string;
			error_message: string | null;
			accumulated_input_tokens: number;
			accumulated_output_tokens: number;
			accumulated_cache_read_tokens: number;
		}>(
			`SELECT status, error_message,
			        accumulated_input_tokens, accumulated_output_tokens, accumulated_cache_read_tokens
			 FROM pipeline_runs WHERE id = $1`,
			[runId]
		);
		if (run) {
			console.log(`\nDB-Run-Snapshot:`);
			console.log(`  status: ${run.status}`);
			console.log(`  error_message: ${run.error_message ?? '(none)'}`);
			console.log(`  tokens: input=${run.accumulated_input_tokens} output=${run.accumulated_output_tokens} cacheRead=${run.accumulated_cache_read_tokens}`);
		}
	}

	await postRunCheck(caseId, documentId);

	await pool.end();
	process.exit(finalEvent === 'completed' ? 0 : finalEvent === 'paused' ? 2 : 1);
}

main().catch(async (e) => {
	console.error(e instanceof Error ? e.stack : e);
	try { await pool.end(); } catch { /* ignore */ }
	process.exit(1);
});
