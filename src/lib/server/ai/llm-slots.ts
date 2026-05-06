// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// LLM-Slots — Tool-LLM-Routing für orthogonale Werkzeuge (nicht
// Pipeline-Phasen). Parallel zu `model-tiers.ts`, andere Konzeption:
//
//   - Tiers (model-tiers.ts) binden eine Pipeline-Phase (H1.tier1 = AG-Pass,
//     H2.tier1 = synthetisches Per-¶-Memo, …) an Provider+Model. Token-
//     Budget ist per-Call entschieden (lange Synthese vs. kurze Extraktion).
//
//   - Slots (diese Datei) binden ein TOOL (z.B. `simulated_expert` für
//     Sachfragen-Recherche in der selbstkorrigierenden H4-Heuristik) an
//     Provider+Model UND fixe Token-Budgets. Das Tool definiert sich über
//     das Budget mit: ein konzentrierter Sachfrage-Slot mit 250in/1000out
//     ist absichtlich knapp; die Knappheit ist Teil des Werkzeug-Vertrags.
//
// Konzeptioneller Hintergrund: docs/architecture/06-pipeline-h4.md.
//
// Persistenz wie bei tiers: User-Wahl in `ai-settings.json` `slots`, fehlt
// ein Eintrag → Registry-Empfehlung. `resolveSlot(slot)` ist der Zugriff
// für Caller (Phase B+C+D).

import type { Provider } from './client.js';
import { loadSettings } from './client.js';

export type LlmSlot =
	| 'simulated_expert'  // Sachfragen-Modell für Mini-Stufe-3 + Große Stufe 3
	| 'fact_check';        // Fact-Check-Slot (TBD, später ggf. weiter differenziert)

export interface SlotModel {
	provider: Provider;
	model: string;
	maxInputTokens: number;
	maxOutputTokens: number;
}

export interface SlotMeta {
	description: string;
	recommended: SlotModel;
	/** Welche Routes sind für DIESEN Slot getestet/empfohlen? */
	candidates: SlotCandidate[];
}

export interface SlotCandidate {
	provider: Provider;
	model: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	/** Was sagt die Erfahrung speziell zu dieser Route IN DIESEM Slot? */
	note: string;
}

const OPUS_OR: SlotModel = {
	provider: 'openrouter',
	model: 'anthropic/claude-opus-4.7',
	maxInputTokens: 250,
	maxOutputTokens: 1000,
};

const MISTRAL_LARGE: SlotModel = {
	provider: 'mistral',
	model: 'mistral-large-latest',
	maxInputTokens: 250,
	maxOutputTokens: 1000,
};

const SONNET_OR: SlotModel = {
	provider: 'openrouter',
	model: 'anthropic/claude-sonnet-4.6',
	maxInputTokens: 250,
	maxOutputTokens: 1000,
};

const SONNET_MAMMOUTH: SlotModel = {
	provider: 'mammouth',
	model: 'claude-sonnet-4-6',
	maxInputTokens: 250,
	maxOutputTokens: 1000,
};

export const SLOT_REGISTRY: Record<LlmSlot, SlotMeta> = {
	simulated_expert: {
		description:
			'Sachfragen-Modell für Mini-Stufe-3 in der selbstkorrigierenden H4-Heuristik ' +
			'und für die Große Stufe 3 auf Kapitelebene. H2 formuliert konzentrierte ' +
			'Sachfragen frei (z.B. "Wurde Klafkis Allgemeinbildungs-Konzept 1985 in ' +
			'welchem Werk formuliert?"); die Antwort fließt als Faktum-Untermauerung ' +
			'in den Einwand an H1 ein. Knappes Token-Budget ist Teil des Vertrags — ' +
			'das Werkzeug ist auf konzentrierte, prosa-knappe Antworten ausgelegt. ' +
			'Name bewusst „simuliert": das ist eine LLM-Antwort, keine echte ' +
			'Fachexpertise — halluzinationsanfällig, mit den Vor-/Nachteilen des ' +
			'konfigurierten Modells.',
		recommended: OPUS_OR,
		candidates: [
			{
				...OPUS_OR,
				note:
					'Default-Empfehlung 2026-05-06: für deutsche Bildungsphilosophie-' +
					'Sachfragen (Klafki, Humboldt, Litt, Bollnow, Mollenhauer, Benner) ' +
					'wahrscheinlich höhere Trainings-Korpus-Exposition als MiMo (chinesisch-' +
					'STEM-Schwerpunkt) oder Mistral (französisch-europäisch, weniger ' +
					'deutschsprachig-akademisch). Plausibilitäts-Default, nicht gemessen.',
			},
			{
				...SONNET_MAMMOUTH,
				note:
					'EU-vermittelte Anthropic-Klasse über Mammouth, falls EU-Pflicht. ' +
					'Für reine Sachfragen vermutlich gleichauf mit Sonnet OR und nahe ' +
					'an Opus, Kosten ~5× geringer.',
			},
			{
				...SONNET_OR,
				note:
					'Anthropic-Klasse via OpenRouter. Für Sachfragen vermutlich ' +
					'gleichauf mit Mammouth-Variante.',
			},
			{
				...MISTRAL_LARGE,
				note:
					'Französisch-europäische Trainings-Basis, vermutlich weniger ' +
					'deutschsprachig-akademische Exposition als Anthropic-Klasse, ' +
					'aber EU-nativ und günstigste Option. Für EU-Pflicht-Cases.',
			},
		],
	},
	fact_check: {
		description:
			'Fact-Check-Slot — Quellen-Verifikation und Zitations-Prüfung. ' +
			'Stand 2026-05-06: nicht differenziert, später ggf. aufgespalten in ' +
			'`fact_check_quotes` (wörtliche Zitate) vs. `fact_check_factuals` ' +
			'(sachliche Aussagen). Default vorerst gleicher Slot wie simulated_expert.',
		recommended: OPUS_OR,
		candidates: [
			{
				...OPUS_OR,
				note:
					'Default vor Slot-Differenzierung — gleiches Modell wie simulated_expert. ' +
					'Sobald die Aufgaben unterschiedliche Modell-Klassen erfordern, eigene Slots.',
			},
		],
	},
};

/**
 * Liefert das Modell+Budget für einen Slot — User-Wahl aus ai-settings.json
 * `slots`, sonst die Registry-Empfehlung. Caller in Phase B+C+D rufen das
 * an jedem Mini-Stufe-3- oder Großen-Stufe-3-Dispatch-Punkt auf.
 */
export function resolveSlot(slot: LlmSlot): SlotModel {
	const settings = loadSettings();
	const choice = settings.slots?.[slot];
	if (
		choice &&
		choice.provider &&
		choice.model &&
		typeof choice.maxInputTokens === 'number' &&
		typeof choice.maxOutputTokens === 'number'
	) {
		return {
			provider: choice.provider,
			model: choice.model,
			maxInputTokens: choice.maxInputTokens,
			maxOutputTokens: choice.maxOutputTokens,
		};
	}
	return SLOT_REGISTRY[slot].recommended;
}

export interface DescribedSlotCandidate {
	provider: Provider;
	model: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	note: string;
	isRecommended: boolean;
}

export interface DescribedSlot {
	slot: LlmSlot;
	description: string;
	resolved: SlotModel;
	recommended: SlotModel;
	isRecommended: boolean;
	candidates: DescribedSlotCandidate[];
}

/**
 * Slot-Beschreibung mit Candidates für die Settings-UI. Spiegelt
 * `describeTiers()` aus `model-tiers.ts`.
 */
export function describeSlots(): DescribedSlot[] {
	const settings = loadSettings();
	return (Object.keys(SLOT_REGISTRY) as LlmSlot[]).map((slot) => {
		const meta = SLOT_REGISTRY[slot];
		const choice = settings.slots?.[slot];
		const hasUserChoice = !!(
			choice &&
			choice.provider &&
			choice.model &&
			typeof choice.maxInputTokens === 'number' &&
			typeof choice.maxOutputTokens === 'number'
		);
		const resolved: SlotModel = hasUserChoice
			? {
					provider: choice.provider,
					model: choice.model,
					maxInputTokens: choice.maxInputTokens,
					maxOutputTokens: choice.maxOutputTokens,
				}
			: meta.recommended;
		const isRecommended =
			resolved.provider === meta.recommended.provider &&
			resolved.model === meta.recommended.model &&
			resolved.maxInputTokens === meta.recommended.maxInputTokens &&
			resolved.maxOutputTokens === meta.recommended.maxOutputTokens;

		const candidates: DescribedSlotCandidate[] = meta.candidates.map((c) => ({
			provider: c.provider,
			model: c.model,
			maxInputTokens: c.maxInputTokens,
			maxOutputTokens: c.maxOutputTokens,
			note: c.note,
			isRecommended:
				c.provider === meta.recommended.provider && c.model === meta.recommended.model,
		}));

		return {
			slot,
			description: meta.description,
			resolved,
			recommended: meta.recommended,
			isRecommended,
			candidates,
		};
	});
}
