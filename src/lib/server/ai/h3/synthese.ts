// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:SYNTHESE — Forward-Integration der DURCHFÜHRUNGS-BEFUNDE gegen die FRAGESTELLUNG.
//
// Mother-Setzung (project_three_heuristics_architecture.md):
//   "Eine SYNTHESE positioniert und systematisiert die ERKENNTNISSE
//   im Hinblick auf die FORSCHUNGSFRAGE. Das ist das GESAMTERGEBNIS
//   der Arbeit."
//   Konstrukte: GESAMTERGEBNIS, FRAGESTELLUNGS_ANTWORT.
//   Tools: H2-Baustein über das ganze Kapitel + ERKENNTNIS_INTEGRATION_PRÜFEN
//   + FRAGESTELLUNG_BEANTWORTUNG_EXTRAHIEREN.
//
// User-Setzungen 2026-05-04:
//   - Ein Konstrukt mit reichem content (Mother-Plural ist Felder-Plural,
//     nicht Konstrukt-Plural) — gesamtergebnisText, fragestellungsAntwortText
//     und erkenntnisIntegration[] in einem `construct_kind='GESAMTERGEBNIS'`-
//     Konstrukt. Sonst landeten zwei Konstrukte am selben Anker mit
//     überlappendem Inhalt.
//   - Werk-Aggregat (analog FORSCHUNGSGEGENSTAND): ein GESAMTERGEBNIS pro
//     Werk, anchor_element_ids = alle ¶ aller SYNTHESE-Container.
//     Begründung: "Gesamtergebnis der Arbeit" ist Werk-Ebene; FRAGESTELLUNG
//     ist Werk-Werk; mehrere SYNTHESE-Container werden im LLM-Prompt
//     getrennt benannt, aber zu einer GESAMTERGEBNIS-Lesart aggregiert.
//   - ERKENNTNIS_INTEGRATION-Output: binär (integriert/nicht-integriert)
//     + optional synthesisAnchorParagraphIndex (1-basiert; im Server-Code
//     auf paragraph_id gemappt) + optional hinweis (Critical-Friend-
//     Bemerkung bei nicht-Integration). coverageRatio berechnet aus
//     count(integriert=true) / count(BEFUNDE mit text!=null).
//   - Idempotenz: delete-before-insert auf GESAMTERGEBNIS für (case_id,
//     document_id). SYNTHESE wird nicht von späteren Heuristiken
//     re-spezifiziert; SCHLUSSREFLEXION setzt sich daneben, nicht
//     modifizierend. Kein version_stack jenseits des origin-Eintrags.
//
// Critical-Friend-Identität (project_critical_friend_identity.md):
//   Tool BESCHREIBT, was die SYNTHESE als Gesamtergebnis leistet und
//   wie die FRAGESTELLUNG beantwortet wird. Bei nicht-integrierten
//   BEFUNDEN: hinweis als Critical-Friend-Bemerkung ("Befund X bleibt
//   unberücksichtigt"), keine Wertung der SYNTHESE selbst ("schwach",
//   "lückenhaft").
//
// Cross-Typ-Reads (alle Pflicht):
//   - FRAGESTELLUNG aus EXPOSITION
//   - FORSCHUNGSGEGENSTAND aus GRUNDLAGENTHEORIE (ggf. EXKURS-modifiziert
//     — automatisch via SELECT, kein Aggregator-Read nötig)
//   - alle BEFUND-Konstrukte aus DURCHFÜHRUNG mit text!=null
//
// Persistenz: function_constructs mit construct_kind='GESAMTERGEBNIS',
//   outline_function_type='SYNTHESE', anchor_element_ids = alle ¶ aller
//   SYNTHESE-Container des Werks. version_stack mit origin-Eintrag.

import { z } from 'zod';
import { query, queryOne } from '../../db/index.js';
import { chat, type Provider } from '../client.js';
import { resolveTier } from '../model-tiers.js';
import { extractAndValidateJSON, type ExtractResult } from '../json-extract.js';
import { PreconditionFailedError } from './precondition.js';
import {
	loadH3CaseContext,
	formatWerktypLine,
	formatKriterienBlock,
	type H3BriefContext,
} from './werk-shared.js';
import {
	loadFragestellungBeurteilung,
	loadMotivation,
	loadForschungsdesignTriple,
	loadVerweisProfilAggregate,
	loadGthReflexionAggregate,
	loadFgRespecHistory,
	loadAuditOnlyHotspots,
	loadArgumentSubstrateCounts,
	formatTheoriebasisBlock,
	formatMethodischesSetupBlock,
	formatAuditOnlyAndArgumentBlock,
	formatFragestellungBeurteilungBlock,
	formatMotivationBlock,
	type FragestellungBeurteilungSnippet,
	type MotivationSnippet,
	type ForschungsdesignSnippet,
	type VerweisProfilAggregate,
	type GthReflexionAggregate,
	type ReSpecHistoryEntry,
	type AuditOnlyHotspot,
	type ArgumentSubstrateCounts,
} from './werk-substrate.js';

// ── Container-Loading ─────────────────────────────────────────────

export interface SyntheseParagraph {
	paragraphId: string;
	charStart: number;
	charEnd: number;
	text: string;
	indexInContainer: number;
	indexInWerk: number; // 1-basiert über alle SYNTHESE-Container
}

export interface SyntheseContainer {
	headingId: string;
	headingText: string;
	paragraphs: SyntheseParagraph[];
}

export async function loadSyntheseContainers(
	documentId: string
): Promise<SyntheseContainer[]> {
	// Identisches Container-Loading-Pattern wie GRUNDLAGENTHEORIE/
	// DURCHFÜHRUNG/EXKURS: ¶ über LATERAL-Lookup dem nächstgelegenen
	// Heading mit outline_function_type='SYNTHESE' zugeordnet.
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
		 ) h ON h.outline_function_type = 'SYNTHESE'
		 WHERE p.document_id = $1
		   AND p.element_type = 'paragraph'
		   AND p.section_kind = 'main'
		 ORDER BY p.char_start`,
		[documentId]
	)).rows;

	const byHeading = new Map<string, SyntheseContainer>();
	let werkIndex = 1;
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
			indexInWerk: werkIndex++,
		});
	}
	return Array.from(byHeading.values());
}

// ── Cross-Typ-Reads ────────────────────────────────────────────────

interface ConstructDuplicateInfo {
	count: number;
	duplicate: boolean;
}

async function loadFragestellungWithDiagnostics(
	caseId: string,
	documentId: string
): Promise<{ text: string | null; diag: ConstructDuplicateInfo }> {
	const countRow = await queryOne<{ n: string }>(
		`SELECT count(*)::text AS n
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'EXPOSITION'
		   AND construct_kind = 'FRAGESTELLUNG'`,
		[caseId, documentId]
	);
	const count = countRow ? Number(countRow.n) : 0;
	const row = await queryOne<{ content: { text?: string } }>(
		`SELECT content
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'EXPOSITION'
		   AND construct_kind = 'FRAGESTELLUNG'
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[caseId, documentId]
	);
	return {
		text: row?.content?.text ?? null,
		diag: { count, duplicate: count > 1 },
	};
}

interface ForschungsgegenstandSnippet {
	text: string;
	subjectKeywords: string[];
}

async function loadForschungsgegenstandWithDiagnostics(
	caseId: string,
	documentId: string
): Promise<{ fg: ForschungsgegenstandSnippet | null; diag: ConstructDuplicateInfo }> {
	const countRow = await queryOne<{ n: string }>(
		`SELECT count(*)::text AS n
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'FORSCHUNGSGEGENSTAND'`,
		[caseId, documentId]
	);
	const count = countRow ? Number(countRow.n) : 0;
	const row = await queryOne<{
		content: { text: string; subjectKeywords?: string[] };
	}>(
		`SELECT content
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'FORSCHUNGSGEGENSTAND'
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[caseId, documentId]
	);
	if (!row) return { fg: null, diag: { count, duplicate: count > 1 } };
	return {
		fg: {
			text: row.content.text,
			subjectKeywords: row.content.subjectKeywords ?? [],
		},
		diag: { count, duplicate: count > 1 },
	};
}

interface BefundFromDb {
	id: string;
	text: string;
	anchorParagraphId: string;
	containerHeadingText: string | null;
}

async function loadBefundsWithText(
	caseId: string,
	documentId: string
): Promise<BefundFromDb[]> {
	// Lade alle BEFUND-Konstrukte aus DURCHFÜHRUNG mit text!=null
	// (nicht-leere ERKENNTNISSE). text=null ist Audit-Trail-Eintrag
	// (Hotspot geprüft, kein Befund extrahiert) — wird hier ausgeblendet.
	// Container-Heading-Verknüpfung ausgelassen: BEFUNDE sind ¶-anker;
	// das DURCHFÜHRUNGS-Container-Heading via virtual_function_containers
	// wäre eine Folge-Erweiterung (heute nicht im Prompt benötigt).
	const rows = (await query<{
		id: string;
		text: string;
		anchor_paragraph_id: string;
	}>(
		`SELECT fc.id,
		        fc.content->>'text' AS text,
		        (fc.anchor_element_ids[1])::text AS anchor_paragraph_id
		 FROM function_constructs fc
		 WHERE fc.case_id = $1
		   AND fc.document_id = $2
		   AND fc.outline_function_type = 'DURCHFUEHRUNG'
		   AND fc.construct_kind = 'BEFUND'
		   AND fc.content->>'text' IS NOT NULL
		   AND fc.content->>'text' <> ''
		 ORDER BY fc.created_at`,
		[caseId, documentId]
	)).rows;

	return rows.map((r) => ({
		id: r.id,
		text: r.text,
		anchorParagraphId: r.anchor_paragraph_id,
		containerHeadingText: null,
	}));
}

// ── LLM-Call: GESAMTERGEBNIS extrahieren ──────────────────────────

const ErkenntnisIntegrationItemSchema = z.object({
	befundIndex: z.number().int().min(1),
	integriert: z.boolean(),
	synthesisAnchorParagraphIndex: z.number().int().min(1).nullable(),
	hinweis: z.string().nullable(),
});

const GesamtergebnisLLMSchema = z.object({
	gesamtergebnisText: z.string().min(1),
	fragestellungsAntwortText: z.string().min(1),
	erkenntnisIntegration: z.array(ErkenntnisIntegrationItemSchema),
});
type GesamtergebnisLLMResult = z.infer<typeof GesamtergebnisLLMSchema>;

interface ExtractGesamtergebnisInput {
	fragestellung: string;
	fragestellungBeurteilung: FragestellungBeurteilungSnippet | null;
	motivation: MotivationSnippet | null;
	forschungsgegenstand: ForschungsgegenstandSnippet;
	forschungsdesign: ForschungsdesignSnippet;
	verweisProfil: VerweisProfilAggregate | null;
	gthReflexion: GthReflexionAggregate | null;
	respecHistory: ReSpecHistoryEntry[];
	auditOnlyHotspots: AuditOnlyHotspot[];
	argSubstrate: ArgumentSubstrateCounts | null;
	syntheseContainers: SyntheseContainer[];
	befunds: BefundFromDb[];
	brief: H3BriefContext;
	documentId: string;
	maxTokens: number;
	modelOverride?: { provider: Provider; model: string };
}

async function extractGesamtergebnis(input: ExtractGesamtergebnisInput): Promise<{
	result: GesamtergebnisLLMResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	const kriterien = formatKriterienBlock(input.brief);
	const system = [
		'Du bist ein analytisches Werkzeug, das aus den SYNTHESE-Kapiteln einer wissenschaftlichen Arbeit deren GESAMTERGEBNIS extrahiert und prüft, welche der zuvor in der DURCHFÜHRUNG extrahierten BEFUNDE in der SYNTHESE adressiert werden.',
		'',
		formatWerktypLine(input.brief),
		...(kriterien ? ['', kriterien] : []),
		'',
		'ROLLE / EPISTEMIK:',
		'  Critical Friend zum eigenen Urteil des/der Forschenden — du beschreibst, was die SYNTHESE als Gesamtergebnis leistet, und welche Lese-Hinweise das gesamte H3-Substrat (FRAGESTELLUNG-Beurteilung, MOTIVATION, methodisches Setup, Theoriebasis-Profil, BEFUND-Lage, Audit-only-Hotspots, EXKURS-Re-Spezifikationen) zu diesem Gesamtergebnis nahelegt. Du beurteilst die SYNTHESE NICHT (kein "stark", "schwach", "lückenhaft", keine Skala). Auffälligkeiten (z.B. dominante Autor:innen, bezugslose Theoriestrecken, nicht-integrierte BEFUNDE) sind Lese-Hinweise an den/die Forschende — nie ein Urteil der Arbeit.',
		'',
		'BEGRIFFE:',
		'  FRAGESTELLUNG: in der Einleitung formulierte Forschungsfrage.',
		'  FRAGESTELLUNG-BEURTEILUNG: separate Critical-Friend-Notiz aus dem EXPOSITION-Pass zur Gestalt der Fragestellung (Problemfeld + Perspektive).',
		'  MOTIVATION: in der Einleitung benannter Antrieb der Untersuchung.',
		'  FORSCHUNGSGEGENSTAND: durch Theoriearbeit erfolgte begriffliche Spezifizierung der Fragestellung (ggf. nach EXKURS-Re-Spezifikationen).',
		'  EXKURS-Re-Spezifikationen: spätere Theorie-Importe, die den Forschungsgegenstand nachträglich ändern oder erweitern.',
		'  METHODOLOGIE/METHODEN/BASIS: das methodische Selbstverständnis, die eingesetzten Verfahren, das Sample/Material.',
		'  THEORIEBASIS-PROFIL: deskriptives Aggregat der Verweis-Struktur (HHI, Top-Autoren, Konzentrations-Hinweise) plus Reflexionsbefunde aus der GRUNDLAGENTHEORIE (Eckpunkt-Signale, diskursiver Bezug, Wiedergabe-Würdigungen).',
		'  BEFUNDE (DURCHFÜHRUNG): empirische/theoretische Ergebnisse aus dem Analyse-Teil — 1–3-Satz-Extrakte aus Hotspot-¶.',
		'  AUDIT-ONLY-Hotspots: DURCHFÜHRUNGS-¶, an denen das BEFUND-Tool zwar einen Hotspot-Marker fand, aber keinen extrahierbaren BEFUND formulieren konnte. Empirisches Material, das keine tragende Aussage trägt.',
		'  SYNTHESE: Kapitel, in dem die Arbeit ihre BEFUNDE positioniert und systematisiert, im Hinblick auf die FRAGESTELLUNG.',
		'  GESAMTERGEBNIS: deskriptive Rekonstruktion dessen, was die SYNTHESE als Gesamtergebnis der Arbeit leistet — kein Qualitätsurteil.',
		'  FRAGESTELLUNGS_ANTWORT: die Antwort, die die Arbeit auf die FRAGESTELLUNG gibt — wie sie aus der SYNTHESE hervorgeht.',
		'',
		'AUFGABE in drei Teilen:',
		'',
		'  TEIL A — gesamtergebnisText (5–8 Sätze deskriptiv):',
		'    Beschreibe, was die SYNTHESE als Gesamtergebnis der Arbeit leistet. Beziehe dabei das volle H3-Substrat ein:',
		'      • welche zentrale Linie über die BEFUNDE gezogen wird;',
		'      • wie die theoretische Einordnung erfolgt — und wie sie sich zum Theoriebasis-Profil verhält (z.B. werden dominante Autor:innen tragend, oder verschwinden bezugslose Theoriestrecken in der Synthese?);',
		'      • welche Bezüge zum FORSCHUNGSGEGENSTAND geleistet werden, ggf. zu EXKURS-Re-Spezifikationen;',
		'      • wie sich das methodische Setup (METHODOLOGIE/METHODEN/BASIS) im Gesamtergebnis niederschlägt — falls überhaupt;',
		'      • welche AUDIT-ONLY-Hotspots empirisches Material lassen, das keine tragende Aussage trägt (deskriptiv erwähnen, falls Container-Lage nahelegt, dass es das Gesamtergebnis berührt).',
		'    Eigene Worte, kein Zitat. Wenn das H3-Substrat keine Auffälligkeiten zeigt, beschreibst du nur, was die SYNTHESE textlich tut.',
		'',
		'  TEIL B — fragestellungsAntwortText (2–4 Sätze deskriptiv):',
		'    Wie beantwortet die Arbeit die FRAGESTELLUNG?',
		'      • Wenn die SYNTHESE die Antwort nur teilweise oder implizit gibt: das so beschreiben.',
		'      • Wenn der FORSCHUNGSGEGENSTAND durch EXKURSE re-spezifiziert wurde: ist die Antwort am re-spezifizierten oder am ursprünglichen Gegenstand orientiert?',
		'      • Wenn AUDIT-ONLY-Hotspots vorliegen, deren Themen die FRAGESTELLUNG berühren: deskriptiv vermerken, dass dieses empirische Material keine tragende Aussage trägt.',
		'      • Wenn die FRAGESTELLUNG-BEURTEILUNG einen Beurteilungs-Hinweis enthält (z.B. unscharfe Perspektive), der die Antwort-Lage erklärt: deskriptiv darauf Bezug nehmen.',
		'',
		'  TEIL C — erkenntnisIntegration:',
		'    Pro vorgelegtem BEFUND (1-basierter Index): prüfe, ob er in der SYNTHESE adressiert wird — d.h. ob die SYNTHESE auf diesen Befund Bezug nimmt, ihn integriert oder weiterführt. Output pro Befund:',
		'      - befundIndex: 1-basierte Position in der vorgelegten Liste',
		'      - integriert: true/false',
		'      - synthesisAnchorParagraphIndex: wenn integriert=true, der 1-basierte Index des SYNTHESE-¶, der diesen Befund am deutlichsten aufgreift. Sonst null.',
		'      - hinweis: bei integriert=false, eine kurze Critical-Friend-Bemerkung (1 Satz) zum nicht-integrierten Befund (z.B. "Befund X zur Wirkung von Y bleibt unerwähnt"). Bei integriert=true: null oder ein knapper Bezugs-Hinweis.',
		'',
		'STIL: DESKRIPTIV. Lese-Hinweise aus Theoriebasis-Profil, methodischem Setup, AUDIT-ONLY-Hotspots und EXKURS-Re-Spezifikationen integrierst du in die Beschreibung des Gesamtergebnisses, NICHT als getrennten Wertungsabschnitt. Critical-Friend-Bemerkungen zu nicht-integrierten BEFUNDEN sind erlaubt — als Lese-Hinweis, nicht als Urteil über die Arbeit. Verwende keine Adjektive wie "stark", "schwach", "lückenhaft", "kohärent", "tragfähig"; bleib bei deskriptiven Verben.',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "gesamtergebnisText": "<5–8 Sätze deskriptiv>",',
		'  "fragestellungsAntwortText": "<2–4 Sätze deskriptiv>",',
		'  "erkenntnisIntegration": [',
		'    {"befundIndex": 1, "integriert": true|false, "synthesisAnchorParagraphIndex": <int>|null, "hinweis": "<text>"|null},',
		'    ...',
		'  ]',
		'}',
	].join('\n');

	// SYNTHESE-Text mit globalem ¶-Index aufbereiten
	const syntheseBlocks: string[] = [];
	for (const c of input.syntheseContainers) {
		syntheseBlocks.push(`### ${c.headingText} (${c.paragraphs.length} ¶)`);
		for (const p of c.paragraphs) {
			syntheseBlocks.push(`[¶${p.indexInWerk}] ${p.text}`);
		}
		syntheseBlocks.push('');
	}
	const syntheseText = syntheseBlocks.join('\n\n');

	// BEFUNDE-Liste mit Index (Quelle für TEIL C)
	const befundBlocks =
		input.befunds.length > 0
			? input.befunds.map((b, i) => `[Befund ${i + 1}] ${b.text}`).join('\n\n')
			: '(keine BEFUND-Konstrukte aus DURCHFÜHRUNG mit text!=null vorhanden)';

	const subjectKeywordsBlock =
		input.forschungsgegenstand.subjectKeywords.length > 0
			? input.forschungsgegenstand.subjectKeywords.map((k) => `- ${k}`).join('\n')
			: '(keine subjectKeywords erfasst)';

	// Optional-Blöcke (null wenn nicht vorhanden)
	const fragBeurteilungBlock = formatFragestellungBeurteilungBlock(
		input.fragestellungBeurteilung
	);
	const motivationBlock = formatMotivationBlock(input.motivation);
	const theoriebasisBlock = formatTheoriebasisBlock({
		verweisProfil: input.verweisProfil,
		gthReflexion: input.gthReflexion,
		respecHistory: input.respecHistory,
	});
	const empirieBlock = formatAuditOnlyAndArgumentBlock({
		befundCount: input.befunds.length,
		auditOnlyHotspots: input.auditOnlyHotspots,
		argSubstrate: input.argSubstrate,
	});
	const methodikBlock = formatMethodischesSetupBlock(input.forschungsdesign);

	const sections: string[] = [];

	sections.push('=== KONTEXT ===');
	sections.push(`FRAGESTELLUNG der Arbeit:\n${input.fragestellung}`);
	if (fragBeurteilungBlock) sections.push(fragBeurteilungBlock);
	if (motivationBlock) sections.push(motivationBlock);
	sections.push(
		`FORSCHUNGSGEGENSTAND (aus GRUNDLAGENTHEORIE, ggf. nach EXKURS-Re-Spezifikationen):\n${input.forschungsgegenstand.text}`
	);
	sections.push(`Kernbegriffe (subjectKeywords):\n${subjectKeywordsBlock}`);

	sections.push('=== METHODISCHES SETUP ===');
	sections.push(methodikBlock);

	if (theoriebasisBlock) {
		sections.push('=== THEORIEBASIS-PROFIL ===');
		sections.push(theoriebasisBlock);
	} else {
		sections.push('=== THEORIEBASIS-PROFIL ===');
		sections.push(
			'(kein Theoriebasis-Profil verfügbar — VERWEIS_PROFIL/BLOCK_WUERDIGUNG/ECKPUNKT_BEFUND/DISKURSIV_BEZUG_BEFUND-Konstrukte fehlen; H3:GRUNDLAGENTHEORIE-Pass wurde ggf. nicht oder nur teilweise ausgeführt.)'
		);
	}

	if (empirieBlock) {
		sections.push('=== EMPIRIE-SUBSTRAT ===');
		sections.push(empirieBlock);
	}

	sections.push(
		`=== BEFUNDE-LISTE (Quelle für TEIL C; insgesamt ${input.befunds.length}) ===`
	);
	sections.push(befundBlocks);

	sections.push(
		`=== SYNTHESE-MATERIAL (${input.syntheseContainers.length} Container, gesamt ${input.syntheseContainers.reduce((s, c) => s + c.paragraphs.length, 0)} ¶) ===`
	);
	sections.push(syntheseText);

	const userMessage = sections.join('\n\n');

	const t0 = Date.now();
	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: input.maxTokens,
		responseFormat: 'json',
		documentIds: [input.documentId],
		modelOverride: input.modelOverride,
	});
	const timingMs = Date.now() - t0;

	const parsed: ExtractResult<GesamtergebnisLLMResult> = extractAndValidateJSON(
		response.text,
		GesamtergebnisLLMSchema
	);
	if (!parsed.ok) {
		const stage = 'stage' in parsed ? parsed.stage : 'unknown';
		const error = 'error' in parsed ? parsed.error : 'unknown';
		throw new Error(
			`SYNTHESE-GESAMTERGEBNIS: Antwort nicht parsbar (stage=${stage}): ${error}\n` +
				`Raw: ${response.text.slice(0, 500)}`
		);
	}

	return {
		result: parsed.value,
		model: response.model,
		provider: response.provider,
		timingMs,
		tokens: { input: response.inputTokens, output: response.outputTokens },
	};
}

// ── Persistenz ────────────────────────────────────────────────────

interface ErkenntnisIntegrationEntry {
	befundId: string;
	befundSnippet: string;
	integriert: boolean;
	synthesisAnchorParagraphId: string | null;
	hinweis: string | null;
}

interface CrossTypeReadsSnapshot {
	hasFragestellungBeurteilung: boolean;
	hasMotivation: boolean;
	forschungsdesign: {
		hasMethodologie: boolean;
		hasMethoden: boolean;
		hasBasis: boolean;
	};
	verweisProfil: { containerCount: number; totalCitations: number } | null;
	gthReflexion: {
		containerCount: number;
		wuerdigungBlockCount: number;
		eckpunktBlockCount: number;
		diskursivBlockCount: number;
		bezugslosBlockCount: number;
	} | null;
	respecHistoryCount: number;
	auditOnlyHotspotCount: number;
	argumentNodeCount: number;
}

interface GesamtergebnisContent {
	gesamtergebnisText: string;
	fragestellungsAntwortText: string;
	erkenntnisIntegration: ErkenntnisIntegrationEntry[];
	coverageRatio: number | null;
	containerOverview: Array<{ headingText: string; paragraphCount: number }>;
	befundCount: number;
	crossTypeReads: CrossTypeReadsSnapshot;
	llmModel: string;
	llmTimingMs: number;
}

async function clearExistingGesamtergebnis(
	caseId: string,
	documentId: string
): Promise<number> {
	const result = await query(
		`DELETE FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'SYNTHESE'
		   AND construct_kind = 'GESAMTERGEBNIS'`,
		[caseId, documentId]
	);
	return result.rowCount ?? 0;
}

async function persistGesamtergebnis(
	caseId: string,
	documentId: string,
	allParagraphIds: string[],
	content: GesamtergebnisContent
): Promise<string> {
	if (allParagraphIds.length === 0) {
		throw new Error('GESAMTERGEBNIS: keine SYNTHESE-¶ als Anker.');
	}
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
		    anchor_element_ids, content, version_stack)
		 VALUES ($1, $2, 'SYNTHESE', 'GESAMTERGEBNIS', $3, $4, $5)
		 RETURNING id`,
		[
			caseId,
			documentId,
			allParagraphIds,
			JSON.stringify(content),
			JSON.stringify([stackEntry]),
		]
	);
	if (!row) throw new Error('Failed to persist GESAMTERGEBNIS');
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

// Token-Budget 2026-05-05 erhöht: SYNTHESE bekommt jetzt das volle H3-Substrat
// (Theoriebasis-Profil, methodisches Setup, FRAGESTELLUNG-Beurteilung, MOTIVATION,
// EXKURS-Re-Spec-Geschichte, Audit-only-Hotspots) als Kontext. Output erweitert
// (gesamtergebnisText 5–8 Sätze, fragestellungsAntwortText 2–4 Sätze + voller
// erkenntnisIntegration-Array). 2000 reichten dafür nicht.
const DEFAULT_MAX_TOKENS = 6000;

export interface SynthesePassOptions {
	persistConstructs?: boolean;
	maxTokens?: number;
	modelOverride?: { provider: Provider; model: string };
}

export interface SyntheseContainerSummary {
	headingId: string;
	headingText: string;
	paragraphCount: number;
}

export interface SynthesePassResult {
	caseId: string;
	documentId: string;
	syntheseContainers: SyntheseContainerSummary[];
	befundCount: number;
	fragestellungSnippet: string | null;
	forschungsgegenstandSnippet: string | null;
	subjectKeywords: string[];
	gesamtergebnis: {
		text: string;
		fragestellungsAntwort: string;
		erkenntnisIntegration: ErkenntnisIntegrationEntry[];
		coverageRatio: number | null;
	} | null;
	constructId: string | null;
	deletedPriorCount: number;
	llmCalls: number;
	llmTimingMs: number;
	tokens: { input: number; output: number };
	provider: string;
	model: string;
	diagnostics: {
		fragestellungCount: number;
		forschungsgegenstandCount: number;
		crossTypeReads: CrossTypeReadsSnapshot;
		warnings: string[];
	};
}

export async function runSynthesePass(
	caseId: string,
	options: SynthesePassOptions = {}
): Promise<SynthesePassResult> {
	const persistConstructs = options.persistConstructs !== false;
	const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
	const modelOverride = options.modelOverride ?? resolveTier('h3.tier2');
	const warnings: string[] = [];

	const { centralDocumentId: documentId, brief } = await loadH3CaseContext(caseId);

	const containers = await loadSyntheseContainers(documentId);

	const fsRes = await loadFragestellungWithDiagnostics(caseId, documentId);
	const fgRes = await loadForschungsgegenstandWithDiagnostics(caseId, documentId);

	if (fsRes.diag.duplicate) {
		warnings.push(
			`FRAGESTELLUNG: ${fsRes.diag.count} Konstrukte vorhanden — jüngstes wird verwendet. ` +
				`Cleanup empfohlen.`
		);
	}
	if (fgRes.diag.duplicate) {
		warnings.push(
			`FORSCHUNGSGEGENSTAND: ${fgRes.diag.count} Konstrukte vorhanden — jüngstes wird ` +
				`verwendet. Cleanup empfohlen.`
		);
	}

	// Setzung 2026-05-04: keine SYNTHESE-Container im Werk → STOP, kein
	// no-op-Return. Spec docs/h3_orchestrator_spec.md #2: harte Vorbedingung
	// (SYNTHESE-Material) verletzt → Run-State `failed` mit Reviewer-Recovery-
	// Diagnose. Kein "stiller Skip", weil der Skip die echte Diagnose
	// verschlucken würde — Reviewer braucht den Hinweis auf fehlende SYNTHESE-
	// Container, nicht eine generische Pass-Vertrags-Verletzung.
	//
	// Critical-Friend-Hinweis im Diagnose-Text: häufiger Fall in literatur-
	// basierten BAs ist, dass die Synthese-Funktion in einem Kapitel mitläuft,
	// das als DURCHFUEHRUNG markiert wurde (z.B. "die theoretisch motivierten
	// Bereiche zusammenführendes" Pädagogik-Kapitel). Reviewer prüft Outline-
	// Funktionstypen und kann ggf. umtaggen.
	if (containers.length === 0) {
		throw new PreconditionFailedError({
			heuristic: 'SYNTHESE',
			missing: 'SYNTHESE-Container im Outline',
			diagnostic:
				'Kein als SYNTHESE markiertes Kapitel im Werk gefunden — die Heuristik kann ohne SYNTHESE-Material kein GESAMTERGEBNIS aggregieren. Reviewer-Aktion: prüfen, ob ein anderes Kapitel funktional die Synthese-Leistung erfüllt (häufig: ein Kapitel, das mehrere theoretische Stränge zusammenführt, oder ein "Fazit" in dem Synthese und Schlussreflexion verschmelzen). In diesen Fällen den Funktionstyp am Heading umtaggen und Pipeline neu triggern. Falls das Werk strukturell keine integrierende Synthese leistet: das ist ein Befund, der im Werk-Gutacht zur Abwertung führt.',
		});
	}

	if (!fsRes.text) {
		throw new PreconditionFailedError({
			heuristic: 'SYNTHESE',
			missing: 'FRAGESTELLUNG',
			diagnostic:
				`Werk ${documentId}: FRAGESTELLUNG fehlt. ` +
				`Erst H3:EXPOSITION laufen.`,
		});
	}
	if (!fgRes.fg) {
		throw new PreconditionFailedError({
			heuristic: 'SYNTHESE',
			missing: 'FORSCHUNGSGEGENSTAND',
			diagnostic:
				`Werk ${documentId}: FORSCHUNGSGEGENSTAND fehlt. ` +
				`Erst H3:GRUNDLAGENTHEORIE Schritt 4 laufen.`,
		});
	}

	const befunds = await loadBefundsWithText(caseId, documentId);

	// Cross-Typ-Reads — alle defensiv (null/empty wenn Vorgänger-Pässe fehlen).
	// Parallel laden, damit kein DB-Roundtrip-Stau entsteht.
	const [
		fragestellungBeurteilung,
		motivation,
		forschungsdesign,
		verweisProfil,
		gthReflexion,
		respecHistory,
		auditOnlyHotspots,
		argSubstrate,
	] = await Promise.all([
		loadFragestellungBeurteilung(caseId, documentId),
		loadMotivation(caseId, documentId),
		loadForschungsdesignTriple(caseId, documentId),
		loadVerweisProfilAggregate(caseId, documentId),
		loadGthReflexionAggregate(caseId, documentId),
		loadFgRespecHistory(caseId, documentId),
		loadAuditOnlyHotspots(caseId, documentId),
		loadArgumentSubstrateCounts(documentId),
	]);

	const crossTypeReads: CrossTypeReadsSnapshot = {
		hasFragestellungBeurteilung: fragestellungBeurteilung !== null,
		hasMotivation: motivation !== null,
		forschungsdesign: {
			hasMethodologie: forschungsdesign.methodologieText !== null,
			hasMethoden: forschungsdesign.methodenText !== null,
			hasBasis: forschungsdesign.basisText !== null,
		},
		verweisProfil: verweisProfil
			? {
				containerCount: verweisProfil.containerCount,
				totalCitations: verweisProfil.totalCitations,
			}
			: null,
		gthReflexion: gthReflexion
			? {
				containerCount: gthReflexion.containerCount,
				wuerdigungBlockCount: gthReflexion.wuerdigungBlockCount,
				eckpunktBlockCount: gthReflexion.eckpunktBlockCount,
				diskursivBlockCount: gthReflexion.diskursivBlockCount,
				bezugslosBlockCount: gthReflexion.diskursivBezug.bezugslosBlocks.length,
			}
			: null,
		respecHistoryCount: respecHistory.length,
		auditOnlyHotspotCount: auditOnlyHotspots.length,
		argumentNodeCount: argSubstrate.argumentNodeCount,
	};

	// Critical-Friend-Warnungen, wenn Substrat dünn ist (kein Blocker — fehlendes
	// ist Befund, nicht Stop, siehe feedback_missing_is_finding_not_block.md):
	if (!verweisProfil) {
		warnings.push(
			'Theoriebasis-Profil leer — VERWEIS_PROFIL-Konstrukte fehlen. SYNTHESE läuft ohne Verweis-Aggregat-Hinweise.'
		);
	}
	if (!gthReflexion) {
		warnings.push(
			'Theorie-Reflexion leer — BLOCK_WUERDIGUNG/ECKPUNKT_BEFUND/DISKURSIV_BEZUG_BEFUND fehlen. SYNTHESE läuft ohne Eckpunkt- und Bezugs-Hinweise.'
		);
	}
	if (
		!forschungsdesign.methodologieText &&
		!forschungsdesign.methodenText &&
		!forschungsdesign.basisText
	) {
		warnings.push(
			'Methodisches Setup leer — METHODOLOGIE/METHODEN/BASIS fehlen. SYNTHESE läuft ohne Methodik-Bezug.'
		);
	}

	const llmRes = await extractGesamtergebnis({
		fragestellung: fsRes.text,
		fragestellungBeurteilung,
		motivation,
		forschungsgegenstand: fgRes.fg,
		forschungsdesign,
		verweisProfil,
		gthReflexion,
		respecHistory,
		auditOnlyHotspots,
		argSubstrate,
		syntheseContainers: containers,
		befunds,
		brief,
		documentId,
		maxTokens,
		modelOverride,
	});

	// LLM-Indices auf paragraph_id und befund_id zurückmappen.
	// SYNTHESE-¶ haben indexInWerk (1-basiert über alle Container).
	const werkParagraphIndex = new Map<number, string>();
	for (const c of containers) {
		for (const p of c.paragraphs) {
			werkParagraphIndex.set(p.indexInWerk, p.paragraphId);
		}
	}

	const integrationEntries: ErkenntnisIntegrationEntry[] = [];
	for (const item of llmRes.result.erkenntnisIntegration) {
		const befund = befunds[item.befundIndex - 1];
		if (!befund) continue; // LLM hat ungültigen Index produziert — überspringen
		const synthesisAnchorParagraphId =
			item.synthesisAnchorParagraphIndex !== null
				? (werkParagraphIndex.get(item.synthesisAnchorParagraphIndex) ?? null)
				: null;
		integrationEntries.push({
			befundId: befund.id,
			befundSnippet: befund.text.slice(0, 200),
			integriert: item.integriert,
			synthesisAnchorParagraphId,
			hinweis: item.hinweis,
		});
	}

	const integratedCount = integrationEntries.filter((e) => e.integriert).length;
	const coverageRatio =
		integrationEntries.length > 0 ? integratedCount / integrationEntries.length : null;

	const allParagraphIds: string[] = [];
	for (const c of containers) {
		for (const p of c.paragraphs) {
			allParagraphIds.push(p.paragraphId);
		}
	}

	const content: GesamtergebnisContent = {
		gesamtergebnisText: llmRes.result.gesamtergebnisText,
		fragestellungsAntwortText: llmRes.result.fragestellungsAntwortText,
		erkenntnisIntegration: integrationEntries,
		coverageRatio,
		containerOverview: containers.map((c) => ({
			headingText: c.headingText,
			paragraphCount: c.paragraphs.length,
		})),
		befundCount: befunds.length,
		crossTypeReads,
		llmModel: llmRes.model,
		llmTimingMs: llmRes.timingMs,
	};

	let constructId: string | null = null;
	let deletedPriorCount = 0;
	if (persistConstructs) {
		deletedPriorCount = await clearExistingGesamtergebnis(caseId, documentId);
		constructId = await persistGesamtergebnis(
			caseId,
			documentId,
			allParagraphIds,
			content
		);
	}

	return {
		caseId,
		documentId,
		syntheseContainers: containers.map((c) => ({
			headingId: c.headingId,
			headingText: c.headingText,
			paragraphCount: c.paragraphs.length,
		})),
		befundCount: befunds.length,
		fragestellungSnippet: fsRes.text.slice(0, 200),
		forschungsgegenstandSnippet: fgRes.fg.text.slice(0, 200),
		subjectKeywords: fgRes.fg.subjectKeywords,
		gesamtergebnis: {
			text: content.gesamtergebnisText,
			fragestellungsAntwort: content.fragestellungsAntwortText,
			erkenntnisIntegration: content.erkenntnisIntegration,
			coverageRatio: content.coverageRatio,
		},
		constructId,
		deletedPriorCount,
		llmCalls: 1,
		llmTimingMs: llmRes.timingMs,
		tokens: llmRes.tokens,
		provider: llmRes.provider,
		model: llmRes.model,
		diagnostics: {
			fragestellungCount: fsRes.diag.count,
			forschungsgegenstandCount: fgRes.diag.count,
			crossTypeReads,
			warnings,
		},
	};
}
