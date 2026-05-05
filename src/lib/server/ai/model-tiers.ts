// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Model-Tiers — Modell-Routing pro Heuristik-Stufe (H1/H2/H3) auf Basis der
// differenzierten Test-Ergebnisse aus den Memory-Einträgen
// `project_mimo_evaluation` und `project_mistral_sonnet_stack_validated`.
//
// Pro Tier:
//   - `recommended`: das Modell, das laut Tests für diesen Tier am besten
//     fährt (Substanz × Kosten × Coverage).
//   - `candidates`: nur Routen, deren Eignung für DIESEN Tier belegt oder
//     glaubhaft ist; jede mit einer tier-spezifischen Notiz, was der Test
//     genau gezeigt hat. Routen ohne Befund kommen nicht in den Pool.
//
// Eine Route kann in einem Tier empfohlen sein und in einem anderen fehlen
// (Mistral ist h1.tier1-Empfehlung, kommt in h1.tier2 nicht vor weil collapse
// nie getestet wurde). KNOWN_ROUTES hält die tier-unabhängigen Stammdaten
// (Label, Preis, Region, DSGVO).

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

/**
 * Tier-unabhängige Stammdaten einer Route. Preis in USD pro Million Tokens
 * (input / output). `null` = nicht verifiziert.
 */
export interface RouteOption {
	provider: Provider;
	model: string;
	label: string;
	inputUSDPerMTok: number | null;
	outputUSDPerMTok: number | null;
	region: string;
	dsgvo: boolean;
}

export const KNOWN_ROUTES: RouteOption[] = [
	{
		provider: 'mistral',
		model: 'mistral-large-latest',
		label: 'mistral-large (Mistral nativ EU)',
		inputUSDPerMTok: 0.5,
		outputUSDPerMTok: 1.5,
		region: 'EU',
		dsgvo: true,
	},
	{
		provider: 'openrouter',
		model: 'xiaomi/mimo-v2.5-pro',
		label: 'mimo-v2.5-pro (OpenRouter)',
		inputUSDPerMTok: 1.0,
		outputUSDPerMTok: 3.0,
		region: 'US',
		dsgvo: false,
	},
	{
		provider: 'openrouter',
		model: 'anthropic/claude-sonnet-4.6',
		label: 'claude-sonnet-4.6 (OpenRouter)',
		inputUSDPerMTok: 3.0,
		outputUSDPerMTok: 15.0,
		region: 'US',
		dsgvo: false,
	},
	{
		provider: 'mammouth',
		model: 'claude-sonnet-4-6',
		label: 'claude-sonnet-4-6 (Mammouth, EU-vermittelt)',
		inputUSDPerMTok: 3.0,
		outputUSDPerMTok: 15.0,
		region: 'EU',
		dsgvo: true,
	},
	{
		provider: 'openrouter',
		model: 'anthropic/claude-opus-4.7',
		label: 'claude-opus-4.7 (OpenRouter)',
		inputUSDPerMTok: 5.0,
		outputUSDPerMTok: 25.0,
		region: 'US',
		dsgvo: false,
	},
	{
		provider: 'mammouth',
		model: 'kimi-k2.5',
		label: 'kimi-k2.5 (Mammouth, EU-vermittelt)',
		inputUSDPerMTok: 0.45,
		outputUSDPerMTok: 2.25,
		region: 'EU',
		dsgvo: true,
	},
	{
		provider: 'openrouter',
		model: 'moonshotai/kimi-k2.5',
		label: 'kimi-k2.5 (OpenRouter)',
		inputUSDPerMTok: 0.45,
		outputUSDPerMTok: 2.25,
		region: 'US',
		dsgvo: false,
	},
];

export interface TierCandidate {
	provider: Provider;
	model: string;
	/** Was sagen die Tests speziell zu dieser Route IN DIESEM Tier? */
	note: string;
}

export interface TierMeta {
	description: string;
	recommended: TierModel;
	candidates: TierCandidate[];
}

const MISTRAL: TierModel = { provider: 'mistral', model: 'mistral-large-latest' };
const MIMO: TierModel = { provider: 'openrouter', model: 'xiaomi/mimo-v2.5-pro' };
const SONNET_OR: TierModel = { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' };
const SONNET_MAMMOUTH: TierModel = { provider: 'mammouth', model: 'claude-sonnet-4-6' };
const OPUS_OR: TierModel = { provider: 'openrouter', model: 'anthropic/claude-opus-4.7' };
const KIMI_MAMMOUTH: TierModel = { provider: 'mammouth', model: 'kimi-k2.5' };
const KIMI_OR: TierModel = { provider: 'openrouter', model: 'moonshotai/kimi-k2.5' };

export const TIER_REGISTRY: Record<Tier, TierMeta> = {
	'h1.tier1': {
		description:
			'H1 basal — Argumentationsgraph + Validity-Check pro Absatz. ' +
			'Pflichten: §:A-Anker erhalten, dichte argumentative Struktur extrahieren, ' +
			'Fallacy-Whitelist anwenden. Hohe Calls-pro-Werk, deutsche Akademiesprache.',
		recommended: MISTRAL,
		candidates: [
			{
				...MISTRAL,
				note: 'End-to-end validiert auf BA-Chapter 4 (50 ¶, basal+AG); keine Substanz-Schwäche im end-to-end-Stack. Günstigste Route + EU-DSGVO. Implicit Caching ab Call 3-4.',
			},
			{
				...MIMO,
				note: 'Validiert auf §1-§5 von 1.1.1 (5 ¶ Spot-Test). AG tragfähig, validity 17/18 konvergent mit Sonnet/Opus. Doppelt so teuer wie Mistral ohne gemessenen Substanz-Vorteil. Reasoning-Klasse: maxTokens für dichte Absätze ggf. verdoppeln.',
			},
			{
				...SONNET_OR,
				note: 'Goldstand-Referenz für AG/validity. ~6× teurer als Mistral, kein gemessener Vorteil über mimo oder Mistral. Für Vergleichsläufe.',
			},
			{
				...SONNET_MAMMOUTH,
				note: 'Wie Sonnet OR (Goldstand-Referenz, ~6× teurer als Mistral), EU-vermittelt über Mammouth.',
			},
			{
				...OPUS_OR,
				note: 'Höchstens gleichauf mit mimo/Sonnet, ~10× teurer als Mistral. Strengere Validity-Diagnose nur in Einzelfällen (§5/A4 petitio_principii bei opus, mimo+Sonnet Charity-tragfähig).',
			},
		],
	},
	'h1.tier2': {
		description:
			'H1 Synthese-Stufen — section_collapse / chapter_collapse / document_collapse / ' +
			'chapter-flow-summary. Aggregiert Argumentations-Graphen entlang der Outline. ' +
			'Wenige Calls pro Werk, lange Kontexte, prosa-shaped Output.',
		recommended: MIMO,
		candidates: [
			{
				...MIMO,
				note: 'Klarster Kandidat: Section-Collapse substanziell stärker als Sonnet/Opus (paragraphen-präziser, eigene edges-bezogene Lese-Schicht), Chapter-Collapse opus-grade (findet eine Auffälligkeit mehr als Opus). 3× günstiger als Sonnet, 18× günstiger als Opus.',
			},
			{
				...SONNET_OR,
				note: 'End-to-end validiert für section/chapter (BA-Chapter 4), Goldstand-Niveau. 3× teurer als mimo ohne gemessenen Vorteil.',
			},
			{
				...SONNET_MAMMOUTH,
				note: 'Wie Sonnet OR (end-to-end validiert), EU-vermittelt — die in Memory `project_mistral_sonnet_stack_validated` getestete Route.',
			},
			{
				...OPUS_OR,
				note: 'Auf section/chapter-Collapse hinter mimo (mimo findet eine Auffälligkeit mehr); Default-Belegung als Premium-Referenz, ~8× teurer als mimo.',
			},
			// Mistral fehlt bewusst: collapse wurde im Mistral+Sonnet-Stack vom
			// Sonnet-Teil übernommen, Mistral-collapse ist ungetestet.
		],
	},
	'h2.tier1': {
		description:
			'H2 synthetisches Per-Absatz-Memo. Interpretierende Zusammenfassung mit ' +
			'auffaelligkeiten[]/codes[]-Listen pro Absatz. Mittlere Komplexität, ' +
			'prosa-shaped Output (Section-Headered-Prose).',
		recommended: MIMO,
		candidates: [
			{
				...MIMO,
				note: 'Validiert: ≈ Sonnet in Inhalt + Code-Labels, kein Schärfungs-Plus (5-¶ Spot-Test). 3× günstiger als Sonnet.',
			},
			{
				...MISTRAL,
				note: 'Nicht systematisch für H2-Memo gemessen, Memory-Vermerk: „bleibt konkurrenzfähig" (mimo-evaluation-Notiz). Günstigste Option, EU-DSGVO — wenn EU-Pflicht.',
			},
			{
				...KIMI_MAMMOUTH,
				note: 'Noch nicht für H2-Memo gemessen — Vergleichskandidat 2026-05-05. Preis-Profil ähnlich Mistral (~0.45/2.25 USD/Mtok), aber via Mammouth EU-vermittelt. Cache-Pass-Through über Mammouth wird empirisch geprüft.',
			},
			{
				...KIMI_OR,
				note: 'OpenRouter-Fallback, falls Mammouth-Variante ausfällt; preisidentisch (~0.45/2.25 USD/Mtok). Nicht DSGVO-konform.',
			},
			{
				...SONNET_OR,
				note: 'Goldstand-Referenz, 3× teurer als mimo ohne gemessenen Vorteil. Für Vergleichsläufe.',
			},
			{
				...SONNET_MAMMOUTH,
				note: 'Wie Sonnet OR, EU-vermittelt.',
			},
			// Opus fehlt bewusst: H2-Memo wurde nicht systematisch gegen Opus gemessen.
		],
	},
	'h3.tier1': {
		description:
			'H3 extraktive Stufen — pro Komplex/Werk: EXPOSITION (FRAGESTELLUNG/MOTIVATION), ' +
			'FORSCHUNGSDESIGN (METHODIK/AUFBAUSKIZZE), FORSCHUNGSGEGENSTAND, ' +
			'GRUNDLAGENTHEORIE-Sub-Tools (Routing/Reproductive/Discursive), ' +
			'DURCHFUEHRUNG-BEFUND-Extraktion. Eng instruierte JSON/Prose-Outputs.',
		recommended: MIMO,
		candidates: [
			{
				...MIMO,
				note: 'Nur EXPOSITION direkt getestet („Test diskriminiert nicht; mimo ≈ Sonnet"). Restliche Module dieses Tiers (FORSCHUNGSDESIGN, FORSCHUNGSGEGENSTAND, GRUNDLAGENTHEORIE, DURCHFUEHRUNG) sind nicht systematisch validiert; per User-Lesart 2026-05-05 angenommen, dass die H1/H2-Befunde übertragen.',
			},
			{
				...SONNET_OR,
				note: 'Bisheriger Hardcode-Default vor Tier-Refactor. EXPOSITION ≈ mimo; sonst keine systematische Vergleichsmessung. 3× teurer als mimo.',
			},
			{
				...SONNET_MAMMOUTH,
				note: 'Wie Sonnet OR, EU-vermittelt.',
			},
			// Opus, Mistral fehlen: nie an H3 getestet.
		],
	},
	'h3.tier2': {
		description:
			'H3 synthetische Stufen — SYNTHESE (GESAMTERGEBNIS), EXKURS (KERNERGEBNIS), ' +
			'SCHLUSSREFLEXION (Geltungsanspruch). Werk-aggregierte Synthese-Outputs ' +
			'mit Erkenntnis-Integration entlang Befund-Liste.',
		recommended: MIMO,
		candidates: [
			{
				...MIMO,
				note: 'Keine direkten Tests für H3-Synthese-Stufen. Empfehlung beruht auf User-Lesart 2026-05-05 („Sonnet in keinem getesteten Bereich überlegen") und Übertrag aus h1.tier2-Collapse-Stärke.',
			},
			{
				...SONNET_OR,
				note: 'Bisheriger Hardcode-Default vor Tier-Refactor. Keine Vergleichsmessung. 3× teurer als mimo.',
			},
			{
				...SONNET_MAMMOUTH,
				note: 'Wie Sonnet OR, EU-vermittelt.',
			},
		],
	},
	'h3.tier3': {
		description:
			'H3 Werk-Meta-Reflexionen — WERK_BESCHREIBUNG (Strukturzusammenfassung), ' +
			'WERK_GUTACHT (Kollegial-Review-Skizze). Reflektieren die anderen H3-Konstrukte ' +
			'auf Werk-Ebene; mehrstufige Komposition mit Outline+Konstrukt-Liste+Memos.',
		recommended: MIMO,
		candidates: [
			{
				...MIMO,
				note: 'Keine direkten Tests. Empfehlung beruht auf User-Lesart 2026-05-05; Werk-Meta integriert über die gesamte Konstruktbasis und ist plausibel der anspruchsvollste Schritt — für kritische Reviews ist Opus eine verteidigbare Höher-Tier-Wahl, aber ohne Messung.',
			},
			{
				...SONNET_OR,
				note: 'Bisheriger Hardcode-Default vor Tier-Refactor. Keine Vergleichsmessung. 3× teurer als mimo.',
			},
			{
				...SONNET_MAMMOUTH,
				note: 'Wie Sonnet OR, EU-vermittelt.',
			},
		],
	},
};

/**
 * Liefert das Modell für einen Tier — User-Wahl aus ai-settings.json `tiers`,
 * sonst die Empfehlung. Wird an jedem Dispatch-Punkt aufgerufen.
 */
export function resolveTier(tier: Tier): TierModel {
	const settings = loadSettings();
	const choice = settings.tiers?.[tier];
	if (choice && choice.provider && choice.model) {
		return { provider: choice.provider, model: choice.model };
	}
	return TIER_REGISTRY[tier].recommended;
}

export interface DescribedCandidate {
	provider: Provider;
	model: string;
	note: string;
	label: string;
	inputUSDPerMTok: number | null;
	outputUSDPerMTok: number | null;
	region: string;
	dsgvo: boolean;
	isRecommended: boolean;
}

export interface DescribedTier {
	tier: Tier;
	description: string;
	resolved: TierModel;
	recommended: TierModel;
	isRecommended: boolean;
	candidates: DescribedCandidate[];
}

/**
 * Tier-Beschreibung mit Candidates (gefiltert + tier-spezifisch annotiert),
 * Stammdaten aus KNOWN_ROUTES gejoined. Routen, die in KNOWN_ROUTES fehlen,
 * werden übersprungen (defensive: deutet auf Inkonsistenz hin, sollte bei
 * Tests crashen, hier silent).
 */
export function describeTiers(): DescribedTier[] {
	const settings = loadSettings();
	return (Object.keys(TIER_REGISTRY) as Tier[]).map((tier) => {
		const meta = TIER_REGISTRY[tier];
		const choice = settings.tiers?.[tier];
		const hasUserChoice = !!(choice && choice.provider && choice.model);
		const resolved: TierModel = hasUserChoice
			? { provider: choice.provider, model: choice.model }
			: meta.recommended;
		const isRecommended =
			resolved.provider === meta.recommended.provider &&
			resolved.model === meta.recommended.model;

		const candidates: DescribedCandidate[] = [];
		for (const c of meta.candidates) {
			const route = KNOWN_ROUTES.find(
				(r) => r.provider === c.provider && r.model === c.model
			);
			if (!route) continue;
			candidates.push({
				provider: c.provider,
				model: c.model,
				note: c.note,
				label: route.label,
				inputUSDPerMTok: route.inputUSDPerMTok,
				outputUSDPerMTok: route.outputUSDPerMTok,
				region: route.region,
				dsgvo: route.dsgvo,
				isRecommended:
					c.provider === meta.recommended.provider && c.model === meta.recommended.model,
			});
		}

		// Falls die User-Wahl außerhalb der candidates-Liste liegt (alte Setzung,
		// die eine inzwischen aussortierte Route trifft): trotzdem einreihen,
		// damit der Picker konsistent ist und die Wahl sichtbar/wechselbar bleibt.
		const resolvedInList = candidates.some(
			(c) => c.provider === resolved.provider && c.model === resolved.model
		);
		if (!resolvedInList) {
			const route = KNOWN_ROUTES.find(
				(r) => r.provider === resolved.provider && r.model === resolved.model
			);
			if (route) {
				candidates.push({
					provider: resolved.provider,
					model: resolved.model,
					note: 'Aktuelle Wahl liegt außerhalb der für diesen Tier validierten Routen.',
					label: route.label,
					inputUSDPerMTok: route.inputUSDPerMTok,
					outputUSDPerMTok: route.outputUSDPerMTok,
					region: route.region,
					dsgvo: route.dsgvo,
					isRecommended: false,
				});
			}
		}

		return {
			tier,
			description: meta.description,
			resolved,
			recommended: meta.recommended,
			isRecommended,
			candidates,
		};
	});
}
