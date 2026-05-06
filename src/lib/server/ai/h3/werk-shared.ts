// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Geteilte Loader und Aggregations-Helpers für die Werk-Heuristiken
// (WERK_DESKRIPTION + WERK_GUTACHT a/b/c). Beide arbeiten auf demselben
// Material — alle persistierten Funktionstyp-Konstrukte des Werks plus
// Outline-Struktur plus optional H1/H2-Collapse-Memos.

import { query, queryOne } from '../../db/index.js';
import type { EffectiveHeading } from '../../documents/outline.js';

// ── Case + Brief Context ─────────────────────────────────────────
//
// H3-Module brauchten bislang nur `central_document_id` aus der Case-Zeile;
// der angeknüpfte assessment_brief blieb für H3 unsichtbar. Damit fuhren
// alle H3-Auswertungen mit identischen Prompts — ohne Forscher-Lesefolie
// und ohne Werktyp-Differenzierung (BA vs. MA vs. Promotion vs. Habil).
// Dieser Loader bringt H3 auf das gleiche Brief-Niveau wie H1/H2: Werktyp
// (Stufe-Differenzierung), Kriterien (Lesefolie für aggregierende Module)
// und Persona (Forscher-Identität für Werk-Meta-Module).

export interface H3BriefContext {
	name: string;
	workType: string;
	criteria: string;
	persona: string;
}

export interface H3CaseContext {
	centralDocumentId: string;
	brief: H3BriefContext;
}

/**
 * Lädt Case + angeknüpften Brief in einem Query. Wirft bei fehlendem
 * Case, fehlendem central_document_id, oder fehlendem Brief. H3 setzt
 * eine Brief-Bindung voraus — analog zu H1, das `if (!caseRow.criteria)
 * throw` als harten Pre-Check fährt.
 */
export async function loadH3CaseContext(caseId: string): Promise<H3CaseContext> {
	const row = await queryOne<{
		central_document_id: string | null;
		brief_name: string | null;
		brief_work_type: string | null;
		brief_criteria: string | null;
		brief_persona: string | null;
	}>(
		`SELECT c.central_document_id,
		        b.name AS brief_name,
		        b.work_type AS brief_work_type,
		        b.criteria AS brief_criteria,
		        b.persona AS brief_persona
		 FROM cases c
		 LEFT JOIN assessment_briefs b ON b.id = c.assessment_brief_id
		 WHERE c.id = $1`,
		[caseId]
	);
	if (!row) throw new Error(`Case not found: ${caseId}`);
	if (!row.central_document_id) {
		throw new Error(`Case ${caseId} has no central_document_id`);
	}
	if (!row.brief_name || row.brief_work_type === null) {
		throw new Error(
			`Case ${caseId} has no assessment_brief — H3 requires a brief for work-type-aware extraction.`
		);
	}
	return {
		centralDocumentId: row.central_document_id,
		brief: {
			name: row.brief_name,
			workType: row.brief_work_type,
			criteria: row.brief_criteria ?? '',
			persona: row.brief_persona ?? '',
		},
	};
}

/**
 * Werktyp-Zeile für den System-Prompt. Format wörtlich aus H1
 * übernommen (`Werktyp: ${brief.work_type}`); raw Enum-String ohne
 * Label-Mapping, damit das Prompt-Vokabular kongruent zu H1 bleibt.
 */
export function formatWerktypLine(brief: H3BriefContext): string {
	return `Werktyp: ${brief.workType}`;
}

/**
 * Kriterien-Block ([KRITERIEN ALS LESEFOLIE]) für aggregierende H3-Module
 * (Synthese / Schlussreflexion / Exkurs / Werk-Beschreibung / Werk-Gutacht).
 * Liefert `null`, wenn der Brief keine Kriterien enthält — Caller entscheidet,
 * ob das ein Fehler ist oder ob der Block einfach entfällt.
 */
export function formatKriterienBlock(brief: H3BriefContext): string | null {
	const c = brief.criteria.trim();
	if (!c) return null;
	return `[KRITERIEN ALS LESEFOLIE]\n${c}`;
}

/**
 * Persona-Block ([PERSONA]) für Werk-Meta-Module (WERK_GUTACHT,
 * SCHLUSSREFLEXION). Kommt VOR der modul-spezifischen Persona —
 * etabliert Forscher-Identität, dann übernimmt die modul-spezifische
 * Anweisung das Was-konkret-zu-tun-ist.
 */
export function formatPersonaBlock(brief: H3BriefContext): string | null {
	const p = brief.persona.trim();
	if (!p) return null;
	return `[PERSONA]\n${p}`;
}

// ── Konstrukt-Aggregat ────────────────────────────────────────────

export interface AggregateConstruct {
	outlineFunctionType: string;
	constructKind: string;
	content: Record<string, unknown>;
}

export async function loadAllConstructs(
	caseId: string,
	documentId: string
): Promise<AggregateConstruct[]> {
	const rows = (
		await query<{
			outline_function_type: string;
			construct_kind: string;
			content: Record<string, unknown>;
		}>(
			`SELECT outline_function_type, construct_kind, content
			 FROM function_constructs
			 WHERE case_id = $1 AND document_id = $2
			   AND outline_function_type NOT IN ('WERK_DESKRIPTION', 'WERK_GUTACHT')
			 ORDER BY outline_function_type, construct_kind, created_at`,
			[caseId, documentId]
		)
	).rows;

	return rows.map((r) => ({
		outlineFunctionType: r.outline_function_type,
		constructKind: r.construct_kind,
		content: r.content,
	}));
}

// ── Memo-Content (optional, H1/H2-Vorlauf) ────────────────────────

export interface AggregateMemo {
	scopeLevel: 'chapter' | 'subchapter';
	scopeElementId: string;
	headingText: string;
	headingCharStart: number;
	textContent: string;
}

export async function loadCollapseMemos(
	documentId: string
): Promise<AggregateMemo[]> {
	const rows = (
		await query<{
			scope_level: string;
			scope_element_id: string;
			heading_text: string;
			char_start: number;
			content: string;
			format: string;
		}>(
			`SELECT mc.scope_level,
			        mc.scope_element_id,
			        SUBSTRING(dc.full_text FROM de.char_start + 1
			                              FOR de.char_end - de.char_start) AS heading_text,
			        de.char_start,
			        mc.content,
			        mc.format
			 FROM memo_content mc
			 JOIN document_elements de ON de.id = mc.scope_element_id
			 JOIN document_content dc ON dc.naming_id = de.document_id
			 WHERE de.document_id = $1
			   AND mc.status = 'active'
			   AND mc.scope_level IN ('chapter', 'subchapter')
			 ORDER BY de.char_start`,
			[documentId]
		)
	).rows;

	return rows.map((r) => ({
		scopeLevel: r.scope_level as 'chapter' | 'subchapter',
		scopeElementId: r.scope_element_id,
		headingText: r.heading_text.trim(),
		headingCharStart: r.char_start,
		textContent: stripHtml(r.format === 'html' ? r.content : r.content),
	}));
}

export function stripHtml(html: string): string {
	return html
		.replace(/<\/?(p|div|br|h[1-6]|li|ul|ol|blockquote)[^>]*>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/[\r\n\t ]+/g, ' ')
		.trim();
}

// ── Outline-Aufbereitung ──────────────────────────────────────────

export interface AnchorAndStructure {
	anchorIds: string[];
	outlineSummary: string;
	headingCount: number;
}

export function buildOutlineSummary(
	headings: EffectiveHeading[]
): AnchorAndStructure {
	const visible = headings.filter((h) => !h.excluded);
	const topLevel = visible.filter((h) => h.effectiveLevel === 1);
	const anchorIds = topLevel.map((h) => h.elementId);

	const lines: string[] = [];
	for (const h of visible) {
		const indent = '  '.repeat(Math.max(0, h.effectiveLevel - 1));
		const numbering = h.effectiveNumbering ? `${h.effectiveNumbering} ` : '';
		const fnType = h.outlineFunctionType ? ` [${h.outlineFunctionType}]` : '';
		lines.push(`${indent}${numbering}${h.effectiveText}${fnType}`);
	}

	return {
		anchorIds,
		outlineSummary: lines.join('\n'),
		headingCount: visible.length,
	};
}

// ── Konstrukt-Block-Aufbereitung für LLM-Input ────────────────────

const SKIP_KINDS = new Set<string>([
	'VERWEIS_PROFIL', // verbose Citation-Statistik, deskriptiv schon in BLOCK_WUERDIGUNG/FORSCHUNGSGEGENSTAND
	'BLOCK_ROUTING', // Routing-Klassifikation, nicht-deskriptive Telemetrie
	// Werk-Aggregate werden NICHT über die formatContent-key=value-Soup gerendert,
	// sondern explizit über formatWerkAggregateBlock() (siehe unten). Hier ausschließen,
	// damit sie nicht doppelt erscheinen. Setzung 2026-05-06,
	// docs/h3_werk_aggregate_substrate_pfad.md.
	'GESAMTERGEBNIS',
	'GELTUNGSANSPRUCH',
]);

const ORDERED_TYPES = [
	'EXPOSITION',
	'GRUNDLAGENTHEORIE',
	'FORSCHUNGSDESIGN',
	'DURCHFUEHRUNG',
	'EXKURS',
	'SYNTHESE',
	'SCHLUSSREFLEXION',
	'WERK_STRUKTUR',
];

export function buildConstructsBlock(constructs: AggregateConstruct[]): {
	text: string;
	countsByType: Record<string, number>;
} {
	const countsByType: Record<string, number> = {};
	const byType = new Map<string, AggregateConstruct[]>();
	for (const c of constructs) {
		countsByType[c.outlineFunctionType] =
			(countsByType[c.outlineFunctionType] ?? 0) + 1;
		if (SKIP_KINDS.has(c.constructKind)) continue;
		if (!byType.has(c.outlineFunctionType)) byType.set(c.outlineFunctionType, []);
		byType.get(c.outlineFunctionType)!.push(c);
	}

	const lines: string[] = [];
	for (const t of ORDERED_TYPES) {
		const cs = byType.get(t);
		if (!cs || cs.length === 0) continue;
		lines.push(`### ${t}`);
		for (const c of cs) {
			lines.push(`- ${c.constructKind}: ${formatContent(c.content)}`);
		}
		lines.push('');
	}
	return { text: lines.join('\n'), countsByType };
}

export function formatContent(content: Record<string, unknown>): string {
	const stringFields: string[] = [];
	for (const [key, value] of Object.entries(content)) {
		if (typeof value === 'string' && value.length > 0 && value.length < 4000) {
			stringFields.push(`${key}=${value}`);
		}
	}
	return stringFields.join(' | ');
}

export function buildMemosBlock(memos: AggregateMemo[]): string | null {
	if (memos.length === 0) return null;
	return memos
		.map((m) => `### ${m.scopeLevel}: ${m.headingText}\n${m.textContent}`)
		.join('\n\n');
}

// ── Werk-Aggregat-Substrat ────────────────────────────────────────
//
// Dedizierter Substrat-Pfad für die Werk-Stages (WERK_DESKRIPTION + WERK_GUTACHT
// a/b/c). Lädt SYNTHESE/GESAMTERGEBNIS und SCHLUSSREFLEXION/GELTUNGSANSPRUCH
// typisiert (statt sie über loadAllConstructs + formatContent als
// `key=value`-Soup zu verflachen) und rendert sie als sektionierten
// Prompt-Block mit klarer Hierarchie:
//
//   - WERK-ANTWORT AUF DIE FRAGESTELLUNG (fragestellungsAntwortText)
//   - WERK-GESAMTERGEBNIS (gesamtergebnisText)
//   - BEFUND-INTEGRATION (Coverage aus erkenntnisIntegration[])
//   - GELTUNGSANSPRUCH (geltungsanspruchText)
//   - GRENZEN (grenzenText)
//   - ANSCHLUSSFORSCHUNG (anschlussforschungText)
//
// Konsumenten: WERK_DESKRIPTION (extractWerkBeschreibung) + WERK_GUTACHT
// Stage A/B/C. Setzung 2026-05-06, docs/h3_werk_aggregate_substrate_pfad.md.
//
// Read-side weniger strict als die Pipeline-Schemas in synthese.ts /
// schlussreflexion.ts: Legacy-Konstrukte ohne erkenntnisIntegration[] oder
// mit fehlenden Sub-Feldern werden defensiv geleert, nicht abgelehnt — der
// Loader signalisiert "Aggregat fehlt" über `null`-Felder, statt zu werfen.

export interface ErkenntnisIntegrationReadItem {
	befundId: string | null;
	befundSnippet: string;
	integriert: boolean;
	synthesisAnchorParagraphId: string | null;
	hinweis: string | null;
}

export interface WerkAggregateSubstrate {
	hasGesamtergebnis: boolean;
	hasGeltungsanspruch: boolean;
	gesamtergebnisText: string | null;
	fragestellungsAntwortText: string | null;
	erkenntnisIntegration: ErkenntnisIntegrationReadItem[];
	coverageRatio: number | null;
	befundCount: number | null;
	geltungsanspruchText: string | null;
	grenzenText: string | null;
	anschlussforschungText: string | null;
}

function readString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean {
	return value === true;
}

function readErkenntnisIntegration(value: unknown): ErkenntnisIntegrationReadItem[] {
	if (!Array.isArray(value)) return [];
	const items: ErkenntnisIntegrationReadItem[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== 'object') continue;
		const obj = raw as Record<string, unknown>;
		const snippet = readString(obj.befundSnippet);
		if (!snippet) continue; // ohne Snippet kein renderbarer Eintrag
		items.push({
			befundId: readString(obj.befundId),
			befundSnippet: snippet,
			integriert: readBoolean(obj.integriert),
			synthesisAnchorParagraphId: readString(obj.synthesisAnchorParagraphId),
			hinweis: readString(obj.hinweis),
		});
	}
	return items;
}

/**
 * Lädt Werk-Aggregate (SYNTHESE/GESAMTERGEBNIS + SCHLUSSREFLEXION/GELTUNGSANSPRUCH)
 * typisiert. `null`-Felder im Ergebnis = Aggregat existiert nicht oder enthält
 * das Sub-Feld nicht; Caller entscheidet, ob das ein Fehler ist.
 */
export async function loadWerkAggregateSubstrate(
	caseId: string,
	documentId: string
): Promise<WerkAggregateSubstrate> {
	const rows = (
		await query<{
			construct_kind: string;
			content: Record<string, unknown> | null;
		}>(
			`SELECT construct_kind, content
			 FROM function_constructs
			 WHERE case_id = $1
			   AND document_id = $2
			   AND ((outline_function_type = 'SYNTHESE' AND construct_kind = 'GESAMTERGEBNIS')
			     OR (outline_function_type = 'SCHLUSSREFLEXION' AND construct_kind = 'GELTUNGSANSPRUCH'))
			 ORDER BY created_at DESC`,
			[caseId, documentId]
		)
	).rows;

	const out: WerkAggregateSubstrate = {
		hasGesamtergebnis: false,
		hasGeltungsanspruch: false,
		gesamtergebnisText: null,
		fragestellungsAntwortText: null,
		erkenntnisIntegration: [],
		coverageRatio: null,
		befundCount: null,
		geltungsanspruchText: null,
		grenzenText: null,
		anschlussforschungText: null,
	};

	// Falls aus Versehen mehrere existieren (sollte clear-before-insert
	// verhindern), nimm den jeweils ersten — ORDER BY created_at DESC oben.
	let gesSeen = false;
	let gelSeen = false;
	for (const r of rows) {
		const c = r.content ?? {};
		if (r.construct_kind === 'GESAMTERGEBNIS' && !gesSeen) {
			gesSeen = true;
			out.hasGesamtergebnis = true;
			out.gesamtergebnisText = readString(c.gesamtergebnisText);
			out.fragestellungsAntwortText = readString(c.fragestellungsAntwortText);
			out.erkenntnisIntegration = readErkenntnisIntegration(c.erkenntnisIntegration);
			out.coverageRatio = readNumber(c.coverageRatio);
			out.befundCount = readNumber(c.befundCount);
		} else if (r.construct_kind === 'GELTUNGSANSPRUCH' && !gelSeen) {
			gelSeen = true;
			out.hasGeltungsanspruch = true;
			out.geltungsanspruchText = readString(c.geltungsanspruchText);
			out.grenzenText = readString(c.grenzenText);
			out.anschlussforschungText = readString(c.anschlussforschungText);
		}
	}
	return out;
}

/**
 * Rendert das Werk-Aggregat-Substrat als sektionierter Prompt-Block. Liefert
 * `null`, wenn weder GESAMTERGEBNIS noch GELTUNGSANSPRUCH existieren — Caller
 * entscheidet, ob das einen Fail bedeutet (für WERK_GUTACHT-c kritisch) oder
 * ob der Block einfach entfällt (für frühe Werk-Stages tolerierbar).
 *
 * Sektionen werden nur emittiert, wenn das jeweilige Feld existiert. Fehlt
 * z.B. erkenntnisIntegration[] (Legacy-GESAMTERGEBNIS vor 2026-05-04), bleibt
 * die BEFUND-INTEGRATION-Sektion weg, statt mit "(keine Daten)" zu rauschen.
 */
export function formatWerkAggregateBlock(
	substrate: WerkAggregateSubstrate
): string | null {
	if (!substrate.hasGesamtergebnis && !substrate.hasGeltungsanspruch) {
		return null;
	}

	const lines: string[] = [];
	lines.push('[WERK-AGGREGATE]');
	lines.push(
		'Verdichtungen aus dem SYNTHESE- und SCHLUSSREFLEXION-Pass. Diese Texte sind die direkten Werk-Antworten und Selbst-Verortungen, auf die sich die Werk-Würdigung beziehen muss.'
	);
	lines.push('');

	if (substrate.fragestellungsAntwortText) {
		lines.push('## WERK-ANTWORT AUF DIE FRAGESTELLUNG');
		lines.push(substrate.fragestellungsAntwortText);
		lines.push('');
	}

	if (substrate.gesamtergebnisText) {
		lines.push('## WERK-GESAMTERGEBNIS');
		lines.push(substrate.gesamtergebnisText);
		lines.push('');
	}

	if (substrate.erkenntnisIntegration.length > 0) {
		lines.push('## BEFUND-INTEGRATION');
		const total = substrate.erkenntnisIntegration.length;
		const integrated = substrate.erkenntnisIntegration.filter((e) => e.integriert)
			.length;
		const ratio =
			substrate.coverageRatio !== null
				? substrate.coverageRatio
				: total > 0
					? integrated / total
					: null;
		const ratioPct = ratio !== null ? ` (${Math.round(ratio * 100)}%)` : '';
		lines.push(
			`Coverage-Audit: ${integrated} von ${total} BEFUNDEN in die Synthese integriert${ratioPct}.`
		);
		const integratedItems = substrate.erkenntnisIntegration.filter((e) => e.integriert);
		const missingItems = substrate.erkenntnisIntegration.filter((e) => !e.integriert);
		if (integratedItems.length > 0) {
			lines.push('');
			lines.push('Integriert:');
			for (const e of integratedItems) {
				const hint = e.hinweis ? ` — ${e.hinweis}` : '';
				lines.push(`  - ${e.befundSnippet}${hint}`);
			}
		}
		if (missingItems.length > 0) {
			lines.push('');
			lines.push('Nicht integriert (bleibt in der Synthese unverbunden):');
			for (const e of missingItems) {
				const hint = e.hinweis ? ` — ${e.hinweis}` : '';
				lines.push(`  - ${e.befundSnippet}${hint}`);
			}
		}
		lines.push('');
	}

	if (substrate.geltungsanspruchText) {
		lines.push('## GELTUNGSANSPRUCH');
		lines.push(substrate.geltungsanspruchText);
		lines.push('');
	}

	if (substrate.grenzenText) {
		lines.push('## GRENZEN');
		lines.push(substrate.grenzenText);
		lines.push('');
	}

	if (substrate.anschlussforschungText) {
		lines.push('## ANSCHLUSSFORSCHUNG');
		lines.push(substrate.anschlussforschungText);
		lines.push('');
	}

	return lines.join('\n').trimEnd();
}
