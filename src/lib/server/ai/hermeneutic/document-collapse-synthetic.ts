// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Werk-collapse pass — H2-Aggregations-Linie (synthetisch).
//
// Counterpart zu document-collapse.ts auf der H2-Linie. Synthetisiert die
// abschliessende Begutachtungsdiagnose auf Werk-Ebene durch Aggregation
// aller `[kontextualisierend/chapter/synthetic]`-Memos — kumulativ-
// hermeneutisch statt graph-extraktiv.
//
// Output-Schema (single-purpose, parallel zu H1's document-collapse):
//   {
//     synthese:           Werk-Synthese (drei Pflichtbestandteile),
//     auffaelligkeiten:   werkweite Beobachtungen (über die Hauptkapitel)
//   }
//
// Eine Werk-`verlaufswiedergabe` ist hier *nicht* ausgegeben: die
// Hauptkapitel-`verlaufswiedergaben` der vorgeschalteten H2-Chapter-Pässe
// dienen bereits dem Gutachten-fertig-Bedarf. Eine Werk-Ebene wäre hier
// eine andere Textgattung (Gesamteinschätzung) — wenn sich aus erstem
// H2-Werk-Lauf zeigt, dass sie substantiell fehlt, kann sie nachgezogen
// werden. (Designentscheidung parallel zu H1.)
//
// Storage: Tag `[kontextualisierend/work/synthetic]`, scope_level='work',
// scope_element_id=NULL (Werk-Ebene ohne document_element-Anker; Link
// zum Dokument über appearances.properties.document_id).
//
// Idempotent: skipt, wenn ein work-synthetic-Memo für das zentrale
// Dokument des Cases existiert.
//
// Linien-rein: chapterMemos werden ausschliesslich mit `/synthetic`-Tag
// gefiltert. H1-Graph-Memos am gleichen Heading werden hier nicht
// eingelesen.

import { z } from 'zod';
import type { Provider } from '../client.js';
import { query, queryOne, transaction } from '../../db/index.js';
import { RepairCallExhaustedError } from '../json-extract.js';
import { runProseCallWithRepair, describeProseFormat, type SectionSpec } from '../prose-extract.js';
import { loadChapterUnits, type ChapterUnit } from './heading-hierarchy.js';

// ── Output schema + prose section spec ────────────────────────────

const AuffaelligkeitSchema = z.object({
	scope: z.string().min(1),
	observation: z.string().min(1),
});

const DocumentCollapseSyntheticResultSchema = z.object({
	synthese: z.string().min(1),
	auffaelligkeiten: z.array(AuffaelligkeitSchema).default([]),
});

export type DocumentCollapseSyntheticResult = z.infer<typeof DocumentCollapseSyntheticResultSchema>;

const DOCUMENT_COLLAPSE_SYNTHETIC_SPEC: SectionSpec = {
	singletons: { SYNTHESE: 'multiline' },
	lists: {
		AUFFAELLIGKEITEN: {
			fields: { scope: 'oneline', observation: 'multiline' },
		},
	},
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
	verlaufswiedergabe: string | null;
	auffaelligkeiten: { scope: string; observation: string }[];
}

interface DocumentContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	brief: BriefMeta;

	chapters: ChapterUnit[];
	chapterMemos: ChapterMemoInput[];
}

// ── Loader ────────────────────────────────────────────────────────

async function loadDocumentContext(caseId: string): Promise<DocumentContext> {
	const caseRow = await queryOne<{
		project_id: string;
		central_document_id: string;
		brief_name: string;
		work_type: string;
		criteria: string;
		persona: string;
	}>(
		`SELECT c.project_id, c.central_document_id,
		        b.name AS brief_name, b.work_type, b.criteria, b.persona
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

	// Linien-rein: alle Hauptkapitel-Synthetic-Memos laden. Hard requirement:
	// jedes L1-Kapitel braucht eines — sonst wäre die Werk-Synthese partial.
	// Der Orchestrator garantiert die Reihenfolge (chapter_collapse_synthetic
	// vor document_collapse_synthetic) über PHASE_ORDER_SYNTHETIC.
	const headingIds = chapters.map((c) => c.l1.headingId);
	const memoRows = (
		await query<{
			heading_id: string;
			inscription: string;
			content: string;
			properties: {
				verlaufswiedergabe?: string;
				auffaelligkeiten?: { scope: string; observation: string }[];
			} | null;
		}>(
			`SELECT mc.scope_element_id AS heading_id, n.inscription, mc.content, a.properties
			 FROM memo_content mc
			 JOIN namings n ON n.id = mc.naming_id
			 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
			 WHERE mc.scope_element_id = ANY($1::uuid[])
			   AND mc.scope_level = 'chapter'
			   AND n.inscription LIKE '[kontextualisierend/chapter/synthetic]%'
			   AND n.deleted_at IS NULL`,
			[headingIds]
		)
	).rows;

	const memoByHeading = new Map<string, (typeof memoRows)[number]>();
	for (const m of memoRows) memoByHeading.set(m.heading_id, m);

	const missing = chapters.filter((c) => !memoByHeading.has(c.l1.headingId));
	if (missing.length > 0) {
		throw new Error(
			`Cannot run runDocumentCollapseSynthetic: ${missing.length} of ${chapters.length} ` +
				`Hauptkapitel have no chapter-synthetic memo yet. Run runChapterCollapseSynthetic on these first: ` +
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
			verlaufswiedergabe: m.properties?.verlaufswiedergabe ?? null,
			auffaelligkeiten: m.properties?.auffaelligkeiten ?? [],
		};
	});

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
	};
}

// ── Prompt assembly ───────────────────────────────────────────────
//
// Werk-Pflichtbestandteile (parallel zu H1, hermeneutisch reformuliert):
// drei, nicht vier. Forschungsbeitrag-Diagnose, Gesamtkohärenz und Werk-
// Architektur, Niveau-Beurteilung mit Werktyp-Akzent. Eine vierte
// "werkweite Spannungsdiagnose" wäre mechanische Hochskalierung — wenn
// sich aus erstem Lauf zeigt, dass werkweite Spannungs-Befunde
// substantiell fehlen, ergänzen wir sie nachträglich.

function buildSystemPrompt(ctx: DocumentContext): string {
	const outlineLines = ctx.chapters
		.map((c) => `- ${c.l1.numbering ?? '?'} ${c.l1.text}`)
		.join('\n');

	return `[PERSONA]
${ctx.brief.persona}

[KONTEXT DIESES PASSES — WERK-SYNTHESE (abschließende Begutachtungsdiagnose, synthetisch)]
Du synthetisierst das **kontextualisierende Memo des gesamten Werks** auf der hermeneutisch-synthetischen Linie.

Dein Input für diesen Pass sind die **Hauptkapitel-Memos** des Werks — vorgeschaltete H2-Synthese-Pässe haben pro Hauptkapitel bereits eine hermeneutische Synthese, eine gutachten-fertige Verlaufswiedergabe und Auffälligkeiten erzeugt. Du fasst diese zu einer Werk-Synthese zusammen.

Dies ist die **abschließende Begutachtungsdiagnose** auf Werk-Ebene — die Position, von der aus die Gesamtbeurteilung des Werks formuliert wird.

Aufgabe in zwei Teilen:

1. **Synthese** (8–14 Sätze, in argumentativer/hermeneutischer Diktion). Drei *Pflichtbestandteile* — fehlt einer, ist die Synthese unvollständig:

   a. **Forschungsbeitrag-Diagnose** — was leistet das Werk *als Ganzes* in seinem Feld? Wo verläuft die Eigenleistungs-Linie über alle Hauptkapitel hinweg? Was wäre mit einem Satz die zentrale hermeneutische Bewegung oder Behauptung, die das Werk seinem Forschungsfeld hinzufügt? (Bei klar rezeptiv-applizierenden Arbeiten ohne genuine Eigenleistung: das ebenso klar diagnostizieren — nicht überhöhen.)

   b. **Gesamtkohärenz und Werk-Architektur** — wie verhalten sich die Hauptkapitel zueinander, gibt es eine durchgehende hermeneutische Bewegung über das Werk hinweg, oder sind die Kapitel parallel-additiv ohne Querverbindungen? Wo liegen werkarchitektonische Brüche (z.B. Theoriekapitel ohne Anschluss an die empirischen Kapitel, Forschungsfrage ohne Wiederaufnahme im Schluss)? Beobachte die Werk-Bewegungs-Linie, nicht nur die formale Gliederung.

   c. **Niveau-Beurteilung mit Werktyp-Akzent** — gemessen an den im Feld üblichen Erwartungen an den Werktyp **${ctx.brief.work_type}**: ist das Werk niveau-angemessen, unterhalb oder oberhalb der Latte? Konkret: eine Hausarbeit BA wird nicht an Habilitations-Maßstäben gemessen; eine Dissertation hat eine andere Eigenleistungs-Latte als eine MA-Arbeit. Kalibriere deine Niveau-Diagnose explizit am Werktyp und nenne den Maßstab beim Namen.

   **Diktion:** evaluativ-gutachterlich. Kein Tabu auf scharfen Diagnosen wenn sie aus den Hauptkapitel-Memos klar belegt sind — die Werk-Synthese ist die Position, von der aus die spätere Gesamteinschätzung im Gutachten geschrieben wird.

2. **Auffälligkeiten** (Liste, kann leer sein): Beobachtungen zur hermeneutischen Qualität auf Werk-Ebene, die in der Synthese nicht hineingehören, aber für die Begutachtung relevant sind. Beispiele: "Die Forschungsfrage des Werks (Hauptkapitel 1) wird in den abschließenden Hauptkapiteln nicht explizit zurückgenommen — eine werkarchitektonische Lücke." oder "Hauptkapitel 3 und 5 tragen sich überschneidende hermeneutische Bewegungen, ohne dass das Werk diese Doppelung adressiert." Halte dich an Auffälligkeiten, die aus der Hauptkapitel-Memo-Struktur erkennbar sind.

[KRITERIEN ALS LESEFOLIE]
${ctx.brief.criteria}

[WERK]
Titel: ${ctx.documentTitle}
Werktyp: ${ctx.brief.work_type}
Hauptkapitel: ${ctx.chapters.length}

Outline:
${outlineLines}

[OUTPUT-FORMAT]
${describeProseFormat(DOCUMENT_COLLAPSE_SYNTHETIC_SPEC)}

Inhalt der SYNTHESE-Sektion: 8–14 Sätze, hermeneutisch-bewegungsorientierte Diktion, drei Pflichtbestandteile, Niveau-Beurteilung explizit am Werktyp '${ctx.brief.work_type}' kalibriert.

Inhalt jeder AUFFAELLIGKEITEN-N-Sektion:
- scope: Hauptkapitel-Numerierung (z.B. "Kap. 3", "Kap. 1.2") oder freitextlich "werkweit"
- observation: Eine Beobachtung zur hermeneutischen Qualität auf Werk-Ebene

Wenn nichts qualitätsmäßig hervorzuheben ist: lasse alle AUFFAELLIGKEITEN-Sektionen weg.`;
}

function buildUserMessage(ctx: DocumentContext): string {
	const blocks = ctx.chapterMemos
		.map((m) => {
			const num = m.numbering ?? '(ohne Numerierung)';
			const auff =
				m.auffaelligkeiten.length === 0
					? ''
					: '\n\n  Auffälligkeiten dieses Hauptkapitels:\n' +
						m.auffaelligkeiten.map((a) => `    [${a.scope}] ${a.observation}`).join('\n');
			// Verlaufswiedergabe wird absichtlich NICHT in den Input gegeben — die
			// synthese trägt bereits den hermeneutischen Gehalt; die wiedergabe ist
			// ein paralleler Gutachten-Liefergegenstand und würde den Werk-
			// Synthese-Input bloat verursachen. Wenn sich aus späterer Validierung
			// zeigt, dass die wiedergabe für die Werk-Synthese gebraucht wird,
			// hier nachziehen. (Designentscheidung parallel zu H1.)
			return `## Hauptkapitel ${num} "${m.label}"\n\n${m.synthese}${auff}`;
		})
		.join('\n\n');

	return `Werk: "${ctx.documentTitle}"
Werktyp: ${ctx.brief.work_type}
Hauptkapitel-Memos als Input: ${ctx.chapterMemos.length}

[HAUPTKAPITEL-MEMOS (synthetisch)]

${blocks}

Synthetisiere jetzt das kontextualisierende Werk-Memo (Synthese + Auffälligkeiten) als abschließende Begutachtungsdiagnose, kalibriert am Werktyp.`;
}

// ── Storage ───────────────────────────────────────────────────────

async function storeDocumentSyntheticMemo(
	ctx: DocumentContext,
	result: DocumentCollapseSyntheticResult,
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

		const label = `[kontextualisierend/work/synthetic] ${ctx.documentTitle}`;
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
					source: 'synthetic_chain',
					document_id: ctx.centralDocumentId,
					work_type: ctx.brief.work_type,
					auffaelligkeiten: result.auffaelligkeiten,
				}),
			]
		);

		// scope_element_id ist NULL: Werk-Ebene hat keinen document_element-
		// Anker (ein "work"-Element existiert nicht in document_elements);
		// der Link zum Dokument geht über appearances.properties.document_id.
		await client.query(
			`INSERT INTO memo_content
			   (naming_id, content, format, status, memo_type, scope_element_id, scope_level)
			 VALUES ($1, $2, 'text', 'active', 'kontextualisierend', NULL, 'work')`,
			[memoId, result.synthese]
		);

		return { memoId };
	});
}

// ── Public orchestration ──────────────────────────────────────────

export interface DocumentCollapseSyntheticRun {
	skipped: boolean;
	existingMemoId: string | null;
	result: DocumentCollapseSyntheticResult | null;
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

export async function runDocumentCollapseSynthetic(
	caseId: string,
	userId: string,
	opts: { modelOverride?: { provider: Provider; model: string }; maxTokens?: number } = {}
): Promise<DocumentCollapseSyntheticRun> {
	const caseRow = await queryOne<{ central_document_id: string }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);

	// Idempotency guard: skip if a work-synthetic memo already exists for this
	// document. Link über appearances.properties.document_id (scope_element_id
	// ist NULL für Werk-Ebene-Memos).
	const existingMemo = await queryOne<{ id: string }>(
		`SELECT n.id
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kontextualisierend/work/synthetic]%'
		   AND mc.scope_level = 'work'
		   AND a.properties->>'document_id' = $1
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[caseRow.central_document_id]
	);
	if (existingMemo) {
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

	const ctx = await loadDocumentContext(caseId);

	const system = buildSystemPrompt(ctx);
	const user = buildUserMessage(ctx);

	let repairResult;
	try {
		repairResult = await runProseCallWithRepair({
			system,
			cacheSystem: true,
			user,
			spec: DOCUMENT_COLLAPSE_SYNTHETIC_SPEC,
			schema: DocumentCollapseSyntheticResultSchema,
			label: 'document-collapse-synthetic',
			// 5000: parallel zu document-collapse.ts; synthese kann 10-18
			// substantielle Sätze umfassen.
			maxTokens: opts.maxTokens ?? 5000,
			modelOverride: opts.modelOverride,
			caseId,
		});
	} catch (err) {
		if (err instanceof RepairCallExhaustedError) {
			const dumpPath = `/tmp/document-collapse-synthetic-failure-${caseRow.central_document_id}.txt`;
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
	const stored = await storeDocumentSyntheticMemo(ctx, parsed, userId);

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
