// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Chapter-collapse pass — H2-Aggregations-Linie (synthetisch).
//
// Counterpart zu chapter-collapse.ts auf der H2-Linie. Synthetisiert das
// kontextualisierende Memo eines Hauptkapitels — kumulativ-hermeneutisch
// statt graph-extraktiv.
//
// Input je nach adaptivem Aggregations-Level (geteilt mit H1, persistiert
// auf heading_classifications.aggregation_subchapter_level):
//
//   - Level 1 (flach): Kette der `reflektierend/paragraph`-Memos der
//     Kapitel-Absätze (kein vorgeschalteter Subkap-Pass auf der H2-Linie).
//
//   - Level 2 oder 3: `kontextualisierend/subchapter/synthetic`-Memos der
//     Subkapitel-Synthesen, die der H2-Section-Collapse zuvor erzeugt hat.
//     Bei Level 3 wird die L2-Numerierung als strukturelle Gruppierung im
//     Prompt mit-präsentiert (analog zu chapter-collapse.ts: kein Zwischen-
//     Synthese-Pass, L2-Architektur über Numerierungs-Hinweise sichtbar).
//
// Output-Schema (dual-purpose, analog zur H1-Linie):
//   {
//     synthese:           hermeneutische Synthese (vier Pflichtbestandteile),
//     verlaufswiedergabe: gutachten-fertige Wiedergabe des Kapitelverlaufs
//                         (expositorisch, third-person, neutral),
//     auffaelligkeiten:   per-Subkap- / per-Absatz-Beobachtungen
//   }
//
// Vokabular-Trennung von H1: `verlaufswiedergabe` (statt H1's
// `argumentationswiedergabe`) — H2 berichtet hermeneutische Bewegungs-
// trajektorien, nicht Argumentations-Strukturen.
//
// Storage: Tag `[kontextualisierend/chapter/synthetic]`, scope_level='chapter'.
// Idempotent: skipt, wenn ein chapter-synthetic-Memo für diese L1 existiert.
// Re-run: DELETE über naming-id, kaskadiert auf memo_content + appearances.
//
// Linien-rein: precedingChapterMemos und subchapterMemos werden ausschliesslich
// mit `/synthetic`-Tag gefiltert. Eine H1-Graph-Memo am gleichen Heading wird
// hier nicht eingelesen — beide Linien sind exklusiv pro Run.

import { z } from 'zod';
import type { Provider } from '../client.js';
import { query, queryOne, transaction } from '../../db/index.js';
import { RepairCallExhaustedError } from '../json-extract.js';
import { runProseCallWithRepair, describeProseFormat, type SectionSpec } from '../prose-extract.js';
import {
	loadChapterUnits,
	chooseSubchapterLevel,
	getPersistedSubchapterLevel,
	persistSubchapterLevel,
	type ChapterUnit,
	type ResolvedHeading,
} from './heading-hierarchy.js';

// ── Output schema + prose section spec ────────────────────────────

const AuffaelligkeitSchema = z.object({
	scope: z.string().min(1),
	observation: z.string().min(1),
});

const ChapterCollapseSyntheticResultSchema = z.object({
	synthese: z.string().min(1),
	verlaufswiedergabe: z.string().min(1),
	auffaelligkeiten: z.array(AuffaelligkeitSchema).default([]),
});

export type ChapterCollapseSyntheticResult = z.infer<typeof ChapterCollapseSyntheticResultSchema>;

const CHAPTER_COLLAPSE_SYNTHETIC_SPEC: SectionSpec = {
	singletons: {
		SYNTHESE: 'multiline',
		VERLAUFSWIEDERGABE: 'multiline',
	},
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

interface SubchapterMemoInput {
	headingId: string;
	numbering: string | null;
	level: number;
	label: string;
	memoText: string;
	auffaelligkeiten: { scope: string; observation: string }[];
}

interface ParagraphReflektierend {
	paragraphId: string;
	positionInChapter: number;
	enclosingSubchapterLabel: string | null;
	reflektierend: string;
}

interface ChapterContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	brief: BriefMeta;

	chapter: ChapterUnit;
	chapterPosition: number;
	totalChapters: number;
	chapterLabelOutline: string[];
	aggregationLevel: 1 | 2 | 3;

	mode: 'paragraphs' | 'subchapter-memos';

	paragraphReflektierends: ParagraphReflektierend[] | null;
	subchapterMemos: SubchapterMemoInput[] | null;

	precedingChapterMemos: { label: string; synthese: string }[];
}

// ── Loader ────────────────────────────────────────────────────────

async function loadChapterContext(
	caseId: string,
	l1HeadingId: string
): Promise<ChapterContext> {
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
	const chapterIdx = chapters.findIndex((c) => c.l1.headingId === l1HeadingId);
	if (chapterIdx === -1) {
		throw new Error(
			`L1 heading ${l1HeadingId} not found in resolved chapter outline of document ` +
				`${caseRow.central_document_id} (must be confirmed-outline + level=1 + non-excluded)`
		);
	}
	const chapter = chapters[chapterIdx];

	const allParagraphs = (
		await query<{ id: string; charStart: number }>(
			`SELECT id, char_start AS "charStart" FROM document_elements
			 WHERE document_id = $1 AND element_type = 'paragraph' AND section_kind = 'main'
			 ORDER BY char_start`,
			[caseRow.central_document_id]
		)
	).rows;

	let level = await getPersistedSubchapterLevel(l1HeadingId);
	if (level === null) {
		level = chooseSubchapterLevel(chapter, allParagraphs);
		await persistSubchapterLevel(l1HeadingId, caseRow.central_document_id, level as 1 | 2 | 3);
	}
	const aggregationLevel = level as 1 | 2 | 3;

	const chapterLabelOutline = chapters.map((c, i) =>
		i === chapterIdx
			? `- ${c.l1.numbering ?? '?'} ${c.l1.text}           ← AKTUELL HIER (Hauptkapitel-Synthese synthetisch)`
			: `- ${c.l1.numbering ?? '?'} ${c.l1.text}`
	);

	// Linien-rein: Chapter-Vorgänger ausschließlich aus der H2-Linie laden.
	const precedingHeadingIds = chapters.slice(0, chapterIdx).map((c) => c.l1.headingId);
	const precedingChapterMemos =
		precedingHeadingIds.length === 0
			? []
			: (
					await query<{ label: string; content: string }>(
						`SELECT n.inscription AS label, mc.content
				 FROM memo_content mc
				 JOIN namings n ON n.id = mc.naming_id
				 WHERE mc.scope_element_id = ANY($1::uuid[])
				   AND mc.scope_level = 'chapter'
				   AND n.inscription LIKE '[kontextualisierend/chapter/synthetic]%'
				   AND n.deleted_at IS NULL
				 ORDER BY n.created_at`,
						[precedingHeadingIds]
					)
				).rows.map((r) => ({
					label: r.label.replace(/^\[kontextualisierend\/chapter\/synthetic\]\s*/, '').trim(),
					synthese: r.content,
				}));

	let mode: ChapterContext['mode'];
	let paragraphReflektierends: ParagraphReflektierend[] | null = null;
	let subchapterMemos: SubchapterMemoInput[] | null = null;

	if (aggregationLevel === 1) {
		mode = 'paragraphs';
		paragraphReflektierends = await loadParagraphReflektierends(chapter);
		if (paragraphReflektierends.length === 0) {
			throw new Error(
				`Chapter "${chapter.l1.text}" has aggregation_subchapter_level=1 but ` +
					`no reflektierend paragraph-memos exist. Run paragraph_synthetic on its paragraphs first.`
			);
		}
		const missing = paragraphReflektierends.filter((p) => !p.reflektierend);
		if (missing.length > 0) {
			throw new Error(
				`Chapter "${chapter.l1.text}" — ${missing.length} paragraph(s) missing reflektierend memo. ` +
					`Run paragraph_synthetic on them first.`
			);
		}
	} else {
		mode = 'subchapter-memos';
		subchapterMemos = await loadSubchapterMemosAtLevel(chapter, aggregationLevel);
		if (subchapterMemos.length === 0) {
			throw new Error(
				`Chapter "${chapter.l1.text}" has aggregation_subchapter_level=${aggregationLevel} ` +
					`but no subchapter-synthetic memos exist at that level. Run section_collapse_synthetic on the L${aggregationLevel} subchapters first.`
			);
		}
	}

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
		chapter,
		chapterPosition: chapterIdx + 1,
		totalChapters: chapters.length,
		chapterLabelOutline,
		aggregationLevel,
		mode,
		paragraphReflektierends,
		subchapterMemos,
		precedingChapterMemos,
	};
}

async function loadParagraphReflektierends(
	chapter: ChapterUnit
): Promise<ParagraphReflektierend[]> {
	if (chapter.paragraphIds.length === 0) {
		throw new Error(`Chapter "${chapter.l1.text}" has no paragraphs`);
	}

	const positionByPid = new Map<string, number>();
	chapter.paragraphIds.forEach((id, i) => positionByPid.set(id, i + 1));

	const subHeadings = chapter.innerHeadings.filter((h) => h.level >= 2);

	// Linien-Trennung: nur Forward-`[reflektierend]%`-Memos einlesen, nicht
	// `[reflektierend-retrograde]%`. Filter via EXISTS in der JOIN-ON-Klausel,
	// damit die LEFT JOIN-Semantik (eine Zeile pro Absatz) auch bei vorhandenem
	// Retrograde-Pendant erhalten bleibt.
	const paragraphRows = (
		await query<{ id: string; char_start: number; reflektierend: string | null }>(
			`SELECT de.id, de.char_start, mc.content AS reflektierend
			 FROM document_elements de
			 LEFT JOIN memo_content mc ON mc.scope_element_id = de.id
			   AND mc.memo_type = 'reflektierend' AND mc.scope_level = 'paragraph'
			   AND EXISTS (
			     SELECT 1 FROM namings n_fwd
			     WHERE n_fwd.id = mc.naming_id
			       AND n_fwd.inscription LIKE '[reflektierend]%'
			       AND n_fwd.deleted_at IS NULL
			   )
			 WHERE de.id = ANY($1::uuid[])
			 ORDER BY de.char_start`,
			[chapter.paragraphIds]
		)
	).rows;

	const enclosingByPid = new Map<string, string | null>();
	for (const p of paragraphRows) {
		let enclosing: ResolvedHeading | null = null;
		for (const h of subHeadings) {
			if (h.charStart > p.char_start) break;
			const nextSibling = subHeadings.find(
				(h2) => h2.charStart > h.charStart && h2.level <= h.level
			);
			const endChar = nextSibling ? nextSibling.charStart : chapter.endChar;
			if (p.char_start < endChar) enclosing = h;
		}
		enclosingByPid.set(
			p.id,
			enclosing ? `${enclosing.numbering ?? '?'} ${enclosing.text}` : null
		);
	}

	return paragraphRows.map((p) => ({
		paragraphId: p.id,
		positionInChapter: positionByPid.get(p.id)!,
		enclosingSubchapterLabel: enclosingByPid.get(p.id) ?? null,
		reflektierend: p.reflektierend ?? '',
	}));
}

async function loadSubchapterMemosAtLevel(
	chapter: ChapterUnit,
	level: 2 | 3
): Promise<SubchapterMemoInput[]> {
	const headingsAtLevel = chapter.innerHeadings.filter((h) => h.level === level);
	if (headingsAtLevel.length === 0) return [];

	const ids = headingsAtLevel.map((h) => h.headingId);
	const memoRows = (
		await query<{
			heading_id: string;
			content: string;
			properties: { auffaelligkeiten?: { scope: string; observation: string }[] } | null;
		}>(
			`SELECT mc.scope_element_id AS heading_id, mc.content, a.properties
			 FROM memo_content mc
			 JOIN namings n ON n.id = mc.naming_id
			 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
			 WHERE mc.scope_element_id = ANY($1::uuid[])
			   AND mc.scope_level = 'subchapter'
			   AND n.inscription LIKE '[kontextualisierend/subchapter/synthetic]%'
			   AND n.deleted_at IS NULL`,
			[ids]
		)
	).rows;

	const memoByHeading = new Map<string, (typeof memoRows)[number]>();
	for (const m of memoRows) memoByHeading.set(m.heading_id, m);

	const result: SubchapterMemoInput[] = [];
	for (const h of headingsAtLevel) {
		const memo = memoByHeading.get(h.headingId);
		if (!memo) continue;
		result.push({
			headingId: h.headingId,
			numbering: h.numbering,
			level: h.level,
			label: h.text,
			memoText: memo.content,
			auffaelligkeiten: memo.properties?.auffaelligkeiten ?? [],
		});
	}
	return result;
}

// ── Prompt assembly ───────────────────────────────────────────────
//
// Vier Pflichtbestandteile auf Hauptkapitel-Ebene (hermeneutische Diktion):
//   (a) Hermeneutische Bewegung über Subkapitel/Absätze hinweg
//   (b) Kernbewegung-Identifikation (mit Subkap- oder ¶-Refs)
//   (c) Werk-Architektur-Verortung
//   (d) Hermeneutische Tragfähigkeit
//
// Jeder Pflichtbestandteil hat eine explizite opt-out-Klausel
// (Slop-Hallzinationsdruck strukturell abgefangen).
//
// Verlaufswiedergabe: gutachten-fertige Wiedergabe des Kapitelverlaufs
// (User-Anforderung 2026-04-30 für H1, übertragen auf H2: doppeltes
// Lesen+Aufschreiben fürs Prüfungsamt sparen). Sachlich-darstellend,
// third-person, neutral — keine analytische Diktion.
//
// Datenstruktur-Hinweise innerhalb der Pflichtbestandteile sind
// mode-conditional: L1 (reflective chain pro ¶) und L2/L3 (Subkap-
// Memos) tragen verschiedene Bewegungs-Spuren.

function buildSystemPrompt(ctx: ChapterContext): string {
	const outlineLines = ctx.chapterLabelOutline.join('\n');
	const preceding =
		ctx.precedingChapterMemos.length === 0
			? '(Dies ist das erste Hauptkapitel — keine vorausgegangenen Hauptkapitel-Synthesen auf der synthetischen Linie.)'
			: ctx.precedingChapterMemos.map((m) => `## ${m.label}\n${m.synthese}`).join('\n\n');

	const inputDescription =
		ctx.mode === 'paragraphs'
			? `Dein Input für diesen Pass ist die **Kette der reflektierenden Memos** der Absätze dieses Hauptkapitels — das Kapitel ist flach gegliedert, es gibt keine vorgeschalteten Subkapitel-Synthesen. Du synthetisierst direkt aus der reflective chain auf Hauptkapitel-Ebene. Jeder dieser Memos wurde mit voll geladenem Vorlauf-Kontext verfasst (vorhergehende Absätze, abgeschlossene Subkapitel-Synthesen davor, Outline-Position) — die chain trägt die kumulative Synthese-Substanz, die hier verdichtet wird.`
			: ctx.aggregationLevel === 2
				? `Dein Input für diesen Pass sind die **Subkapitel-Memos** der L2-Untergliederungen dieses Hauptkapitels — vorgeschaltete H2-Synthese-Pässe haben pro L2-Subkapitel bereits ein Memo erzeugt (Synthese + Auffälligkeiten). Du fasst diese zu einer Hauptkapitel-Synthese zusammen.`
				: `Dein Input für diesen Pass sind die **Subkapitel-Memos der L3-Subkapitel** dieses Hauptkapitels (vorgeschaltete H2-Synthese-Pässe haben pro L3-Subkapitel bereits ein Memo erzeugt). Die L2-Mittelgliederung wird **nicht** durch eigene Memos repräsentiert, sondern durch die Numerierung der L3-Subkapitel: Subkapitel mit gemeinsamem L2-Präfix (z.B. "1.2.1", "1.2.2", "1.2.3" gehören zu L2 "1.2") gruppieren sich. Achte auf diese Gliederung als Architektur-Hinweis, ohne sie als eigene Synthese-Ebene zu behandeln.`;

	const movementHint =
		ctx.mode === 'paragraphs'
			? 'Wiederaufnahmen, Begriffs-Switches und Bewegungs-Übergänge zwischen den reflektierenden Memos sind die Hinweise auf die Kapitel-Architektur.'
			: 'Wiederaufnahmen, Bezugnahmen und durchlaufende hermeneutische Bewegungen über die Subkapitel-Memos hinweg sind die Hinweise auf die Kapitel-Architektur.';

	const coreMovementHint =
		ctx.mode === 'paragraphs'
			? 'Hinweis: ein Absatz, der einen markierten Modus-Wechsel des Kapitels trägt (z.B. von Phänomen-Exposition zu Begriffs-Setzung, von Forschungsstand-Aufnahme zu Eigenposition) oder dessen reflektierende Lesart in der Folge wieder aufgegriffen wird, ist strukturell besonders tragend.'
			: 'Hinweis: ein Subkapitel, dessen Synthese in den nachfolgenden Subkapitel-Memos häufig wiederaufgegriffen wird oder das eine deutliche Wende des hermeneutischen Verlaufs markiert, ist strukturell besonders tragend.';

	const refScopeHint =
		ctx.mode === 'paragraphs'
			? '§<Position> oder §<Position>→§<Position>'
			: 'Subkapitel-Numerierung (z.B. 1.2 oder 1.2.3) oder Subkap-Übergang (1.2→1.3)';

	return `[PERSONA]
${ctx.brief.persona}

[KONTEXT DIESES PASSES — HAUPTKAPITEL-SYNTHESE (synthetisch)]
Du synthetisierst das **kontextualisierende Memo eines Hauptkapitels** auf der hermeneutisch-synthetischen Linie.

${inputDescription}

Aufgabe in drei Teilen:

1. **Synthese** (6–10 Sätze, in argumentativer/hermeneutischer Diktion). Vier *Pflichtbestandteile* — fehlt einer, ist die Synthese unvollständig:

   a. **Hermeneutische Bewegung** — welche Lese-/Argumentations-Bewegung vollzieht das Hauptkapitel im Ganzen? Welche Bewegungsfigur liegt der Anordnung der Subkapitel/Absätze zugrunde — Phänomen-Exposition, Begriffsklärung, Forschungsstand-Aufnahme, Position-Setzung, Spannung-Aufbau, Übergang von Deskription zu Diagnose? ${movementHint} Die *Bewegungsfigur* benennen, nicht den Inhalt nacherzählen.

   b. **Kernbewegung-Identifikation** — falls das Kapitel eine identifizierbare Kernbewegung trägt (oft ein Pivot-Subkapitel oder Pivot-Absatz, an dem das Kapitel von einem hermeneutischen Modus in einen anderen kippt, oder eine Schwelle, an der das Werk-Argument wirklich vorangetrieben wird), benenne sie explizit ("die hermeneutische Kernbewegung des Kapitels ist X") mit Referenz (${refScopeHint}). Wenn das Kapitel keine identifizierbare Kernbewegung hat, sondern parallel-additiv mehrere Subkapitel/Absätze nebeneinander stellt: das ebenso klar diagnostizieren statt eine Bewegung zu konstruieren. ${coreMovementHint}

   c. **Werk-Architektur-Verortung** — welches Hauptkapitel steht *davor* (siehe Outline + bisherige Hauptkapitel-Memos oben), welches *danach*? Welche strukturelle Brückenfunktion erfüllt dieses Hauptkapitel zwischen den beiden — was nimmt es vom Vorgänger auf, was bereitet es für den Nachfolger vor? Beim ersten oder letzten Hauptkapitel entfällt die jeweilige Bezugsrichtung. Wenn keine Brückenfunktion erkennbar ist (das Kapitel steht thematisch isoliert), das ebenso diagnostizieren statt eine Brücke zu konstruieren.

   d. **Hermeneutische Tragfähigkeit** — beurteile (i) den Anspruch des Hauptkapitels im Werk-Ganzen: was beansprucht es zu leisten — ein Konzept zu klären, eine Position zu beziehen, einen Forschungsstand zu konsolidieren, einen Übergang zu vollziehen, eine Eigenleistung zu vollbringen? — und (ii) die Tragfähigkeit der hermeneutischen Konstruktion über die Subkapitel/Absätze hinweg für diesen Anspruch: trägt die Stützung den Kapitel-Anspruch, ist sie unter- oder überdimensioniert? Wenn Anspruch und Stützung gleich proportioniert sind, das ebenso klar diagnostizieren.

   **Diktion:** evaluativ-hermeneutisch ("die Kernbewegung des Hauptkapitels ist X", "das Kapitel verfehlt eine eigenständige Klärung von Y"). NICHT inhaltlich-darstellend ("im Kapitel wird Y gesagt") — Letzteres gehört in die Verlaufswiedergabe. Wenn ein Pflichtbestandteil substantiell nicht zutrifft (siehe opt-out-Klauseln), das diagnostizieren statt zu fabrizieren.

2. **Verlaufswiedergabe** (1–3 Absätze, expositorische Diktion). Eine **gutachten-fertige Reproduktion** dessen, was das Hauptkapitel inhaltlich behauptet und in welcher Reihenfolge entfaltet — geeignet zur direkten oder leicht editierten Übernahme in einen Gutachten-Text ans Prüfungsamt.

   **Diktion:** sachlich-darstellend, third-person über das Werk ("Das Kapitel entfaltet die These, dass… Dazu wird zunächst… anschließend… abschließend…"). KEINE Bewertung, KEINE Spannungsdiagnose, KEIN hermeneutik-analytisches Vokabular ("Kernbewegung", "Pflichtbestandteil", "Bewegungsfigur"). Reine Wiedergabe in einer Form, die ein:e Gutachter:in unverändert oder mit minimalen Anpassungen ins eigene Gutachten übernehmen würde.

   Diese Wiedergabe darf länger sein als die Synthese — sie soll vollständig genug sein, dass ein:e Lesende, der/die das Hauptkapitel nicht selbst gelesen hat, weiß, was inhaltlich darin behauptet und in welcher Reihenfolge es entfaltet wird.

3. **Auffälligkeiten** (Liste, kann leer sein): Beobachtungen zur hermeneutischen Qualität auf Kapitel-Ebene, die in Synthese und Wiedergabe nicht hineingehören, aber für die Begutachtung relevant sind. Beispiele: "Das L2-Subkapitel 1.2 (Globalitäts-Theorie) wird im Folge-L2 1.3 nirgends explizit angeschlossen — eine theorie-praxis-Brücke wird vorausgesetzt, aber nicht expliziert." oder "Sequenz §3-§5: konsequente schrittweise Klärung; das Kapitel arbeitet hermeneutisch sauber von Phänomen zu Theorie." Halte dich an Auffälligkeiten, die aus den Subkap-Memos (L2/L3) bzw. der reflective chain (L1) erkennbar sind.

[KRITERIEN ALS LESEFOLIE]
${ctx.brief.criteria}

[WERK]
Titel: ${ctx.documentTitle}
Werktyp: ${ctx.brief.work_type}
Position dieses Hauptkapitels: ${ctx.chapterPosition} von ${ctx.totalChapters}.

Outline (Hauptkapitel, sequentiell):
${outlineLines}

[BISHERIGE HAUPTKAPITEL-MEMOS (vorausgegangene Hauptkapitel, synthetisch)]
${preceding}

[OUTPUT-FORMAT]
${describeProseFormat(CHAPTER_COLLAPSE_SYNTHETIC_SPEC)}

SYNTHESE — 6–10 Sätze, hermeneutisch-bewegungsorientierte Diktion, vier Pflichtbestandteile.

VERLAUFSWIEDERGABE — 1–3 Absätze, expositorisch, neutral, gutachten-fertig.

AUFFAELLIGKEITEN (pro Eintrag):
- scope: ${refScopeHint} oder freitextliche kapitelweite Bemerkung
- observation: Eine Beobachtung zur hermeneutischen Qualität dieser Einheit

Wenn nichts qualitätsmäßig hervorzuheben ist: lasse alle AUFFAELLIGKEITEN-Einträge weg. Schreibe keine Allerwelts-Beobachtungen — nur, was bei Begutachtung wirklich relevant wäre.`;
}

function buildUserMessage(ctx: ChapterContext): string {
	if (ctx.mode === 'subchapter-memos') {
		const memos = ctx.subchapterMemos!;
		let block: string;
		if (ctx.aggregationLevel === 3) {
			const byL2 = new Map<string, typeof memos>();
			for (const m of memos) {
				const l2Key = m.numbering
					? m.numbering.split('.').slice(0, 2).join('.')
					: '(ohne Numerierung)';
				const arr = byL2.get(l2Key) ?? [];
				arr.push(m);
				byL2.set(l2Key, arr);
			}
			const groups: string[] = [];
			for (const [l2Key, l2Memos] of byL2) {
				groups.push(
					`### L2-Gruppe ${l2Key}\n` +
						l2Memos.map((m) => formatSubchapterMemoBlock(m)).join('\n\n')
				);
			}
			block = groups.join('\n\n');
		} else {
			block = memos.map((m) => formatSubchapterMemoBlock(m)).join('\n\n');
		}
		return `Hauptkapitel: "${ctx.chapter.l1.numbering ?? '?'} ${ctx.chapter.l1.text}"
Aggregations-Ebene: L${ctx.aggregationLevel} (${memos.length} Subkapitel-Memos als Input)

[SUBKAPITEL-MEMOS (synthetisch, Input für die Hauptkapitel-Synthese)]

${block}

Synthetisiere jetzt das kontextualisierende Hauptkapitel-Memo (Synthese + Verlaufswiedergabe + Auffälligkeiten) ausschließlich aus diesen Subkapitel-Memos.`;
	}

	const paragraphs = ctx.paragraphReflektierends!;
	const block = paragraphs.map((p) => formatParagraphBlock(p)).join('\n\n');
	return `Hauptkapitel: "${ctx.chapter.l1.numbering ?? '?'} ${ctx.chapter.l1.text}"
Aggregations-Ebene: L1 (flach gegliedert; direkt aus reflective chain synthetisieren)
Anzahl Absätze: ${paragraphs.length}

[KETTE DER REFLEKTIERENDEN MEMOS]

${block}

Synthetisiere jetzt das kontextualisierende Hauptkapitel-Memo (Synthese + Verlaufswiedergabe + Auffälligkeiten) ausschließlich aus dieser reflective chain.`;
}

function formatSubchapterMemoBlock(m: SubchapterMemoInput): string {
	const num = m.numbering ?? '(ohne Numerierung)';
	const auff =
		m.auffaelligkeiten.length === 0
			? ''
			: '\n\n  Auffälligkeiten dieses Subkapitels:\n' +
				m.auffaelligkeiten.map((a) => `    [${a.scope}] ${a.observation}`).join('\n');
	return `## Subkapitel ${num} "${m.label}"\n\n${m.memoText}${auff}`;
}

function formatParagraphBlock(p: ParagraphReflektierend): string {
	const enclosing = p.enclosingSubchapterLabel ? ` (innerhalb: ${p.enclosingSubchapterLabel})` : '';
	return `## §${p.positionInChapter}${enclosing}\n${p.reflektierend}`;
}

// ── Storage ───────────────────────────────────────────────────────

async function storeChapterSyntheticMemo(
	ctx: ChapterContext,
	result: ChapterCollapseSyntheticResult,
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

		const numLabel = ctx.chapter.l1.numbering ?? '?';
		const label = `[kontextualisierend/chapter/synthetic] ${numLabel} ${ctx.chapter.l1.text}`;
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
					aggregation_level: ctx.aggregationLevel,
					input_mode: ctx.mode,
					verlaufswiedergabe: result.verlaufswiedergabe,
					auffaelligkeiten: result.auffaelligkeiten,
				}),
			]
		);

		await client.query(
			`INSERT INTO memo_content
			   (naming_id, content, format, status, memo_type, scope_element_id, scope_level)
			 VALUES ($1, $2, 'text', 'active', 'kontextualisierend', $3, 'chapter')`,
			[memoId, result.synthese, ctx.chapter.l1.headingId]
		);

		return { memoId };
	});
}

// ── Public orchestration ──────────────────────────────────────────

export interface ChapterCollapseSyntheticRun {
	skipped: boolean;
	existingMemoId: string | null;
	result: ChapterCollapseSyntheticResult | null;
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
	aggregationLevel: 1 | 2 | 3 | null;
	inputMode: 'paragraphs' | 'subchapter-memos' | null;
	inputCount: number | null;
}

export async function runChapterCollapseSynthetic(
	caseId: string,
	l1HeadingId: string,
	userId: string,
	opts: { modelOverride?: { provider: Provider; model: string }; maxTokens?: number } = {}
): Promise<ChapterCollapseSyntheticRun> {
	const existingMemo = await queryOne<{ id: string }>(
		`SELECT n.id
		 FROM namings n
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kontextualisierend/chapter/synthetic]%'
		   AND mc.scope_element_id = $1
		   AND mc.scope_level = 'chapter'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[l1HeadingId]
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
			aggregationLevel: null,
			inputMode: null,
			inputCount: null,
		};
	}

	const ctx = await loadChapterContext(caseId, l1HeadingId);

	const system = buildSystemPrompt(ctx);
	const user = buildUserMessage(ctx);

	let repairResult;
	try {
		repairResult = await runProseCallWithRepair({
			system,
			cacheSystem: true,
			user,
			spec: CHAPTER_COLLAPSE_SYNTHETIC_SPEC,
			schema: ChapterCollapseSyntheticResultSchema,
			label: 'chapter-collapse-synthetic',
			// 6000: parallel zu chapter-collapse.ts; verlaufswiedergabe kann
			// 1-3 substantielle Absätze umfassen.
			maxTokens: opts.maxTokens ?? 6000,
			modelOverride: opts.modelOverride,
			caseId,
		});
	} catch (err) {
		if (err instanceof RepairCallExhaustedError) {
			const dumpPath = `/tmp/chapter-collapse-synthetic-failure-${l1HeadingId}.txt`;
			const fs = await import('node:fs/promises');
			await fs.writeFile(
				dumpPath,
				`l1_heading_id: ${l1HeadingId}\nattempts: ${err.attempts}\nlast_stage: ${err.lastStage}\nlast_error: ${err.lastError}\n\n--- STAGES PER ATTEMPT ---\n${err.stagesPerAttempt.map((s, i) => `attempt ${i}: ${s.join(' -> ')}`).join('\n')}\n\n--- LAST RAW RESPONSE ---\n${err.lastRawText}\n`,
				'utf8'
			);
			console.error(`     dumped raw response to ${dumpPath}`);
		}
		throw err;
	}

	const parsed = repairResult.value;
	const stored = await storeChapterSyntheticMemo(ctx, parsed, userId);

	const inputCount =
		ctx.mode === 'paragraphs'
			? (ctx.paragraphReflektierends?.length ?? 0)
			: (ctx.subchapterMemos?.length ?? 0);

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
		aggregationLevel: ctx.aggregationLevel,
		inputMode: ctx.mode,
		inputCount,
	};
}
