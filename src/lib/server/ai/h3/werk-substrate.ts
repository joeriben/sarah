// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Geteilte Cross-Typ-Reads + Prompt-Block-Formatierer für die werk-skopierten
// H3-Heuristiken (SYNTHESE, SCHLUSSREFLEXION). Beide Heuristiken müssen das
// volle H3-Substrat sehen, das die Vorgänger-Pässe persistiert haben — Theorie-
// Reflexion (BLOCK_WUERDIGUNG/ECKPUNKT_BEFUND/DISKURSIV_BEZUG_BEFUND), Verweis-
// Profil-Aggregat, EXKURS-Re-Spec-Geschichte des FORSCHUNGSGEGENSTANDs,
// FRAGESTELLUNG-Beurteilung, MOTIVATION, METHODOLOGIE, audit-only-Hotspots
// in der DURCHFÜHRUNG.
//
// Trennung zu werk-shared.ts: dort liegen Brief/Outline/Konstrukt-Aggregat-
// Helpers für die Werk-Heuristiken (WERK_DESKRIPTION/WERK_GUTACHT). Diese
// Datei ist enger geschnitten — nur was SYNTHESE und SR brauchen, mit
// Format-Helpern, die aus den geladenen Daten Prompt-Blöcke produzieren.
//
// Critical-Friend (project_critical_friend_identity.md):
// Die Format-Helper benennen Auffälligkeiten DESKRIPTIV (z.B. "HHI=0.92 →
// stark konzentrierte Theoriebasis"), nie wertend. Konsumenten-Prompts
// instruieren das LLM, daraus Lese-Hinweise abzuleiten, nicht Urteile.

import { query, queryOne } from '../../db/index.js';

// ── FRAGESTELLUNG_BEURTEILUNG (EXPOSITION) ────────────────────────

export interface FragestellungBeurteilungSnippet {
	beurteilung: string;
}

export async function loadFragestellungBeurteilung(
	caseId: string,
	documentId: string
): Promise<FragestellungBeurteilungSnippet | null> {
	const row = await queryOne<{ content: { beurteilung?: string } }>(
		`SELECT content FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'EXPOSITION'
		   AND construct_kind = 'FRAGESTELLUNG_BEURTEILUNG'
		 ORDER BY created_at DESC LIMIT 1`,
		[caseId, documentId]
	);
	if (!row?.content?.beurteilung) return null;
	return { beurteilung: row.content.beurteilung };
}

// ── MOTIVATION (EXPOSITION) ───────────────────────────────────────

export interface MotivationSnippet {
	text: string;
}

export async function loadMotivation(
	caseId: string,
	documentId: string
): Promise<MotivationSnippet | null> {
	const row = await queryOne<{ content: { text?: string } }>(
		`SELECT content FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'EXPOSITION'
		   AND construct_kind = 'MOTIVATION'
		 ORDER BY created_at DESC LIMIT 1`,
		[caseId, documentId]
	);
	if (!row?.content?.text) return null;
	return { text: row.content.text };
}

// ── METHODOLOGIE/METHODEN/BASIS (FORSCHUNGSDESIGN) ────────────────

export interface ForschungsdesignSnippet {
	methodologieText: string | null;
	methodenText: string | null;
	basisText: string | null;
}

export async function loadForschungsdesignTriple(
	caseId: string,
	documentId: string
): Promise<ForschungsdesignSnippet> {
	const rows = (
		await query<{ construct_kind: string; content: { text?: string } }>(
			`SELECT construct_kind, content FROM function_constructs
			 WHERE case_id = $1 AND document_id = $2
			   AND outline_function_type = 'FORSCHUNGSDESIGN'
			   AND construct_kind IN ('METHODOLOGIE', 'METHODEN', 'BASIS')
			 ORDER BY created_at DESC`,
			[caseId, documentId]
		)
	).rows;
	let methodologieText: string | null = null;
	let methodenText: string | null = null;
	let basisText: string | null = null;
	for (const r of rows) {
		const t = r.content?.text ?? null;
		if (r.construct_kind === 'METHODOLOGIE' && methodologieText === null) methodologieText = t;
		if (r.construct_kind === 'METHODEN' && methodenText === null) methodenText = t;
		if (r.construct_kind === 'BASIS' && basisText === null) basisText = t;
	}
	return { methodologieText, methodenText, basisText };
}

// ── VERWEIS_PROFIL Aggregat (GRUNDLAGENTHEORIE) ───────────────────

interface VerweisProfileContent {
	containerHeading?: string;
	citationCount?: number;
	paragraphCount?: number;
	uniqueAuthorCount?: number;
	byAuthor?: Array<{ author: string; mentions: number }>;
	density?: {
		hhi?: number;
		topAuthorShare?: number;
		top3AuthorShare?: number;
		consecutiveDominanceAuthor?: string | null;
		maxConsecutiveParagraphsDominatedByAuthor?: number;
		paragraphsWithCitation?: number;
		paragraphsWithoutCitation?: number;
	};
	coverage?: {
		totalCitations?: number;
		resolvedCitations?: number;
		orphanCitations?: number;
	};
}

export interface VerweisProfilAggregate {
	containerCount: number;
	totalCitations: number;
	resolvedCitations: number;
	orphanCitations: number;
	werkUniqueAuthorCount: number;
	werkTopAuthors: Array<{ author: string; mentions: number }>;
	containerProfiles: Array<{
		headingText: string;
		paragraphCount: number;
		citationCount: number;
		uniqueAuthorCount: number;
		hhi: number | null;
		topAuthorShare: number | null;
		consecutiveDominanceAuthor: string | null;
		maxConsecutiveParagraphsDominatedByAuthor: number | null;
		paragraphsWithoutCitation: number | null;
		topAuthors: Array<{ author: string; mentions: number }>;
	}>;
}

export async function loadVerweisProfilAggregate(
	caseId: string,
	documentId: string
): Promise<VerweisProfilAggregate | null> {
	const rows = (
		await query<{ content: VerweisProfileContent }>(
			`SELECT content FROM function_constructs
			 WHERE case_id = $1 AND document_id = $2
			   AND outline_function_type = 'GRUNDLAGENTHEORIE'
			   AND construct_kind = 'VERWEIS_PROFIL'
			 ORDER BY created_at`,
			[caseId, documentId]
		)
	).rows;
	if (rows.length === 0) return null;

	let totalCitations = 0;
	let resolvedCitations = 0;
	let orphanCitations = 0;
	const werkAuthorMentions = new Map<string, number>();

	const containerProfiles: VerweisProfilAggregate['containerProfiles'] = [];
	for (const r of rows) {
		const c = r.content ?? {};
		totalCitations += c.coverage?.totalCitations ?? c.citationCount ?? 0;
		resolvedCitations += c.coverage?.resolvedCitations ?? 0;
		orphanCitations += c.coverage?.orphanCitations ?? 0;

		const byAuthor = Array.isArray(c.byAuthor) ? c.byAuthor : [];
		for (const a of byAuthor) {
			werkAuthorMentions.set(a.author, (werkAuthorMentions.get(a.author) ?? 0) + (a.mentions ?? 0));
		}

		const topAuthors = byAuthor
			.slice()
			.sort((a, b) => (b.mentions ?? 0) - (a.mentions ?? 0))
			.slice(0, 3);

		containerProfiles.push({
			headingText: c.containerHeading ?? '(unbekannter Container)',
			paragraphCount: c.paragraphCount ?? 0,
			citationCount: c.citationCount ?? 0,
			uniqueAuthorCount: c.uniqueAuthorCount ?? byAuthor.length,
			hhi: c.density?.hhi ?? null,
			topAuthorShare: c.density?.topAuthorShare ?? null,
			consecutiveDominanceAuthor: c.density?.consecutiveDominanceAuthor ?? null,
			maxConsecutiveParagraphsDominatedByAuthor:
				c.density?.maxConsecutiveParagraphsDominatedByAuthor ?? null,
			paragraphsWithoutCitation: c.density?.paragraphsWithoutCitation ?? null,
			topAuthors,
		});
	}

	const werkTopAuthors = Array.from(werkAuthorMentions.entries())
		.map(([author, mentions]) => ({ author, mentions }))
		.sort((a, b) => b.mentions - a.mentions)
		.slice(0, 6);

	return {
		containerCount: rows.length,
		totalCitations,
		resolvedCitations,
		orphanCitations,
		werkUniqueAuthorCount: werkAuthorMentions.size,
		werkTopAuthors,
		containerProfiles,
	};
}

// ── BLOCK_WUERDIGUNG / ECKPUNKT_BEFUND / DISKURSIV_BEZUG_BEFUND ──

interface BlockWuerdigungContent {
	blocks?: Array<{
		blockIndex?: number;
		paragraphIndexRange?: [number, number];
		summary?: string;
	}>;
}

interface AxisInfo {
	signal?: 'green' | 'yellow' | 'red';
	rationale?: string;
}

interface EckpunktBefundContent {
	blocks?: Array<{
		blockIndex?: number;
		paragraphIndexRange?: [number, number];
		dominantAuthor?: string;
		axes?: {
			kernbegriff?: AxisInfo;
			kontamination?: AxisInfo;
			provenienz?: AxisInfo;
		};
	}>;
}

interface DiskursivBezugBefundContent {
	blocks?: Array<{
		blockIndex?: number;
		paragraphIndexRange?: [number, number];
		source?: 'routing_diskussion' | 'standard_stretch';
		bezug?: 'explizit' | 'implizit' | 'bezugslos';
		signal?: 'green' | 'yellow' | 'red';
		rationale?: string;
	}>;
}

export interface GthReflexionAggregate {
	containerCount: number;
	wuerdigungBlockCount: number;
	eckpunktBlockCount: number;
	diskursivBlockCount: number;
	wuerdigungSummaries: Array<{
		containerHeadingText: string;
		blockIndex: number;
		summary: string;
		paragraphIndexRange: [number, number] | null;
	}>;
	eckpunktSignals: {
		kernbegriff: { green: number; yellow: number; red: number };
		kontamination: { green: number; yellow: number; red: number };
		provenienz: { green: number; yellow: number; red: number };
		auffaelligeBefunde: Array<{
			containerHeadingText: string;
			blockIndex: number;
			dominantAuthor: string | null;
			axis: 'kernbegriff' | 'kontamination' | 'provenienz';
			signal: 'yellow' | 'red';
			rationale: string;
		}>;
	};
	diskursivBezug: {
		counts: { explizit: number; implizit: number; bezugslos: number };
		bezugslosBlocks: Array<{
			containerHeadingText: string;
			blockIndex: number;
			rationale: string;
			paragraphIndexRange: [number, number] | null;
		}>;
	};
}

export async function loadGthReflexionAggregate(
	caseId: string,
	documentId: string
): Promise<GthReflexionAggregate | null> {
	const rows = (
		await query<{
			id: string;
			construct_kind: string;
			content:
				| BlockWuerdigungContent
				| EckpunktBefundContent
				| DiskursivBezugBefundContent;
			anchor_element_ids: string[];
		}>(
			`SELECT fc.id, fc.construct_kind, fc.content, fc.anchor_element_ids
			 FROM function_constructs fc
			 WHERE fc.case_id = $1 AND fc.document_id = $2
			   AND fc.outline_function_type = 'GRUNDLAGENTHEORIE'
			   AND fc.construct_kind IN ('BLOCK_WUERDIGUNG', 'ECKPUNKT_BEFUND', 'DISKURSIV_BEZUG_BEFUND')
			 ORDER BY fc.created_at`,
			[caseId, documentId]
		)
	).rows;
	if (rows.length === 0) return null;

	// Container-Heading-Map: erster anchor → Container-Heading per LATERAL.
	const allAnchorIds = new Set<string>();
	for (const r of rows) {
		for (const a of r.anchor_element_ids ?? []) allAnchorIds.add(a);
	}
	const headingByAnchor = new Map<string, string>();
	if (allAnchorIds.size > 0) {
		const headingRows = (
			await query<{ anchor_id: string; heading_text: string }>(
				`WITH heading_with_type AS (
				   SELECT de.id AS heading_id,
				          de.char_start,
				          de.char_end,
				          hc.outline_function_type,
				          SUBSTRING(dc.full_text FROM de.char_start + 1
				                                 FOR de.char_end - de.char_start) AS heading_text
				   FROM document_elements de
				   JOIN heading_classifications hc ON hc.element_id = de.id
				   JOIN document_content dc ON dc.naming_id = de.document_id
				   WHERE de.document_id = $1
				     AND de.element_type = 'heading'
				     AND de.section_kind = 'main'
				     AND hc.outline_function_type = 'GRUNDLAGENTHEORIE'
				     AND COALESCE(hc.excluded, false) = false
				 )
				 SELECT p.id AS anchor_id, h.heading_text
				 FROM document_elements p
				 JOIN LATERAL (
				   SELECT hwt.heading_text
				   FROM heading_with_type hwt
				   WHERE hwt.char_start <= p.char_start
				   ORDER BY hwt.char_start DESC
				   LIMIT 1
				 ) h ON true
				 WHERE p.document_id = $1
				   AND p.id = ANY($2::uuid[])`,
				[documentId, Array.from(allAnchorIds)]
			)
		).rows;
		for (const hr of headingRows) {
			headingByAnchor.set(hr.anchor_id, (hr.heading_text ?? '').trim());
		}
	}

	const wuerdigungSummaries: GthReflexionAggregate['wuerdigungSummaries'] = [];
	const eckpunktSignals: GthReflexionAggregate['eckpunktSignals'] = {
		kernbegriff: { green: 0, yellow: 0, red: 0 },
		kontamination: { green: 0, yellow: 0, red: 0 },
		provenienz: { green: 0, yellow: 0, red: 0 },
		auffaelligeBefunde: [],
	};
	const diskursivBezug: GthReflexionAggregate['diskursivBezug'] = {
		counts: { explizit: 0, implizit: 0, bezugslos: 0 },
		bezugslosBlocks: [],
	};

	let wuerdigungBlockCount = 0;
	let eckpunktBlockCount = 0;
	let diskursivBlockCount = 0;
	const containerHeadings = new Set<string>();

	for (const r of rows) {
		const firstAnchor = (r.anchor_element_ids ?? [])[0];
		const containerHeading =
			(firstAnchor && headingByAnchor.get(firstAnchor)) || '(unbekannter Container)';
		containerHeadings.add(containerHeading);

		if (r.construct_kind === 'BLOCK_WUERDIGUNG') {
			const blocks = (r.content as BlockWuerdigungContent).blocks ?? [];
			for (const b of blocks) {
				wuerdigungBlockCount += 1;
				if (b.summary) {
					wuerdigungSummaries.push({
						containerHeadingText: containerHeading,
						blockIndex: b.blockIndex ?? wuerdigungSummaries.length,
						summary: b.summary,
						paragraphIndexRange: b.paragraphIndexRange ?? null,
					});
				}
			}
		} else if (r.construct_kind === 'ECKPUNKT_BEFUND') {
			const blocks = (r.content as EckpunktBefundContent).blocks ?? [];
			for (const b of blocks) {
				eckpunktBlockCount += 1;
				const axes = b.axes ?? {};
				const axisKeys = ['kernbegriff', 'kontamination', 'provenienz'] as const;
				for (const ak of axisKeys) {
					const axis = axes[ak];
					if (!axis?.signal) continue;
					eckpunktSignals[ak][axis.signal] += 1;
					if (axis.signal !== 'green' && axis.rationale) {
						eckpunktSignals.auffaelligeBefunde.push({
							containerHeadingText: containerHeading,
							blockIndex: b.blockIndex ?? 0,
							dominantAuthor: b.dominantAuthor ?? null,
							axis: ak,
							signal: axis.signal,
							rationale: axis.rationale,
						});
					}
				}
			}
		} else if (r.construct_kind === 'DISKURSIV_BEZUG_BEFUND') {
			const blocks = (r.content as DiskursivBezugBefundContent).blocks ?? [];
			for (const b of blocks) {
				diskursivBlockCount += 1;
				if (b.bezug) {
					diskursivBezug.counts[b.bezug] += 1;
				}
				if (b.bezug === 'bezugslos' && b.rationale) {
					diskursivBezug.bezugslosBlocks.push({
						containerHeadingText: containerHeading,
						blockIndex: b.blockIndex ?? 0,
						rationale: b.rationale,
						paragraphIndexRange: b.paragraphIndexRange ?? null,
					});
				}
			}
		}
	}

	return {
		containerCount: containerHeadings.size,
		wuerdigungBlockCount,
		eckpunktBlockCount,
		diskursivBlockCount,
		wuerdigungSummaries,
		eckpunktSignals,
		diskursivBezug,
	};
}

// ── EXKURS-Re-Spec-Geschichte (FG version_stack) ──────────────────

export interface ReSpecHistoryEntry {
	exkursHeadingText: string;
	importedConcepts: Array<{ name: string; sourceAuthor: string | null }>;
	affectedConcepts: string[];
	reSpecText: string;
	exkursAnchorText: string | null;
	at: string;
}

export async function loadFgRespecHistory(
	caseId: string,
	documentId: string
): Promise<ReSpecHistoryEntry[]> {
	const row = await queryOne<{
		version_stack: Array<{
			kind?: string;
			at?: string;
			source_exkurs_heading_text?: string;
			imported_concepts?: Array<{ name: string; sourceAuthor?: string | null }>;
			affected_concepts?: string[];
			re_spec_text?: string;
			exkurs_anchor_text?: string | null;
		}>;
	}>(
		`SELECT version_stack FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'FORSCHUNGSGEGENSTAND'
		 ORDER BY created_at DESC LIMIT 1`,
		[caseId, documentId]
	);
	if (!row || !Array.isArray(row.version_stack)) return [];
	const out: ReSpecHistoryEntry[] = [];
	for (const e of row.version_stack) {
		if (e.kind !== 're_spec') continue;
		out.push({
			exkursHeadingText: e.source_exkurs_heading_text ?? '(unbekannter EXKURS)',
			importedConcepts: (e.imported_concepts ?? []).map((c) => ({
				name: c.name,
				sourceAuthor: c.sourceAuthor ?? null,
			})),
			affectedConcepts: e.affected_concepts ?? [],
			reSpecText: e.re_spec_text ?? '',
			exkursAnchorText: e.exkurs_anchor_text ?? null,
			at: e.at ?? '',
		});
	}
	return out;
}

// ── Audit-Only-Hotspots (DURCHFUEHRUNG-BEFUNDE mit text=null) ─────

export interface AuditOnlyHotspot {
	befundId: string;
	hotspotParagraphId: string;
	containerHeadingText: string;
}

export async function loadAuditOnlyHotspots(
	caseId: string,
	documentId: string
): Promise<AuditOnlyHotspot[]> {
	const rows = (
		await query<{
			id: string;
			anchor_paragraph_id: string;
			heading_text: string | null;
		}>(
			`WITH heading_with_type AS (
			   SELECT de.id AS heading_id,
			          de.char_start,
			          SUBSTRING(dc.full_text FROM de.char_start + 1
			                                 FOR de.char_end - de.char_start) AS heading_text
			   FROM document_elements de
			   JOIN heading_classifications hc ON hc.element_id = de.id
			   JOIN document_content dc ON dc.naming_id = de.document_id
			   WHERE de.document_id = $2
			     AND de.element_type = 'heading'
			     AND de.section_kind = 'main'
			     AND hc.outline_function_type = 'DURCHFUEHRUNG'
			     AND COALESCE(hc.excluded, false) = false
			 )
			 SELECT fc.id,
			        (fc.anchor_element_ids[1])::text AS anchor_paragraph_id,
			        h.heading_text
			 FROM function_constructs fc
			 JOIN document_elements p ON p.id = fc.anchor_element_ids[1]
			 LEFT JOIN LATERAL (
			   SELECT hwt.heading_text
			   FROM heading_with_type hwt
			   WHERE hwt.char_start <= p.char_start
			   ORDER BY hwt.char_start DESC
			   LIMIT 1
			 ) h ON true
			 WHERE fc.case_id = $1 AND fc.document_id = $2
			   AND fc.outline_function_type = 'DURCHFUEHRUNG'
			   AND fc.construct_kind = 'BEFUND'
			   AND (fc.content->>'text' IS NULL OR fc.content->>'text' = '')
			 ORDER BY fc.created_at`,
			[caseId, documentId]
		)
	).rows;
	return rows.map((r) => ({
		befundId: r.id,
		hotspotParagraphId: r.anchor_paragraph_id,
		containerHeadingText: r.heading_text?.trim() ?? '(unbekannter DURCHFÜHRUNG-Container)',
	}));
}

// ── Argument-Substrat (DURCHFUEHRUNG argument_nodes) ──────────────

export interface ArgumentSubstrateCounts {
	argumentNodeCount: number;
	durchfuehrungArgumentNodeCount: number;
}

export async function loadArgumentSubstrateCounts(
	documentId: string
): Promise<ArgumentSubstrateCounts> {
	// argument_nodes referenziert document_elements via paragraph_element_id;
	// die Werk-Bindung läuft über das Paragraph-Element. Pro Werk: alle AGs
	// in DURCHFUEHRUNGS-¶ (Step-2-AG-Pass schreibt dorthin) als Substrat-Maß.
	const totalRow = await queryOne<{ n: string }>(
		`SELECT count(*)::text AS n
		 FROM argument_nodes an
		 JOIN document_elements p ON p.id = an.paragraph_element_id
		 WHERE p.document_id = $1`,
		[documentId]
	);
	const durchRow = await queryOne<{ n: string }>(
		`WITH heading_with_type AS (
		   SELECT de.id AS heading_id, de.char_start, de.char_end, hc.outline_function_type
		   FROM document_elements de
		   JOIN heading_classifications hc ON hc.element_id = de.id
		   WHERE de.document_id = $1
		     AND de.element_type = 'heading'
		     AND de.section_kind = 'main'
		     AND hc.outline_function_type = 'DURCHFUEHRUNG'
		     AND COALESCE(hc.excluded, false) = false
		 )
		 SELECT count(*)::text AS n
		 FROM argument_nodes an
		 JOIN document_elements p ON p.id = an.paragraph_element_id
		 JOIN LATERAL (
		   SELECT 1 FROM heading_with_type hwt
		   WHERE hwt.char_start <= p.char_start
		   ORDER BY hwt.char_start DESC
		   LIMIT 1
		 ) h ON true
		 WHERE p.document_id = $1`,
		[documentId]
	);
	return {
		argumentNodeCount: totalRow ? Number(totalRow.n) : 0,
		durchfuehrungArgumentNodeCount: durchRow ? Number(durchRow.n) : 0,
	};
}

// ── Format-Helper für Prompt-Blöcke ───────────────────────────────

/**
 * Theoriebasis-Block: aggregiert VERWEIS_PROFIL, BLOCK_WUERDIGUNG,
 * ECKPUNKT_BEFUND, DISKURSIV_BEZUG_BEFUND, FG-Re-Spec-Geschichte.
 * Liefert null, wenn nichts davon vorhanden ist (sehr leeres H3-Substrat).
 *
 * Die Verbalisierung von HHI/topAuthorShare bleibt deskriptiv — das LLM
 * entscheidet, wie es das interpretiert. Wir benennen Auffälligkeiten
 * (z.B. HHI≥0.5) als "Hinweis", nicht als "Befund".
 */
export function formatTheoriebasisBlock(input: {
	verweisProfil: VerweisProfilAggregate | null;
	gthReflexion: GthReflexionAggregate | null;
	respecHistory: ReSpecHistoryEntry[];
}): string | null {
	const parts: string[] = [];

	if (input.verweisProfil) {
		const vp = input.verweisProfil;
		const lines: string[] = [];
		lines.push(
			`VERWEIS-PROFIL (Werk-Aggregat über ${vp.containerCount} GRUNDLAGENTHEORIE-Container):`
		);
		lines.push(
			`  – ${vp.totalCitations} Zitationen, ${vp.werkUniqueAuthorCount} unique Autorenpositionen werkweit`
		);
		if (vp.werkTopAuthors.length > 0) {
			const topStr = vp.werkTopAuthors
				.slice(0, 5)
				.map((a) => `${a.author} (${a.mentions})`)
				.join(', ');
			lines.push(`  – Werk-Top-Autoren: ${topStr}`);
		}
		if (vp.totalCitations > 0) {
			const orphanShare = vp.orphanCitations / vp.totalCitations;
			if (orphanShare > 0.1) {
				lines.push(
					`  – Hinweis: ${(orphanShare * 100).toFixed(0)}% der Zitationen sind orphan (nicht in Bibliographie auflösbar)`
				);
			}
		}
		// Pro Container die auffälligsten Konzentrations-Hinweise
		const concentrationHints: string[] = [];
		for (const cp of vp.containerProfiles) {
			if (cp.hhi !== null && cp.hhi >= 0.5) {
				const dom =
					cp.consecutiveDominanceAuthor && (cp.maxConsecutiveParagraphsDominatedByAuthor ?? 0) >= 3
						? `, ${cp.consecutiveDominanceAuthor} dominiert ${cp.maxConsecutiveParagraphsDominatedByAuthor} aufeinanderfolgende ¶`
						: '';
					concentrationHints.push(
						`    · "${cp.headingText}" — HHI=${cp.hhi.toFixed(2)} (${cp.uniqueAuthorCount} Autor:innen über ${cp.paragraphCount} ¶${dom})`
				);
			}
			if (cp.paragraphsWithoutCitation !== null && cp.paragraphCount > 0) {
				const noCitShare = cp.paragraphsWithoutCitation / cp.paragraphCount;
				if (noCitShare > 0.7) {
					concentrationHints.push(
						`    · "${cp.headingText}" — ${cp.paragraphsWithoutCitation}/${cp.paragraphCount} ¶ ohne Zitation (${(noCitShare * 100).toFixed(0)}%)`
					);
				}
			}
		}
		if (concentrationHints.length > 0) {
			lines.push(`  – Konzentrations-/Beleg-Hinweise pro Container:`);
			lines.push(...concentrationHints);
		}
		parts.push(lines.join('\n'));
	}

	if (input.gthReflexion) {
		const gr = input.gthReflexion;
		const lines: string[] = [];
		lines.push(
			`THEORIE-REFLEXION (aus ${gr.containerCount} GRUNDLAGENTHEORIE-Containern, ${gr.wuerdigungBlockCount} Wiedergabe-Blöcke gewürdigt):`
		);
		// ECKPUNKT-Signal-Verteilung
		const sumAxis = (s: { green: number; yellow: number; red: number }) =>
			s.green + s.yellow + s.red;
		const totalEckpunkt = sumAxis(gr.eckpunktSignals.kernbegriff);
		if (totalEckpunkt > 0) {
			lines.push(
				`  – ECKPUNKT-Signale (${totalEckpunkt} geprüfte Wiedergabe-Blöcke):`
			);
			lines.push(
				`    · kernbegriff: ${gr.eckpunktSignals.kernbegriff.green}🟢 / ${gr.eckpunktSignals.kernbegriff.yellow}🟡 / ${gr.eckpunktSignals.kernbegriff.red}🔴`
			);
			lines.push(
				`    · kontamination: ${gr.eckpunktSignals.kontamination.green}🟢 / ${gr.eckpunktSignals.kontamination.yellow}🟡 / ${gr.eckpunktSignals.kontamination.red}🔴`
			);
			lines.push(
				`    · provenienz: ${gr.eckpunktSignals.provenienz.green}🟢 / ${gr.eckpunktSignals.provenienz.yellow}🟡 / ${gr.eckpunktSignals.provenienz.red}🔴`
			);
			// Auffällige Befunde (red > yellow), max 6
			const rotgelbe = gr.eckpunktSignals.auffaelligeBefunde
				.slice()
				.sort((a, b) => (a.signal === 'red' ? -1 : 1) - (b.signal === 'red' ? -1 : 1))
				.slice(0, 6);
			if (rotgelbe.length > 0) {
				lines.push(`  – Auffällige Eckpunkt-Befunde (rot/gelb, max 6):`);
				for (const f of rotgelbe) {
					const author = f.dominantAuthor ? ` zu ${f.dominantAuthor}` : '';
					const sig = f.signal === 'red' ? '🔴' : '🟡';
					lines.push(
						`    · ${sig} "${f.containerHeadingText}" Block ${f.blockIndex} ${f.axis}${author}: ${f.rationale}`
					);
				}
			}
		}
		// Diskursiver Bezug
		const dbCount =
			gr.diskursivBezug.counts.explizit +
			gr.diskursivBezug.counts.implizit +
			gr.diskursivBezug.counts.bezugslos;
		if (dbCount > 0) {
			lines.push(
				`  – Diskursiver Bezug der Theoriearbeit zur FRAGESTELLUNG (${dbCount} geprüfte Blöcke): ` +
					`${gr.diskursivBezug.counts.explizit} explizit / ${gr.diskursivBezug.counts.implizit} implizit / ${gr.diskursivBezug.counts.bezugslos} bezugslos`
			);
			if (gr.diskursivBezug.bezugslosBlocks.length > 0) {
				lines.push(`  – Bezugslose Theoriestrecken (max 4):`);
				for (const b of gr.diskursivBezug.bezugslosBlocks.slice(0, 4)) {
					lines.push(
						`    · "${b.containerHeadingText}" Block ${b.blockIndex}: ${b.rationale}`
					);
				}
			}
		}
		// Wiedergabe-Würdigungen (max 4 Stichproben — sonst wird der Block zu lang)
		if (gr.wuerdigungSummaries.length > 0) {
			lines.push(`  – Wiedergabe-Würdigungen (Stichprobe, max 4):`);
			for (const w of gr.wuerdigungSummaries.slice(0, 4)) {
				lines.push(`    · "${w.containerHeadingText}" Block ${w.blockIndex}: ${w.summary}`);
			}
			if (gr.wuerdigungSummaries.length > 4) {
				lines.push(`    · … (${gr.wuerdigungSummaries.length - 4} weitere Wiedergabe-Würdigungen)`);
			}
		}
		parts.push(lines.join('\n'));
	}

	if (input.respecHistory.length > 0) {
		const lines: string[] = [];
		lines.push(
			`EXKURS-Re-Spezifikationen am FORSCHUNGSGEGENSTAND (${input.respecHistory.length} Stück, in Walk-Reihenfolge):`
		);
		for (const e of input.respecHistory) {
			const imp =
				e.importedConcepts.length > 0
					? e.importedConcepts
							.map((c) => (c.sourceAuthor ? `${c.name} (${c.sourceAuthor})` : c.name))
							.join(', ')
					: '–';
			const aff = e.affectedConcepts.length > 0 ? e.affectedConcepts.join(', ') : '–';
			lines.push(`  – EXKURS "${e.exkursHeadingText}":`);
			lines.push(`      importiert: ${imp}`);
			lines.push(`      betrifft: ${aff}`);
			lines.push(`      Re-Spec: ${e.reSpecText}`);
		}
		parts.push(lines.join('\n'));
	}

	if (parts.length === 0) return null;
	return parts.join('\n\n');
}

/**
 * Methodisches-Setup-Block. Critical-Friend-Notiz, wenn keines der drei
 * FORSCHUNGSDESIGN-Konstrukte vorhanden ist.
 */
export function formatMethodischesSetupBlock(fd: ForschungsdesignSnippet): string {
	const parts: string[] = [];
	parts.push(
		`METHODOLOGIE: ${fd.methodologieText ?? '(METHODOLOGIE-Konstrukt nicht vorhanden — FORSCHUNGSDESIGN-Pass nicht gelaufen oder Werk reflektiert keine eigene Methodologie)'}`
	);
	parts.push(
		`METHODEN: ${fd.methodenText ?? '(METHODEN-Konstrukt nicht vorhanden)'}`
	);
	parts.push(
		`BASIS (Sample/Material): ${fd.basisText ?? '(BASIS-Konstrukt nicht vorhanden)'}`
	);
	return parts.join('\n');
}

/**
 * Empirie-Substrat-Block: BEFUND-Liste + audit-only-Hinweis +
 * Argument-Substrat-Größe. Die BEFUND-Texte werden NICHT hier formatiert —
 * der Konsument-Prompt nummeriert sie selbst (für erkenntnisIntegration-
 * Index-Mapping in der SYNTHESE).
 */
export function formatAuditOnlyAndArgumentBlock(input: {
	befundCount: number;
	auditOnlyHotspots: AuditOnlyHotspot[];
	argSubstrate: ArgumentSubstrateCounts | null;
}): string | null {
	const lines: string[] = [];
	lines.push(`BEFUNDE-mit-Text: ${input.befundCount}`);
	if (input.auditOnlyHotspots.length > 0) {
		lines.push(
			`AUDIT-ONLY-Hotspots (DURCHFÜHRUNG-¶ mit Befund-Marker, an denen das BEFUND-Tool keinen extrahierbaren Befund formuliert hat — empirisches Material, das keine Aussage trägt): ${input.auditOnlyHotspots.length}`
		);
		// Verteilung auf Container
		const byContainer = new Map<string, number>();
		for (const h of input.auditOnlyHotspots) {
			byContainer.set(h.containerHeadingText, (byContainer.get(h.containerHeadingText) ?? 0) + 1);
		}
		for (const [container, n] of byContainer) {
			lines.push(`  · "${container}": ${n}`);
		}
	}
	if (input.argSubstrate && input.argSubstrate.argumentNodeCount > 0) {
		lines.push(
			`Argument-Substrat (DURCHFÜHRUNG-AG): ${input.argSubstrate.durchfuehrungArgumentNodeCount} Argumentknoten in DURCHFÜHRUNGS-¶ (gesamt im Werk: ${input.argSubstrate.argumentNodeCount})`
		);
	}
	if (lines.length === 0) return null;
	return lines.join('\n');
}

/**
 * Knappe Beurteilungs-Notiz aus FRAGESTELLUNG_BEURTEILUNG. Wird als Lese-
 * Hinweis an den Konsument-Prompt weitergegeben — Critical-Friend-Notiz,
 * keine Wertung.
 */
export function formatFragestellungBeurteilungBlock(
	beurteilung: FragestellungBeurteilungSnippet | null
): string | null {
	if (!beurteilung) return null;
	return `FRAGESTELLUNG-BEURTEILUNG (Critical-Friend-Notiz aus EXPOSITION): ${beurteilung.beurteilung}`;
}

export function formatMotivationBlock(motivation: MotivationSnippet | null): string | null {
	if (!motivation) return null;
	return `MOTIVATION (Antrieb der Untersuchung, aus EXPOSITION): ${motivation.text}`;
}
