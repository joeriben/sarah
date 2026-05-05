// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:SCHLUSSREFLEXION — Geltungsanspruch + Grenzen + Anschlussforschung.
//
// Mother-Setzung (project_three_heuristics_architecture.md):
//   "Eine SCHLUSSREFLEXION diskutiert das GESAMTERGEBNIS im Hinblick auf
//   Reichweiten und Grenzen. Daraus ergibt sich eine mindestens implizite
//   Aussage über den GELTUNGSANSPRUCH der Arbeit, z.B. eine Forschungs-
//   lücke teilweise gefüllt oder ihr bestehen aufgewiesen zu haben,
//   Anschlussforschungen oder Umsetzungen in Praxisfeldern begründet zu
//   haben."
//   Konstrukte: GELTUNGSANSPRUCH, GRENZEN, ANSCHLUSSFORSCHUNG.
//   Tools: gleichnamige Extraktoren auf Schlüsselwort-Vorauswahl.
//   Cross-Typ: liest GESAMTERGEBNIS + FRAGESTELLUNG.
//
// User-Setzungen 2026-05-04 (analog SYNTHESE):
//   - Ein Konstrukt mit reichem content (Mother-Plural als Felder-Plural).
//     `construct_kind='GELTUNGSANSPRUCH'` (Mother's primary kind, da der
//     Geltungsanspruch das zentrale Werk-Reflexionskonstrukt ist).
//     content = {geltungsanspruchText, grenzenText, anschlussforschungText, ...}.
//   - Werk-Aggregat: anchor = alle ¶ aller SCHLUSSREFLEXION-Container.
//   - Cross-Typ-Reads erweitert über Mother-Minimum hinaus: zusätzlich
//     FORSCHUNGSGEGENSTAND (für Bezug) und METHODEN/BASIS (für Methoden-/
//     Sample-Grenzen-Reflektion). Mother-Lücke "SR zu Methoden-Grenzen"
//     wird damit geschlossen.
//   - Idempotenz: delete-before-insert. Kein version_stack-Wachstum
//     jenseits origin (SR ist die letzte Werk-Heuristik vor WERK_*).
//   - Schlüsselwort-Vorauswahl (Mother): heute NICHT als Pre-Filter
//     implementiert. Pragmatisch: ganzer SR-Container an LLM, der erkennt
//     die drei Komponenten selbst aus dem Kontext. Pre-Filter könnte
//     als Optimierung folgen, falls Container sehr groß werden.
//
// Critical-Friend-Identität (project_critical_friend_identity.md):
//   Texte sind deskriptiv. Bei nicht-explizit-formulierten Komponenten
//   (z.B. Werk benennt keine Grenzen) wird das transparent benannt
//   ("Werk reflektiert keine Methoden-Grenzen explizit"), nicht weg-
//   geschoben.
//
// Cross-Typ-Reads:
//   - FRAGESTELLUNG (EXPOSITION) — Pflicht
//   - GESAMTERGEBNIS (SYNTHESE) — Pflicht
//   - FORSCHUNGSGEGENSTAND (GRUNDLAGENTHEORIE, ggf. EXKURS-modifiziert) — Pflicht
//   - METHODEN + BASIS (FORSCHUNGSDESIGN) — optional (für Grenzen-Reflexion)
//
// Persistenz: function_constructs mit construct_kind='GELTUNGSANSPRUCH',
//   outline_function_type='SCHLUSSREFLEXION'.

import { z } from 'zod';
import { query, queryOne } from '../../db/index.js';
import { chat, type Provider } from '../client.js';
import { resolveTier } from '../model-tiers.js';
import { extractAndValidateJSON, type ExtractResult } from '../json-extract.js';
import { PreconditionFailedError } from './precondition.js';
import { loadEffectiveOutline } from '../../documents/outline.js';
import {
	loadH3CaseContext,
	formatWerktypLine,
	formatKriterienBlock,
	formatPersonaBlock,
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

export interface SchlussreflexionParagraph {
	paragraphId: string;
	charStart: number;
	charEnd: number;
	text: string;
	indexInContainer: number;
	indexInWerk: number;
}

export interface SchlussreflexionContainer {
	headingId: string;
	headingText: string;
	paragraphs: SchlussreflexionParagraph[];
}

export async function loadSchlussreflexionContainers(
	documentId: string
): Promise<SchlussreflexionContainer[]> {
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
		 ) h ON h.outline_function_type = 'SCHLUSSREFLEXION'
		 WHERE p.document_id = $1
		   AND p.element_type = 'paragraph'
		   AND p.section_kind = 'main'
		 ORDER BY p.char_start`,
		[documentId]
	)).rows;

	const byHeading = new Map<string, SchlussreflexionContainer>();
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

// ── Recovery: letztes Kapitel als SR-Material ────────────────────
//
// User-Setzung 2026-05-04: ohne SCHLUSSREFLEXION-Container nimmt die
// Heuristik das letzte Top-Level-Kapitel — in Werken mit Fazit-Kapitel
// verschmilzt SR häufig mit SYNTHESE im Schlussbereich. Default ist das
// letzte Drittel der ¶ (min 1); bei needsMoreContext eskaliert der Loop
// auf das letzte Unterkapitel oder das ganze Kapitel. Defizit-Befund
// ("Werk leistet keine SR-Diskussion") ist ein valides Resultat.

interface LastChapterRecovery {
	chapterHeadingId: string;
	chapterHeadingText: string;
	chapterParagraphs: SchlussreflexionParagraph[];
	lastSubchapterHeadingId: string | null;
	lastSubchapterHeadingText: string | null;
	lastSubchapterParagraphs: SchlussreflexionParagraph[];
}

async function loadLastChapterRecovery(
	documentId: string
): Promise<LastChapterRecovery | null> {
	const outline = await loadEffectiveOutline(documentId);
	if (!outline) return null;
	const visible = outline.headings.filter((h) => !h.excluded);
	const topLevel = visible.filter((h) => h.effectiveLevel === 1);
	if (topLevel.length === 0) return null;
	const lastChapter = topLevel[topLevel.length - 1];

	const idx = visible.findIndex((h) => h.elementId === lastChapter.elementId);
	const subsequent = visible.slice(idx + 1);
	const lastSubchapter =
		subsequent.length > 0 ? subsequent[subsequent.length - 1] : null;

	const chapterRows = (
		await query<{
			paragraph_id: string;
			char_start: number;
			char_end: number;
			text: string;
		}>(
			`SELECT p.id AS paragraph_id, p.char_start, p.char_end,
			        SUBSTRING(dc.full_text FROM p.char_start + 1
			                              FOR p.char_end - p.char_start) AS text
			 FROM document_elements p
			 JOIN document_content dc ON dc.naming_id = p.document_id
			 WHERE p.document_id = $1
			   AND p.element_type = 'paragraph'
			   AND p.section_kind = 'main'
			   AND p.char_start >= $2
			 ORDER BY p.char_start`,
			[documentId, lastChapter.charEnd]
		)
	).rows;

	if (chapterRows.length === 0) return null;

	const chapterParagraphs: SchlussreflexionParagraph[] = chapterRows.map(
		(r, i) => ({
			paragraphId: r.paragraph_id,
			charStart: r.char_start,
			charEnd: r.char_end,
			text: r.text.trim(),
			indexInContainer: i,
			indexInWerk: i + 1,
		})
	);

	const lastSubchapterParagraphs: SchlussreflexionParagraph[] = lastSubchapter
		? chapterParagraphs.filter((p) => p.charStart >= lastSubchapter.charEnd)
		: [];

	return {
		chapterHeadingId: lastChapter.elementId,
		chapterHeadingText: lastChapter.effectiveText,
		chapterParagraphs,
		lastSubchapterHeadingId: lastSubchapter?.elementId ?? null,
		lastSubchapterHeadingText: lastSubchapter?.effectiveText ?? null,
		lastSubchapterParagraphs,
	};
}

function takeLastThird<T>(arr: T[]): T[] {
	if (arr.length === 0) return [];
	const n = Math.max(1, Math.ceil(arr.length / 3));
	return arr.slice(-n);
}

function reindexParagraphs(
	paragraphs: SchlussreflexionParagraph[]
): SchlussreflexionParagraph[] {
	return paragraphs.map((p, i) => ({
		...p,
		indexInContainer: i,
		indexInWerk: i + 1,
	}));
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
		`SELECT count(*)::text AS n FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'EXPOSITION'
		   AND construct_kind = 'FRAGESTELLUNG'`,
		[caseId, documentId]
	);
	const count = countRow ? Number(countRow.n) : 0;
	const row = await queryOne<{ content: { text?: string } }>(
		`SELECT content FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'EXPOSITION'
		   AND construct_kind = 'FRAGESTELLUNG'
		 ORDER BY created_at DESC LIMIT 1`,
		[caseId, documentId]
	);
	return { text: row?.content?.text ?? null, diag: { count, duplicate: count > 1 } };
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
		`SELECT count(*)::text AS n FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'FORSCHUNGSGEGENSTAND'`,
		[caseId, documentId]
	);
	const count = countRow ? Number(countRow.n) : 0;
	const row = await queryOne<{ content: { text: string; subjectKeywords?: string[] } }>(
		`SELECT content FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'FORSCHUNGSGEGENSTAND'
		 ORDER BY created_at DESC LIMIT 1`,
		[caseId, documentId]
	);
	if (!row) return { fg: null, diag: { count, duplicate: count > 1 } };
	return {
		fg: { text: row.content.text, subjectKeywords: row.content.subjectKeywords ?? [] },
		diag: { count, duplicate: count > 1 },
	};
}

interface GesamtergebnisSnippet {
	text: string;
	fragestellungsAntwortText: string;
	coverageRatio: number | null;
}

async function loadGesamtergebnisWithDiagnostics(
	caseId: string,
	documentId: string
): Promise<{ ge: GesamtergebnisSnippet | null; diag: ConstructDuplicateInfo }> {
	const countRow = await queryOne<{ n: string }>(
		`SELECT count(*)::text AS n FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'SYNTHESE'
		   AND construct_kind = 'GESAMTERGEBNIS'`,
		[caseId, documentId]
	);
	const count = countRow ? Number(countRow.n) : 0;
	const row = await queryOne<{
		content: {
			gesamtergebnisText: string;
			fragestellungsAntwortText?: string;
			coverageRatio?: number | null;
		};
	}>(
		`SELECT content FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'SYNTHESE'
		   AND construct_kind = 'GESAMTERGEBNIS'
		 ORDER BY created_at DESC LIMIT 1`,
		[caseId, documentId]
	);
	if (!row) return { ge: null, diag: { count, duplicate: count > 1 } };
	return {
		ge: {
			text: row.content.gesamtergebnisText,
			fragestellungsAntwortText: row.content.fragestellungsAntwortText ?? '',
			coverageRatio: row.content.coverageRatio ?? null,
		},
		diag: { count, duplicate: count > 1 },
	};
}

// METHODOLOGIE/METHODEN/BASIS und alle weiteren Cross-Typ-Reads kommen
// aus werk-substrate.ts — gemeinsam mit SYNTHESE genutzt.

// ── LLM-Call ──────────────────────────────────────────────────────

const SchlussreflexionLLMSchema = z.object({
	geltungsanspruchText: z.string().min(1),
	grenzenText: z.string().min(1),
	anschlussforschungText: z.string().min(1),
	needsMoreContext: z.boolean(),
});
type SchlussreflexionLLMResult = z.infer<typeof SchlussreflexionLLMSchema>;

interface ExtractSchlussreflexionInput {
	fragestellung: string;
	fragestellungBeurteilung: FragestellungBeurteilungSnippet | null;
	motivation: MotivationSnippet | null;
	forschungsgegenstand: ForschungsgegenstandSnippet;
	gesamtergebnis: GesamtergebnisSnippet;
	forschungsdesign: ForschungsdesignSnippet;
	verweisProfil: VerweisProfilAggregate | null;
	gthReflexion: GthReflexionAggregate | null;
	respecHistory: ReSpecHistoryEntry[];
	auditOnlyHotspots: AuditOnlyHotspot[];
	argSubstrate: ArgumentSubstrateCounts | null;
	srContainers: SchlussreflexionContainer[];
	brief: H3BriefContext;
	documentId: string;
	maxTokens: number;
	modelOverride?: { provider: Provider; model: string };
}

async function extractSchlussreflexion(
	input: ExtractSchlussreflexionInput
): Promise<{
	result: SchlussreflexionLLMResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	const persona = formatPersonaBlock(input.brief);
	const kriterien = formatKriterienBlock(input.brief);
	const system = [
		...(persona ? [persona, ''] : []),
		'Du bist ein analytisches Werkzeug, das aus dem/den SCHLUSSREFLEXION-Kapitel(n) einer wissenschaftlichen Arbeit drei Komponenten extrahiert: GELTUNGSANSPRUCH, GRENZEN, ANSCHLUSSFORSCHUNG.',
		'',
		formatWerktypLine(input.brief),
		...(kriterien ? ['', kriterien] : []),
		'',
		'ROLLE / EPISTEMIK:',
		'  Critical Friend zum eigenen Urteil des/der Forschenden — du beschreibst, was die SCHLUSSREFLEXION leistet, und welche Lese-Hinweise das gesamte H3-Substrat (FRAGESTELLUNG-Beurteilung, MOTIVATION, methodisches Setup, Theoriebasis-Profil, BEFUND-/AUDIT-only-Lage, Argument-Substrat, EXKURS-Re-Spezifikationen, GESAMTERGEBNIS) zur Reichweite und zu den Grenzen der Arbeit nahelegen. Du beurteilst die Arbeit NICHT (kein "stark", "lückenhaft", "dünn", keine Skala). Auffälligkeiten (z.B. Theoriebasis-Konzentration, dünnes empirisches Material, nicht-integrierte BEFUNDE im GESAMTERGEBNIS) sind Lese-Hinweise, nie ein Urteil.',
		'',
		'BEGRIFFE:',
		'  GELTUNGSANSPRUCH: die (oft implizite) Aussage der Arbeit über ihre eigene Reichweite und Legitimität. Beispiele: "Forschungslücke teilweise gefüllt", "Bestand der Lücke nachgewiesen", "Anschlussforschung begründet", "Praxis-Empfehlungen abgeleitet". Was beansprucht die Arbeit, geleistet zu haben?',
		'  GRENZEN: die selbstreflektierten Reichweite-Limitierungen — methodische Grenzen (Sample-Größe/Auswahl, Methodenwahl, Methodologie-Selbstverständnis), Theoriebasis-Grenzen (Konzentration auf wenige Autor:innen, bezugslose Theoriestrecken), Geltungsbereich (Generalisierbarkeit, Übertragbarkeit), empirische Grenzen (BEFUNDE-Dichte, Audit-only-Hotspots, Argument-Substrat-Größe), thematische Grenzen (was wurde nicht adressiert). NICHT: externe Kritik, sondern was die Arbeit selbst benennt oder erkennen lässt — und was das H3-Substrat als Lese-Hinweis nahelegt.',
		'  ANSCHLUSSFORSCHUNG: explizit oder implizit benannte offene Fragen, vorgeschlagene weitere Untersuchungen, Praxis-Implementierungen, die als Anschluss formuliert werden.',
		'  FRAGESTELLUNG-BEURTEILUNG: separate Critical-Friend-Notiz aus dem EXPOSITION-Pass zur Gestalt der Fragestellung — relevant für GELTUNGSANSPRUCH (was die Frage selbst tragen kann).',
		'  MOTIVATION: in der Einleitung benannter Antrieb der Untersuchung — relevant für ANSCHLUSSFORSCHUNG-Framing.',
		'  THEORIEBASIS-PROFIL: deskriptives Aggregat der Verweis-Struktur (HHI, Top-Autoren, Konzentrations-Hinweise) plus Reflexionsbefunde aus der GRUNDLAGENTHEORIE.',
		'  AUDIT-ONLY-Hotspots: DURCHFÜHRUNGS-¶ mit Hotspot-Marker, an denen kein extrahierbarer BEFUND formuliert wurde — empirisches Material ohne tragende Aussage.',
		'  Argument-Substrat: Anzahl der argument_nodes (rohe AG-Strukturen) im Werk und in der DURCHFÜHRUNG — quantitatives Größen-Signal des analytischen Materials.',
		'  EXKURS-Re-Spezifikationen: spätere Theorie-Importe, die den Forschungsgegenstand nachträglich modifiziert haben.',
		'',
		'AUFGABE in drei Teilen:',
		'',
		'  TEIL A — geltungsanspruchText (3–6 Sätze deskriptiv):',
		'    Welchen Geltungsanspruch artikuliert die Arbeit? Beziehe dich konkret auf GESAMTERGEBNIS, FRAGESTELLUNGS-ANTWORT und FRAGESTELLUNG. Beziehe ein, ob die FRAGESTELLUNG-BEURTEILUNG einen Gestalt-Hinweis enthält (z.B. unscharfe Perspektive), der die Reichweite des Anspruchs erklärt. Wenn der Geltungsanspruch im Werk implizit bleibt, rekonstruiere ihn knapp und benenne explizit, dass er implizit ist.',
		'',
		'  TEIL B — grenzenText (3–6 Sätze deskriptiv):',
		'    Welche Reichweite-Grenzen reflektiert die Arbeit selbst? Beziehe ein:',
		'      • methodische Grenzen aus METHODOLOGIE/METHODEN/BASIS;',
		'      • Theoriebasis-Grenzen aus dem THEORIEBASIS-PROFIL (z.B. starke Konzentration auf einzelne Autor:innen, bezugslose Theoriestrecken);',
		'      • empirische Grenzen aus AUDIT-ONLY-Hotspots und der Größe des Argument-Substrats — speziell: AUDIT-ONLY-Hotspots sind Material, das keine Aussage trägt; Argument-Substrat-Zahlen geben einen Anhaltspunkt zur empirischen Tiefe;',
		'      • Geltungsbereich-/thematische Grenzen aus FRAGESTELLUNG ↔ GESAMTERGEBNIS ↔ EXKURS-Re-Spezifikationen.',
		'    Wenn das Werk diese Grenzen nicht explizit benennt, das deskriptiv sagen ("Das Werk reflektiert keine Theoriebasis-Konzentration explizit, obwohl das Profil HHI=0,65 zeigt") — ohne Skalen-Wertung.',
		'',
		'  TEIL C — anschlussforschungText (2–5 Sätze deskriptiv):',
		'    Welche Anschlussforschungen, offenen Fragen, Praxis-Empfehlungen formuliert die Arbeit? Beziehe ggf. die MOTIVATION ein (treibt sie auch die Anschluss-Setzungen?). Wenn keine vorhanden, das deskriptiv benennen.',
		'',
		'STIL: DESKRIPTIV. Lese-Hinweise aus Theoriebasis-Profil, methodischem Setup, AUDIT-ONLY-Hotspots, Argument-Substrat und EXKURS-Re-Spezifikationen integrierst du in die GRENZEN- und GELTUNGSANSPRUCH-Beschreibung, NICHT als getrennten Wertungsabschnitt. Verwende keine Adjektive wie "stark", "schwach", "lückenhaft", "dünn", "tragfähig"; bleib bei deskriptiven Verben.',
		'',
		'Selbst-Bewertung needsMoreContext:',
		'  Setze `needsMoreContext: true` NUR, wenn das vorgelegte SR-Material so eng ist, dass eine substantielle Lesart von GELTUNGSANSPRUCH/GRENZEN/ANSCHLUSSFORSCHUNG nicht möglich ist und MEHR Kontext (z.B. das ganze Schluss-Kapitel statt nur dessen letztes Drittel) plausibel zu einem präziseren Befund führen würde. Setze `false`, wenn das Material entweder ausreicht ODER das Werk strukturell keine SR-Diskussion enthält — der Defizit-Befund ("Werk reflektiert keine Grenzen explizit") ist ein valides Resultat, KEIN Grund für mehr Kontext. Im Zweifel `false`.',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "geltungsanspruchText": "<3–6 Sätze deskriptiv>",',
		'  "grenzenText": "<3–6 Sätze deskriptiv>",',
		'  "anschlussforschungText": "<2–5 Sätze deskriptiv>",',
		'  "needsMoreContext": false',
		'}',
	].join('\n');

	const srBlocks: string[] = [];
	for (const c of input.srContainers) {
		srBlocks.push(`### ${c.headingText} (${c.paragraphs.length} ¶)`);
		for (const p of c.paragraphs) {
			srBlocks.push(`[¶${p.indexInWerk}] ${p.text}`);
		}
		srBlocks.push('');
	}
	const srText = srBlocks.join('\n\n');

	// Optional-Blöcke
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
		befundCount: 0, // SR sieht den BEFUNDE-Korpus nicht direkt — nur GESAMTERGEBNIS aggregiert.
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
		`FORSCHUNGSGEGENSTAND (GRUNDLAGENTHEORIE, ggf. nach EXKURS-Re-Spezifikationen):\n${input.forschungsgegenstand.text}`
	);

	sections.push('=== METHODISCHES SETUP ===');
	sections.push(methodikBlock);

	if (theoriebasisBlock) {
		sections.push('=== THEORIEBASIS-PROFIL ===');
		sections.push(theoriebasisBlock);
	} else {
		sections.push('=== THEORIEBASIS-PROFIL ===');
		sections.push(
			'(kein Theoriebasis-Profil verfügbar — VERWEIS_PROFIL/BLOCK_WUERDIGUNG/ECKPUNKT_BEFUND/DISKURSIV_BEZUG_BEFUND-Konstrukte fehlen.)'
		);
	}

	if (empirieBlock) {
		sections.push('=== EMPIRIE-SUBSTRAT ===');
		sections.push(empirieBlock);
	}

	sections.push('=== GESAMTERGEBNIS (SYNTHESE) ===');
	sections.push(input.gesamtergebnis.text);
	sections.push(
		`FRAGESTELLUNGS-ANTWORT (aus SYNTHESE):\n${input.gesamtergebnis.fragestellungsAntwortText || '(nicht vorhanden)'}`
	);
	if (input.gesamtergebnis.coverageRatio !== null) {
		sections.push(
			`Erkenntnis-Integration in der SYNTHESE: coverageRatio=${(input.gesamtergebnis.coverageRatio * 100).toFixed(0)}% (Anteil der DURCHFÜHRUNGS-BEFUNDE, die im Gesamtergebnis adressiert werden)`
		);
	}

	sections.push(
		`=== SCHLUSSREFLEXION-MATERIAL (${input.srContainers.length} Container, gesamt ${input.srContainers.reduce((s, c) => s + c.paragraphs.length, 0)} ¶) ===`
	);
	sections.push(srText);

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

	const parsed: ExtractResult<SchlussreflexionLLMResult> = extractAndValidateJSON(
		response.text,
		SchlussreflexionLLMSchema
	);
	if (!parsed.ok) {
		const stage = 'stage' in parsed ? parsed.stage : 'unknown';
		const error = 'error' in parsed ? parsed.error : 'unknown';
		throw new Error(
			`SCHLUSSREFLEXION: Antwort nicht parsbar (stage=${stage}): ${error}\n` +
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

type RecoveryStage = 'none' | 'last-third' | 'last-subchapter' | 'last-chapter';

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

interface SchlussreflexionContent {
	geltungsanspruchText: string;
	grenzenText: string;
	anschlussforschungText: string;
	containerOverview: Array<{ headingText: string; paragraphCount: number }>;
	hadMethoden: boolean;
	hadBasis: boolean;
	crossTypeReads: CrossTypeReadsSnapshot;
	llmModel: string;
	llmTimingMs: number;
	recoveryStage: RecoveryStage;
}

async function clearExistingSchlussreflexion(
	caseId: string,
	documentId: string
): Promise<number> {
	const result = await query(
		`DELETE FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'SCHLUSSREFLEXION'
		   AND construct_kind = 'GELTUNGSANSPRUCH'`,
		[caseId, documentId]
	);
	return result.rowCount ?? 0;
}

async function persistSchlussreflexion(
	caseId: string,
	documentId: string,
	allParagraphIds: string[],
	content: SchlussreflexionContent
): Promise<string> {
	if (allParagraphIds.length === 0) {
		throw new Error('SCHLUSSREFLEXION: keine SR-¶ als Anker.');
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
		 VALUES ($1, $2, 'SCHLUSSREFLEXION', 'GELTUNGSANSPRUCH', $3, $4, $5)
		 RETURNING id`,
		[
			caseId,
			documentId,
			allParagraphIds,
			JSON.stringify(content),
			JSON.stringify([stackEntry]),
		]
	);
	if (!row) throw new Error('Failed to persist SCHLUSSREFLEXION');
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

// Token-Budget 2026-05-05 erhöht: SR bekommt jetzt das volle H3-Substrat
// (Theoriebasis-Profil, methodisches Setup inkl. METHODOLOGIE, FRAGESTELLUNG-
// Beurteilung, MOTIVATION, EXKURS-Re-Spec-Geschichte, Audit-only-Hotspots,
// Argument-Substrat) als Kontext. Output erweitert (3 Texte je 3–6 Sätze
// statt 1–4). 1500 reichten dafür nicht.
const DEFAULT_MAX_TOKENS = 5000;

export interface SchlussreflexionPassOptions {
	persistConstructs?: boolean;
	maxTokens?: number;
	modelOverride?: { provider: Provider; model: string };
}

export interface SchlussreflexionContainerSummary {
	headingId: string;
	headingText: string;
	paragraphCount: number;
}

export interface SchlussreflexionPassResult {
	caseId: string;
	documentId: string;
	srContainers: SchlussreflexionContainerSummary[];
	fragestellungSnippet: string | null;
	forschungsgegenstandSnippet: string | null;
	gesamtergebnisSnippet: string | null;
	hadMethoden: boolean;
	hadBasis: boolean;
	geltungsanspruchText: string | null;
	grenzenText: string | null;
	anschlussforschungText: string | null;
	constructId: string | null;
	deletedPriorCount: number;
	llmCalls: number;
	llmTimingMs: number;
	tokens: { input: number; output: number };
	provider: string;
	model: string;
	recoveryStage: RecoveryStage;
	diagnostics: {
		fragestellungCount: number;
		forschungsgegenstandCount: number;
		gesamtergebnisCount: number;
		crossTypeReads: CrossTypeReadsSnapshot;
		warnings: string[];
	};
}

export async function runSchlussreflexionPass(
	caseId: string,
	options: SchlussreflexionPassOptions = {}
): Promise<SchlussreflexionPassResult> {
	const persistConstructs = options.persistConstructs !== false;
	const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
	const modelOverride = options.modelOverride ?? resolveTier('h3.tier2');
	const warnings: string[] = [];

	const { centralDocumentId: documentId, brief } = await loadH3CaseContext(caseId);

	const containers = await loadSchlussreflexionContainers(documentId);

	const fsRes = await loadFragestellungWithDiagnostics(caseId, documentId);
	const fgRes = await loadForschungsgegenstandWithDiagnostics(caseId, documentId);
	const geRes = await loadGesamtergebnisWithDiagnostics(caseId, documentId);

	if (fsRes.diag.duplicate) {
		warnings.push(`FRAGESTELLUNG: ${fsRes.diag.count} Konstrukte vorhanden — jüngstes verwendet.`);
	}
	if (fgRes.diag.duplicate) {
		warnings.push(`FORSCHUNGSGEGENSTAND: ${fgRes.diag.count} Konstrukte vorhanden — jüngstes verwendet.`);
	}
	if (geRes.diag.duplicate) {
		warnings.push(`GESAMTERGEBNIS: ${geRes.diag.count} Konstrukte vorhanden — jüngstes verwendet.`);
	}

	// Setzung 2026-05-04: kein dediziertes SCHLUSSREFLEXION-Kapitel im
	// Outline → Recovery-Pfad statt Hard-Fail (User-Update gegenüber
	// Mother's STOP-Pattern). Annahme: in Werken mit Fazit-Kapitel
	// verschmilzt SR mit SYNTHESE im Schlussbereich — letztes Drittel
	// der ¶ ist die engste plausible Lokalisierung. Defizit-Befund vom
	// LLM ("keine GELTUNGSANSPRUCH/GRENZEN/ANSCHLUSSFORSCHUNG erkennbar")
	// ist legitimes Resultat und fließt als Konstrukt in WERK_GUTACHT
	// ein, statt den Run technisch fehlschlagen zu lassen.
	let usedContainers: SchlussreflexionContainer[] = containers;
	let recovery: LastChapterRecovery | null = null;
	let recoveryStage: RecoveryStage = 'none';

	if (containers.length === 0) {
		recovery = await loadLastChapterRecovery(documentId);
		if (!recovery || recovery.chapterParagraphs.length === 0) {
			throw new PreconditionFailedError({
				heuristic: 'SCHLUSSREFLEXION',
				missing: 'Werk-Schluss-Material',
				diagnostic:
					'Kein SCHLUSSREFLEXION-Container im Outline und Werk hat keine ableitbaren Schluss-Absätze (kein Top-Level-Kapitel mit Folgeabsätzen). Outline überprüfen — typischerweise Hinweis auf nicht-konfirmierte Outline oder strukturell unvollständiges Werk.',
			});
		}
		const lastThirdParagraphs = takeLastThird(recovery.chapterParagraphs);
		usedContainers = [
			{
				headingId: recovery.chapterHeadingId,
				headingText: `${recovery.chapterHeadingText} (Recovery: letztes Drittel — kein dediziertes SCHLUSSREFLEXION-Kapitel)`,
				paragraphs: reindexParagraphs(lastThirdParagraphs),
			},
		];
		recoveryStage = 'last-third';
		warnings.push(
			`SCHLUSSREFLEXION-Recovery: kein dedizierter SR-Container — ${lastThirdParagraphs.length} ¶ aus dem letzten Drittel von "${recovery.chapterHeadingText}" als Material genommen.`
		);
	}

	if (!fsRes.text) {
		throw new PreconditionFailedError({
			heuristic: 'SCHLUSSREFLEXION',
			missing: 'FRAGESTELLUNG',
			diagnostic: `Werk ${documentId}: FRAGESTELLUNG fehlt. Erst H3:EXPOSITION laufen.`,
		});
	}
	if (!fgRes.fg) {
		throw new PreconditionFailedError({
			heuristic: 'SCHLUSSREFLEXION',
			missing: 'FORSCHUNGSGEGENSTAND',
			diagnostic: `Werk ${documentId}: FORSCHUNGSGEGENSTAND fehlt. Erst H3:GRUNDLAGENTHEORIE Schritt 4 laufen.`,
		});
	}
	if (!geRes.ge) {
		throw new PreconditionFailedError({
			heuristic: 'SCHLUSSREFLEXION',
			missing: 'GESAMTERGEBNIS',
			diagnostic: `Werk ${documentId}: GESAMTERGEBNIS fehlt. Erst H3:SYNTHESE laufen.`,
		});
	}

	// Cross-Typ-Reads — alle defensiv (null/empty wenn Vorgänger-Pässe fehlen).
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

	if (!verweisProfil) {
		warnings.push(
			'Theoriebasis-Profil leer — VERWEIS_PROFIL-Konstrukte fehlen. SR läuft ohne Verweis-Aggregat-Hinweise.'
		);
	}
	if (!gthReflexion) {
		warnings.push(
			'Theorie-Reflexion leer — BLOCK_WUERDIGUNG/ECKPUNKT_BEFUND/DISKURSIV_BEZUG_BEFUND fehlen. SR läuft ohne Eckpunkt- und Bezugs-Hinweise.'
		);
	}
	if (
		!forschungsdesign.methodologieText &&
		!forschungsdesign.methodenText &&
		!forschungsdesign.basisText
	) {
		warnings.push(
			'Methodisches Setup leer — METHODOLOGIE/METHODEN/BASIS fehlen. SR läuft ohne Methodik-Bezug.'
		);
	}

	let llmRes = await extractSchlussreflexion({
		fragestellung: fsRes.text,
		fragestellungBeurteilung,
		motivation,
		forschungsgegenstand: fgRes.fg,
		gesamtergebnis: geRes.ge,
		forschungsdesign,
		verweisProfil,
		gthReflexion,
		respecHistory,
		auditOnlyHotspots,
		argSubstrate,
		srContainers: usedContainers,
		brief,
		documentId,
		maxTokens,
		modelOverride,
	});
	let llmCallCount = 1;

	if (recovery && llmRes.result.needsMoreContext) {
		const useSubchapter = recovery.lastSubchapterParagraphs.length > 0;
		const escalatedParagraphs = useSubchapter
			? recovery.lastSubchapterParagraphs
			: recovery.chapterParagraphs;
		const escalatedHeadingText = useSubchapter
			? (recovery.lastSubchapterHeadingText ?? recovery.chapterHeadingText)
			: recovery.chapterHeadingText;
		const escalatedHeadingId = useSubchapter
			? (recovery.lastSubchapterHeadingId ?? recovery.chapterHeadingId)
			: recovery.chapterHeadingId;
		const escalatedLabel = useSubchapter
			? `${escalatedHeadingText} (Recovery: ganzes letztes Unterkapitel)`
			: `${recovery.chapterHeadingText} (Recovery: ganzes letztes Kapitel)`;

		usedContainers = [
			{
				headingId: escalatedHeadingId,
				headingText: escalatedLabel,
				paragraphs: reindexParagraphs(escalatedParagraphs),
			},
		];
		recoveryStage = useSubchapter ? 'last-subchapter' : 'last-chapter';

		llmRes = await extractSchlussreflexion({
			fragestellung: fsRes.text,
			fragestellungBeurteilung,
			motivation,
			forschungsgegenstand: fgRes.fg,
			gesamtergebnis: geRes.ge,
			forschungsdesign,
			verweisProfil,
			gthReflexion,
			respecHistory,
			auditOnlyHotspots,
			argSubstrate,
			srContainers: usedContainers,
			brief,
			documentId,
			maxTokens,
			modelOverride,
		});
		llmCallCount = 2;
		warnings.push(
			`SCHLUSSREFLEXION-Recovery-Eskalation: LLM signalisierte zu wenig Kontext — auf "${escalatedLabel}" erweitert (${escalatedParagraphs.length} ¶).`
		);
	}

	const allParagraphIds: string[] = [];
	for (const c of usedContainers) {
		for (const p of c.paragraphs) {
			allParagraphIds.push(p.paragraphId);
		}
	}

	const content: SchlussreflexionContent = {
		geltungsanspruchText: llmRes.result.geltungsanspruchText,
		grenzenText: llmRes.result.grenzenText,
		anschlussforschungText: llmRes.result.anschlussforschungText,
		containerOverview: usedContainers.map((c) => ({
			headingText: c.headingText,
			paragraphCount: c.paragraphs.length,
		})),
		hadMethoden: forschungsdesign.methodenText !== null,
		hadBasis: forschungsdesign.basisText !== null,
		crossTypeReads,
		llmModel: llmRes.model,
		llmTimingMs: llmRes.timingMs,
		recoveryStage,
	};

	let constructId: string | null = null;
	let deletedPriorCount = 0;
	if (persistConstructs) {
		deletedPriorCount = await clearExistingSchlussreflexion(caseId, documentId);
		constructId = await persistSchlussreflexion(
			caseId,
			documentId,
			allParagraphIds,
			content
		);
	}

	return {
		caseId,
		documentId,
		srContainers: usedContainers.map((c) => ({
			headingId: c.headingId,
			headingText: c.headingText,
			paragraphCount: c.paragraphs.length,
		})),
		fragestellungSnippet: fsRes.text.slice(0, 200),
		forschungsgegenstandSnippet: fgRes.fg.text.slice(0, 200),
		gesamtergebnisSnippet: geRes.ge.text.slice(0, 200),
		hadMethoden: forschungsdesign.methodenText !== null,
		hadBasis: forschungsdesign.basisText !== null,
		geltungsanspruchText: content.geltungsanspruchText,
		grenzenText: content.grenzenText,
		anschlussforschungText: content.anschlussforschungText,
		constructId,
		deletedPriorCount,
		llmCalls: llmCallCount,
		llmTimingMs: llmRes.timingMs,
		tokens: llmRes.tokens,
		provider: llmRes.provider,
		model: llmRes.model,
		recoveryStage,
		diagnostics: {
			fragestellungCount: fsRes.diag.count,
			forschungsgegenstandCount: fgRes.diag.count,
			gesamtergebnisCount: geRes.diag.count,
			crossTypeReads,
			warnings,
		},
	};
}
