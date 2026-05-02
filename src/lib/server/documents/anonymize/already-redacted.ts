// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Skip-Check: ist die Frontpage des Dokuments BEREITS händisch geschwärzt?
// Wenn ja, läuft die deterministische Anonymisierung nicht mehr — der User
// hat sein Werkzeug schon eingesetzt. Status wird auf
// 'skipped_already_redacted' gesetzt, der Failsafe-Tripwire bleibt
// trotzdem scharf (mit den Seeds, die der Verifikations-Pass dennoch
// extrahiert hätte) — falls die User-Schwärzung Lücken hat, blockt der
// Failsafe vor dem ersten Outbound-Call.

import { extractFrontmatter } from './seeds.js';

// Inline-Helfer (vorher aus seeds.ts importiert) — beim NER-Refactor
// wurden looksLikePersonName / collapseSpaces dort gestrichen, weil der
// Hauptpfad jetzt spaCy nutzt. Hier reicht eine simple Plausibilitäts-
// Heuristik: 2–5 Tokens, jeweils Cap-Start.
function collapseSpaces(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}
function looksLikePersonNameSimple(value: string): boolean {
	const cleaned = value.replace(/\([^)]*\)/g, '').trim();
	if (cleaned.length < 5) return false;
	const tokens = cleaned.match(/\p{Lu}[\p{L}\p{M}.'’-]{1,}|\p{Lu}\./gu) ?? [];
	if (tokens.length < 2 || tokens.length > 5) return false;
	return true;
}

// Block-Box-Glyphs in der Frontpage. Drei oder mehr in Folge gelten als
// Schwärzung. Inkludiert Unicode-Block-Characters und ASCII-Fallbacks.
const REDACTION_GLYPH_RE = /[█▓▒░■▄▀▌▐]{3,}|[X]{4,}|[x]{4,}|[*]{4,}|_{4,}/;

// Bracket-Platzhalter, die statt eines Namens stehen.
const BRACKET_PLACEHOLDER_RE =
	/\[\s*(?:anonymisiert|anonymized|redacted|name|n\.n\.|nn|xxx+|geschw[aä]rzt|caviardé|censurado|oscurato|verwijderd|usuni[eę]ty|cenzurov[áa]no)\s*\]/i;

// Wort-Form-Schwärzung: "anonymisiert" / "redacted" steht statt eines Namens.
const WORD_PLACEHOLDER_RE =
	/\b(?:anonymisiert|anonymized|redacted|geschw[aä]rzt|caviardé|censurado|oscurato|usuni[eę]ty|n\.\s*n\.|XXXX+|xxxx+)\b/i;

// Frontmatter-Stop-Hint: Author-Label-Patterns. Wenn auf der Frontpage
// ein Author-Label vorkommt UND in dessen Umgebung statt eines Namens
// eine der oben genannten Schwärzungs-Patterns steht, gilt der Author
// als geschwärzt.
//
// Wichtig: nicht jede Schwärzung im Dokument zählt — nur die im Author-
// Slot. Random `[anonymisiert]` in einer Fußnote bedeutet nicht, dass die
// Frontpage geschwärzt ist.
const AUTHOR_LABEL_RE =
	/\b(?:vorgelegt\s+von|eingereicht\s+von|verfasst\s+von|submitted\s+by|presented\s+by|written\s+by|autor(?:in)?|author|verfasser(?:in)?|name|nom|nombre|nome|naam|tekijä|szerző|αυτή|yazar|автор)\s*[:.]?\s*/i;

export interface RedactionCheckResult {
	skipped: boolean;
	reason: 'no_author_label' | 'name_present' | 'redacted' | 'inconclusive';
	evidence?: string;
}

export function isAuthorAlreadyRedacted(fullText: string): RedactionCheckResult {
	const frontmatter = extractFrontmatter(fullText);
	const lines = frontmatter.split(/\r?\n/).map(collapseSpaces);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const labelMatch = AUTHOR_LABEL_RE.exec(line);
		if (!labelMatch) continue;

		// Was steht direkt nach dem Label, oder auf der nächsten nicht-leeren Zeile?
		const tail = line.slice(labelMatch.index + labelMatch[0].length).trim();
		const candidate = tail || (i + 1 < lines.length ? lines[i + 1] : '');

		// Reihenfolge: erst Schwärzung prüfen (sonst würde "Dr. phil.
		// [ANONYMISIERT]" durch looksLikePersonNameSimple als gültiger
		// Name akzeptiert werden, weil es genug Cap-Tokens hat).
		if (
			REDACTION_GLYPH_RE.test(candidate) ||
			BRACKET_PLACEHOLDER_RE.test(candidate) ||
			WORD_PLACEHOLDER_RE.test(candidate)
		) {
			return { skipped: true, reason: 'redacted', evidence: candidate };
		}

		// Sonst: ist ein plausibler Name da → NICHT geschwärzt.
		if (looksLikePersonNameSimple(candidate)) {
			return { skipped: false, reason: 'name_present', evidence: candidate };
		}
	}

	// Kein Author-Label gefunden — wir wissen nicht, ob es eine Frontpage
	// gibt oder nicht. Conservative: NICHT skippen, weiter zur normalen
	// Anonymisierung. Wenn dort keine Seeds gefunden werden, landet das
	// Dokument auf 'no_candidates'.
	return { skipped: false, reason: 'no_author_label' };
}
