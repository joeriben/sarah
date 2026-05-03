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
import { runArgumentationGraphPass } from '../hermeneutic/argumentation-graph.js';
import { runArgumentValidityPass } from '../hermeneutic/argument-validity.js';
import { extractInlineCitations } from './grundlagentheorie.js';

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

// ──────────────────────────────────────────────────────────────────
// Schritt 2: Selektive H1-Anwendung auf Hotspots
// ──────────────────────────────────────────────────────────────────
//
// Wiederverwendung des bestehenden H1-Tools (Argumentationsgraph +
// Argument-Validity) — pro Hotspot-¶ aus Step 1, NICHT auf dem ganzen
// Container. Das ist der Kern der Mother-Kostenoptimierung: nur dort
// teures LLM-Begründetheits-Reasoning, wo der billige Closure-Marker-
// Filter eine Befund-Verdichtung markiert hat.
//
// Idempotenz-Modell:
//   - argumentation-graph.ts skipt automatisch, wenn argument_nodes oder
//     scaffolding_elements für den ¶ schon existieren.
//   - argument-validity.ts skipt automatisch, wenn alle argument_nodes
//     des ¶ bereits ein validity_assessment haben.
//   - Re-Run für nur einen ¶: DELETE FROM argument_nodes WHERE
//     paragraph_element_id = '...'. (Wir greifen hier nicht aktiv ein,
//     damit ein DURCHFÜHRUNG-Re-Run nicht stillschweigend H1-Outputs
//     wegwirft, die andere Heuristiken evtl. weiterverwenden.)
//
// Persistenz erfolgt vollständig in den H1-Tabellen — KEIN
// function_construct in Step 2. BEFUND-Konstrukte entstehen erst,
// wenn Step 3 (stellenspezifische Regex-Rückwärtssuche) den
// Verfahrens-/Gegenstandsbezug für die Begründungs-Beurteilung
// ergänzt hat. Memory: feedback_constructs_are_extracts_not_telemetry.

async function loadHotspotsFromContainers(
	caseId: string,
	documentId: string
): Promise<{ paragraphId: string; charStart: number; charEnd: number; markerNames: string[] }[]> {
	const rows = (await query<{
		element_id: string;
		start_seq: number;
		end_seq: number;
		marker_names: string[] | null;
	}>(
		`SELECT (r->>'element_id')::uuid AS element_id,
		        (r->>'start_seq')::int  AS start_seq,
		        (r->>'end_seq')::int    AS end_seq,
		        ARRAY(
		          SELECT jsonb_array_elements_text(r->'marker_names')
		        )::text[] AS marker_names
		 FROM virtual_function_containers vfc,
		      jsonb_array_elements(vfc.source_anchor_ranges) r
		 WHERE vfc.case_id = $1
		   AND vfc.document_id = $2
		   AND vfc.outline_function_type = 'DURCHFUEHRUNG'
		 ORDER BY (r->>'start_seq')::int`,
		[caseId, documentId]
	)).rows;

	return rows.map((r) => ({
		paragraphId: r.element_id,
		charStart: r.start_seq,
		charEnd: r.end_seq,
		markerNames: r.marker_names ?? [],
	}));
}

export interface DurchfuehrungStep2HotspotResult {
	paragraphId: string;
	markerNames: string[];
	ag: {
		ranSkipped: boolean; // skipped weil bereits persistiert
		argumentsStored: number;
		scaffoldingStored: number;
	};
	validity: {
		ranSkipped: boolean;
		argumentsAssessed: number;
	};
	tokens: { input: number; output: number; cacheCreation: number; cacheRead: number };
	error: { stage: 'ag' | 'validity'; message: string } | null;
}

export interface DurchfuehrungStep2Result {
	caseId: string;
	documentId: string;
	hotspotCount: number;
	processed: number;
	skippedAg: number;
	skippedValidity: number;
	totalArgumentsStored: number;
	totalScaffoldingStored: number;
	totalArgumentsAssessed: number;
	tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number };
	errors: { paragraphId: string; stage: 'ag' | 'validity'; message: string }[];
	hotspots: DurchfuehrungStep2HotspotResult[];
}

export async function runDurchfuehrungPassStep2(
	caseId: string
): Promise<DurchfuehrungStep2Result> {
	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.central_document_id) {
		throw new Error(`Case ${caseId} has no central_document_id`);
	}
	const documentId = caseRow.central_document_id;

	const hotspots = await loadHotspotsFromContainers(caseId, documentId);

	const acc = {
		input: 0,
		output: 0,
		cacheCreation: 0,
		cacheRead: 0,
		total: 0,
	};
	let processed = 0;
	let skippedAg = 0;
	let skippedValidity = 0;
	let totalArgumentsStored = 0;
	let totalScaffoldingStored = 0;
	let totalArgumentsAssessed = 0;
	const errors: { paragraphId: string; stage: 'ag' | 'validity'; message: string }[] = [];
	const perHotspot: DurchfuehrungStep2HotspotResult[] = [];

	for (const h of hotspots) {
		const tokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
		let agSkipped = false;
		let validitySkipped = false;
		let argumentsStored = 0;
		let scaffoldingStored = 0;
		let argumentsAssessed = 0;
		let perError: { stage: 'ag' | 'validity'; message: string } | null = null;

		// AG-Pass — sequenziell, weil ein Empirie-Hotspot oft seitenlange
		// Folgehotspots im selben Container hat und parallele Calls kein
		// echtes Throughput-Plus bringen, dafür aber Rate-Limit-Risiko.
		try {
			const ag = await runArgumentationGraphPass(caseId, h.paragraphId);
			if (ag.skipped) {
				agSkipped = true;
				skippedAg += 1;
			} else {
				argumentsStored = ag.stored?.nodeIds.length ?? 0;
				scaffoldingStored = ag.stored?.scaffoldingIds.length ?? 0;
				totalArgumentsStored += argumentsStored;
				totalScaffoldingStored += scaffoldingStored;
				if (ag.tokens) {
					tokens.input += ag.tokens.input;
					tokens.output += ag.tokens.output;
					tokens.cacheCreation += ag.tokens.cacheCreation;
					tokens.cacheRead += ag.tokens.cacheRead;
					acc.input += ag.tokens.input;
					acc.output += ag.tokens.output;
					acc.cacheCreation += ag.tokens.cacheCreation;
					acc.cacheRead += ag.tokens.cacheRead;
					acc.total += ag.tokens.total;
				}
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			perError = { stage: 'ag', message: msg };
			errors.push({ paragraphId: h.paragraphId, stage: 'ag', message: msg });
			perHotspot.push({
				paragraphId: h.paragraphId,
				markerNames: h.markerNames,
				ag: { ranSkipped: false, argumentsStored: 0, scaffoldingStored: 0 },
				validity: { ranSkipped: false, argumentsAssessed: 0 },
				tokens,
				error: perError,
			});
			continue;
		}

		// Validity-Pass — nur wenn AG erfolgreich war (egal ob skipped).
		try {
			const v = await runArgumentValidityPass(caseId, h.paragraphId);
			if (v.skipped) {
				validitySkipped = true;
				skippedValidity += 1;
			} else {
				argumentsAssessed = v.updatedCount;
				totalArgumentsAssessed += argumentsAssessed;
				if (v.tokens) {
					tokens.input += v.tokens.input;
					tokens.output += v.tokens.output;
					tokens.cacheCreation += v.tokens.cacheCreation;
					tokens.cacheRead += v.tokens.cacheRead;
					acc.input += v.tokens.input;
					acc.output += v.tokens.output;
					acc.cacheCreation += v.tokens.cacheCreation;
					acc.cacheRead += v.tokens.cacheRead;
					acc.total += v.tokens.total;
				}
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			perError = { stage: 'validity', message: msg };
			errors.push({ paragraphId: h.paragraphId, stage: 'validity', message: msg });
		}

		processed += 1;
		perHotspot.push({
			paragraphId: h.paragraphId,
			markerNames: h.markerNames,
			ag: { ranSkipped: agSkipped, argumentsStored, scaffoldingStored },
			validity: { ranSkipped: validitySkipped, argumentsAssessed },
			tokens,
			error: perError,
		});
	}

	return {
		caseId,
		documentId,
		hotspotCount: hotspots.length,
		processed,
		skippedAg,
		skippedValidity,
		totalArgumentsStored,
		totalScaffoldingStored,
		totalArgumentsAssessed,
		tokens: acc,
		errors,
		hotspots: perHotspot,
	};
}

// ──────────────────────────────────────────────────────────────────
// Schritt 3: Stellenspezifische Regex-Rückwärtssuche (Grounding-Lookup)
// ──────────────────────────────────────────────────────────────────
//
// Mother-Setzung (Z. 109 + Folgenachricht): "Dem H1-Tool wird ggf. das
// referenzielle Grounding fehlen. Es muss daher nach oben suchen dürfen
// bzw. dabei unterstützt werden — agentisches Such-Tool, das vom Argument
// aus nach oben Regex sucht bis zum Kapitelbeginn. Nicht stur alle
// Absätze, sondern per Regex mit Pattern der gerade untersuchten Stelle."
//
// Diese Stufe stellt das Such-Tool selbst bereit (deterministisch). Die
// agentische Verwendung — LLM ruft das Tool tool-use-mäßig auf, um
// Grounding zu rekonstruieren — ist Aufgabe eines folgenden BEFUND-
// Konsolidierungs-Schritts und bewusst nicht hier kombiniert (Memory:
// feedback_features_before_interface — Feature steht, Interface folgt).
//
// Pattern-Quellen aus dem Hotspot-¶:
//   1. Eigennamen / distinktive Großbuchstaben-Tokens (Personen-/Orts-/
//      Konzeptnamen, Fall-IDs wie "Domino", "Candy" in Empirie-Habils).
//      Filter: ≥4 Zeichen, Stop-Liste deutscher Funktionswörter und
//      Container-Begriffe — Memory `feedback_pattern_iteration_vs_simpler_heuristic`:
//      schmal halten, später iterieren.
//   2. Inline-Zitate (Author-Year) via extractInlineCitations aus
//      grundlagentheorie.ts — wiederverwendet, kein eigener Parser.
//
// Suchraum: alle ¶ desselben DURCHFÜHRUNGS-Containers VOR dem Hotspot-¶
// (charStart < hotspot.charStart). Nicht über Container-Grenzen hinaus —
// Mother-Setzung "bis zum Kapitelbeginn".
//
// Output: pro Token die Liste der Treffer-¶ (sortiert: nächster zuerst),
// plus first introduction (frühestes ¶ im Container, das den Token
// enthält). Tokens ohne Treffer landen in `unmatched` — wertvolles Signal,
// dass der Verweis-Anker nicht im selben Kapitel begründet ist.

const PROPER_NOUN_STOP_WORDS = new Set<string>([
	// Determinatoren / Pronomina (Satzanfang)
	'Der', 'Die', 'Das', 'Den', 'Dem', 'Des',
	'Ein', 'Eine', 'Einer', 'Eines', 'Einem', 'Einen',
	'Diese', 'Dieser', 'Dieses', 'Diesen', 'Diesem',
	'Jene', 'Jener', 'Jenes', 'Jenen', 'Jenem',
	'Welcher', 'Welche', 'Welches',
	// Häufige Satzanfangswörter
	'Aber', 'Doch', 'Denn', 'Daher', 'Dabei', 'Dadurch', 'Damit', 'Daran',
	'Darin', 'Darüber', 'Darum', 'Darauf', 'Davon', 'Demnach', 'Dennoch',
	'Deshalb', 'Deswegen', 'Hierbei', 'Hierfür', 'Hierzu', 'Hingegen',
	'Insgesamt', 'Ferner', 'Schließlich', 'Zudem', 'Zugleich',
	// Präpositionen am Satzanfang
	'Im', 'Am', 'Um', 'In', 'An', 'Auf', 'Über', 'Unter', 'Vor', 'Nach',
	'Neben', 'Bei', 'Mit', 'Aus', 'Ohne', 'Durch', 'Für', 'Wegen',
	'Beim', 'Vom', 'Zum', 'Zur', 'Ans', 'Aufs',
	// Konjunktionen
	'Und', 'Oder', 'Sowie', 'Wenn', 'Weil', 'Wobei', 'Während', 'Obwohl',
	'Sodass', 'Dass',
	// Akademische Container-Begriffe (zu generisch um distinktiv zu sein)
	'Studie', 'Untersuchung', 'Forschung', 'Analyse', 'Befund', 'Befunde',
	'Ergebnis', 'Ergebnisse', 'Beispiel', 'Beispiele', 'Kapitel',
	'Abschnitt', 'Punkt', 'Teil', 'Tabelle', 'Abbildung', 'Diagramm',
	'Daten', 'Material', 'Sample', 'Korpus', 'Fall', 'Falls', 'Fälle',
	// Zeit-/Datums-Ausdrücke
	'Anfang', 'Beginn', 'Ende', 'Mitte', 'Schluss', 'Stand',
	'Jahr', 'Tag', 'Monat', 'Woche', 'Stunde',
	'Phase', 'Stufe', 'Etappe', 'Periode', 'Zeitraum',
	// Monate
	'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
	'August', 'September', 'Oktober', 'November', 'Dezember',
	// Citation-Marker
	'Vgl', 'Siehe', 'Ebd', 'Hrsg', 'Hg', 'Etc', 'Bzw',
	// Sehr generisch
	'Werk', 'Werke', 'Text', 'Texte', 'Aussage', 'Aussagen', 'Frage',
	'Fragen', 'Antwort', 'Antworten', 'Begriff', 'Begriffe',
	'Thema', 'Themen', 'Sache', 'Sachen', 'Form', 'Formen',
	'Ebene', 'Ebenen', 'Aspekt', 'Aspekte', 'Punkt', 'Punkte',
]);

const PROPER_NOUN_RE = /\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]{3,})\b/g;

export interface ExtractedToken {
	token: string;
	kind: 'proper_noun' | 'citation';
}

export function extractDistinctiveTokens(
	hotspot: BefundHotspot
): ExtractedToken[] {
	const out = new Map<string, ExtractedToken>();

	// (1) Eigennamen / distinktive Großbuchstaben-Tokens.
	PROPER_NOUN_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = PROPER_NOUN_RE.exec(hotspot.text)) !== null) {
		const token = m[1];
		if (PROPER_NOUN_STOP_WORDS.has(token)) continue;
		// Doppel-Großschreibung wie "GCED", "UNESCO" einlassen — sind oft
		// distinktive Akronyme. Rein-numerische Tokens treten hier nicht auf
		// (Pattern verlangt Anfangs-Großbuchstaben).
		if (!out.has(token)) {
			out.set(token, { token, kind: 'proper_noun' });
		}
	}

	// (2) Inline-Zitate (Author-Year) — wiederverwendet aus
	// grundlagentheorie.ts. Wir wickeln den Hotspot-¶ in die dortige
	// GrundlagentheorieParagraph-Form ein (strukturell kompatibel).
	const citations = extractInlineCitations({
		paragraphId: hotspot.paragraphId,
		charStart: hotspot.charStart,
		charEnd: hotspot.charEnd,
		text: hotspot.text,
		indexInContainer: hotspot.indexInContainer,
	});
	for (const c of citations) {
		// Erstautor-Familienname als suchbares Token. Familienname ist
		// distinktiver als die volle "Author Year"-Form, die im Vorlauf
		// nur selten 1:1 wiederholt wird.
		const firstAuthor = c.authorsCanonical[0];
		if (!firstAuthor) continue;
		// Bei Mehrwort-Familiennamen ("Castro Varela") nur den letzten
		// Bestandteil als Suchschlüssel — der ist üblicherweise das
		// Zitations-Stem.
		const stem = firstAuthor.split(/\s+/).pop() ?? firstAuthor;
		if (PROPER_NOUN_STOP_WORDS.has(stem)) continue;
		// Citation-Tokens überschreiben proper_noun-Klassifikation —
		// die Author-Identifikation ist die spezifischere Quelle.
		out.set(stem, { token: stem, kind: 'citation' });
	}

	return Array.from(out.values());
}

export interface GroundingMatch {
	token: string;
	kind: 'proper_noun' | 'citation';
	matchedParagraphIds: string[];   // alle Vorlauf-¶ mit Treffer, sortiert nach char_start ASC
	nearestParagraphId: string | null; // letztes Vorlauf-¶ vor Hotspot mit Treffer
	firstParagraphId: string | null;   // erstes Vorlauf-¶ im Container mit Treffer
}

export interface GroundingLookupForHotspot {
	hotspotParagraphId: string;
	containerHeadingId: string;
	extractedTokens: ExtractedToken[];
	matches: GroundingMatch[];
	unmatched: ExtractedToken[];
}

function buildTokenMatcher(token: string): RegExp {
	// Wortgrenzen-Match, case-insensitive bewusst NICHT — Eigennamen sind
	// typografisch markiert. RegExp-Sonderzeichen escapen (Familiennamen
	// können Bindestriche enthalten, das ist aber kein Sonderzeichen).
	const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`\\b${escaped}\\b`);
}

export function lookupGroundingForHotspot(
	hotspot: BefundHotspot,
	container: DurchfuehrungContainer
): GroundingLookupForHotspot {
	const tokens = extractDistinctiveTokens(hotspot);

	// Suchraum: ¶ vor dem Hotspot im selben Container.
	const priorParagraphs = container.paragraphs.filter(
		(p) => p.charStart < hotspot.charStart
	);

	const matches: GroundingMatch[] = [];
	const unmatched: ExtractedToken[] = [];

	for (const t of tokens) {
		const re = buildTokenMatcher(t.token);
		const hits: string[] = [];
		for (const p of priorParagraphs) {
			if (re.test(p.text)) hits.push(p.paragraphId);
		}
		if (hits.length === 0) {
			unmatched.push(t);
			continue;
		}
		matches.push({
			token: t.token,
			kind: t.kind,
			matchedParagraphIds: hits,
			nearestParagraphId: hits[hits.length - 1] ?? null,
			firstParagraphId: hits[0] ?? null,
		});
	}

	return {
		hotspotParagraphId: hotspot.paragraphId,
		containerHeadingId: container.headingId,
		extractedTokens: tokens,
		matches,
		unmatched,
	};
}

export interface DurchfuehrungStep3HotspotResult {
	hotspotParagraphId: string;
	containerHeadingText: string;
	extractedTokens: number;
	matchedTokens: number;
	unmatchedTokens: number;
	lookup: GroundingLookupForHotspot;
}

export interface DurchfuehrungStep3Result {
	caseId: string;
	documentId: string;
	hotspotCount: number;
	totalExtractedTokens: number;
	totalMatched: number;
	totalUnmatched: number;
	hotspots: DurchfuehrungStep3HotspotResult[];
}

export async function runDurchfuehrungPassStep3(
	caseId: string
): Promise<DurchfuehrungStep3Result> {
	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.central_document_id) {
		throw new Error(`Case ${caseId} has no central_document_id`);
	}
	const documentId = caseRow.central_document_id;

	// Container neu aufbauen (statt aus virtual_function_containers zu
	// rekonstruieren, weil wir den vollständigen ¶-Vorlauf brauchen,
	// nicht nur die Hotspots — die Rückwärtssuche läuft auf den
	// nicht-Hotspot-¶, die in vfc nicht enthalten sind).
	const containers = await loadDurchfuehrungContainers(documentId);

	const hotspotResults: DurchfuehrungStep3HotspotResult[] = [];
	let totalExtractedTokens = 0;
	let totalMatched = 0;
	let totalUnmatched = 0;

	for (const container of containers) {
		const hotspots = detectBefundHotspots(container);
		for (const h of hotspots) {
			const lookup = lookupGroundingForHotspot(h, container);
			totalExtractedTokens += lookup.extractedTokens.length;
			totalMatched += lookup.matches.length;
			totalUnmatched += lookup.unmatched.length;
			hotspotResults.push({
				hotspotParagraphId: h.paragraphId,
				containerHeadingText: container.headingText,
				extractedTokens: lookup.extractedTokens.length,
				matchedTokens: lookup.matches.length,
				unmatchedTokens: lookup.unmatched.length,
				lookup,
			});
		}
	}

	return {
		caseId,
		documentId,
		hotspotCount: hotspotResults.length,
		totalExtractedTokens,
		totalMatched,
		totalUnmatched,
		hotspots: hotspotResults,
	};
}
