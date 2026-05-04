// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Per-paragraph Argument-Validity-Pass — OPT-IN.
//
// Aktiviert via assessment_briefs.validity_check (Migration 040). Läuft
// NACH dem AG-Pass und VOR section_collapse, weil die Validität intrinsisch
// am Argument lebt und vor der Synthese-Schicht festgehalten werden soll.
//
// Charity-First-Prinzip:
//
//   1. PRIMÄR: positiver Tragfähigkeitsnachweis. Klassifiziere die Schluss-
//      form (deductive | inductive | abductive) und begründe, warum die
//      Premissen den claim tragen — Kongruenz der Ebenen, Ableitungs-
//      muster, Sprung-Vermeidung.
//
//   2. SEKUNDÄR (nur wenn Tragfähigkeit nicht nachweisbar): Wähle aus der
//      eng umrissenen Fallacy-Whitelist und nenne die betroffene Premisse.
//
// Hintergrund: direkte Fallacy-Suche ist methodologisch riskant — das
// LLM neigt dazu "irgendeine Fallacy" zu nominieren, wo nur impliziter
// Hintergrund fehlt. Das Charity-Prinzip dreht den Spieß um: nur wenn
// die positive Rekonstruktion scheitert, kommen Fallacies ins Spiel.
//
// Idempotence: skip wenn alle Argumente des ¶ bereits validity_assessment
// != NULL haben. Re-Run via UPDATE argument_nodes SET validity_assessment =
// NULL WHERE paragraph_element_id = '...'.

import { z } from 'zod';
import { query, queryOne, transaction } from '../../db/index.js';
import { chat, type Provider } from '../client.js';

// ── Whitelist ─────────────────────────────────────────────────────

export const FALLACY_WHITELIST = [
	'metabasis_eis_allo_genos',     // unzulässiger Sprung in andere Gattung/Ebene
	'ex_falso_quodlibet',           // aus falscher Premisse folgt Beliebiges
	'petitio_principii',            // Zirkularität / Frage-Begehren
	'affirming_the_consequent',     // (P→Q ∧ Q) ⊬ P
	'denying_the_antecedent',       // (P→Q ∧ ¬P) ⊬ ¬Q
	'false_dilemma',                // unzulässige Reduktion auf zwei Alternativen
	'hasty_generalization',         // Verallgemeinerung aus zu wenig Fällen
	'equivocation',                 // Bedeutungswechsel eines Begriffs zw. Premissen
	'naturalistic_fallacy',         // Sein → Sollen ohne Brücke
	'confusion_necessary_sufficient', // Verwechslung notwendig/hinreichend
	'ad_hominem',                   // Personenangriff statt Sache
	'straw_man',                    // Verzerrung der Gegenposition
] as const;

export type FallacyType = (typeof FALLACY_WHITELIST)[number];

// ── Schema ────────────────────────────────────────────────────────

const InferenceFormSchema = z.enum(['deductive', 'inductive', 'abductive']);
const FallacyTypeSchema = z.enum(FALLACY_WHITELIST);

const ValidityAssessmentSchema = z.discriminatedUnion('carries', [
	z.object({
		carries: z.literal(true),
		inference_form: InferenceFormSchema,
		rationale: z.string().min(1),
		fallacy: z.null().optional(),
	}),
	z.object({
		carries: z.literal(false),
		inference_form: InferenceFormSchema.nullable().optional(),
		rationale: z.string().min(1),
		fallacy: z.object({
			type: FallacyTypeSchema,
			target_premise: z.string().min(1),
			explanation: z.string().min(1),
		}),
	}),
]);

export type ValidityAssessment = z.infer<typeof ValidityAssessmentSchema>;

// ── Loader ────────────────────────────────────────────────────────

interface ParagraphArgRow {
	id: string;
	arg_local_id: string;
	claim: string;
	premises: { type: 'stated' | 'carried' | 'background'; text: string; from_paragraph?: number }[];
	validity_assessment: unknown;
}

interface ParagraphValidityCtx {
	paragraphId: string;
	paragraphText: string;
	args: ParagraphArgRow[];
}

async function loadValidityContext(paragraphId: string): Promise<ParagraphValidityCtx | null> {
	const para = await queryOne<{ id: string; char_start: number; char_end: number; full_text: string }>(
		`SELECT de.id, de.char_start, de.char_end, dc.full_text
		 FROM document_elements de
		 JOIN document_content dc ON dc.naming_id = de.document_id
		 WHERE de.id = $1`,
		[paragraphId]
	);
	if (!para) return null;

	const argRows = (await query<ParagraphArgRow>(
		`SELECT id, arg_local_id, claim, premises, validity_assessment
		 FROM argument_nodes
		 WHERE paragraph_element_id = $1
		 ORDER BY position_in_paragraph`,
		[paragraphId]
	)).rows;

	return {
		paragraphId,
		paragraphText: para.full_text.substring(para.char_start, para.char_end),
		args: argRows,
	};
}

// ── Prompt ────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
	const fallacyList = FALLACY_WHITELIST.map((f) => `  - ${f}`).join('\n');
	return `[ROLLE]
Du bist Argumentationslogiker. Du beurteilst die formal-logische Tragfähigkeit einzelner Argumente — nicht ihre inhaltliche Plausibilität, nicht ihre rhetorische Wirkung, nicht ihren disziplinären Stellenwert.

[CHARITY-PRINZIP — VORGEHEN]
Für jedes Argument:

1. **Versuche zuerst, die Tragfähigkeit POSITIV zu rekonstruieren**:
   - Klassifiziere die Schluss-Form als genau eine von:
       deductive  — Wenn-Dann-Schluss, modus ponens / tollens, Subsumtion.
       inductive  — Verallgemeinerung aus Einzelfällen, statistischer Schluss.
       abductive  — Schluss auf die beste Erklärung.
   - Begründe in 1-3 Sätzen, WARUM die Premissen den claim tragen:
     · Sind die Premissen-Ebenen kongruent zum claim (kein Gattungswechsel)?
     · Folgt der claim aus den Premissen formal (deduktiv) oder mit hinreichender Stützung (induktiv/abduktiv)?
     · Werden alle benötigten Brückenannahmen entweder genannt oder als 'background' korrekt markiert?
   Wenn das gelingt → \`carries: yes\`, fülle \`form\` und \`rationale\`.

2. **NUR wenn die positive Rekonstruktion scheitert**, springe auf die Fallacy-Auswahl. Wähle GENAU EINE aus:
${fallacyList}
   Nenne dann die betroffene Premisse (P1, P2, ... in Reihenfolge ihrer Auflistung; oder \`claim\` wenn der Bruch beim claim selbst liegt) und erkläre den Bruch in 1-2 Sätzen.
   Setze \`carries: no\`, fülle \`fallacy\`, \`target\` und \`rationale\`.

WICHTIG: ein Argument darf nur dann \`carries: no\` bekommen, wenn ein konkreter Bruch nachweisbar ist. Bloße Schwäche ("die Premissen sind dünn") ist KEIN Tragfähigkeits-Defekt — wenn die Schluss-Form formal hält, ist \`carries: yes\` mit entsprechender Form-Klassifikation richtig. False Positives auf der Fallacy-Achse sind in einem Gutachten reputationsschädlich; im Zweifel \`carries: yes\`.

[BEZUGSRAHMEN]
Die Premissen-Typen aus dem AG-Pass:
  · stated      — wörtlich/paraphrasiert im Absatz.
  · carried §N  — aus früherem Absatz übernommen (kontextfest).
  · background  — fachübliche Hintergrundannahme.
Eine \`background\`-Premisse ist KEINE Schwäche; sie ist legitim, wenn die Annahme tatsächlich fachüblich ist.

[OUTPUT-FORMAT — line-based prose, KEIN JSON]
Eine Sektion pro Argument. Sektion-Header GROSSGESCHRIEBEN.

VALIDITY A1
carries: yes
form: deductive
rationale: <warum die Premissen den claim deduktiv tragen, 1-3 Sätze>

VALIDITY A2
carries: no
fallacy: metabasis_eis_allo_genos
target: P1
rationale: <konkrete Beschreibung des Bruchs, 1-2 Sätze>

(weitere Argumente analog, jeweils mit eigener VALIDITY-Sektion)`;
}

function buildUserMessage(ctx: ParagraphValidityCtx): string {
	const argBlocks = ctx.args.map((a) => {
		const premiseLines = a.premises
			.map((p, i) => {
				const tag = p.type === 'carried' && p.from_paragraph
					? `carried §${p.from_paragraph}`
					: p.type;
				return `  P${i + 1} [${tag}]: ${p.text}`;
			})
			.join('\n');
		return `${a.arg_local_id}
claim: ${a.claim}
premises:
${premiseLines || '  (keine)'}`;
	}).join('\n\n');

	return `[ABSATZ-KONTEXT — nur als Anker, NICHT zu beurteilen]
"${ctx.paragraphText}"

[ARGUMENTE DIESES ABSATZES]
${argBlocks}

Beurteile JEDES Argument nach dem Charity-Prinzip. Eine VALIDITY-Sektion pro Argument.`;
}

// ── Parser ────────────────────────────────────────────────────────

const VALIDITY_HEADER = /^\s*(?:#{1,3}\s+)?VALIDITY\s+(A\d+)\s*$/i;
const VALID_FORM = new Set(['deductive', 'inductive', 'abductive']);
const VALID_FALLACY = new Set<string>(FALLACY_WHITELIST as readonly string[]);

interface ParseResult {
	byArgLocalId: Map<string, ValidityAssessment>;
	warnings: string[];
}

function parseValidityProse(rawText: string, knownArgLocalIds: Set<string>): ParseResult {
	const warnings: string[] = [];
	const byArgLocalId = new Map<string, ValidityAssessment>();
	const lines = rawText.split(/\r?\n/);

	type Section = { id: string; body: string[] };
	const sections: Section[] = [];
	let cur: Section | null = null;
	for (const line of lines) {
		const m = line.match(VALIDITY_HEADER);
		if (m) {
			if (cur) sections.push(cur);
			cur = { id: m[1].toUpperCase(), body: [] };
		} else if (cur) {
			cur.body.push(line);
		}
	}
	if (cur) sections.push(cur);

	for (const sec of sections) {
		if (!knownArgLocalIds.has(sec.id)) {
			warnings.push(`VALIDITY ${sec.id} references unknown argument — skipped`);
			continue;
		}
		const fields = parseFields(sec.body);
		const carriesRaw = (fields.carries ?? '').toLowerCase().trim();
		const rationale = fields.rationale ?? '';
		if (rationale.length === 0) {
			warnings.push(`VALIDITY ${sec.id} missing rationale — skipped`);
			continue;
		}

		const carries = carriesRaw === 'yes' || carriesRaw === 'true';
		if (carries) {
			const formRaw = (fields.form ?? fields.inference_form ?? '').toLowerCase().trim();
			if (!VALID_FORM.has(formRaw)) {
				warnings.push(`VALIDITY ${sec.id} carries=yes but form="${formRaw}" invalid — skipped`);
				continue;
			}
			byArgLocalId.set(sec.id, {
				carries: true,
				inference_form: formRaw as 'deductive' | 'inductive' | 'abductive',
				rationale,
			});
		} else {
			const fallacyRaw = (fields.fallacy ?? '').toLowerCase().trim();
			const target = (fields.target ?? fields.target_premise ?? '').trim();
			if (!VALID_FALLACY.has(fallacyRaw)) {
				warnings.push(`VALIDITY ${sec.id} carries=no but fallacy="${fallacyRaw}" not in whitelist — skipped`);
				continue;
			}
			if (target.length === 0) {
				warnings.push(`VALIDITY ${sec.id} carries=no but no target premise — skipped`);
				continue;
			}
			const formRaw = (fields.form ?? fields.inference_form ?? '').toLowerCase().trim();
			const inference_form = VALID_FORM.has(formRaw)
				? (formRaw as 'deductive' | 'inductive' | 'abductive')
				: null;
			byArgLocalId.set(sec.id, {
				carries: false,
				inference_form,
				rationale,
				fallacy: {
					type: fallacyRaw as FallacyType,
					target_premise: target,
					explanation: rationale,
				},
			});
		}
	}

	return { byArgLocalId, warnings };
}

function parseFields(body: string[]): Record<string, string> {
	const fields: Record<string, string> = {};
	let curKey: string | null = null;
	for (const line of body) {
		const m = line.match(/^\s*([a-zA-Z_]+)\s*:\s*(.*)$/);
		if (m) {
			curKey = m[1].toLowerCase();
			fields[curKey] = m[2];
		} else if (curKey !== null && line.trim().length > 0) {
			fields[curKey] = (fields[curKey] + '\n' + line).trim();
		}
	}
	for (const k of Object.keys(fields)) fields[k] = fields[k].trim();
	return fields;
}

// ── Storage ───────────────────────────────────────────────────────

async function storeValidity(
	assessmentsByArgId: Map<string, { dbId: string; assessment: ValidityAssessment }>
): Promise<void> {
	if (assessmentsByArgId.size === 0) return;
	await transaction(async (client) => {
		for (const { dbId, assessment } of assessmentsByArgId.values()) {
			// Sanity-validate against schema before persistence (defence in depth).
			const ok = ValidityAssessmentSchema.safeParse(assessment);
			if (!ok.success) {
				console.warn(`     skipping invalid assessment for ${dbId}: ${ok.error.message.slice(0, 200)}`);
				continue;
			}
			await client.query(
				`UPDATE argument_nodes SET validity_assessment = $1 WHERE id = $2`,
				[JSON.stringify(assessment), dbId]
			);
		}
	});
}

// ── Public orchestration ──────────────────────────────────────────

export interface ArgumentValidityRun {
	skipped: boolean;
	updatedCount: number;
	tokens: {
		input: number;
		output: number;
		cacheCreation: number;
		cacheRead: number;
		total: number;
	} | null;
	model: string | null;
	provider: string | null;
}

export async function runArgumentValidityPass(
	_caseId: string,
	paragraphId: string,
	opts: { modelOverride?: { provider: Provider; model: string }; maxTokens?: number } = {}
): Promise<ArgumentValidityRun> {
	const ctx = await loadValidityContext(paragraphId);
	if (!ctx) {
		return { skipped: true, updatedCount: 0, tokens: null, model: null, provider: null };
	}

	if (ctx.args.length === 0) {
		// Reiner Scaffolding-¶ — nichts zu beurteilen.
		return { skipped: true, updatedCount: 0, tokens: null, model: null, provider: null };
	}

	const pendingArgs = ctx.args.filter((a) => a.validity_assessment == null);
	if (pendingArgs.length === 0) {
		// Alle bereits beurteilt — skip.
		return { skipped: true, updatedCount: 0, tokens: null, model: null, provider: null };
	}

	const system = buildSystemPrompt();
	const user = buildUserMessage(ctx);

	const response = await chat({
		cacheableSystemPrefix: system,
		messages: [{ role: 'user', content: user }],
		// Pro Argument ~150-300 Tokens Output (rationale + Felder). 4000 deckt
		// auch ¶ mit 8+ Argumenten komfortabel ab.
		maxTokens: opts.maxTokens ?? 4000,
		modelOverride: opts.modelOverride,
	});

	const knownIds = new Set(ctx.args.map((a) => a.arg_local_id));
	const { byArgLocalId, warnings } = parseValidityProse(response.text, knownIds);

	if (warnings.length > 0) {
		console.warn(`     validity-parser warnings (${warnings.length}): ${warnings.slice(0, 3).join(' | ')}${warnings.length > 3 ? ' ...' : ''}`);
	}

	if (byArgLocalId.size === 0) {
		const dumpPath = `/tmp/argument-validity-failure-${paragraphId}.txt`;
		const fs = await import('node:fs/promises');
		await fs.writeFile(
			dumpPath,
			`paragraph_id: ${paragraphId}\noutput_tokens: ${response.outputTokens}\n` +
			`parser warnings (${warnings.length}):\n${warnings.map((w) => '  - ' + w).join('\n')}\n\n` +
			`--- RAW RESPONSE ---\n${response.text}\n`,
			'utf8'
		);
		throw new Error(`Argument-validity prose-parse produced no usable output (${warnings.length} warnings, dumped to ${dumpPath})`);
	}

	// Map arg_local_id → DB-Row für UPDATE
	const argByLocalId = new Map(ctx.args.map((a) => [a.arg_local_id, a]));
	const toStore = new Map<string, { dbId: string; assessment: ValidityAssessment }>();
	for (const [argLocalId, assessment] of byArgLocalId.entries()) {
		const arg = argByLocalId.get(argLocalId);
		if (!arg) continue;
		// Nur überschreiben, wenn noch kein assessment gesetzt — verhindert
		// stille Re-Schreibungen bei einem Re-Run, der nur einzelne neue Args
		// erfassen soll. Re-Run mit force: NULL-out vorher per UPDATE.
		if (arg.validity_assessment != null) continue;
		toStore.set(argLocalId, { dbId: arg.id, assessment });
	}

	await storeValidity(toStore);

	return {
		skipped: false,
		updatedCount: toStore.size,
		tokens: {
			input: response.inputTokens,
			output: response.outputTokens,
			cacheCreation: response.cacheCreationTokens,
			cacheRead: response.cacheReadTokens,
			total: response.tokensUsed,
		},
		model: response.model,
		provider: response.provider,
	};
}
