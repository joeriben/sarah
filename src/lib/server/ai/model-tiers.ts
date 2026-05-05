// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Model-Tiers — einheitliches, transparentes Modell-Routing über H1/H2/H3.
//
// Hintergrund (Memory `project_two_track_model_strategy`,
// `project_mistral_sonnet_stack_validated`, `project_mimo_evaluation`):
// Wir haben für mehrere Funktionsbereiche der Pipeline ALTERNATIVE Modelle
// validiert (Mistral-Large + Sonnet-via-Mammouth, mimo-v2.5-pro), die jeweils
// auf Goldstand-Niveau kommen oder dort hinkommen. Die Ergebnisse waren
// bislang strukturell nicht greifbar:
//
//   - der orchestrator schickte H1 ohne modelOverride durch chat() → globaler
//     Default; Validität-Befunde für Mistral oder mimo ohne Wirkung.
//   - H3-Module hardcodierten DEFAULT_*_MODEL = Sonnet pro Modul; eine
//     Änderung verlangte Edits in 9 Dateien.
//   - es gab keine Stelle, an der man "was läuft auf welchem Modell" lesen
//     konnte; die Heterogenität war unauffindbar.
//
// Dieses Modul macht das System transparent und konsistent:
//
//   1. Jede Heuristik (H1/H2/H3) hat numerierte Tiers (h1.tier1, h1.tier2, …),
//      die entlang der Aufgaben-Komplexität geclustert sind:
//        - tier1: basal/extraktiv (AG, validity, FRAGESTELLUNG, BEFUND, …)
//        - tier2: synthetisch (section/chapter/document collapse, SYNTHESE, …)
//        - tier3: werk-Meta (WERK_BESCHREIBUNG, WERK_GUTACHT)
//   2. TIER_REGISTRY trägt pro Tier eine Beschreibung, einen Default (das
//      heute aktuell beste validierte Modell für diesen Tier) und einen
//      Evaluation-Status (was wurde getestet?).
//   3. resolveTier(tier) konsultiert ai-settings.json `tiers` — der User kann
//      pro Tier einen abweichenden Provider+Model setzen, ohne Code-Änderung.
//   4. Jede Dispatch-Stelle im Orchestrator und im H3-Walk-Driver übergibt
//      `modelOverride: resolveTier(tier)`. Damit ist die Routing-Entscheidung
//      vollständig hier konzentriert.
//
// Ein neues Modell zu evaluieren heißt jetzt: Tier-Override in ai-settings.json
// setzen, Run triggern, Resultat ablesen. Bestätigt sich der Vorteil:
// TIER_REGISTRY[…].default umsetzen + evaluation-Status erweitern.

import type { Provider } from './client.js';
import { loadSettings } from './client.js';

export type Tier =
	| 'h1.tier1'   // H1 basal: AG + validity (per Absatz, hochpräzise, viele Calls)
	| 'h1.tier2'   // H1 collapse: section/chapter/document/chapter-flow (synthetisch, wenige Calls)
	| 'h2.tier1'   // H2 synth-memo: per Absatz (interpretierend, mittelpräzise)
	| 'h3.tier1'   // H3 extract: EXPOSITION, FORSCHUNGSDESIGN, FORSCHUNGSGEGENSTAND, GRUNDLAGENTHEORIE-Sub, DURCHFUEHRUNG-BEFUND
	| 'h3.tier2'   // H3 synth: SYNTHESE, EXKURS-Kernergebnis, SCHLUSSREFLEXION
	| 'h3.tier3';  // H3 werk-meta: WERK_BESCHREIBUNG, WERK_GUTACHT

export interface TierModel {
	provider: Provider;
	model: string;
}

export interface TierMeta {
	/** Was läuft auf diesem Tier? Welche LLM-Aufgaben? */
	description: string;
	/** Welches Modell läuft als Default? (Bestes validiertes Modell für diesen Tier zum heutigen Zeitpunkt.) */
	default: TierModel;
	/** Was ist evaluiert, was sind offene Lücken? Knapper Lebenslauf der Tier-Entscheidung. */
	evaluation: string;
}

// Defaults reflektieren den heutigen tatsächlichen Status (vor diesem
// Refactor): H1/H2 = mimo (war globaler ai-settings.json-Wert),
// H3 = sonnet (war in jedem H3-Modul als DEFAULT_*_MODEL hardcoded).
// Damit bewahrt der Refactor Verhalten — tier-overrides in settings sind
// die Knöpfe, mit denen alternative validierte Stacks (Mistral, Sonnet via
// Mammouth) ausprobiert oder wieder aktiviert werden.
export const TIER_REGISTRY: Record<Tier, TierMeta> = {
	'h1.tier1': {
		description:
			'H1 basal — Argumentationsgraph + Validity-Check pro Absatz. ' +
			'Pflichten: §:A-Anker erhalten, dichte argumentative Struktur extrahieren, ' +
			'Fallacy-Whitelist anwenden. Hohe Calls-pro-Werk, deutsche Akademiesprache.',
		default: { provider: 'openrouter', model: 'xiaomi/mimo-v2.5-pro' },
		evaluation:
			'mimo-v2.5-pro: validiert (Memory `project_mimo_evaluation`) — H1-tragfähig ' +
			'für synth/AG/validity bei 2×–23× Kostenersparnis ggü. Sonnet-direct. ' +
			'Mistral-Large-2512 (nativ EU): validiert auf BA-Chapter 4 (Memory ' +
			'`project_mistral_sonnet_stack_validated`) — Goldstand-Niveau, EU-DSGVO-safe. ' +
			'Sonnet-direct/-via-OpenRouter: Goldstand-Referenz. ' +
			'Lücke: H3-Begleitlauf (durchfuehrung Step 2 ruft AG intern) noch nicht ' +
			'gegen Mistral/mimo gemessen.',
	},
	'h1.tier2': {
		description:
			'H1 Synthese-Stufen — section_collapse / chapter_collapse / document_collapse / ' +
			'chapter-flow-summary. Aggregiert Argumentations-Graphen entlang der Outline. ' +
			'Wenige Calls pro Werk, lange Kontexte, prosa-shaped Output.',
		default: { provider: 'openrouter', model: 'xiaomi/mimo-v2.5-pro' },
		evaluation:
			'mimo-v2.5-pro: validiert für section/chapter/document collapse ' +
			'(Memory `project_mimo_evaluation`). ' +
			'Sonnet via Mammouth: validiert auf BA-Chapter 4, EU-vermittelt ' +
			'(Memory `project_mistral_sonnet_stack_validated`). ' +
			'Sonnet-direct: Goldstand-Referenz.',
	},
	'h2.tier1': {
		description:
			'H2 synthetisches Per-Absatz-Memo. Interpretierende Zusammenfassung mit ' +
			'auffaelligkeiten[]/codes[]-Listen pro Absatz. Mittlere Komplexität, ' +
			'prosa-shaped Output (Section-Headered-Prose).',
		default: { provider: 'openrouter', model: 'xiaomi/mimo-v2.5-pro' },
		evaluation:
			'mimo-v2.5-pro: validiert für synthetisches Memo ' +
			'(Memory `project_mimo_evaluation`). ' +
			'Sonnet-direct: Goldstand-Referenz. ' +
			'Lücke: keine systematische Vergleichsmessung Mistral vs. mimo für H2-Memo.',
	},
	'h3.tier1': {
		description:
			'H3 extraktive Stufen — pro Komplex/Werk: EXPOSITION (FRAGESTELLUNG/MOTIVATION), ' +
			'FORSCHUNGSDESIGN (METHODIK/AUFBAUSKIZZE), FORSCHUNGSGEGENSTAND, ' +
			'GRUNDLAGENTHEORIE-Sub-Tools (Routing/Reproductive/Discursive), ' +
			'DURCHFUEHRUNG-BEFUND-Extraktion. Eng instruierte JSON/Prose-Outputs.',
		default: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' },
		evaluation:
			'Sonnet via OpenRouter: Status-quo (vor Refactor in jedem H3-Modul als ' +
			'DEFAULT_*_MODEL hardcoded). ' +
			'Lücke: H3 noch nicht gegen Mistral oder mimo systematisch evaluiert ' +
			'(Memory `project_mimo_evaluation`: H3 explizit als nicht abgedeckt markiert; ' +
			'`project_two_track_model_strategy`: H3 noch nicht budget-validiert).',
	},
	'h3.tier2': {
		description:
			'H3 synthetische Stufen — SYNTHESE (GESAMTERGEBNIS), EXKURS (KERNERGEBNIS), ' +
			'SCHLUSSREFLEXION (Geltungsanspruch). Werk-aggregierte Synthese-Outputs ' +
			'mit Erkenntnis-Integration entlang Befund-Liste.',
		default: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' },
		evaluation:
			'Sonnet via OpenRouter: Status-quo. ' +
			'Lücke: keine Vergleichsmessung. Synthese-Stufen sind plausibel anspruchsvoller ' +
			'als Extrakt-Stufen (mehr Kontext-Integration), eine Höher-Tier-Wahl ' +
			'(Opus / Sonnet) ist für die Default-Belegung verteidigbar.',
	},
	'h3.tier3': {
		description:
			'H3 Werk-Meta-Reflexionen — WERK_BESCHREIBUNG (Strukturzusammenfassung), ' +
			'WERK_GUTACHT (Kollegial-Review-Skizze). Reflektieren die anderen H3-Konstrukte ' +
			'auf Werk-Ebene; mehrstufige Komposition mit Outline+Konstrukt-Liste+Memos.',
		default: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' },
		evaluation:
			'Sonnet via OpenRouter: Status-quo. ' +
			'Lücke: keine Vergleichsmessung. Werk-Meta verlangt Integration über die ' +
			'gesamte Konstruktbasis, ist plausibel der anspruchsvollste Schritt — ' +
			'eine Opus-Default-Belegung wäre für kritische Reviews verteidigbar.',
	},
};

/**
 * Resolves the model for a given tier, consulting user-overrides in
 * ai-settings.json `tiers` first, falling back to TIER_REGISTRY default.
 *
 * Use at every dispatch site (orchestrator, h3-walk-driver) instead of letting
 * chat() fall back to the global provider/model. This makes the routing
 * decision audit-able in one place (TIER_REGISTRY) and tweakable via settings.
 */
export function resolveTier(tier: Tier): TierModel {
	const settings = loadSettings();
	const override = settings.tiers?.[tier];
	if (override && override.provider && override.model) {
		return { provider: override.provider, model: override.model };
	}
	return TIER_REGISTRY[tier].default;
}

/**
 * Lists all tiers with their effective resolved model (default or override).
 * Useful for settings-page rendering and CLI introspection — answers the
 * question "what would run on what" without touching the pipeline.
 */
export function describeTiers(): Array<{
	tier: Tier;
	description: string;
	resolved: TierModel;
	overridden: boolean;
	default: TierModel;
	evaluation: string;
}> {
	const settings = loadSettings();
	return (Object.keys(TIER_REGISTRY) as Tier[]).map((tier) => {
		const meta = TIER_REGISTRY[tier];
		const override = settings.tiers?.[tier];
		const overridden = !!(override && override.provider && override.model);
		return {
			tier,
			description: meta.description,
			resolved: overridden
				? { provider: override.provider, model: override.model }
				: meta.default,
			overridden,
			default: meta.default,
			evaluation: meta.evaluation,
		};
	});
}
