// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Meta-Synthese — Review-Synthese über H1+H2-Werk-Outputs.
//
// Terminales Glied im Composite-Run heuristic='meta' (User-Setzung
// 2026-05-05). Konsumiert beide Werk-Synthesen desselben Werks und
// produziert:
//
//   Teil A — Synthese-Prose in vier Schritten (strikt nur aus H1+H2-
//            Outputs inferierbar, kein Volltext-Zugriff in dieser Stufe):
//     1. positive Werkhypothese (was schreiben beide Analysen dem Werk zu)
//     2. geteilte Defizithypothese
//     3. H1↔H2-Differenz (was sieht H1 schärfer, was sieht H2 genauer)
//     4. Synthesehypothese (ausdrücklich als Hypothese markiert)
//
//   Teil B — drei Literaturbezugs-Anker für späteren Fact-Check, jeweils
//            mit Begründung, warum dieser Bezug die Interpretation
//            entscheidet. Hybrider Pre-Filter liefert Kandidaten-Pool,
//            das Modell wählt drei aus.
//
// Pre-Filter Teil B (siehe docs/architecture/04-pipeline-h1-h2.md §7.4):
//   - argument_nodes.referential_grounding ∈ {namedropping, concrete}
//     (≠ 'none', ≠ 'abstract')
//   - Zitations-Marker im paragraph-Text (regex '(Autor Jahr)')
//   - Zentralität im argument_graph (in_degree + out_degree)
// Score = Σ Indikatoren; Top-Pool wird ans LLM weitergereicht.
//
// Storage:
//   - Teil A: memo_content mit Inscription-Tag '[kontextualisierend/work/meta]',
//     scope_level='work', scope_element_id=NULL (parallel zu work/graph + work/synthetic).
//     Vier Sub-Synthesen werden zu *einem* zusammengefassten Prosa-Block
//     verkettet (mit Zwischen-Headern), damit memo_content.content das
//     vollständige Review-Memo trägt.
//   - Teil B: appearances.properties.fact_check_anchors als JSONB-Liste:
//       [{ argument_node_id, paragraph_id, rationale }, ...]
//
// Idempotent: skipt, wenn ein '[kontextualisierend/work/meta]'-Memo für
// das zentrale Dokument des Cases existiert.

import { z } from 'zod';
import type { Provider } from '../client.js';
import { query, queryOne, transaction } from '../../db/index.js';
import { RepairCallExhaustedError } from '../json-extract.js';
import { runProseCallWithRepair, describeProseFormat, type SectionSpec } from '../prose-extract.js';

// ── Output schema + prose section spec ────────────────────────────

const FactCheckAnkerSchema = z.object({
	kandidat_nr: z.string().min(1),
	rationale: z.string().min(1),
});

const MetaSynthesisResultSchema = z.object({
	positive_werkhypothese: z.string().min(1),
	defizit_hypothese: z.string().min(1),
	h1_h2_differenz: z.string().min(1),
	synthese_hypothese: z.string().min(1),
	fact_check_anker: z.array(FactCheckAnkerSchema).length(3),
});

export type MetaSynthesisResult = z.infer<typeof MetaSynthesisResultSchema>;

const META_SYNTHESIS_SPEC: SectionSpec = {
	singletons: {
		POSITIVE_WERKHYPOTHESE: 'multiline',
		DEFIZIT_HYPOTHESE: 'multiline',
		H1_H2_DIFFERENZ: 'multiline',
		SYNTHESE_HYPOTHESE: 'multiline',
	},
	lists: {
		FACT_CHECK_ANKER: {
			fields: { kandidat_nr: 'oneline', rationale: 'multiline' },
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

interface ArgumentCandidate {
	// Position in der gerankten Kandidaten-Liste, 1-basiert. Wird im Prompt
	// als Auswahl-Schlüssel exponiert (LLM liefert kandidat_nr zurück).
	rank: number;
	argumentNodeId: string;
	paragraphId: string;
	paragraphIndex: number;
	subchapterLabel: string;
	claim: string;
	premisesSummary: string;
	anchorPhrase: string;
	referentialGrounding: 'none' | 'namedropping' | 'abstract' | 'concrete';
	centrality: number;
	citationsInParagraph: number;
	rawTextSnippet: string;
}

interface MetaSynthesisContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	brief: BriefMeta;

	h1Synthese: string;
	h1Auffaelligkeiten: { scope: string; observation: string }[];
	h2Synthese: string;
	h2Auffaelligkeiten: { scope: string; observation: string }[];

	candidates: ArgumentCandidate[];
}

// ── Pre-Filter (Teil B Kandidaten) ────────────────────────────────

// Erfasst akademische Inline-Zitationen der Form "(Autor 2020)",
// "(Autor 2020, S. 45)", "(Autor et al. 2020)", "(Autor/Müller 2020)".
// Bewusst tolerant (jedes Klammerpaar mit grossbuchstabigem Anfang und
// 4-stelliger Jahreszahl) — dies ist ein statistischer Indikator,
// keine Strukturvalidierung.
const CITATION_REGEX = /\(([A-ZÄÖÜ][^()]{0,80}?\b\d{4})/g;

function countCitations(text: string): number {
	const matches = text.match(CITATION_REGEX);
	return matches ? matches.length : 0;
}

interface RawCandidateRow {
	argument_node_id: string;
	paragraph_id: string;
	paragraph_char_start: number;
	paragraph_char_end: number;
	paragraph_index: number;
	subchapter_label: string;
	claim: string;
	premises: unknown;
	anchor_phrase: string;
	referential_grounding: 'none' | 'namedropping' | 'abstract' | 'concrete' | null;
	centrality: number;
}

async function loadArgumentCandidates(
	documentId: string,
	fullText: string
): Promise<ArgumentCandidate[]> {
	// referential_grounding ∈ {namedropping, concrete} = textbasiert belegter
	// Bezug auf Literatur (≠ 'none', ≠ 'abstract'). Pro-Argument klassifiziert
	// (siehe Memory project_pipeline_grounding_is_span_blind).
	const rows = (
		await query<RawCandidateRow>(
			`WITH paragraph_index AS (
			   SELECT id, char_start, char_end,
			          ROW_NUMBER() OVER (ORDER BY char_start)::int AS pidx
			   FROM document_elements
			   WHERE document_id = $1
			     AND element_type = 'paragraph'
			     AND section_kind = 'main'
			 ),
			 nearest_heading AS (
			   SELECT p.id AS paragraph_id,
			          (SELECT h.id
			           FROM document_elements h
			           WHERE h.document_id = $1
			             AND h.element_type = 'heading'
			             AND h.section_kind = 'main'
			             AND h.char_start <= p.char_start
			           ORDER BY h.char_start DESC LIMIT 1) AS heading_id
			   FROM paragraph_index p
			 ),
			 centrality AS (
			   SELECT n.id AS node_id,
			          (SELECT COUNT(*)::int FROM argument_edges e
			           WHERE e.from_node_id = n.id OR e.to_node_id = n.id) AS deg
			   FROM argument_nodes n
			 )
			 SELECT an.id AS argument_node_id,
			        p.id AS paragraph_id,
			        p.char_start AS paragraph_char_start,
			        p.char_end AS paragraph_char_end,
			        p.pidx AS paragraph_index,
			        COALESCE(h_de.id::text, '') AS subchapter_label,
			        an.claim,
			        an.premises,
			        an.anchor_phrase,
			        an.referential_grounding,
			        c.deg AS centrality
			 FROM argument_nodes an
			 JOIN paragraph_index p ON p.id = an.paragraph_element_id
			 LEFT JOIN nearest_heading nh ON nh.paragraph_id = p.id
			 LEFT JOIN document_elements h_de ON h_de.id = nh.heading_id
			 LEFT JOIN centrality c ON c.node_id = an.id
			 WHERE p.id IS NOT NULL
			   AND an.referential_grounding IN ('namedropping', 'concrete')`,
			[documentId]
		)
	).rows;

	if (rows.length === 0) return [];

	// Subchapter-Label in lesbarer Form auflösen (Numerierung + Text).
	const headingIds = Array.from(
		new Set(rows.map((r) => r.subchapter_label).filter((v) => v.length > 0))
	);
	const headingLookup = new Map<string, string>();
	if (headingIds.length > 0) {
		const headingRows = (
			await query<{
				id: string;
				char_start: number;
				char_end: number;
			}>(
				`SELECT id, char_start, char_end
				 FROM document_elements
				 WHERE id = ANY($1::uuid[])`,
				[headingIds]
			)
		).rows;
		for (const h of headingRows) {
			const text = fullText.substring(h.char_start, h.char_end).trim().slice(0, 80);
			headingLookup.set(h.id, text);
		}
	}

	// Citation-Counts pro Absatz cachen — ein Absatz kann mehrere Argumente
	// haben.
	const citationCountByParagraph = new Map<string, number>();
	const rawTextByParagraph = new Map<string, string>();
	for (const r of rows) {
		if (!citationCountByParagraph.has(r.paragraph_id)) {
			const text = fullText.substring(r.paragraph_char_start, r.paragraph_char_end);
			citationCountByParagraph.set(r.paragraph_id, countCitations(text));
			rawTextByParagraph.set(r.paragraph_id, text);
		}
	}

	// Score = referential_grounding (concrete=2, namedropping=1)
	//       + Zitations-Marker im Absatz (1 wenn ≥ 1)
	//       + Zentralität (capped)
	type Scored = { row: RawCandidateRow; score: number };
	const scored: Scored[] = rows.map((r) => {
		const groundingScore = r.referential_grounding === 'concrete' ? 2 : 1;
		const citationScore = (citationCountByParagraph.get(r.paragraph_id) ?? 0) > 0 ? 1 : 0;
		const centralityScore = Math.min(r.centrality ?? 0, 4);
		return { row: r, score: groundingScore + citationScore + centralityScore };
	});

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		// Tie-Break: paragraph_index (frühere Stellen zuerst — strukturierte
		// Reihenfolge beim Lesen).
		return a.row.paragraph_index - b.row.paragraph_index;
	});

	// Pool-Grösse: 12 Kandidaten — agentisch wählbar, aber Prompt-Bloat
	// begrenzt. Ein Werk mit ≤ 12 Kandidaten reicht alle zur Auswahl an.
	const POOL_SIZE = 12;
	const top = scored.slice(0, POOL_SIZE);

	const summarizePremises = (premises: unknown): string => {
		if (!Array.isArray(premises) || premises.length === 0) return '(keine)';
		return premises
			.slice(0, 3)
			.map((p) => {
				const obj = p as { type?: string; text?: string };
				const type = obj.type ?? '?';
				const text = (obj.text ?? '').slice(0, 120);
				return `[${type}] ${text}`;
			})
			.join(' | ');
	};

	return top.map((s, i) => {
		const r = s.row;
		const subLabel = headingLookup.get(r.subchapter_label) ?? '(ohne Subkapitel)';
		const rawSnippet = (rawTextByParagraph.get(r.paragraph_id) ?? '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 280);
		return {
			rank: i + 1,
			argumentNodeId: r.argument_node_id,
			paragraphId: r.paragraph_id,
			paragraphIndex: r.paragraph_index,
			subchapterLabel: subLabel,
			claim: r.claim,
			premisesSummary: summarizePremises(r.premises),
			anchorPhrase: r.anchor_phrase,
			referentialGrounding: r.referential_grounding ?? 'none',
			centrality: r.centrality ?? 0,
			citationsInParagraph: citationCountByParagraph.get(r.paragraph_id) ?? 0,
			rawTextSnippet: rawSnippet,
		};
	});
}

// ── Loader ────────────────────────────────────────────────────────

async function loadMetaSynthesisContext(caseId: string): Promise<MetaSynthesisContext> {
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

	// Beide Werk-Synthesen (H1 + H2) sind harte Voraussetzung.
	type WorkMemoRow = {
		content: string;
		properties: { auffaelligkeiten?: { scope: string; observation: string }[] } | null;
	};
	const h1Memo = await queryOne<WorkMemoRow>(
		`SELECT mc.content, a.properties
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kontextualisierend/work/graph]%'
		   AND mc.scope_level = 'work'
		   AND a.properties->>'document_id' = $1
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[caseRow.central_document_id]
	);
	if (!h1Memo) {
		throw new Error(
			`Cannot run runMetaSynthesis: H1-Werk-Synthese (kontextualisierend/work/graph) fehlt — H1-Lauf erst abschliessen`
		);
	}
	const h2Memo = await queryOne<WorkMemoRow>(
		`SELECT mc.content, a.properties
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
	if (!h2Memo) {
		throw new Error(
			`Cannot run runMetaSynthesis: H2-Werk-Synthese (kontextualisierend/work/synthetic) fehlt — H2-Lauf erst abschliessen`
		);
	}

	const candidates = await loadArgumentCandidates(caseRow.central_document_id, docRow.full_text);

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
		h1Synthese: h1Memo.content,
		h1Auffaelligkeiten: h1Memo.properties?.auffaelligkeiten ?? [],
		h2Synthese: h2Memo.content,
		h2Auffaelligkeiten: h2Memo.properties?.auffaelligkeiten ?? [],
		candidates,
	};
}

// ── Prompt assembly ───────────────────────────────────────────────

function buildSystemPrompt(ctx: MetaSynthesisContext): string {
	const candidatesAvailable = ctx.candidates.length > 0;
	const candidateHelp = candidatesAvailable
		? `Du erhältst eine nummerierte Kandidatenliste (Argumente mit Literaturbezug, in einem zitationsmarkierten Absatz und/oder mit hoher argument-graph-Zentralität). Wähle aus dieser Liste **drei** Anker. Du gibst nur die Kandidaten-Nummer (z.B. "7") und deine Begründung zurück; das System löst Argument- und Absatz-IDs danach selbst auf.`
		: `Es gibt keine Kandidaten in der Pool-Liste — gib in diesem Fall trotzdem drei FACT_CHECK_ANKER-Sektionen mit kandidat_nr: 0 und einer Begründung, warum kein literaturbezogenes Argument im Werk identifizierbar war.`;

	return `[PERSONA]
${ctx.brief.persona}

[KONTEXT DIESES PASSES — META-SYNTHESE / REVIEW-SYNTHESE]
Du erhältst zwei vorgelagerte Werk-Synthesen desselben Werks, erstellt durch zwei unterschiedlich gestimmte Heuristiken:

  - **H1 (analytisch)** — argumentations-strukturell, präzise, kritisch in der Diktion.
  - **H2 (synthetisch-hermeneutisch)** — bewegungs-orientiert, würdigend, an interpretativen Linien orientiert.

Beide Synthesen wurden vorgeschaltet erzeugt; jede hat ihre eigene blinde Stelle. Deine Aufgabe in dieser Stufe ist, **strikt aus diesen beiden Outputs**, eine Review-Synthese in vier disziplinierten Schritten zu erstellen — **kein Zugriff auf den Werk-Volltext**, keine neuen inhaltlichen Befunde erfinden. Was nur am Werk selbst prüfbar wäre, gehört in spätere Stufen (Volltext-Tool-Use, separat).

Aufgabe in zwei Teilen:

**Teil A — Review-Synthese in vier Schritten (Pflichtbestandteile):**

1. **Positive Werkhypothese** — was schreiben *beide* Analysen dem Werk zu? Was ist die Schnittmenge der positiven Werk-Behauptungen über H1+H2? (Kein "Beste-aus-beiden", sondern die Konvergenz beider Lesarten.)

2. **Geteilte Defizithypothese** — wo identifizieren *beide* Analysen Schwächen, Brüche, Lücken? Wo deckt sich die kritische Lesart? (Nicht: "Schwächen, die nur H1 sieht" — das gehört in Schritt 3.)

3. **H1↔H2-Differenz** — wo widersprechen sich die beiden Analysen, oder wo sieht eine Linie etwas, das die andere übersieht oder anders gewichtet? Was sieht **H1 schärfer** (analytisch-präzisere Diagnose), was sieht **H2 genauer** (hermeneutisch-bewegungsorientierte Diagnose)? Beide Analyse-Diktionen haben blinde Stellen — diese Schritt-Sektion macht sie sichtbar.

4. **Synthesehypothese** — eine belastbare zusammenfassende Hypothese über das Werk, die Schritte 1–3 integriert. **Markiere diese ausdrücklich als Hypothese**, weil das Werk selbst nicht erneut gelesen wurde — der Status ist "auf Basis der Analysen plausibel", nicht "am Werk geprüft".

Disziplin: keine fallbezogenen Aussagen außerhalb der H1+H2-Outputs. Strikte Trennung zwischen "aus den Analysen inferierbar" und "nur am Werk prüfbar". Wo H1+H2 schweigen, schweige auch hier.

**Teil B — drei Literaturbezugs-Anker für späteren Fact-Check.**

Identifiziere drei Argumente aus dem H1-argument_graph, deren **Literaturbezug** die Werk-Interpretation entscheidet — d.h. drei Stellen, an denen ein späterer Fact-Check der zitierten Quelle die Synthesehypothese stützen oder umstoßen würde. Für jeden Anker eine kurze Begründung: **warum genau dieser Bezug die Interpretation entscheidet** (z.B. "trägt die positive Werkhypothese zu Schritt 1", "stützt die Differenzdiagnose in Schritt 3", "ist Pfeiler der Synthesehypothese in Schritt 4").

${candidateHelp}

[KRITERIEN ALS LESEFOLIE]
${ctx.brief.criteria}

[WERK]
Titel: ${ctx.documentTitle}
Werktyp: ${ctx.brief.work_type}

[OUTPUT-FORMAT]
${describeProseFormat(META_SYNTHESIS_SPEC)}

Inhalt der vier Teil-A-Sektionen (POSITIVE_WERKHYPOTHESE, DEFIZIT_HYPOTHESE, H1_H2_DIFFERENZ, SYNTHESE_HYPOTHESE): jeweils 4–8 Sätze, evaluativ-gutachterliche Diktion, Synthesehypothese-Sektion ausdrücklich als Hypothese markiert.

Inhalt jeder FACT_CHECK_ANKER-N-Sektion:
- kandidat_nr: Nummer aus der Kandidatenliste (z.B. "7")
- rationale: Begründung, warum dieser Literaturbezug die Interpretation entscheidet (auf welchen der vier Teil-A-Schritte er einzahlt)

Genau drei FACT_CHECK_ANKER-Sektionen.`;
}

function buildUserMessage(ctx: MetaSynthesisContext): string {
	const auff1 =
		ctx.h1Auffaelligkeiten.length > 0
			? '\n\nH1-Auffälligkeiten:\n' +
				ctx.h1Auffaelligkeiten.map((a) => `  [${a.scope}] ${a.observation}`).join('\n')
			: '';
	const auff2 =
		ctx.h2Auffaelligkeiten.length > 0
			? '\n\nH2-Auffälligkeiten:\n' +
				ctx.h2Auffaelligkeiten.map((a) => `  [${a.scope}] ${a.observation}`).join('\n')
			: '';

	const candidatesBlock =
		ctx.candidates.length === 0
			? '(keine Kandidaten — siehe Hinweis im System-Prompt)'
			: ctx.candidates
					.map(
						(c) =>
							`### Kandidat ${c.rank}\n` +
							`  Subkapitel: ${c.subchapterLabel}\n` +
							`  Absatz: ¶${c.paragraphIndex}\n` +
							`  Claim: ${c.claim}\n` +
							`  Premissen: ${c.premisesSummary}\n` +
							`  Anker-Phrase im Text: ${c.anchorPhrase || '(ohne)'}\n` +
							`  Grounding: ${c.referentialGrounding} | Zitations-Marker im Absatz: ${c.citationsInParagraph} | Zentralität: ${c.centrality}\n` +
							`  Absatz-Auszug: ${c.rawTextSnippet}`
					)
					.join('\n\n');

	return `Werk: "${ctx.documentTitle}"
Werktyp: ${ctx.brief.work_type}

[H1-WERK-SYNTHESE (analytisch)]
${ctx.h1Synthese}${auff1}

[H2-WERK-SYNTHESE (synthetisch-hermeneutisch)]
${ctx.h2Synthese}${auff2}

[KANDIDATEN-POOL FÜR TEIL B (vorgefiltert nach Literaturbezug + Zitations-Marker + Zentralität)]
${candidatesBlock}

Erstelle jetzt die Review-Synthese in vier Schritten (Teil A) und wähle drei Literaturbezugs-Anker (Teil B) aus dem Pool, jeweils mit Begründung.`;
}

// ── Storage ───────────────────────────────────────────────────────

function assembleProseContent(result: MetaSynthesisResult): string {
	// Vier Teil-A-Sektionen in einen lesbaren Prosa-Block verketten. Die
	// Header sind die UI-relevanten Schritt-Etiketten (Display in Reader-
	// Tab "Meta-Synthese").
	return [
		`## 1. Positive Werkhypothese\n\n${result.positive_werkhypothese.trim()}`,
		`## 2. Geteilte Defizithypothese\n\n${result.defizit_hypothese.trim()}`,
		`## 3. H1↔H2-Differenz\n\n${result.h1_h2_differenz.trim()}`,
		`## 4. Synthesehypothese\n\n${result.synthese_hypothese.trim()}`,
	].join('\n\n');
}

interface ResolvedAnchor {
	argument_node_id: string;
	paragraph_id: string;
	rationale: string;
}

function resolveAnchors(
	candidates: ArgumentCandidate[],
	ankerEntries: { kandidat_nr: string; rationale: string }[]
): ResolvedAnchor[] {
	const byRank = new Map<number, ArgumentCandidate>();
	for (const c of candidates) byRank.set(c.rank, c);

	const resolved: ResolvedAnchor[] = [];
	for (const entry of ankerEntries) {
		const trimmed = entry.kandidat_nr.trim();
		const num = parseInt(trimmed.replace(/[^\d]/g, ''), 10);
		if (!Number.isFinite(num) || num <= 0) {
			// kandidat_nr=0 oder unparsbar → null-resolved Eintrag (LLM hat
			// keinen verfügbaren Kandidaten gemeldet, siehe System-Prompt-
			// Empty-Path).
			continue;
		}
		const cand = byRank.get(num);
		if (!cand) {
			console.warn(
				`     meta-synthesis: kandidat_nr=${num} ist nicht im Pool (Pool-Größe ${candidates.length}) — Eintrag verworfen`
			);
			continue;
		}
		resolved.push({
			argument_node_id: cand.argumentNodeId,
			paragraph_id: cand.paragraphId,
			rationale: entry.rationale.trim(),
		});
	}
	return resolved;
}

async function storeMetaSynthesisMemo(
	ctx: MetaSynthesisContext,
	result: MetaSynthesisResult,
	resolvedAnchors: ResolvedAnchor[],
	userId: string
): Promise<{ memoId: string }> {
	const proseContent = assembleProseContent(result);

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

		const label = `[kontextualisierend/work/meta] ${ctx.documentTitle}`;
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
					source: 'meta_synthesis',
					document_id: ctx.centralDocumentId,
					work_type: ctx.brief.work_type,
					fact_check_anchors: resolvedAnchors,
					// Strukturierte Teil-A-Sub-Synthesen separat ablegen — der
					// memo_content.content trägt die zusammengefasste Prosa,
					// aber UI/Export wollen ggf. die vier Felder einzeln.
					synthese_parts: {
						positive_werkhypothese: result.positive_werkhypothese,
						defizit_hypothese: result.defizit_hypothese,
						h1_h2_differenz: result.h1_h2_differenz,
						synthese_hypothese: result.synthese_hypothese,
					},
				}),
			]
		);

		// scope_element_id ist NULL: Werk-Ebene hat keinen document_element-
		// Anker (parallel zu work/graph + work/synthetic). Link zum Dokument
		// über appearances.properties.document_id.
		await client.query(
			`INSERT INTO memo_content
			   (naming_id, content, format, status, memo_type, scope_element_id, scope_level)
			 VALUES ($1, $2, 'text', 'active', 'kontextualisierend', NULL, 'work')`,
			[memoId, proseContent]
		);

		return { memoId };
	});
}

// ── Public orchestration ──────────────────────────────────────────

export interface MetaSynthesisRun {
	skipped: boolean;
	existingMemoId: string | null;
	result: MetaSynthesisResult | null;
	resolvedAnchors: ResolvedAnchor[] | null;
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
	candidatePoolSize: number | null;
}

export async function runMetaSynthesis(
	caseId: string,
	userId: string,
	opts: { modelOverride?: { provider: Provider; model: string }; maxTokens?: number } = {}
): Promise<MetaSynthesisRun> {
	const caseRow = await queryOne<{ central_document_id: string }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);

	// Idempotency guard: skip wenn ein work/meta-Memo für dieses Werk existiert.
	const existingMemo = await queryOne<{ id: string }>(
		`SELECT n.id
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kontextualisierend/work/meta]%'
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
			resolvedAnchors: null,
			stored: null,
			tokens: null,
			model: null,
			provider: null,
			candidatePoolSize: null,
		};
	}

	const ctx = await loadMetaSynthesisContext(caseId);

	const system = buildSystemPrompt(ctx);
	const user = buildUserMessage(ctx);

	let repairResult;
	try {
		repairResult = await runProseCallWithRepair({
			system,
			cacheSystem: true,
			user,
			spec: META_SYNTHESIS_SPEC,
			schema: MetaSynthesisResultSchema,
			label: 'meta-synthesis',
			// 6000: vier Sub-Synthesen à 4-8 Sätze + drei Anker-Sektionen.
			// Tendenziell tokenhungriger als reine Werk-Synthesen, daher leicht
			// erhöht gegenüber 5000 in document-collapse*.
			maxTokens: opts.maxTokens ?? 6000,
			modelOverride: opts.modelOverride,
			caseId,
		});
	} catch (err) {
		if (err instanceof RepairCallExhaustedError) {
			const dumpPath = `/tmp/meta-synthesis-failure-${caseRow.central_document_id}.txt`;
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
	const resolvedAnchors = resolveAnchors(ctx.candidates, parsed.fact_check_anker);
	const stored = await storeMetaSynthesisMemo(ctx, parsed, resolvedAnchors, userId);

	return {
		skipped: false,
		existingMemoId: null,
		result: parsed,
		resolvedAnchors,
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
		candidatePoolSize: ctx.candidates.length,
	};
}
