// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Subchapter-collapse pass — H2-Aggregations-Linie (synthetisch).
//
// Counterpart zu section-collapse-from-graph.ts auf der H2-Linie. Konsumiert
// die reflective chain (reflektierend/paragraph-Memos aus paragraph_synthetic)
// und synthetisiert das kontextualisierende Memo des Subkapitels — kumulativ-
// hermeneutisch statt graph-extraktiv.
//
// Output-Struktur ist strukturanalog zu section-collapse-from-graph.ts:
//   { synthese: string, auffaelligkeiten: [{ scope, observation }] }
// Diktion und Pflichtbestandteile sind hermeneutisch-bewegungsorientiert
// statt argumentations-strukturell.
//
// Storage: kontextualisierend/subchapter mit Inscription-Tag
// `[kontextualisierend/subchapter/synthetic]` — kollisionsfrei zu H1's
// `[kontextualisierend/subchapter/graph]`.

import { z } from 'zod';
import type { Provider } from '../client.js';
import { query, queryOne, transaction } from '../../db/index.js';
import { RepairCallExhaustedError } from '../json-extract.js';
import { runProseCallWithRepair, describeProseFormat, type SectionSpec } from '../prose-extract.js';
import { loadResolvedOutline } from './heading-hierarchy.js';

// ── Output schema + prose section spec ────────────────────────────

const AuffaelligkeitSchema = z.object({
	scope: z.string().min(1),
	observation: z.string().min(1),
});

const SyntheticCollapseResultSchema = z.object({
	synthese: z.string().min(1),
	auffaelligkeiten: z.array(AuffaelligkeitSchema).default([]),
});

export type SyntheticCollapseResult = z.infer<typeof SyntheticCollapseResultSchema>;

const SYNTHETIC_COLLAPSE_SPEC: SectionSpec = {
	singletons: { SYNTHESE: 'multiline' },
	lists: {
		AUFFAELLIGKEITEN: {
			fields: { scope: 'oneline', observation: 'multiline' },
		},
	},
};

// ── Context ────────────────────────────────────────────────────────

interface CollapseContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	fullText: string;
	brief: { name: string; work_type: string; criteria: string; persona: string };
	mainHeadings: string[];
	mainHeadingCount: number;
	mainParagraphCount: number;

	subchapterHeadingId: string;
	subchapterLabel: string;
	subchapterStart: number;
	subchapterEnd: number;

	paragraphs: {
		paragraphId: string;
		positionInSubchapter: number;
		reflektierendId: string | null;
		reflektierend: string | null;
	}[];

	completedKontextualisierungen: { sectionLabel: string; content: string }[];
}

// ── Loader ────────────────────────────────────────────────────────

async function loadCollapseContext(
	caseId: string,
	subchapterHeadingId: string
): Promise<CollapseContext> {
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

	const docRow = await queryOne<{ inscription: string; full_text: string }>(
		`SELECT n.inscription, dc.full_text
		 FROM namings n JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.id = $1`,
		[caseRow.central_document_id]
	);
	if (!docRow) throw new Error(`Central document not found`);

	const heading = await queryOne<{ char_start: number; char_end: number; section_kind: string | null }>(
		`SELECT char_start, char_end, section_kind FROM document_elements
		 WHERE id = $1 AND document_id = $2 AND element_type = 'heading'`,
		[subchapterHeadingId, caseRow.central_document_id]
	);
	if (!heading) throw new Error(`Subchapter heading not found: ${subchapterHeadingId}`);
	if (heading.section_kind !== 'main') {
		throw new Error(`Heading ${subchapterHeadingId} is in section_kind=${heading.section_kind}, not 'main'`);
	}

	// Subchapter-Ende: nächstes Heading auf SAME-OR-HIGHER level (kongruent zu
	// section-collapse-from-graph.ts und paragraphCountForUnit in
	// heading-hierarchy.ts). Eine L2-Synthese, der unmittelbar eine L3 folgt
	// (z.B. 2.1 → 2.1.1), würde sonst bei der L3-Position abschneiden und 0
	// Paragraphen finden.
	const outline = await loadResolvedOutline(caseRow.central_document_id);
	const headingResolved = outline.find((h) => h.headingId === subchapterHeadingId);
	if (!headingResolved) {
		throw new Error(
			`Heading ${subchapterHeadingId} not found in resolved outline (outline must be confirmed and heading not excluded)`
		);
	}
	const nextSiblingOrHigher = outline.find(
		(h) => h.charStart > headingResolved.charStart && h.level <= headingResolved.level
	);
	const subchapterEnd = nextSiblingOrHigher?.charStart ?? docRow.full_text.length;

	// Linien-Trennung: nur Forward-`[reflektierend]%`-Memos einlesen, nicht
	// `[reflektierend-retrograde]%` — der Retrograde-Pass darf den
	// Forward-Subkapitel-Synthese-Pass nicht beeinflussen. Filter via EXISTS
	// in der JOIN-ON-Klausel, damit die LEFT JOIN-Semantik (eine Zeile pro
	// Absatz) auch bei vorhandenem Retrograde-Pendant erhalten bleibt.
	const paragraphsWithMemos = (
		await query<{
			paragraph_id: string;
			char_start: number;
			reflektierend_id: string | null;
			reflektierend: string | null;
		}>(
			`SELECT
			   de.id AS paragraph_id,
			   de.char_start,
			   i.naming_id AS reflektierend_id,
			   i.content AS reflektierend
			 FROM document_elements de
			 LEFT JOIN memo_content i ON i.scope_element_id = de.id
			   AND i.memo_type = 'reflektierend' AND i.scope_level = 'paragraph'
			   AND EXISTS (
			     SELECT 1 FROM namings n_fwd
			     WHERE n_fwd.id = i.naming_id
			       AND n_fwd.inscription LIKE '[reflektierend]%'
			       AND n_fwd.deleted_at IS NULL
			   )
			 WHERE de.document_id = $1
			   AND de.element_type = 'paragraph'
			   AND de.section_kind = 'main'
			   AND de.char_start >= $2 AND de.char_start < $3
			 ORDER BY de.char_start`,
			[caseRow.central_document_id, heading.char_start, subchapterEnd]
		)
	).rows;

	// Linien-rein: nur abgeschlossene H2-Subkapitel-Synthesen einlesen, nicht
	// H1-graph-Pendants. Heuristiken sind exklusiv pro Run, aber ein Werk kann
	// historisch beide Linien angesammelt haben — die H2-Synthese soll auf
	// dem H2-Vorlauf aufbauen, nicht auf der Graph-Linie.
	const completedKontextualisierungen = (
		await query<{ section_label: string; content: string }>(
			`SELECT
			   substring($1::text FROM de.char_start+1 FOR de.char_end-de.char_start) AS section_label,
			   mc.content
			 FROM memo_content mc
			 JOIN namings n ON n.id = mc.naming_id
			 JOIN document_elements de ON de.id = mc.scope_element_id
			 WHERE mc.memo_type = 'kontextualisierend'
			   AND mc.scope_level = 'subchapter'
			   AND n.inscription LIKE '[kontextualisierend/subchapter/synthetic]%'
			   AND n.deleted_at IS NULL
			   AND de.document_id = $2
			   AND de.char_start < $3
			 ORDER BY de.char_start`,
			[docRow.full_text, caseRow.central_document_id, heading.char_start]
		)
	).rows;

	const headingRows = await query<{ char_start: number; char_end: number }>(
		`SELECT char_start, char_end FROM document_elements
		 WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main'
		 ORDER BY char_start`,
		[caseRow.central_document_id]
	);
	const mainHeadings = headingRows.rows.map((r) =>
		docRow.full_text.substring(r.char_start, r.char_end).trim().slice(0, 100)
	);

	const counts = await queryOne<{ paragraphs: string; headings: string }>(
		`SELECT
		   COUNT(*) FILTER (WHERE element_type = 'paragraph') AS paragraphs,
		   COUNT(*) FILTER (WHERE element_type = 'heading')   AS headings
		 FROM document_elements
		 WHERE document_id = $1 AND section_kind = 'main'`,
		[caseRow.central_document_id]
	);

	return {
		caseId,
		projectId: caseRow.project_id,
		centralDocumentId: caseRow.central_document_id,
		documentTitle: docRow.inscription,
		fullText: docRow.full_text,
		brief: {
			name: caseRow.brief_name,
			work_type: caseRow.work_type,
			criteria: caseRow.criteria,
			persona: caseRow.persona,
		},
		mainHeadings,
		mainHeadingCount: parseInt(counts?.headings ?? '0', 10),
		mainParagraphCount: parseInt(counts?.paragraphs ?? '0', 10),
		subchapterHeadingId,
		subchapterLabel: docRow.full_text.substring(heading.char_start, heading.char_end).trim(),
		subchapterStart: heading.char_start,
		subchapterEnd,
		paragraphs: paragraphsWithMemos.map((p, i) => ({
			paragraphId: p.paragraph_id,
			positionInSubchapter: i + 1,
			reflektierendId: p.reflektierend_id,
			reflektierend: p.reflektierend,
		})),
		completedKontextualisierungen: completedKontextualisierungen.map((r) => ({
			sectionLabel: r.section_label.trim(),
			content: r.content,
		})),
	};
}

// ── Prompt assembly ───────────────────────────────────────────────

function buildSystemPrefix(ctx: CollapseContext): string {
	return `[PERSONA]
${ctx.brief.persona}

[KONTEXT DIESES PASSES — SYNTHESE AUS DER INTERPRETIVE CHAIN]
Du synthetisierst das **kontextualisierende Memo** für ein Subkapitel auf der H2-Linie: dein Input ist die Kette der reflektierenden Memos, die in der sequenziellen Per-Absatz-Lektüre dieses Subkapitels entstanden sind. Jeder dieser Memos wurde mit voll geladenem Vorlauf-Kontext verfasst (vorhergehende Absätze des Subkapitels, abgeschlossene Subkapitel-Synthesen davor, Outline-Position) — die chain trägt also schon die kumulative Synthese-Substanz, die hier verdichtet wird.

Aufgabe in zwei Teilen:

1. **Synthese** (6–10 Sätze, in argumentativer/hermeneutischer Diktion). Vier *Pflichtbestandteile* — fehlt einer, ist die Synthese unvollständig:

   a. **Hermeneutische Bewegung** — welche Lese-/Argumentations-Bewegung vollzieht das Subkapitel im Ganzen? Phänomen-Exposition, Begriffsklärung, Forschungsstand-Aufnahme, Position-Setzung, Spannung-Aufbau, Übergang von Deskription zu Diagnose? Die *Bewegungsfigur* benennen, nicht den Inhalt nacherzählen.

   b. **Kernbewegung mit ¶-Refs** — welcher *einzelne* Absatz oder Absatz-Übergang trägt das *meiste* hermeneutische Gewicht in diesem Subkapitel? Krönen, nicht nur erwähnen — eine Sektion hat in der Regel eine identifizierbare Kernbewegung (oft ein Pivot-Absatz, an dem das Subkapitel von einem Modus in einen anderen kippt, oder ein Übergang, der das Werk-Argument wirklich vorantreibt). Benenne sie explizit ("die hermeneutische Kernbewegung des Subkapitels ist X") mit ¶-Referenz (z.B. §3, §4→§5).

   c. **Werk-Architektur-Verortung** — welches Subkapitel steht *davor* (siehe Outline unten), welches *danach*? Welche strukturelle Brückenfunktion erfüllt dieses Subkapitel zwischen den beiden — was nimmt es vom Vorgänger auf, was bereitet es für den Nachfolger vor? Nicht nur Vorblick, sondern auch Rückbindung.

   d. **Hermeneutische Tragfähigkeit** — beurteile (i) den Anspruch des Subkapitels im Werk-Kontext: was beansprucht es zu leisten — ein Konzept zu klären, eine Position zu beziehen, einen Forschungsstand zu konsolidieren, einen Übergang zu vollziehen? — und (ii) die Tragfähigkeit der hermeneutischen Konstruktion für diesen Anspruch: trägt sie ihn, ist sie unter- oder überdimensioniert? Beurteilung an dem, was tatsächlich im Subkapitel vorliegt; wenn Anspruch und Stützung gleich proportioniert sind, das ebenso klar diagnostizieren.

   **Nicht** Absatz-für-Absatz nacherzählen — die *Bewegung* konstruieren.

2. **Auffälligkeiten** (Liste, kann leer sein): per-Absatz oder per-Übergang Beobachtungen zur hermeneutischen Qualität, die in der Synthese nicht hineingehören, aber für die Begutachtung wichtig sind. Beispiele:
   - "§3 vollzieht einen Begriffs-Switch (von 'Bildung' zu 'Lernen') ohne markierende Klärung — die Lesart muss in der Folgesektion entscheiden, welcher Begriff trägt."
   - "§5 baut eine Spannung zwischen Forschungsstand und Eigenposition auf, die im Subkapitel selbst nicht aufgelöst wird — Auflösung wird offenbar in nachfolgendem Subkapitel erwartet."
   - "Sequenz §2-§4: konsequente schrittweise Klärung; das Subkapitel arbeitet hermeneutisch sauber von Phänomen zu Theorie."

   Halte dich an Auffälligkeiten, die aus der reflective chain erkennbar sind (Bewegungsbrüche, ungeklärte Switches, aufgebaute aber nicht eingelöste Spannungen, prägnante Konsolidierungen). Unterlasse stilistische oder rhetorische Bewertungen.

[KRITERIEN ALS LESEFOLIE]
${ctx.brief.criteria}

[WERK]
Titel: ${ctx.documentTitle}
Werktyp: ${ctx.brief.work_type}
Umfang Hauptteil: ${ctx.mainHeadingCount} Hauptkapitel-Überschriften, ${ctx.mainParagraphCount} Hauptabsätze.

[OUTPUT-FORMAT]
${describeProseFormat(SYNTHETIC_COLLAPSE_SPEC)}

Inhalt der SYNTHESE-Sektion: 6–10 Sätze, hermeneutisch-bewegungsorientierte Diktion (welche Bewegung, welche Position, welche Spannung), keine Inhalts-Diktion (was steht da).

Inhalt jeder AUFFAELLIGKEITEN-N-Sektion:
- scope: §<Position> oder §<Position>→§<Position> oder freitextliche subkapitelweite Bemerkung
- observation: Eine Beobachtung zur hermeneutischen Qualität dieses Absatzes/Übergangs

Wenn nichts qualitätsmäßig hervorzuheben ist: lasse alle AUFFAELLIGKEITEN-Sektionen weg. Schreibe keine Allerwelts-Beobachtungen — nur, was bei Begutachtung wirklich relevant wäre.`;
}

function buildSystemSuffix(ctx: CollapseContext): string {
	const outlineLines = ctx.mainHeadings
		.map((h) => (h === ctx.subchapterLabel ? `- ${h}           ← AKTUELL HIER (Synthese-Pass synthetisch)` : `- ${h}`))
		.join('\n');

	const completed =
		ctx.completedKontextualisierungen.length === 0
			? '(Noch keine H2-Subkapitel-Synthesen abgeschlossen — dies ist die erste auf der synthetischen Linie im Werk.)'
			: ctx.completedKontextualisierungen
					.map((k) => `## "${k.sectionLabel}"\n${k.content}`)
					.join('\n\n');

	return `[OUTLINE & POSITION]
Outline (Hauptüberschriften, sequentiell):
${outlineLines}

[BISHERIGE KONTEXTUALISIERENDE MEMOS abgeschlossener Subkapitel (synthetisch)]
${completed}`;
}

function buildUserMessage(ctx: CollapseContext): string {
	const memoBlock = ctx.paragraphs
		.map((p) => {
			const i = p.reflektierend ?? '(keine reflektierende Memo)';
			return `## §${p.positionInSubchapter}\n${i}`;
		})
		.join('\n\n');

	return `Subkapitel: "${ctx.subchapterLabel}"
Anzahl Absätze: ${ctx.paragraphs.length}

[KETTE DER REFLEKTIERENDEN MEMOS]

${memoBlock}

Synthetisiere jetzt das kontextualisierende Memo (Synthese + Auffälligkeiten) für dieses Subkapitel auf Basis der reflective chain.`;
}

// ── Storage ───────────────────────────────────────────────────────

async function storeSyntheticCollapseMemo(
	ctx: CollapseContext,
	result: SyntheticCollapseResult,
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

		// Inscription-Tag distinkt von H1-graph-Variante. Beide Linien können
		// auf demselben scope_element_id koexistieren — keine UNIQUE-Constraint
		// auf memo_content.
		const label = `[kontextualisierend/subchapter/synthetic] ${ctx.subchapterLabel}`;
		const memo = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[ctx.projectId, label, userId]
		);
		const memoId = memo.rows[0].id;

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', $3)`,
			[memoId, perspective.id, JSON.stringify({ source: 'synthetic_per_paragraph_chain', auffaelligkeiten: result.auffaelligkeiten })]
		);

		await client.query(
			`INSERT INTO memo_content
			   (naming_id, content, format, status, memo_type, scope_element_id, scope_level)
			 VALUES ($1, $2, 'text', 'active', 'kontextualisierend', $3, 'subchapter')`,
			[memoId, result.synthese, ctx.subchapterHeadingId]
		);

		return { memoId };
	});
}

// ── Public orchestration ──────────────────────────────────────────

export interface SyntheticCollapseRun {
	skipped: boolean;
	existingMemoId: string | null;
	result: SyntheticCollapseResult | null;
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
	paragraphsSynthesized: number | null;
}

export async function runSectionCollapseSynthetic(
	caseId: string,
	subchapterHeadingId: string,
	userId: string,
	opts: { modelOverride?: { provider: Provider; model: string }; maxTokens?: number } = {}
): Promise<SyntheticCollapseRun> {
	const existingMemo = await queryOne<{ id: string }>(
		`SELECT n.id
		 FROM namings n
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kontextualisierend/subchapter/synthetic]%'
		   AND mc.scope_element_id = $1
		   AND mc.scope_level = 'subchapter'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[subchapterHeadingId]
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
			paragraphsSynthesized: null,
		};
	}

	const ctx = await loadCollapseContext(caseId, subchapterHeadingId);

	if (ctx.paragraphs.length === 0) {
		throw new Error(`No paragraphs in subchapter "${ctx.subchapterLabel}"`);
	}
	const missing = ctx.paragraphs.filter((p) => !p.reflektierend);
	if (missing.length > 0) {
		throw new Error(
			`Cannot collapse subchapter "${ctx.subchapterLabel}" — ${missing.length} paragraph(s) missing reflektierend memo. ` +
				`Run runParagraphPass on them first (H2 phase 'paragraph_synthetic').`
		);
	}

	const cacheableSystemPrefix = buildSystemPrefix(ctx);
	const system = buildSystemSuffix(ctx);
	const user = buildUserMessage(ctx);

	let repairResult;
	try {
		repairResult = await runProseCallWithRepair({
			cacheableSystemPrefix,
			system,
			user,
			spec: SYNTHETIC_COLLAPSE_SPEC,
			schema: SyntheticCollapseResultSchema,
			label: 'section-collapse-synthetic',
			maxTokens: opts.maxTokens ?? 4000,
			modelOverride: opts.modelOverride,
			caseId,
		});
	} catch (err) {
		if (err instanceof RepairCallExhaustedError) {
			const dumpPath = `/tmp/section-collapse-synthetic-failure-${subchapterHeadingId}.txt`;
			const fs = await import('node:fs/promises');
			await fs.writeFile(
				dumpPath,
				`subchapter_heading_id: ${subchapterHeadingId}\nattempts: ${err.attempts}\nlast_stage: ${err.lastStage}\nlast_error: ${err.lastError}\n\n--- STAGES PER ATTEMPT ---\n${err.stagesPerAttempt.map((s, i) => `attempt ${i}: ${s.join(' -> ')}`).join('\n')}\n\n--- LAST RAW RESPONSE ---\n${err.lastRawText}\n`,
				'utf8'
			);
			console.error(`     dumped raw response to ${dumpPath}`);
		}
		throw err;
	}

	const parsed = repairResult.value;
	const stored = await storeSyntheticCollapseMemo(ctx, parsed, userId);

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
		paragraphsSynthesized: ctx.paragraphs.length,
	};
}
