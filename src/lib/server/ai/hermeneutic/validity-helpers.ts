// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Geteilte Helfer für die Collapse-Pässe (subchapter / chapter / work),
// um die opt-in Validity-Daten (Migration 040, argument_validity-Pass)
// in den Synthese-Input einzuspeisen.
//
// Designprinzip: nur ERKANNTE FALLACIES werden in die Synthese-Prompts
// durchgereicht. Tragfähige Args (carries=true) bleiben unmarkiert —
// das spart Tokens und macht erkannte Brüche durch Schmalheit der Markierung
// salient (das LLM sieht die Auffälligkeit als Ausnahme, nicht als Routine).

export interface FallacyAnnotation {
	type: string;
	targetPremise: string;
	explanation: string;
}

/**
 * Extrahiert die Fallacy-Annotation aus einem rohen validity_assessment-JSONB.
 * Gibt null zurück wenn:
 *   - validity_assessment IS NULL (Pass nicht gelaufen / opt-in deaktiviert)
 *   - carries=true (Argument ist tragfähig — keine Annotation nötig)
 *   - Schema unerwartet (defensive: nicht annotieren statt crashen)
 */
export function extractFallacy(raw: unknown): FallacyAnnotation | null {
	if (raw == null) return null;
	if (typeof raw !== 'object') return null;
	const v = raw as Record<string, unknown>;
	if (v.carries !== false) return null;
	const fallacy = v.fallacy;
	if (!fallacy || typeof fallacy !== 'object') return null;
	const f = fallacy as Record<string, unknown>;
	const type = typeof f.type === 'string' ? f.type : null;
	const targetPremise = typeof f.target_premise === 'string' ? f.target_premise : null;
	const explanation = typeof f.explanation === 'string'
		? f.explanation
		: typeof v.rationale === 'string' ? v.rationale : null;
	if (!type || !targetPremise || !explanation) return null;
	return { type, targetPremise, explanation };
}

/**
 * Formatiert eine Fallacy-Annotation als kompakte Inline-Zeile zur Einfügung
 * unter eine Argument-Listen-Zeile im User-Message. Eingerückt, mit ⚠-Marker
 * für Salienz im LLM-Input.
 */
export function formatFallacyLine(f: FallacyAnnotation, indent = '    '): string {
	return `${indent}⚠ Tragfähigkeitsbruch (Charity-Pass): ${f.type} @ ${f.targetPremise} — ${f.explanation}`;
}

/**
 * Suffix-Block für den System-Prompt der Collapse-Pässe. Erklärt dem LLM, wie
 * mit den ⚠-Markierungen umzugehen ist. Wird nur eingehängt, wenn überhaupt
 * Fallacies in der aktuellen Synthese-Einheit vorkommen — sonst würde der
 * Hinweis Token verbrennen, ohne dass es etwas zu sagen gibt.
 */
export const FALLACY_AWARENESS_REGEL = `

[ZUM UMGANG MIT TRAGFÄHIGKEITSBRÜCHEN]
Im Argument-Listing können einzelne Argumente mit ⚠ markiert sein — diese stammen aus dem opt-in Charity-Pass (argument_validity), der pro Argument zuerst die Tragfähigkeit positiv zu rekonstruieren versucht; markiert wird nur, wenn das nicht gelingt.

Vorgehen:
- Markierte Brüche NICHT still überspringen oder filtern. Sie gehören als Teil der argumentativen Bewegung benannt — entweder im Synthese-Fließtext (wenn der Bruch die Bewegung des Subkapitels prägt) oder mindestens in den Auffälligkeiten.
- Gewichte angemessen nach Fallacy-Typ:
  · Gravierend (sollten in der Synthese-Bewegung selbst auftauchen): metabasis_eis_allo_genos (Ebenenverwechslung), equivocation (Bedeutungswechsel), false_dilemma (unzulässige Reduktion), naturalistic_fallacy (Sein → Sollen ohne Brücke), confusion_necessary_sufficient.
  · Mittel (gehören in Auffälligkeiten): affirming_the_consequent, denying_the_antecedent, hasty_generalization, ad_hominem, straw_man.
  · Genretypisch / nicht zu dramatisieren: petitio_principii in Resümee-/Schluss-/Einleitungs-Kapiteln (dort Wiederholung der eigenen These ist normal); in den Auffälligkeiten kurz erwähnen, nicht als gravierend rahmen.
- Beziehe die Markierung auf die argumentative Tragfähigkeit (Pflichtbestandteil d), nicht auf Stil oder Disziplin-Konvention.`;
