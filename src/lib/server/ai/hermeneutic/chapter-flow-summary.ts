// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Kapitelverlauf-Pass — narrativer Mittelabsatz des Gutachtens.
//
// Erzeugt eine zusammenhängende, *referierend-narrative* Darstellung der
// Argumentationsbewegung über die Kapitelfolge. Format-Vorbild ist der
// mittlere Absatz klassischer BA-Gutachten, der zwischen formaler
// Einleitung und Note-Vergabe steht: "In fünf stringent aufgebauten
// Kapiteln bietet die Arbeit zunächst… In Kap. 2… Kap. 3 stellt…
// Lobend hervorzuheben ist…  Das Fazit (Kap. 5) integriert…"
//
// Abgrenzung zum Werk-Verdikt (document-collapse.ts):
//   Werk-Verdikt:  Diagnose-Diktion. Forschungsbeitrag, Gesamtkohärenz,
//                  Niveau-Beurteilung am Werktyp. Memo-Type
//                  'kontextualisierend', Tag '[kontextualisierend/work/graph]'.
//   Kapitelverlauf: Referierende Diktion. Strukturwiedergabe der
//                   Kapitelbewegung mit eingestreuten Wertungen. Memo-Type
//                   'kapitelverlauf' (Migration 039), Tag '[kapitelverlauf/work]'.
//
// Adaptive Länge: BA ≈ 1 Absatz / 150–250 Wörter. MA ≈ 2 Absätze.
// Dissertation/Habil ≈ 3 Absätze. Werktyp wird im Prompt explizit benannt.
//
// Idempotent: skips wenn ein Kapitelverlauf-Memo für das zentrale Dokument
// existiert. Force-Flag (force: true) deletes the existing memo first; das
// ist der Pfad für UI-getriggerte Neugenerierung.

import { z } from 'zod';
import type { Provider } from '../client.js';
import { query, queryOne, transaction } from '../../db/index.js';
import { RepairCallExhaustedError } from '../json-extract.js';
import { runProseCallWithRepair, describeProseFormat, type SectionSpec } from '../prose-extract.js';
import { loadChapterUnits, type ChapterUnit } from './heading-hierarchy.js';

// ── Output schema + prose section spec ────────────────────────────

const ChapterFlowResultSchema = z.object({
	kapitelverlauf: z.string().min(1),
});

export type ChapterFlowResult = z.infer<typeof ChapterFlowResultSchema>;

const FLOW_SPEC: SectionSpec = {
	singletons: { KAPITELVERLAUF: 'multiline' },
	lists: {},
};

// ── Context ────────────────────────────────────────────────────────

interface BriefMeta {
	name: string;
	work_type: string;
	criteria: string;
	persona: string;
}

interface ChapterMemoInput {
	headingId: string;
	numbering: string | null;
	label: string;
	synthese: string;
	argumentationswiedergabe: string | null;
	auffaelligkeiten: { scope: string; observation: string }[];
}

interface FlowContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	brief: BriefMeta;

	chapters: ChapterUnit[];
	chapterMemos: ChapterMemoInput[];
	workVerdict: string | null;
}

// ── Loader ────────────────────────────────────────────────────────

async function loadFlowContext(caseId: string): Promise<FlowContext> {
	const caseRow = await queryOne<{
		project_id: string;
		central_document_id: string;
		brief_name: string;
		work_type: string;
		criteria: string;
		persona: string;
		argumentation_graph: boolean;
	}>(
		`SELECT c.project_id, c.central_document_id,
		        b.name AS brief_name, b.work_type, b.criteria, b.persona,
		        b.argumentation_graph
		 FROM cases c
		 LEFT JOIN assessment_briefs b ON b.id = c.assessment_brief_id
		 WHERE c.id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.criteria) throw new Error(`Case ${caseId} has no assessment_brief attached`);

	const docRow = await queryOne<{ inscription: string }>(
		`SELECT inscription FROM namings WHERE id = $1`,
		[caseRow.central_document_id]
	);
	if (!docRow) throw new Error(`Central document not found`);

	const chapters = await loadChapterUnits(caseRow.central_document_id);
	if (chapters.length === 0) {
		throw new Error(`No L1 chapters found for document ${caseRow.central_document_id}`);
	}

	// Hard requirement: every L1 chapter must have a chapter-graph memo,
	// kongruent zu document-collapse. Wir wollen Kapitelverlauf nur dann
	// erzeugen, wenn die analytische Hauptlinie wirklich durchgezogen ist.
	const headingIds = chapters.map((c) => c.l1.headingId);
	const memoRows = (
		await query<{
			heading_id: string;
			content: string;
			properties: {
				argumentationswiedergabe?: string;
				auffaelligkeiten?: { scope: string; observation: string }[];
			} | null;
		}>(
			`SELECT mc.scope_element_id AS heading_id, mc.content, a.properties
			 FROM memo_content mc
			 JOIN namings n ON n.id = mc.naming_id
			 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
			 WHERE mc.scope_element_id = ANY($1::uuid[])
			   AND mc.scope_level = 'chapter'
			   AND mc.memo_type = 'kontextualisierend'
			   AND n.inscription LIKE '[kontextualisierend/chapter/graph]%'
			   AND n.deleted_at IS NULL`,
			[headingIds]
		)
	).rows;

	const memoByHeading = new Map<string, (typeof memoRows)[number]>();
	for (const m of memoRows) memoByHeading.set(m.heading_id, m);

	const missing = chapters.filter((c) => !memoByHeading.has(c.l1.headingId));
	if (missing.length > 0) {
		throw new Error(
			`Cannot run runChapterFlowSummary: ${missing.length} of ${chapters.length} ` +
				`Hauptkapitel have no chapter-graph memo yet. Run the analytical pipeline first: ` +
				missing.map((c) => `"${c.l1.numbering ?? '?'} ${c.l1.text}"`).join(', ')
		);
	}

	const chapterMemos: ChapterMemoInput[] = chapters.map((c) => {
		const m = memoByHeading.get(c.l1.headingId)!;
		return {
			headingId: c.l1.headingId,
			numbering: c.l1.numbering,
			label: c.l1.text,
			synthese: m.content,
			argumentationswiedergabe: m.properties?.argumentationswiedergabe ?? null,
			auffaelligkeiten: m.properties?.auffaelligkeiten ?? [],
		};
	});

	// Werk-Verdikt laden — als Diktion-Anker. Optional: wenn nicht vorhanden,
	// erzeugt der Pass den Kapitelverlauf trotzdem (er hängt nicht hart vom
	// Werk-Verdikt ab, profitiert aber von dessen Niveau-Diagnose als Tonfall-
	// Kalibrierung).
	const verdictRow = await queryOne<{ content: string }>(
		`SELECT mc.content
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kontextualisierend/work/graph]%'
		   AND mc.scope_level = 'work'
		   AND mc.memo_type = 'kontextualisierend'
		   AND a.properties->>'document_id' = $1
		   AND n.deleted_at IS NULL
		 ORDER BY n.created_at DESC
		 LIMIT 1`,
		[caseRow.central_document_id]
	);

	return {
		caseId,
		projectId: caseRow.project_id,
		centralDocumentId: caseRow.central_document_id,
		documentTitle: docRow.inscription,
		brief: {
			name: caseRow.brief_name,
			work_type: caseRow.work_type,
			criteria: caseRow.criteria,
			persona: caseRow.persona,
		},
		chapters,
		chapterMemos,
		workVerdict: verdictRow?.content ?? null,
	};
}

// ── Adaptive Längen-Vorgabe nach Werktyp ───────────────────────────
//
// Werte aus Beobachtung der Beispielgutachten-Sammlung BA Pädagogik (FAU).
// BA-Mittelabsätze: ~150–250 Wörter, gelegentlich ein zweiter Absatz für
// kritische Anmerkungen. MA-Arbeiten haben in der Sammlung mehr Volumen,
// Diss/Habil entsprechend. Wir lassen Spielraum (Range) statt fixer Worte.

function lengthGuidance(workType: string): { paragraphs: string; words: string } {
	const wt = workType.toLowerCase();
	if (wt.includes('habil')) return { paragraphs: '3 Absätze', words: 'ca. 400–600 Wörter' };
	if (wt.includes('disserta') || wt.includes('promotion'))
		return { paragraphs: '2–3 Absätze', words: 'ca. 350–500 Wörter' };
	if (wt.includes('master') || wt === 'ma' || wt.includes('magister'))
		return { paragraphs: '2 Absätze', words: 'ca. 250–400 Wörter' };
	if (wt.includes('hausarbeit'))
		return { paragraphs: '1 Absatz', words: 'ca. 100–200 Wörter' };
	// BA / Bachelor / Default
	return { paragraphs: '1 Absatz', words: 'ca. 150–250 Wörter' };
}

// ── Prompt assembly ───────────────────────────────────────────────

function buildSystemPrompt(ctx: FlowContext): string {
	const outlineLines = ctx.chapters
		.map((c) => `- ${c.l1.numbering ?? '?'} ${c.l1.text}`)
		.join('\n');

	const len = lengthGuidance(ctx.brief.work_type);

	return `[PERSONA]
${ctx.brief.persona}

[KONTEXT DIESES PASSES — KAPITELVERLAUF-DARSTELLUNG]
Du schreibst die *zusammenfassende Darstellung des Kapitelverlaufs* für ein Gutachten — den narrativ-referierenden Absatz, der durch die Kapitelfolge geht und die Argumentationsbewegung des Werks nachzeichnet.

Format-Vorbild: der mittlere Absatz klassischer Begutachtungstexte, der zwischen formaler Einleitung und Note-Vergabe steht. Diktion ist *referierend-narrativ* (nicht diagnostisch), mit eingestreuten qualitativen Wertungen ("lobend hervorzuheben ist…", "etwas zu kurz fällt…", "besonders interessant…"), wo die Hauptkapitel-Synthesen oder das Werk-Verdikt das hergeben.

Konkret zu liefern:
* **Eröffnungssatz**: Anzahl Hauptkapitel + Strukturqualität ("in N stringent aufgebauten Kapiteln…", "in N sinnvoll aufeinander aufbauenden Kapiteln…", oder schärfer wenn die Synthesen das hergeben). Optional einbettende Kurz-Charakterisierung des Werks (Thema, Forschungsfeld, Zugang).
* **Kapitelfolge in narrativer Reihenfolge**: "In Kap. 1 wird… Kap. 2 stellt… In den Kapiteln 3 und 4… Das Fazit (Kap. N)…". Du musst NICHT jedes einzelne Kapitel separat würdigen — verbinde benachbarte oder thematisch zusammenhängende Kapitel zu einer Bewegung, wo das die Linie deutlicher macht.
* **Eingestreute Wertungen**, die aus den Hauptkapitel-Synthesen / Auffälligkeiten klar belegt sind. Nicht: pauschales Lob oder pauschale Kritik. Wenn die Synthese eines Kapitels eine Stärke oder Schwäche markant nennt, gehört das in den Verlaufstext.
* **Schlusssatz**: was das Fazit-Kapitel leistet (kohärente Zusammenführung / pointiertes Resümee / etwas dünn).

**Wichtig — Diktion**:
- Referierend-narrativ, nicht evaluativ-argumentativ. Das Werk-Verdikt diagnostiziert — der Kapitelverlauf führt durch.
- Keine Aufzählungspunkte, kein Markdown. Geschriebener Fließtext.
- Keine Anführungszeichen um Kapitel-Titel, ausser zur Markierung von Eigenbegriffen.
- Wo Kapitel-Numerierung vorhanden ist: "Kap. 2", "Kap. 3" (nicht "das zweite Kapitel" — das wirkt umständlich).

**Länge**: ${len.paragraphs}, ${len.words}. Werktyp ist **${ctx.brief.work_type}** — kalibriere die Länge entsprechend.

[BEISPIELE — STILVORBILDER (echte BA-Mittelabsätze)]

Beispiel 1 (kurze Variante, sehr gut):
"In fünf stringent aufgebauten Kapiteln bietet die Arbeit zunächst eine Situierung und Entfaltung ihrer Fragestellung. Sie diskutiert in Kap. 2 die Bedeutung von Identität für die Phase des Jugendalters. Hier ist lobend hervorzuheben, dass die Autorin auch komplexere Aspekte des Themas — hier: Zeitlichkeit, u.a. unter Bezug auf philosophische AutorInnen wie Ricoeur ausgeführt — aufgreift. Dies leitet zugleich über in das anschließende biographietheoretische Kapitel. Unter Rückgriff auf die transformatorische Bildungstheorie bezieht die Autorin an dieser Stelle — zunächst überraschender Weise — Thematiken der Medienbildung ein. Diese bringt sie — neben der klassischen Biographiearbeit — auch in das Kernkapitel 4 ein. Die Arbeit schließt mit einem Resümee unter der Perspektive transitorischer Bildungsprozesse."

Beispiel 2 (mit kritischen Einschüben, befriedigend):
"Das Phänomen 'Mobbing' wird in Kap. 2 unter Einbezug von rechtlichen, empirischen und gesundheitsbezogenen Aspekten beschrieben. Eher kurz kommt dabei das Phänomen selbst, das zwar begriffshistorisch hergeleitet wird — das gelingt und ist schön —, bleibt aber systematisch folgenlos, dessen Logik jedoch nicht hinreichend unter Heranziehung einschlägiger, auch konkurrierender Modelle diskutiert wird. Damit besteht eine ausgesprochen dünne theoretische Basis, was sich auf den Rest der Arbeit dahingehend auswirkt, dass die zahlreichend aufgewählten Maßnahmen und Aspekte nicht theoretisch fundiert differenziert und kritisch gegeneinander abgewogen werden können."

[KRITERIEN ALS LESEFOLIE]
${ctx.brief.criteria}

[WERK]
Titel: ${ctx.documentTitle}
Werktyp: ${ctx.brief.work_type}
Hauptkapitel: ${ctx.chapters.length}

Outline:
${outlineLines}

[OUTPUT-FORMAT]
${describeProseFormat(FLOW_SPEC)}

Längen-Kalibrierung des Sektion-Inhalts: ${len.paragraphs}, ${len.words}. Referierend-narrative Diktion, mit eingestreuten Wertungen wo aus den Hauptkapitel-Synthesen klar belegt.`;
}

function buildUserMessage(ctx: FlowContext): string {
	// Wir geben für jedes Hauptkapitel: synthese + ggf. argumentationswiedergabe
	// + Auffälligkeiten. Argumentationswiedergabe ist hier (anders als beim
	// Werk-Verdikt) explizit erwünscht — sie liefert die fertigen
	// Verlaufsbeschreibungen pro Kapitel, die der Pass in den narrativen Bogen
	// einschmilzt.
	const blocks = ctx.chapterMemos
		.map((m) => {
			const num = m.numbering ?? '(ohne Numerierung)';
			const wieder = m.argumentationswiedergabe
				? `\n\n  Argumentationswiedergabe (Kapitel-Pass):\n  ${m.argumentationswiedergabe.replace(/\n/g, '\n  ')}`
				: '';
			const auff =
				m.auffaelligkeiten.length === 0
					? ''
					: '\n\n  Auffälligkeiten dieses Hauptkapitels:\n' +
					  m.auffaelligkeiten.map((a) => `    [${a.scope}] ${a.observation}`).join('\n');
			return `## Hauptkapitel ${num} "${m.label}"\n\nSynthese:\n${m.synthese}${wieder}${auff}`;
		})
		.join('\n\n');

	const verdictBlock = ctx.workVerdict
		? `\n\n[WERK-VERDIKT — Diktion-Anker (nicht im Output wiederholen)]\n${ctx.workVerdict}\n`
		: '';

	return `Werk: "${ctx.documentTitle}"
Werktyp: ${ctx.brief.work_type}
Hauptkapitel-Memos als Input: ${ctx.chapterMemos.length}
${verdictBlock}
[HAUPTKAPITEL-MEMOS]

${blocks}

Schreibe jetzt den narrativ-referierenden Kapitelverlauf-Absatz, kalibriert in Länge und Detailtiefe am Werktyp.`;
}

// ── Storage ───────────────────────────────────────────────────────

async function storeFlowMemo(
	ctx: FlowContext,
	result: ChapterFlowResult,
	userId: string
): Promise<{ memoId: string }> {
	return transaction(async (client) => {
		let perspective = (
			await client.query(
				`SELECT n.id FROM namings n
				 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
				 WHERE n.project_id = $1 AND a.mode = 'perspective'
				   AND a.properties->>'role' = 'memo-system'
				   AND n.deleted_at IS NULL
				 LIMIT 1`,
				[ctx.projectId]
			)
		).rows[0];
		if (!perspective) {
			const r = await client.query(
				`INSERT INTO namings (project_id, inscription, created_by)
				 VALUES ($1, 'Memo System', $2) RETURNING id`,
				[ctx.projectId, userId]
			);
			await client.query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
				 VALUES ($1, $1, 'perspective', '{"role": "memo-system"}')`,
				[r.rows[0].id]
			);
			perspective = r.rows[0];
		}

		const label = `[kapitelverlauf/work] ${ctx.documentTitle}`;
		const memo = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[ctx.projectId, label, userId]
		);
		const memoId = memo.rows[0].id;

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', $3)`,
			[
				memoId,
				perspective.id,
				JSON.stringify({
					source: 'chapter_flow_summary',
					document_id: ctx.centralDocumentId,
					work_type: ctx.brief.work_type,
					chapter_count: ctx.chapterMemos.length,
				}),
			]
		);

		await client.query(
			`INSERT INTO memo_content
			   (naming_id, content, format, status, memo_type, scope_element_id, scope_level)
			 VALUES ($1, $2, 'text', 'active', 'kapitelverlauf', NULL, 'work')`,
			[memoId, result.kapitelverlauf]
		);

		return { memoId };
	});
}

async function deleteExistingFlowMemo(centralDocumentId: string): Promise<void> {
	// Soft-delete via namings.deleted_at — kongruent zur Grundkonvention im Repo.
	// Cascade auf memo_content + appearances ist nicht aktiviert, aber die
	// Filter LIKE '[kapitelverlauf/work]…' + deleted_at IS NULL beim Laden
	// hält das alte Memo aus den Queries draußen.
	await query(
		`UPDATE namings
		 SET deleted_at = NOW()
		 WHERE id IN (
		   SELECT n.id
		   FROM namings n
		   JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		   JOIN memo_content mc ON mc.naming_id = n.id
		   WHERE n.inscription LIKE '[kapitelverlauf/work]%'
		     AND mc.scope_level = 'work'
		     AND mc.memo_type = 'kapitelverlauf'
		     AND a.properties->>'document_id' = $1
		     AND n.deleted_at IS NULL
		 )`,
		[centralDocumentId]
	);
}

// ── Public orchestration ──────────────────────────────────────────

export interface ChapterFlowSummaryRun {
	skipped: boolean;
	existingMemoId: string | null;
	result: ChapterFlowResult | null;
	stored: { memoId: string } | null;
	tokens: {
		input: number;
		output: number;
		cacheCreation: number;
		cacheRead: number;
		total: number;
	} | null;
	model: string | null;
	provider: string | null;
	chapterCount: number | null;
}

export async function runChapterFlowSummary(
	caseId: string,
	userId: string,
	opts: {
		modelOverride?: { provider: Provider; model: string };
		force?: boolean;
	} = {}
): Promise<ChapterFlowSummaryRun> {
	const caseRow = await queryOne<{ central_document_id: string }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);

	const existingMemo = await queryOne<{ id: string }>(
		`SELECT n.id
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kapitelverlauf/work]%'
		   AND mc.scope_level = 'work'
		   AND mc.memo_type = 'kapitelverlauf'
		   AND a.properties->>'document_id' = $1
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[caseRow.central_document_id]
	);

	if (existingMemo && !opts.force) {
		return {
			skipped: true,
			existingMemoId: existingMemo.id,
			result: null,
			stored: null,
			tokens: null,
			model: null,
			provider: null,
			chapterCount: null,
		};
	}

	if (existingMemo && opts.force) {
		await deleteExistingFlowMemo(caseRow.central_document_id);
	}

	const ctx = await loadFlowContext(caseId);

	const system = buildSystemPrompt(ctx);
	const user = buildUserMessage(ctx);

	let repairResult;
	try {
		repairResult = await runProseCallWithRepair({
			system,
			cacheSystem: true,
			user,
			spec: FLOW_SPEC,
			schema: ChapterFlowResultSchema,
			label: 'chapter-flow-summary',
			// Output ist ein knapper Fließtext (1–3 Absätze); 2000 Tokens
			// reichen auch für Habil-Variante mit ~600 Wörtern.
			maxTokens: 2000,
			modelOverride: opts.modelOverride,
			caseId,
		});
	} catch (err) {
		if (err instanceof RepairCallExhaustedError) {
			const dumpPath = `/tmp/chapter-flow-failure-${caseRow.central_document_id}.txt`;
			const fs = await import('node:fs/promises');
			await fs.writeFile(
				dumpPath,
				`document_id: ${caseRow.central_document_id}\nattempts: ${err.attempts}\nlast_stage: ${err.lastStage}\nlast_error: ${err.lastError}\n\n--- STAGES PER ATTEMPT ---\n${err.stagesPerAttempt.map((s, i) => `attempt ${i}: ${s.join(' -> ')}`).join('\n')}\n\n--- LAST RAW RESPONSE ---\n${err.lastRawText}\n`,
				'utf8'
			);
			console.error(`     dumped raw response to ${dumpPath}`);
		}
		throw err;
	}

	const parsed = repairResult.value;
	const stored = await storeFlowMemo(ctx, parsed, userId);

	return {
		skipped: false,
		existingMemoId: null,
		result: parsed,
		stored,
		tokens: {
			input: repairResult.tokens.input,
			output: repairResult.tokens.output,
			cacheCreation: repairResult.tokens.cacheCreation,
			cacheRead: repairResult.tokens.cacheRead,
			total: repairResult.tokens.total,
		},
		model: repairResult.model,
		provider: repairResult.provider,
		chapterCount: ctx.chapterMemos.length,
	};
}
