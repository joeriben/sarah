// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pipeline-Run-Endpoint — orchestrierter End-to-End-Lauf der hermeneutischen
// Pässe in der korrekten Reihenfolge mit Live-Status via Server-Sent Events.
//
//   POST   — startet einen neuen Run oder resumed einen pausierten/laufenden;
//            antwortet mit text/event-stream (SSE) bis zu 'completed', 'paused'
//            oder 'failed'. Body:
//              { heuristic?: 'h1'|'h2'|'h3',  // exklusive Pfad-Wahl
//                include_validity?: bool,    // H1-Modifikator
//                retrograde_pass?: bool,     // H2-Modifikator
//                cost_cap_usd?: number }
//            heuristic-Default: aus dem Brief abgeleitet (h3_enabled=true
//            → 'h3', sonst 'h1'). H1/H2/H3 sind exklusive Pfade.
//   GET    — gibt den aktuellen Run-Stand als JSON zurück (für Reload/Polling).
//   DELETE — setzt cancel_requested = true; der laufende Loop stoppt nach
//            dem nächsten atomaren Step graceful, persistierter Stand bleibt.
//
// Pause vs. Abbruch:
//   - Pause = DELETE → cancel_requested=true → Loop sieht das, status='paused';
//     ein erneutes POST setzt cancel_requested=false und macht weiter.
//   - Endgültiger Abbruch ist kein eigener Modus: pausierter Run wird einfach
//     nicht resumed; pausierte Runs blockieren auch keinen neuen Run, weil
//     POST den existierenden pausierten Run reaktiviert (kein Doppel-Run pro
//     Case).
//
// SSE-Events (Wire-Format: data: <json>\n\n):
//   { type: 'run-init', runId, status, resumed }
//   { type: 'phase-start', phase, total }
//   { type: 'step-start', phase, atom, index, total }
//   { type: 'step-done',  phase, atom, index, total, skipped, tokens, cumulative }
//   { type: 'step-error', phase, atom, message }
//   { type: 'paused', reason? }
//   { type: 'completed' }
//   { type: 'failed', message }

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import {
	startOrResumeRun,
	runPipelineLoop,
	requestCancel,
	getActiveRun,
	getLatestRun,
	type RunOptions,
	type PipelineEvent,
} from '$lib/server/pipeline/orchestrator.js';

async function ensureCaseAccess(caseId: string, userId: string): Promise<{ central_document_id: string | null; brief_validity_check: boolean; brief_h3_enabled: boolean }> {
	const row = await queryOne<{ central_document_id: string | null; project_id: string; brief_validity_check: boolean | null; brief_h3_enabled: boolean | null }>(
		`SELECT c.central_document_id, c.project_id,
		        b.validity_check AS brief_validity_check,
		        b.h3_enabled AS brief_h3_enabled
		 FROM cases c
		 LEFT JOIN assessment_briefs b ON b.id = c.assessment_brief_id
		 WHERE c.id = $1`,
		[caseId]
	);
	if (!row) error(404, 'Case not found');
	const member = await queryOne<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[row.project_id, userId]
	);
	if (!member) error(403, 'Not a member of this project');
	return {
		central_document_id: row.central_document_id,
		brief_validity_check: row.brief_validity_check === true,
		brief_h3_enabled: row.brief_h3_enabled === true,
	};
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { caseId } = params;
	if (!caseId) error(400, 'caseId required');

	const userId = locals.user.id;
	const access = await ensureCaseAccess(caseId, userId);
	if (!access.central_document_id) {
		error(409, 'Case has no central document');
	}

	const outlineCheck = await queryOne<{ outline_status: string }>(
		`SELECT outline_status FROM document_content WHERE naming_id = $1`,
		[access.central_document_id]
	);
	if (outlineCheck && outlineCheck.outline_status !== 'confirmed') {
		// JSON-Antwort statt SvelteKit-`error()`-HTML-Page — der Caller
		// fragt mit `Accept: text/event-stream`, dort liefert SvelteKit
		// die HTML-Error-Page. Wir geben deshalb explizit JSON zurück,
		// damit der Client die Code-Konstante (OUTLINE_NOT_CONFIRMED)
		// auswerten und eine sinnvolle Meldung zeigen kann.
		return json(
			{ code: 'OUTLINE_NOT_CONFIRMED', message: 'Die Outline des Dokuments muss vor dem Pipeline-Lauf bestätigt werden. Wechsle in den Outline-Tab und prüfe die Kapitel-Struktur.' },
			{ status: 409 }
		);
	}

	const body = (await request.json().catch(() => ({}))) as {
		heuristic?: 'h1' | 'h2' | 'h3';
		include_validity?: boolean;
		retrograde_pass?: boolean;
		cost_cap_usd?: number | null;
	};
	// heuristic: explicit body wins, sonst Default aus dem Brief
	// (h3_enabled=true → 'h3'; sonst 'h1'). H1, H2, H3 sind exklusive
	// Pfade pro Run; Brief-Spalte `h3_enabled` ist Übergangs-Modellierung
	// und wird in einer Folge-Migration zu einer expliziten heuristic-
	// Spalte mit Werten 'h1'|'h2'|'h3'.
	// include_validity ist H1-spezifischer Modifikator (argument_validity
	// einschieben); explicit body wins, sonst Default aus dem Brief.
	const explicitValidity = typeof body?.include_validity === 'boolean' ? body.include_validity : null;
	const briefHeuristic: 'h1' | 'h3' = access.brief_h3_enabled ? 'h3' : 'h1';
	const heuristic: 'h1' | 'h2' | 'h3' =
		body?.heuristic === 'h1' || body?.heuristic === 'h2' || body?.heuristic === 'h3'
			? body.heuristic
			: briefHeuristic;
	const options: RunOptions = {
		heuristic,
		include_validity: explicitValidity ?? access.brief_validity_check,
		retrograde_pass: typeof body?.retrograde_pass === 'boolean' ? body.retrograde_pass : false,
		cost_cap_usd: typeof body?.cost_cap_usd === 'number' ? body.cost_cap_usd : null,
	};

	const { run, resumed } = await startOrResumeRun(caseId, userId, options);

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const encoder = new TextEncoder();
			let closed = false;
			const send = (e: PipelineEvent) => {
				if (closed) return;
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
			};
			const close = () => {
				if (closed) return;
				closed = true;
				try { controller.close(); } catch { /* already closed */ }
			};

			// On client disconnect: request cancel so the loop can wind down.
			request.signal.addEventListener('abort', () => {
				closed = true;
				requestCancel(run.id).catch(() => {});
			});

			send({ type: 'run-init', runId: run.id, status: run.status, resumed });

			try {
				await runPipelineLoop(run.id, caseId, userId, options, send);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				send({ type: 'failed', message });
			} finally {
				close();
			}
		},
		cancel() {
			requestCancel(run.id).catch(() => {});
		},
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-store, no-transform',
			'X-Accel-Buffering': 'no',
			Connection: 'keep-alive',
		},
	});
};

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { caseId } = params;
	if (!caseId) error(400, 'caseId required');
	await ensureCaseAccess(caseId, locals.user.id);

	const active = await getActiveRun(caseId);
	const latest = active ?? (await getLatestRun(caseId));
	return json({ run: latest });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { caseId } = params;
	if (!caseId) error(400, 'caseId required');
	await ensureCaseAccess(caseId, locals.user.id);

	const active = await getActiveRun(caseId);
	if (!active) {
		return json({ ok: true, paused: false, message: 'No active run' });
	}
	await requestCancel(active.id);
	return json({ ok: true, paused: true, runId: active.id });
};
