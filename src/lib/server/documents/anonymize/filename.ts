// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Generierter Anzeige-Filename für anonymisierte Dokumente.
// Pattern: {Type}_{YYYY-MM-DD}_{TitleWord}.{ext}
//
// Hintergrund: der hochgeladene Filename leakt oft direkt den Autor
// ("Habilitation_Mustermann_2025.docx"). Daher wird `namings.inscription`
// nach erfolgter Anonymisierung durch ein generiertes Schema ersetzt.
// Der originale Filename bleibt nur als `document_content.original_filename`
// für die lokale User-Referenz erhalten — nicht im Inscription-Pfad und
// nicht in irgendwas, das an externe Provider geht.
//
// Type-Slot: bis zur Falltyp-System-Implementierung (Stufe 3) immer
// 'Dokument'. Wenn case_documents existiert, wird daraus z.B. 'Habilitation'
// oder 'PeerReview'.

import { collapseSpaces, stripTitles } from './seeds.js';

const FILENAME_SAFE_RE = /[^a-zA-Z0-9äöüÄÖÜßÀ-ɏ_-]/g;

function sanitizeFilenameToken(s: string, maxLen = 24): string {
	const cleaned = collapseSpaces(s)
		.replace(/[äöüÄÖÜß]/g, (c) =>
			({ ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' })[c] ?? c
		)
		.replace(FILENAME_SAFE_RE, '')
		.slice(0, maxLen);
	return cleaned || 'anonym';
}

function todayIso(): string {
	const d = new Date();
	return d.toISOString().slice(0, 10);
}

export interface SyntheticFilenameOptions {
	/** Document type (Falltyp) — falls Stufe 3 nicht aktiv: 'Dokument'. */
	docType?: string;
	/** Title aus dem Dokument — z.B. erstes Heading oder Frontmatter-Titel. */
	title?: string;
	/** Originalextension, z.B. 'docx' oder 'pdf'. Default 'docx'. */
	ext?: string;
	/** Datum-Override (für Tests). Default: heute. */
	date?: string;
}

/**
 * Generiert einen anonymisierten Anzeige-Filename.
 *
 * Beispiel:
 *   buildSyntheticFilename({ title: 'Bildungsphilosophie als Reflexion', ext: 'docx' })
 *     → 'Dokument_2026-05-02_Bildungsphilosophie.docx'
 */
export function buildSyntheticFilename(opts: SyntheticFilenameOptions = {}): string {
	const docType = sanitizeFilenameToken(opts.docType ?? 'Dokument', 16);
	const date = opts.date ?? todayIso();
	const ext = (opts.ext ?? 'docx').replace(/^\./, '');
	const titleWord = opts.title
		? sanitizeFilenameToken(firstSubstantiveWord(opts.title), 24)
		: 'anonym';
	return `${docType}_${date}_${titleWord}.${ext}`;
}

/**
 * Erste substantivische "Inhalts"-Token aus einem Titel.
 *
 * Heuristik: Suche das erste Token von ≥4 Buchstaben, das groß anfängt
 * (Substantiv-Indiz im Deutschen) UND kein Funktionswort ist. Fallback:
 * irgendein erstes Token ≥4 Buchstaben. Letzter Fallback: 'anonym'.
 */
function firstSubstantiveWord(title: string): string {
	const STOPWORDS = new Set([
		'der', 'die', 'das', 'den', 'dem', 'des', 'eine', 'einen', 'einem', 'einer', 'eines',
		'the', 'and', 'for', 'with', 'from', 'into', 'onto', 'upon',
		'le', 'la', 'les', 'un', 'une', 'des', 'aux',
		'el', 'los', 'las', 'unos', 'unas',
		'il', 'lo', 'gli',
		'zur', 'zum', 'beim', 'vom', 'als', 'sind', 'werden', 'wird', 'wurde', 'kann', 'soll',
		'über', 'unter', 'zwischen', 'gegen', 'trotz', 'wegen',
		'on', 'in', 'of', 'to', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been'
	]);
	const cleaned = stripTitles(title).replace(/[^\p{L}\p{N}\s-]/gu, ' ');
	const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 4);
	for (const t of tokens) {
		if (STOPWORDS.has(t.toLowerCase())) continue;
		if (/^[A-ZÄÖÜÅÆØÀ-ɏ]/.test(t)) return t;
	}
	for (const t of tokens) {
		if (!STOPWORDS.has(t.toLowerCase())) return t;
	}
	return tokens[0] ?? 'anonym';
}
