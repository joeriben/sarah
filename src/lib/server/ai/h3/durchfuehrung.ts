// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:DURCHFÜHRUNG — Schritt 1 (deterministisch, kein LLM).
//
// Mother-Session-Setzung (Z. 109 + L<follow-up nach extraction>):
// "Empirieartikel sind sehr lang und enthalten zwar Schlüsse, aber wenig
// Argumentation. H1 wäre auf das ganze Material teuer und sinnlos. Daher
// Regex/Heuristik analog zu GRUNDLAGENTHEORIE Step 1: thematische Hot-Spots
// in Bezug auf Befunde ermitteln. Deren Begründetheit wird in einem
// späteren Schritt mit H1 eingeschätzt — und zwar nur dort, wo Hot-Spots
// liegen. Schätzung: 10–20% einer empirischen DURCHFÜHRUNG müssen wirklich
// per LLM analysiert werden."
//
// Diese Stufe macht den billigen Vorlauf: Closure-Marker-Regex über alle
// DURCHFÜHRUNGS-Container des Werks, Persistenz der Hot-Spot-¶ als
// virtuelle Container (ein virtueller Container pro Outline-Container),
// damit der spätere H1-Schritt nur auf der reduzierten Menge läuft.
//
// Konstrukt-Schreibung (BEFUND) erfolgt NICHT in dieser Stufe, sondern
// erst in Schritt 2 nach H1-Pass — Memory `feedback_constructs_are_extracts_not_telemetry`:
// Hot-Spot-Listen sind Pre-Selektion, nicht Extrakt.
//
// Re-Run: idempotent über DELETE auf virtual_function_containers für
// (case_id, document_id, outline_function_type='DURCHFUEHRUNG') vor dem
// neuen INSERT. Spätere BEFUND-Konstrukte (Schritt 2) hängen über
// virtual_container_id daran und gehen FK-SET-NULL bei Container-Löschung.

import { query, queryOne } from '../../db/index.js';

// ── Closure-Marker für Befund-Stellen ─────────────────────────────
//
// Geschlossene Set-Liste. Bewusst schmal gehalten — Memory
// `feedback_pattern_iteration_vs_simpler_heuristic`: lieber kleine
// Diagnostik-Liste, dann iterieren, als großer Pattern-Katalog
// vorab. Erweiterung erfolgt nach realer Materialbeobachtung.

const BEFUND_MARKERS: { name: string; re: RegExp }[] = [
	{ name: 'zeigt_sich', re: /\b(zeigt(e)?\s+sich|zeigen\s+sich|gezeigt\s+(werden|wurde|wird))\b/i },
	{ name: 'befund_lemma', re: /\b(Befund(e|s|en)?|Ergebnis(se|ses|sen)?|Resultat(e|s|en)?)\b/ },
	{ name: 'ergibt_sich', re: /\b(ergibt|ergab)\s+sich\b/i },
	{ name: 'feststellen', re: /\b(fest(gestellt|zuhalten|halten|stellen|stellt))\b/i },
	{ name: 'lassen_sich', re: /\b(lässt|läßt|lassen)\s+(sich\s+)?(erkennen|konstatieren|festhalten|ableiten|schließen|resümieren|zeigen)\b/i },
	{ name: 'hervorgehen', re: /\b(hervor(zugehen|geht|gehen|gegangen|gehend))\b/i },
	{ name: 'deutlich_werden', re: /\bdeutlich\s+(wird|werden|geworden|wurde)\b/i },
	{ name: 'weist_hin', re: /\b(weist|weisen)\s+darauf\s+hin\b/i },
	{ name: 'deutet_hin', re: /\bdeutet\s+(darauf\s+hin|sich\s+an)\b/i },
	{ name: 'macht_deutlich', re: /\b(macht|machen)\s+(deutlich|sichtbar|erkennbar)\b/i },
	{ name: 'dokumentiert_sich', re: /\bdokumentier(t|en)\s+sich\b/i },
	{ name: 'rekonstruiert_sich', re: /\brekonstruier(t|en)\s+sich\b/i },
	{ name: 'kommt_zum_ausdruck', re: /\bkommt\s+zum\s+Ausdruck\b/i },
	{ name: 'tritt_hervor', re: /\btritt(\s+(deutlich|klar))?\s+hervor\b/i },
	{ name: 'zusammenfassend', re: /\b(zusammenfassend|abschließend|resümierend)\b/i },
	{ name: 'material_referenz', re: /\bim\s+(Sample|Material|Korpus|Datenmaterial|Fall|Beispiel)\b/ },
	{ name: 'wird_ersichtlich', re: /\bwird\s+(ersichtlich|sichtbar|erkennbar)\b/i },
];

interface MarkerHit {
	name: string;
	matchedText: string;
}

function findBefundMarkers(text: string): MarkerHit[] {
	const hits: MarkerHit[] = [];
	for (const { name, re } of BEFUND_MARKERS) {
		const m = text.match(re);
		if (m) hits.push({ name, matchedText: m[0] });
	}
	return hits;
}

// ── Container-Resolution ──────────────────────────────────────────

export interface DurchfuehrungParagraph {
	paragraphId: string;
	charStart: number;
	charEnd: number;
	text: string;
	indexInContainer: number;
}

export interface DurchfuehrungContainer {
	headingId: string;
	headingText: string;
	paragraphs: DurchfuehrungParagraph[];
}

export async function loadDurchfuehrungContainers(
	documentId: string
): Promise<DurchfuehrungContainer[]> {
	// Identisches Muster wie loadGrundlagentheorieContainers: ¶ über
	// LATERAL-Lookup dem nächstgelegenen Heading mit
	// outline_function_type='DURCHFUEHRUNG' zugeordnet, sodass
	// verschachtelte DURCHFÜHRUNGS-Subheadings den ¶ vom übergeordneten
	// Container übernehmen lassen können (LATERAL gewinnt der nähere Heading).
	const rows = (await query<{
		paragraph_id: string;
		char_start: number;
		char_end: number;
		text: string;
		heading_id: string;
		heading_text: string;
	}>(
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
		     AND hc.outline_function_type IS NOT NULL
		     AND COALESCE(hc.excluded, false) = false
		 )
		 SELECT p.id AS paragraph_id,
		        p.char_start,
		        p.char_end,
		        SUBSTRING(dc.full_text FROM p.char_start + 1
		                              FOR p.char_end - p.char_start) AS text,
		        h.heading_id,
		        h.heading_text
		 FROM document_elements p
		 JOIN document_content dc ON dc.naming_id = p.document_id
		 JOIN LATERAL (
		   SELECT hwt.heading_id, hwt.heading_text, hwt.outline_function_type
		   FROM heading_with_type hwt
		   WHERE hwt.char_start <= p.char_start
		   ORDER BY hwt.char_start DESC
		   LIMIT 1
		 ) h ON h.outline_function_type = 'DURCHFUEHRUNG'
		 WHERE p.document_id = $1
		   AND p.element_type = 'paragraph'
		   AND p.section_kind = 'main'
		 ORDER BY p.char_start`,
		[documentId]
	)).rows;

	const byHeading = new Map<string, DurchfuehrungContainer>();
	for (const r of rows) {
		let c = byHeading.get(r.heading_id);
		if (!c) {
			c = {
				headingId: r.heading_id,
				headingText: r.heading_text.trim(),
				paragraphs: [],
			};
			byHeading.set(r.heading_id, c);
		}
		c.paragraphs.push({
			paragraphId: r.paragraph_id,
			charStart: r.char_start,
			charEnd: r.char_end,
			text: r.text.trim(),
			indexInContainer: c.paragraphs.length,
		});
	}
	return Array.from(byHeading.values());
}

// ── Hotspot-Detection ─────────────────────────────────────────────

export interface BefundHotspot {
	paragraphId: string;
	charStart: number;
	charEnd: number;
	text: string;
	indexInContainer: number;
	markers: MarkerHit[];
}

export function detectBefundHotspots(
	container: DurchfuehrungContainer
): BefundHotspot[] {
	const hotspots: BefundHotspot[] = [];
	for (const p of container.paragraphs) {
		const markers = findBefundMarkers(p.text);
		if (markers.length === 0) continue;
		hotspots.push({
			paragraphId: p.paragraphId,
			charStart: p.charStart,
			charEnd: p.charEnd,
			text: p.text,
			indexInContainer: p.indexInContainer,
			markers,
		});
	}
	return hotspots;
}

// ── Persistenz: virtuelle Container ───────────────────────────────

async function clearExistingDurchfuehrung(
	caseId: string,
	documentId: string
): Promise<void> {
	// FK function_constructs.virtual_container_id ON DELETE SET NULL —
	// frühere BEFUND-Konstrukte (sobald Schritt 2 läuft) verbleiben, ihre
	// Container-Bindung wird aber genullt. Schritt 2 muss dann beim Re-Run
	// auch eigene BEFUND-Konstrukt-Cleanup machen. Hier in Schritt 1 nur
	// der Container.
	await query(
		`DELETE FROM virtual_function_containers
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'DURCHFUEHRUNG'`,
		[caseId, documentId]
	);
}

async function persistHotspotContainer(
	caseId: string,
	documentId: string,
	container: DurchfuehrungContainer,
	hotspots: BefundHotspot[]
): Promise<string> {
	const ranges = hotspots.map((h) => ({
		element_id: h.paragraphId,
		start_seq: h.charStart,
		end_seq: h.charEnd,
		marker_names: h.markers.map((m) => m.name),
	}));

	const row = await queryOne<{ id: string }>(
		`INSERT INTO virtual_function_containers
		   (case_id, document_id, outline_function_type, granularity_level,
		    label, source_anchor_ranges)
		 VALUES ($1, $2, 'DURCHFUEHRUNG', NULL, $3, $4)
		 RETURNING id`,
		[caseId, documentId, container.headingText, JSON.stringify(ranges)]
	);
	if (!row) {
		throw new Error(
			`Failed to persist DURCHFUEHRUNG hotspot container for "${container.headingText}"`
		);
	}
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

export interface DurchfuehrungContainerResult {
	headingId: string;
	headingText: string;
	totalParagraphs: number;
	hotspots: BefundHotspot[];
	virtualContainerId: string | null;
}

export interface DurchfuehrungPassResult {
	caseId: string;
	documentId: string;
	containers: DurchfuehrungContainerResult[];
	totalParagraphs: number;
	totalHotspots: number;
	hotspotRatio: number; // 0..1; Mother-Setzung Ziel ~0.10–0.20 für H1-Folgepass
}

export async function runDurchfuehrungPassStep1(
	caseId: string
): Promise<DurchfuehrungPassResult> {
	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.central_document_id) {
		throw new Error(`Case ${caseId} has no central_document_id`);
	}
	const documentId = caseRow.central_document_id;

	const containers = await loadDurchfuehrungContainers(documentId);

	if (containers.length === 0) {
		return {
			caseId,
			documentId,
			containers: [],
			totalParagraphs: 0,
			totalHotspots: 0,
			hotspotRatio: 0,
		};
	}

	await clearExistingDurchfuehrung(caseId, documentId);

	const containerResults: DurchfuehrungContainerResult[] = [];
	let totalParagraphs = 0;
	let totalHotspots = 0;

	for (const container of containers) {
		totalParagraphs += container.paragraphs.length;
		const hotspots = detectBefundHotspots(container);
		totalHotspots += hotspots.length;

		let virtualContainerId: string | null = null;
		if (hotspots.length > 0) {
			virtualContainerId = await persistHotspotContainer(
				caseId,
				documentId,
				container,
				hotspots
			);
		}

		containerResults.push({
			headingId: container.headingId,
			headingText: container.headingText,
			totalParagraphs: container.paragraphs.length,
			hotspots,
			virtualContainerId,
		});
	}

	return {
		caseId,
		documentId,
		containers: containerResults,
		totalParagraphs,
		totalHotspots,
		hotspotRatio: totalParagraphs > 0 ? totalHotspots / totalParagraphs : 0,
	};
}
