// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:FORSCHUNGSDESIGN — extrahiert METHODOLOGIE, METHODEN und BASIS
// (Korpus oder Erhebung) aus dem methodischen Material eines Werkes.
//
// Memory: project_three_heuristics_architecture.md (FORSCHUNGSDESIGN-Tabelle),
// feedback_no_phase_layer_orchestrator.md.
//
// Walk-Position (Setzung 2026-05-04): FORSCHUNGSDESIGN ist ein WERK-skopierter
// Knoten im H3-Walk — nicht per Komplex iteriert, sondern genau einmal pro
// Werk ausgeführt. Im linearen Walk steht es nach allen GRUNDLAGENTHEORIE-
// Komplexen UND nach dem werk-skopierten FG-Aggregations-Knoten (der den
// FORSCHUNGSGEGENSTAND-Konstrukt produziert). Wenn das Werk eigene
// FORSCHUNGSDESIGN-getypte Headings hat, absorbiert dieser Werk-Knoten alle
// FORSCHUNGSDESIGN-Komplexe in einem Pass — der Orchestrator iteriert sie
// nicht einzeln.
//
// Choreographie:
//   1. ¶-Sammlung kaskadierend, mit Provenienz-Tracking pro ¶:
//      a) Walk-Komplexe mit functionType='FORSCHUNGSDESIGN' (alle, in Walk-
//         Reihenfolge zusammengefügt).
//      b) Falls leer: EXPOSITION-Container, Methoden-Marker-Filter pro ¶.
//      c) Falls leer: Volltext-Scan über alle main-¶, Methoden-Marker-Filter.
//      Stop bei erstem Treffer-Set.
//   2. Persistenter virtueller Container für (doc_id, FORSCHUNGSDESIGN);
//      bei Re-Run wird der alte Container + zugehörige FORSCHUNGSDESIGN-
//      Konstrukte gelöscht. Provenienz-Marker pro Range im Container.
//   3. Bezugsrahmen laden: FRAGESTELLUNG (EXPOSITION, Charakterisierung)
//      und FORSCHUNGSGEGENSTAND (GRUNDLAGENTHEORIE, Spezifizierung).
//      CCS-Logik: cue → characterization → specification.
//      Die FRAGESTELLUNG aus der Exposition ist allenfalls characterisiert
//      (außer sie ist bereits in der Einleitung hart theoretisch belegt);
//      erst FORSCHUNGSGEGENSTAND liefert die Spezifizierung. Die methodisch
//      relevante "spezifizierte Fragestellung" ist beides zusammen.
//      Beide sind HARTE Vorbedingungen — fehlt einer, wird die Heuristik
//      nicht ausgeführt (PreconditionFailedError). Konsequenz aus
//      docs/h3_orchestrator_spec.md #2: kein analytischer Lauf ohne
//      vollständigen Analysehorizont.
//   4. METHODIK_EXTRAHIEREN: ein LLM-Call, drei Felder ein Pass.
//      Pro Feld mit non-null Inhalt → ein function_construct mit
//      construct_kind METHODOLOGIE / METHODEN / BASIS.
//
// VALIDITY_FALLACY_PRÜFEN und scaffolding-Querschnittsbaustein sind
// laut Mother-Session ebenfalls Teil von FORSCHUNGSDESIGN, in dieser
// Iteration aber bewusst weggelassen — Substanz erst, Querschnitt später.

import { z } from 'zod';
import { query, queryOne } from '../../db/index.js';
import { chat, getModel, getProvider, type Provider } from '../client.js';
import { extractAndValidateJSON } from '../json-extract.js';
import { PreconditionFailedError } from './precondition.js';
import { loadH3ComplexWalk } from '../../pipeline/h3-complex-walk.js';
import {
	loadH3CaseContext,
	formatWerktypLine,
	type H3BriefContext,
} from './werk-shared.js';

type ModelOverride = { provider: Provider; model: string };

export interface ForschungsdesignPassOptions {
	modelOverride?: ModelOverride;
}

// ── Marker-Set für Methoden-Sätze ─────────────────────────────────

const METHODEN_MARKERS: RegExp[] = [
	/\b(methodisch|methode(n|nlehre|nwahl)?|methodologie|methodologisch)\b/i,
	/\b(vorgehen|vorgehensweise|verfahren|untersuchungsdesign|forschungsdesign)\b/i,
	/\b(qualitativ|quantitativ|hermeneutisch|interpretativ|rekonstruktiv)\b/i,
	/\b(diskursanalys|inhaltsanalys|sequenzanalys|sequentiell|grounded\s+theory|phänomenolog)/i,
	/\b(vergleich(en|end)?|kontrast|gegenüberstellung|fallstudie|fallanalys|fallvergleich)/i,
	/\b(korpus|erhebung|stichprobe|sample|feld(forschung)?|interview|fragebogen|teilnehmend)/i,
	/\b(auswertung(s)?|kategorienbasiert|kodier|kodieren|gütekriteri)/i,
	/\b(triangulation|theoretical\s+sampling|inhaltsanalytisch)/i,
];

function paragraphHasMethodenMarker(text: string): boolean {
	return METHODEN_MARKERS.some((re) => re.test(text));
}

// ── Marker-Set für Aufbau-Skizzen ─────────────────────────────────
//
// Aufbau-Skizzen sind Plan/Vorgehensweise-Beschreibungen in der Einleitung —
// methodologisch unbegründet, aber strukturell-narrativ erkennbar. Critical-
// Friend-Befund: planvoll, aber methodisch nicht reflektiert. Drei Marker-
// Familien: sequentielle Reihenfolge ("im ersten Teil … im zweiten Teil …"),
// Aufbau-Vokabular ("Aufbau dieser Arbeit", "im Folgenden"), Werk-
// Selbstreferenz ("die Arbeit gliedert sich").

const AUFBAU_SEQUENTIAL_MARKERS: RegExp[] = [
	/\bim\s+(ersten|zweiten|dritten|vierten|letzten)\s+(teil|kapitel|abschnitt|schritt)\b/i,
	/\b(zunächst|zuerst|anschließend|danach|abschließend|schließlich|im\s+folgenden|sodann|sodass)\b/i,
	/\bdarauf(hin|\s+aufbauend)?\b/i,
	/\b(zum\s+abschluss|am\s+ende\s+der\s+arbeit|im\s+letzten)\b/i,
];
const AUFBAU_GLIEDERUNG_MARKERS: RegExp[] = [
	/\bdie\s+arbeit\s+(gliedert\s+sich|ist\s+gegliedert|besteht\s+aus|umfasst|setzt\s+sich\s+zusammen)\b/i,
	/\b(aufbau|gliederung|struktur)\s+(dieser|der\s+vorliegenden)\s+arbeit\b/i,
	/\bim\s+folgenden\s+wird\b/i,
	/\b(in\s+kapitel|im\s+kapitel)\s+\d+\b/i,
];

function paragraphHasAufbauMarker(text: string): { hits: number; isAufbau: boolean } {
	let sequentialHits = 0;
	for (const re of AUFBAU_SEQUENTIAL_MARKERS) {
		const matches = text.match(re);
		if (matches) sequentialHits += matches.length;
	}
	const gliederungHit = AUFBAU_GLIEDERUNG_MARKERS.some((re) => re.test(text));
	// Aufbau-Skizze gilt als detektiert, wenn entweder ≥3 sequentielle Marker
	// im selben ¶ (typisches "Im ersten Teil … im zweiten Teil … abschließend …"-
	// Pattern) oder ≥1 Gliederungs-Marker plus ≥1 sequenzieller Marker.
	const isAufbau =
		sequentialHits >= 3 || (gliederungHit && sequentialHits >= 1);
	return { hits: sequentialHits + (gliederungHit ? 1 : 0), isAufbau };
}

// ── ¶-Sammlung mit Provenienz ────────────────────────────────────

type Provenance = 'outline_container' | 'exposition_fallback' | 'fulltext_regex';

interface CollectedParagraph {
	paragraphId: string;
	charStart: number;
	charEnd: number;
	text: string;
	containerHeadingText: string | null;
	provenance: Provenance;
}

/**
 * Strategie A: ¶ aus FORSCHUNGSDESIGN-Komplexen des H3-Walks.
 * Wenn das Werk mehrere FORSCHUNGSDESIGN-Komplexe enthält (KAPITEL +
 * UNTERKAPITEL), absorbiert der werk-skopierte Knoten sie in Walk-Reihenfolge
 * — der Container-Label kommt vom ersten Komplex.
 */
async function loadOutlineContainerParagraphs(
	documentId: string
): Promise<CollectedParagraph[]> {
	const walk = await loadH3ComplexWalk(documentId);
	const fdComplexes = walk.filter((c) => c.functionType === 'FORSCHUNGSDESIGN');
	if (fdComplexes.length === 0) return [];

	const allParagraphIds: string[] = [];
	const headingByParagraph = new Map<string, string>();
	for (const c of fdComplexes) {
		for (const pid of c.paragraphIds) {
			allParagraphIds.push(pid);
			headingByParagraph.set(pid, c.headingText);
		}
	}

	const rows = (await query<{
		paragraph_id: string;
		char_start: number;
		char_end: number;
		text: string;
	}>(
		`SELECT p.id AS paragraph_id,
		        p.char_start,
		        p.char_end,
		        SUBSTRING(dc.full_text FROM p.char_start + 1
		                              FOR p.char_end - p.char_start) AS text
		 FROM document_elements p
		 JOIN document_content dc ON dc.naming_id = p.document_id
		 WHERE p.document_id = $1
		   AND p.id = ANY($2::uuid[])
		 ORDER BY p.char_start`,
		[documentId, allParagraphIds]
	)).rows;

	return rows.map((r) => ({
		paragraphId: r.paragraph_id,
		charStart: r.char_start,
		charEnd: r.char_end,
		text: r.text.trim(),
		containerHeadingText: headingByParagraph.get(r.paragraph_id) ?? null,
		provenance: 'outline_container',
	}));
}

/**
 * Strategie B: ¶ aus dem EXPOSITION-Container, gefiltert auf Methoden-Marker.
 * Greift nur, wenn FORSCHUNGSDESIGN nicht als eigener Container existiert
 * — z.B. BA, in der die methodische Begründung in der Einleitung mitläuft.
 */
async function loadExpositionMethodenParagraphs(
	documentId: string
): Promise<CollectedParagraph[]> {
	const rows = (await query<{
		paragraph_id: string;
		char_start: number;
		char_end: number;
		text: string;
		container_heading_text: string;
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
		        h.heading_text AS container_heading_text
		 FROM document_elements p
		 JOIN document_content dc ON dc.naming_id = p.document_id
		 JOIN LATERAL (
		   SELECT hwt.heading_text, hwt.outline_function_type
		   FROM heading_with_type hwt
		   WHERE hwt.char_start <= p.char_start
		   ORDER BY hwt.char_start DESC
		   LIMIT 1
		 ) h ON h.outline_function_type = 'EXPOSITION'
		 WHERE p.document_id = $1
		   AND p.element_type = 'paragraph'
		   AND p.section_kind = 'main'
		 ORDER BY p.char_start`,
		[documentId]
	)).rows;

	return rows
		.filter((r) => paragraphHasMethodenMarker(r.text))
		.map((r) => ({
			paragraphId: r.paragraph_id,
			charStart: r.char_start,
			charEnd: r.char_end,
			text: r.text.trim(),
			containerHeadingText: r.container_heading_text.trim(),
			provenance: 'exposition_fallback',
		}));
}

/**
 * Strategie C: Volltext-Scan über alle main-¶, gefiltert auf Methoden-Marker.
 * Greift nur, wenn weder FORSCHUNGSDESIGN noch EXPOSITION-Methoden-¶
 * etwas geliefert haben — letztes Auffangnetz.
 */
async function loadFulltextMethodenParagraphs(
	documentId: string
): Promise<CollectedParagraph[]> {
	const rows = (await query<{
		paragraph_id: string;
		char_start: number;
		char_end: number;
		text: string;
	}>(
		`SELECT p.id AS paragraph_id,
		        p.char_start,
		        p.char_end,
		        SUBSTRING(dc.full_text FROM p.char_start + 1
		                              FOR p.char_end - p.char_start) AS text
		 FROM document_elements p
		 JOIN document_content dc ON dc.naming_id = p.document_id
		 WHERE p.document_id = $1
		   AND p.element_type = 'paragraph'
		   AND p.section_kind = 'main'
		 ORDER BY p.char_start`,
		[documentId]
	)).rows;

	return rows
		.filter((r) => paragraphHasMethodenMarker(r.text))
		.map((r) => ({
			paragraphId: r.paragraph_id,
			charStart: r.char_start,
			charEnd: r.char_end,
			text: r.text.trim(),
			containerHeadingText: null,
			provenance: 'fulltext_regex',
		}));
}

async function collectParagraphs(documentId: string): Promise<{
	paragraphs: CollectedParagraph[];
	strategy: Provenance | null;
	containerLabel: string | null;
}> {
	const a = await loadOutlineContainerParagraphs(documentId);
	if (a.length > 0) {
		return {
			paragraphs: a,
			strategy: 'outline_container',
			containerLabel: a[0].containerHeadingText,
		};
	}
	const b = await loadExpositionMethodenParagraphs(documentId);
	if (b.length > 0) {
		return {
			paragraphs: b,
			strategy: 'exposition_fallback',
			containerLabel: b[0].containerHeadingText,
		};
	}
	const c = await loadFulltextMethodenParagraphs(documentId);
	if (c.length > 0) {
		return { paragraphs: c, strategy: 'fulltext_regex', containerLabel: null };
	}
	return { paragraphs: [], strategy: null, containerLabel: null };
}

/**
 * Lädt alle ¶ aus EXPOSITION-Containern (ohne Marker-Filter). Wird für die
 * Aufbau-Skizzen-Suche genutzt — sowohl regex-basiert (paragraphHasAufbauMarker)
 * als auch als LLM-Input wenn Regex nichts findet.
 */
async function loadExpositionAllParagraphs(
	documentId: string
): Promise<{ paragraphId: string; charStart: number; charEnd: number; text: string }[]> {
	const rows = (await query<{
		paragraph_id: string;
		char_start: number;
		char_end: number;
		text: string;
	}>(
		`WITH heading_with_type AS (
		   SELECT de.id AS heading_id,
		          de.char_start,
		          hc.outline_function_type
		   FROM document_elements de
		   JOIN heading_classifications hc ON hc.element_id = de.id
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
		                              FOR p.char_end - p.char_start) AS text
		 FROM document_elements p
		 JOIN document_content dc ON dc.naming_id = p.document_id
		 JOIN LATERAL (
		   SELECT hwt.outline_function_type
		   FROM heading_with_type hwt
		   WHERE hwt.char_start <= p.char_start
		   ORDER BY hwt.char_start DESC
		   LIMIT 1
		 ) h ON h.outline_function_type = 'EXPOSITION'
		 WHERE p.document_id = $1
		   AND p.element_type = 'paragraph'
		   AND p.section_kind = 'main'
		 ORDER BY p.char_start`,
		[documentId]
	)).rows;
	return rows.map((r) => ({
		paragraphId: r.paragraph_id,
		charStart: r.char_start,
		charEnd: r.char_end,
		text: r.text.trim(),
	}));
}

// ── Bezugsrahmen: FRAGESTELLUNG + FORSCHUNGSGEGENSTAND ───────────
//
// Beide sind HARTE Vorbedingungen. Der `loadBezugsrahmen`-Aufrufer ist
// für die Vorbedingungs-Prüfung verantwortlich. Diese Loader-Funktion
// gibt nullable zurück, damit die Prüfung am Aufrufer (mit klarer
// Diagnostik) stattfindet.

interface Bezugsrahmen {
	fragestellungText: string;
	forschungsgegenstandText: string;
}

interface BezugsrahmenLoadResult {
	fragestellungText: string | null;
	forschungsgegenstandText: string | null;
}

async function loadBezugsrahmen(documentId: string): Promise<BezugsrahmenLoadResult> {
	const fragestellung = await queryOne<{ content: { text?: string } }>(
		`SELECT content
		 FROM function_constructs
		 WHERE document_id = $1
		   AND outline_function_type = 'EXPOSITION'
		   AND construct_kind = 'FRAGESTELLUNG'
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[documentId]
	);
	const forschungsgegenstand = await queryOne<{ content: { text?: string } }>(
		`SELECT content
		 FROM function_constructs
		 WHERE document_id = $1
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'FORSCHUNGSGEGENSTAND'
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[documentId]
	);
	return {
		fragestellungText: fragestellung?.content?.text ?? null,
		forschungsgegenstandText: forschungsgegenstand?.content?.text ?? null,
	};
}

// ── Persistenz: virtueller Container ──────────────────────────────

async function clearExistingForschungsdesign(
	caseId: string,
	documentId: string
): Promise<void> {
	// Idempotenz: alte FORSCHUNGSDESIGN-Konstrukte und Container für
	// dieses Werk wegräumen. Konstrukte zuerst (FK SET NULL würde sie
	// sonst orphanen, aber semantisch wollen wir bei Re-Run frisch).
	await query(
		`DELETE FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'FORSCHUNGSDESIGN'`,
		[caseId, documentId]
	);
	await query(
		`DELETE FROM virtual_function_containers
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'FORSCHUNGSDESIGN'`,
		[caseId, documentId]
	);
}

async function persistVirtualContainer(
	caseId: string,
	documentId: string,
	paragraphs: CollectedParagraph[],
	label: string | null
): Promise<string> {
	// source_anchor_ranges: pro ¶ eine Range. element_id zeigt auf den
	// ¶ selbst, start_seq/end_seq sind Charakter-Positionen im Werk.
	// Provenienz pro Range, damit Reviewer-UI später anzeigen kann,
	// woher jede Methodik-Aussage stammt.
	const ranges = paragraphs.map((p) => ({
		element_id: p.paragraphId,
		start_seq: p.charStart,
		end_seq: p.charEnd,
		provenance: p.provenance,
	}));

	const row = await queryOne<{ id: string }>(
		`INSERT INTO virtual_function_containers
		   (case_id, document_id, outline_function_type, granularity_level,
		    label, source_anchor_ranges)
		 VALUES ($1, $2, 'FORSCHUNGSDESIGN', NULL, $3, $4)
		 RETURNING id`,
		[caseId, documentId, label, JSON.stringify(ranges)]
	);
	if (!row) throw new Error('Failed to persist virtual container for FORSCHUNGSDESIGN');
	return row.id;
}

// ── AUFBAU_SKIZZE: Regex-Erkennung + LLM-Fallback ─────────────────
//
// Critical-Friend-Befund für BAs ohne FORSCHUNGSDESIGN-Material: das Werk
// hat einen Aufbau-Plan in der Einleitung (Vorhaben-Statement), aber keine
// methodologische Begründung. Pyramide:
//   1. Regex: ¶-Suche in EXPOSITION mit AUFBAU_*_MARKERS (billig, deterministisch)
//   2. LLM-Fallback: ein Pass auf alle EXPOSITION-¶ mit Plan/Vorgehensweise-
//      Frage (teurer, aber robust gegen Formulierungs-Vielfalt)
//   3. wenn beide leer → PreconditionFailedError mit Reviewer-Recovery-Hint

interface AufbauSkizzeFinding {
	text: string;
	source: 'regex' | 'llm';
	anchorParagraphIds: string[];
}

async function findAufbauSkizzeRegex(
	documentId: string
): Promise<AufbauSkizzeFinding | null> {
	const expoParagraphs = await loadExpositionAllParagraphs(documentId);
	if (expoParagraphs.length === 0) return null;

	// Setzung 2026-05-04: Aufbau-Skizzen stehen typischerweise am ENDE der
	// Einleitung — oft über 3-5 ¶ verteilt mit je 1-2 Markern (Per-¶-
	// Schwellenwert wird dadurch nie erreicht). Rückwärts-Strategie:
	//   - vom letzten EXPOSITION-¶ rückwärts iterieren
	//   - jeden ¶ auf Marker-Hits prüfen (paragraphHasAufbauMarker.hits)
	//   - Block sammeln, solange ¶ mind. 1 Marker-Hit hat ODER die Lücke
	//     zwischen Markern <2 ¶ ist (1 zwischendurch leerer ¶ erlaubt,
	//     z.B. Überleitungs-Satz)
	//   - bei 2 ¶ in Folge ohne Marker → Block-Ende
	// Block gilt als Aufbau-Skizze, wenn:
	//   - mind. 3 sequenzielle Marker insgesamt im Block
	//   - ODER 1 Gliederungs-Marker + 1 sequenzieller Marker im Block
	//   - ODER mind. 2 ¶ mit je 1+ sequentiellem Marker
	const block: typeof expoParagraphs = [];
	let consecutiveEmpty = 0;
	for (let i = expoParagraphs.length - 1; i >= 0; i--) {
		const p = expoParagraphs[i];
		const m = paragraphHasAufbauMarker(p.text);
		if (m.hits === 0) {
			consecutiveEmpty++;
			if (consecutiveEmpty >= 2) break;
			// Erlaubt: 1 zwischendurch leerer ¶ — wird mitgenommen, falls Block
			// schon angefangen hat (Überleitungs-Satz mitten im Aufbau-Block).
			if (block.length > 0) block.unshift(p);
			continue;
		}
		consecutiveEmpty = 0;
		block.unshift(p);
	}
	if (block.length === 0) return null;

	// Block-Akzeptanzkriterium: mind. 3 sequentielle Marker im Block ODER
	// 1 Gliederungs-Marker + 1 sequentieller Marker ODER ≥2 ¶ mit Markern.
	let totalSequential = 0;
	let hasGliederung = false;
	let paragraphsWithMarker = 0;
	for (const p of block) {
		let pSeq = 0;
		for (const re of AUFBAU_SEQUENTIAL_MARKERS) {
			const matches = p.text.match(re);
			if (matches) pSeq += matches.length;
		}
		const pGl = AUFBAU_GLIEDERUNG_MARKERS.some((re) => re.test(p.text));
		totalSequential += pSeq;
		if (pGl) hasGliederung = true;
		if (pSeq > 0 || pGl) paragraphsWithMarker++;
	}
	const accepted =
		totalSequential >= 3 ||
		(hasGliederung && totalSequential >= 1) ||
		paragraphsWithMarker >= 2;
	if (!accepted) return null;

	const text = block.map((p) => p.text).join('\n\n');
	return {
		text,
		source: 'regex',
		anchorParagraphIds: block.map((p) => p.paragraphId),
	};
}

const AufbauSkizzeLlmSchema = z.object({
	found: z.boolean(),
	plan_text: z.string().nullable(),
	anchor_paragraph_indices: z.array(z.number().int().nonnegative()).nullable(),
});

async function findAufbauSkizzeLlm(
	documentId: string,
	bezugsrahmen: Bezugsrahmen,
	brief: H3BriefContext,
	modelOverride?: ModelOverride
): Promise<{ finding: AufbauSkizzeFinding | null; tokens: { input: number; output: number } }> {
	const expoParagraphs = await loadExpositionAllParagraphs(documentId);
	if (expoParagraphs.length === 0) {
		return { finding: null, tokens: { input: 0, output: 0 } };
	}

	const system = [
		'Du bist ein analytisches Werkzeug. Aufgabe: in den vorgelegten Absätzen aus der Einleitung einer wissenschaftlichen Arbeit prüfen, ob eine AUFBAU-SKIZZE (Plan/Vorgehensweise des Werks) erkennbar ist.',
		'',
		formatWerktypLine(brief),
		'',
		'Eine AUFBAU-SKIZZE ist ein Text, der die Gliederung/Vorgehensweise der Arbeit beschreibt — typischerweise mit sequentieller Reihenfolge ("Im ersten Teil … im zweiten Teil … abschließend …") oder Werk-Selbstreferenz ("Die Arbeit gliedert sich in …", "Im Folgenden wird …").',
		'',
		'WICHTIG: AUFBAU-SKIZZE ist KEIN methodologisch begründetes Forschungsdesign. Die Skizze beschreibt nur den Aufbau, nicht das Warum (Methodenwahl, Verfahrensbegründung). Wenn die Begründung methodologisch trägt, ist es METHODOLOGIE/METHODEN — das wird woanders extrahiert. Hier nur den Plan-Charakter erkennen.',
		'',
		'Bezugsrahmen (zur Lese-Orientierung, NICHT zu reproduzieren):',
		`  FRAGESTELLUNG: ${bezugsrahmen.fragestellungText}`,
		`  FORSCHUNGSGEGENSTAND: ${bezugsrahmen.forschungsgegenstandText}`,
		'',
		'Antworte ausschließlich als JSON:',
		'{',
		'  "found": true | false,',
		'  "plan_text": "<wörtlicher Plan-Text aus den Absätzen>" | null,',
		'  "anchor_paragraph_indices": [<Indizes der relevanten Absätze>] | null',
		'}',
		'',
		'Bei "found": false → plan_text und anchor_paragraph_indices sind null.',
		'Bei "found": true → plan_text enthält den extrahierten Text (Wortlaut, ggf. mit Kürzungen via "…"), anchor_paragraph_indices listet die Indizes der Absätze, in denen der Plan steht (mehrere möglich).',
	].join('\n');

	const userMessage = [
		'EXPOSITION-Absätze (in Werk-Reihenfolge, indiziert):',
		'',
		...expoParagraphs.map((p, i) => `[${i}] ${p.text}`),
	].join('\n\n');

	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: 1500,
		responseFormat: 'json',
		documentIds: [documentId],
		modelOverride,
	});

	const parsed = extractAndValidateJSON(response.text, AufbauSkizzeLlmSchema);
	if (!parsed.ok) {
		throw new Error(
			`AUFBAU_SKIZZE LLM-Pass: Antwort nicht parsbar (stage=${parsed.stage}): ${parsed.error}\n` +
			`Raw: ${response.text.slice(0, 500)}`
		);
	}
	const result = parsed.value;
	const tokens = { input: response.inputTokens, output: response.outputTokens };

	if (!result.found || !result.plan_text || !result.anchor_paragraph_indices) {
		return { finding: null, tokens };
	}
	const anchorIds = result.anchor_paragraph_indices
		.filter((i) => i >= 0 && i < expoParagraphs.length)
		.map((i) => expoParagraphs[i].paragraphId);
	if (anchorIds.length === 0) {
		// LLM hat found:true, aber keine validen Indizes → behandeln wir defensiv
		// als "doch nicht gefunden", damit die Pipeline keinen Konstrukt ohne
		// Anker persistiert (Mig-043-CHECK: cardinality(anchor_element_ids)>=1).
		return { finding: null, tokens };
	}
	return {
		finding: { text: result.plan_text, source: 'llm', anchorParagraphIds: anchorIds },
		tokens,
	};
}

async function persistAufbauSkizze(
	caseId: string,
	documentId: string,
	finding: AufbauSkizzeFinding
): Promise<string> {
	const content = { text: finding.text, source: finding.source };
	const stackEntry = {
		kind: 'origin' as const,
		at: new Date().toISOString(),
		by_user_id: null,
		source_run_id: null,
		content_snapshot: content,
	};
	// AUFBAU_SKIZZE braucht keinen virtual_function_container — sie ist ein
	// EXPOSITION-Phänomen, das als FORSCHUNGSDESIGN-Defizit-Befund persistiert
	// wird. Direkt-Anker an die EXPOSITION-¶, die den Plan tragen.
	const row = await queryOne<{ id: string }>(
		`INSERT INTO function_constructs
		   (case_id, document_id, outline_function_type, construct_kind,
		    anchor_element_ids, content, version_stack, virtual_container_id)
		 VALUES ($1, $2, 'FORSCHUNGSDESIGN', 'AUFBAU_SKIZZE', $3, $4, $5, NULL)
		 RETURNING id`,
		[
			caseId,
			documentId,
			finding.anchorParagraphIds,
			JSON.stringify(content),
			JSON.stringify([stackEntry]),
		]
	);
	if (!row) throw new Error('Failed to persist AUFBAU_SKIZZE construct');
	return row.id;
}

// ── METHODIK_EXTRAHIEREN: LLM-Pass ────────────────────────────────

const MethodikSchema = z.object({
	methodologie: z.string().nullable(),
	methoden: z.string().nullable(),
	basis: z.string().nullable(),
});
type MethodikResult = z.infer<typeof MethodikSchema>;

async function methodikExtrahieren(
	paragraphs: CollectedParagraph[],
	bezugsrahmen: Bezugsrahmen,
	containerLabel: string | null,
	strategy: Provenance,
	documentId: string,
	brief: H3BriefContext,
	modelOverride?: ModelOverride
): Promise<{ result: MethodikResult; tokens: { input: number; output: number } }> {
	const fragestellung = bezugsrahmen.fragestellungText;
	const forschungsgegenstand = bezugsrahmen.forschungsgegenstandText;

	const sourceHint = (() => {
		switch (strategy) {
			case 'outline_container':
				return `Das Werk hat ein eigenständiges FORSCHUNGSDESIGN-Kapitel/Unterkapitel${containerLabel ? ` ("${containerLabel}")` : ''}. Die folgenden Absätze sind dessen vollständiger Inhalt.`;
			case 'exposition_fallback':
				return `Das Werk hat KEIN eigenständiges Methodenkapitel. Die methodische Begründung läuft in der Einleitung${containerLabel ? ` ("${containerLabel}")` : ''} mit. Die folgenden Absätze sind die methodisch markierten ¶ aus der Einleitung.`;
			case 'fulltext_regex':
				return 'Das Werk hat weder ein FORSCHUNGSDESIGN-Kapitel noch methodische Markierungen in der Einleitung. Die folgenden Absätze sind methodisch markierte ¶, die im Volltext gesammelt wurden — Position und Heading-Kontext nicht garantiert.';
		}
	})();

	const system = [
		'Du bist ein analytisches Werkzeug, das aus methodischem Material einer wissenschaftlichen Arbeit drei Konstrukte extrahiert: METHODOLOGIE, METHODEN und BASIS.',
		'',
		formatWerktypLine(brief),
		'',
		'Begriffe (Erziehungswissenschaft / qualitative Sozialforschung):',
		'  - METHODOLOGIE: die epistemische Grundhaltung der Untersuchung — welcher Forschungslogik folgt die Arbeit (qualitativ-rekonstruktiv, hermeneutisch, diskursanalytisch, theoretisch-vergleichend, etc.)? Welche Erkenntnisweise wird beansprucht?',
		'  - METHODEN: die konkreten Verfahren, mit denen die Arbeit ihre Daten/Texte bearbeitet (Sequenzanalyse, qualitative Inhaltsanalyse, theoretischer Vergleich, etc.). Auf der Ebene des konkreten Vorgehens.',
		'  - BASIS: was untersucht wird UND die Begründung in Bezug auf die Fragestellung. Bei empirischen Arbeiten die Erhebung (Sample, Feldzugang, Interviewpartner, Beobachtungssetting) plus deren Begründung; bei theoretischen Arbeiten der Korpus (welche Texte/Dokumente/Programme) plus dessen Auswahllogik. Beides ist nur dann tragfähig, wenn nachvollziehbar wird, wieso GERADE diese Basis zur Beantwortung GERADE dieser Fragestellung geeignet ist. Wo die Quelle nur das "was" benennt, ohne das "wieso passt es zur Frage" zu adressieren, das im BASIS-Text als Lücke benennen, nicht still überbrücken.',
		'',
		'Die drei Konstrukte sind ANALYTISCH zu trennen, auch wenn sie im Quelltext verwoben formuliert sind.',
		'',
		'Bezugsrahmen für die Beurteilung der Methodenwahl (NICHT zu reproduzieren, sondern als Maßstab beim Lesen mitzuführen):',
		'',
		'Die methodisch relevante "spezifizierte Fragestellung" entsteht erst aus FRAGESTELLUNG plus FORSCHUNGSGEGENSTAND zusammen. Die FRAGESTELLUNG aus der Exposition hat allenfalls Charakterisierungs-Status (auf Basis grounded oder ungrounded cues, nur in Sonderfällen bereits hart theoretisch belegt). Erst der FORSCHUNGSGEGENSTAND aus der Theoriearbeit liefert die Spezifizierung. Die Methodenwahl muss zur spezifizierten Fragestellung passen, nicht nur zur charakterisierten.',
		'',
		`FRAGESTELLUNG (Charakterisierung aus der Exposition): ${fragestellung}`,
		'',
		`FORSCHUNGSGEGENSTAND (Spezifizierung aus der Theoriearbeit): ${forschungsgegenstand}`,
		'',
		'Aufgabe: aus den vorgegebenen Absätzen die drei Konstrukte rekonstruieren — jedes in einem kompakten Beschreibungstext (typisch 2–4 Sätze pro Feld). Methodologie und Methoden auseinanderhalten (Methodologie = Forschungslogik, Methoden = Verfahren). Wenn ein Feld in den Absätzen substanziell nicht behandelt wird, antworte mit null für dieses Feld — keine Spekulation, keine Lücken füllen, keine Auflistung dessen, was fehlt.',
		'',
		'Reproduziere KEINE rein selbstdeklarativen Methodik-Etiketten ("hermeneutisch" als bloßes Label) ohne erkennbares korrespondierendes Vorgehen. Wenn nur ein Etikett genannt wird ohne korrespondierendes Vorgehen → diese Aussage in das passende Feld aufnehmen, aber als das markieren, was sie ist (z.B. "die Arbeit deklariert ein hermeneutisches Vorgehen, ohne dieses verfahrensseitig zu konkretisieren").',
		'',
		'Quellenkontext:',
		sourceHint,
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "methodologie": "<2–4 Sätze>" | null,',
		'  "methoden":     "<2–4 Sätze>" | null,',
		'  "basis":        "<2–4 Sätze>" | null',
		'}',
	].join('\n');

	const userMessage = [
		'Methodisch relevante Absätze (in Werk-Reihenfolge):',
		'',
		...paragraphs.map((p, i) => `[${i}] ${p.text}`),
	].join('\n\n');

	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: 2000,
		responseFormat: 'json',
		documentIds: [documentId],
		modelOverride,
	});

	const parsed = extractAndValidateJSON(response.text, MethodikSchema);
	if (!parsed.ok) {
		throw new Error(
			`METHODIK_EXTRAHIEREN: Antwort nicht parsbar (stage=${parsed.stage}): ${parsed.error}\n` +
			`Raw: ${response.text.slice(0, 500)}`
		);
	}
	return {
		result: parsed.value,
		tokens: { input: response.inputTokens, output: response.outputTokens },
	};
}

// ── Persistenz: function_constructs ───────────────────────────────

async function persistConstruct(
	caseId: string,
	documentId: string,
	constructKind: 'METHODOLOGIE' | 'METHODEN' | 'BASIS',
	anchorElementIds: string[],
	virtualContainerId: string,
	content: { text: string }
): Promise<string> {
	const stackEntry = {
		kind: 'origin' as const,
		at: new Date().toISOString(),
		by_user_id: null,
		source_run_id: null,
		content_snapshot: content,
	};
	const row = await queryOne<{ id: string }>(
		`INSERT INTO function_constructs
		   (case_id, document_id, outline_function_type, construct_kind,
		    anchor_element_ids, content, version_stack, virtual_container_id)
		 VALUES ($1, $2, 'FORSCHUNGSDESIGN', $3, $4, $5, $6, $7)
		 RETURNING id`,
		[
			caseId,
			documentId,
			constructKind,
			anchorElementIds,
			JSON.stringify(content),
			JSON.stringify([stackEntry]),
			virtualContainerId,
		]
	);
	if (!row) throw new Error(`Failed to persist ${constructKind} construct`);
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

export interface ForschungsdesignPassResult {
	caseId: string;
	documentId: string;
	strategy: Provenance | null;          // welche Sammelstrategie hat getroffen
	containerLabel: string | null;        // Heading-Text, falls aus Outline/EXPOSITION
	collectedParagraphCount: number;
	virtualContainerId: string | null;
	methodologie: { constructId: string; text: string } | null;
	methoden: { constructId: string; text: string } | null;
	basis: { constructId: string; text: string } | null;
	// Aufbau-Skizzen-Befund: greift, wenn weder Methoden-Container noch
	// methodische Markierungen in der Einleitung vorliegen. Critical-Friend-
	// Substanz: planvoll, aber methodologisch unbegründet.
	aufbauSkizze: { constructId: string; text: string; source: 'regex' | 'llm' } | null;
	tokens: { input: number; output: number };
	llmCalls: number;
	model: string;
	provider: string;
}

export async function runForschungsdesignPass(
	caseId: string,
	options: ForschungsdesignPassOptions = {}
): Promise<ForschungsdesignPassResult> {
	const { modelOverride } = options;
	const { centralDocumentId: documentId, brief } = await loadH3CaseContext(caseId);

	// HARTE Vorbedingungen prüfen, bevor Sammel- oder LLM-Arbeit anläuft.
	// Spec: docs/h3_orchestrator_spec.md #2.
	const loaded = await loadBezugsrahmen(documentId);
	if (!loaded.fragestellungText) {
		throw new PreconditionFailedError({
			heuristic: 'FORSCHUNGSDESIGN',
			missing: 'FRAGESTELLUNG',
			diagnostic:
				'H3:EXPOSITION muss vor FORSCHUNGSDESIGN für dieses Werk gelaufen sein. Methodische Angemessenheit braucht die rekonstruierte Fragestellung als Bezugspunkt.',
		});
	}
	if (!loaded.forschungsgegenstandText) {
		throw new PreconditionFailedError({
			heuristic: 'FORSCHUNGSDESIGN',
			missing: 'FORSCHUNGSGEGENSTAND',
			diagnostic:
				'H3:GRUNDLAGENTHEORIE muss vor FORSCHUNGSDESIGN für dieses Werk gelaufen sein. Methodische Angemessenheit braucht den spezifizierten Forschungsgegenstand als Maßstab — ohne ihn gibt es keinen Analysehorizont.',
		});
	}
	const bezugsrahmen: Bezugsrahmen = {
		fragestellungText: loaded.fragestellungText,
		forschungsgegenstandText: loaded.forschungsgegenstandText,
	};

	const collected = await collectParagraphs(documentId);

	if (collected.paragraphs.length === 0 || collected.strategy === null) {
		// Kein Methoden-Material gefunden. Pyramide für AUFBAU_SKIZZE:
		// 1. Regex auf EXPOSITION-¶ — billig, deterministisch
		// 2. LLM-Fallback auf alle EXPOSITION-¶ — teurer, robust
		// 3. wenn beide leer → PreconditionFailedError mit Reviewer-Recovery-Hint
		//
		// Critical-Friend-Setzung 2026-05-04: kein Skip bei strukturell fehlendem
		// FORSCHUNGSDESIGN — entweder ein erkennbarer Aufbau-Plan (= Plan-ohne-
		// methodologische-Begründung als substanzieller Befund), oder STOP mit
		// Diagnose, damit der Reviewer manuell prüfen kann.

		await clearExistingForschungsdesign(caseId, documentId);

		const regexFinding = await findAufbauSkizzeRegex(documentId);
		if (regexFinding) {
			const id = await persistAufbauSkizze(caseId, documentId, regexFinding);
			return {
				caseId,
				documentId,
				strategy: null,
				containerLabel: null,
				collectedParagraphCount: 0,
				virtualContainerId: null,
				methodologie: null,
				methoden: null,
				basis: null,
				aufbauSkizze: { constructId: id, text: regexFinding.text, source: 'regex' },
				tokens: { input: 0, output: 0 },
				llmCalls: 0,
				model: modelOverride?.model ?? getModel(),
				provider: modelOverride?.provider ?? getProvider(),
			};
		}

		const llm = await findAufbauSkizzeLlm(documentId, bezugsrahmen, brief, modelOverride);
		if (llm.finding) {
			const id = await persistAufbauSkizze(caseId, documentId, llm.finding);
			return {
				caseId,
				documentId,
				strategy: null,
				containerLabel: null,
				collectedParagraphCount: 0,
				virtualContainerId: null,
				methodologie: null,
				methoden: null,
				basis: null,
				aufbauSkizze: { constructId: id, text: llm.finding.text, source: 'llm' },
				tokens: llm.tokens,
				llmCalls: 1,
				model: modelOverride?.model ?? getModel(),
				provider: modelOverride?.provider ?? getProvider(),
			};
		}

		throw new PreconditionFailedError({
			heuristic: 'FORSCHUNGSDESIGN',
			missing: 'Methodisches Material und Aufbau-Skizze',
			diagnostic:
				'Weder ein eigenständiges Methodenkapitel noch methodische Markierungen in der Einleitung noch eine Aufbau-Skizze (Plan/Vorgehensweise) wurden in EXPOSITION gefunden — Regex- und LLM-Pyramide haben beide nichts geliefert. Reviewer-Aktion: in der Einleitung manuell prüfen — falls eine Plan/Vorgehensweise-Passage existiert, manuell als AUFBAU_SKIZZE-Konstrukt anlegen und Pipeline neu triggern. Falls keinerlei Reflexion über Vorgehensweise im Werk: das ist ein methodologisches Defizit, das im Werk-Gutacht zur Abwertung führt.',
		});
	}

	await clearExistingForschungsdesign(caseId, documentId);

	const virtualContainerId = await persistVirtualContainer(
		caseId,
		documentId,
		collected.paragraphs,
		collected.containerLabel
	);

	const extract = await methodikExtrahieren(
		collected.paragraphs,
		bezugsrahmen,
		collected.containerLabel,
		collected.strategy,
		documentId,
		brief,
		modelOverride
	);

	const anchorIds = collected.paragraphs.map((p) => p.paragraphId);

	let methodologie: ForschungsdesignPassResult['methodologie'] = null;
	let methoden: ForschungsdesignPassResult['methoden'] = null;
	let basis: ForschungsdesignPassResult['basis'] = null;

	if (extract.result.methodologie) {
		const id = await persistConstruct(
			caseId,
			documentId,
			'METHODOLOGIE',
			anchorIds,
			virtualContainerId,
			{ text: extract.result.methodologie }
		);
		methodologie = { constructId: id, text: extract.result.methodologie };
	}
	if (extract.result.methoden) {
		const id = await persistConstruct(
			caseId,
			documentId,
			'METHODEN',
			anchorIds,
			virtualContainerId,
			{ text: extract.result.methoden }
		);
		methoden = { constructId: id, text: extract.result.methoden };
	}
	if (extract.result.basis) {
		const id = await persistConstruct(
			caseId,
			documentId,
			'BASIS',
			anchorIds,
			virtualContainerId,
			{ text: extract.result.basis }
		);
		basis = { constructId: id, text: extract.result.basis };
	}

	return {
		caseId,
		documentId,
		strategy: collected.strategy,
		containerLabel: collected.containerLabel,
		collectedParagraphCount: collected.paragraphs.length,
		virtualContainerId,
		methodologie,
		methoden,
		basis,
		aufbauSkizze: null,
		tokens: extract.tokens,
		llmCalls: 1,
		model: modelOverride?.model ?? getModel(),
		provider: modelOverride?.provider ?? getProvider(),
	};
}
