// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Tier-Overrides für Modell-Routing — siehe `src/lib/server/ai/model-tiers.ts`.
//
// GET   → describeTiers()-Liste + Provider-Inventar (für UI-Selects).
// POST  → setzt oder löscht ein Tier-Override:
//           Body { tier, provider, model } setzt
//           Body { tier, clear: true }     löscht
//         Andere Settings (provider/model/delegationAgent/language) bleiben
//         unangetastet — dies ist explizit nur die Tier-Mutation.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	type Provider,
	PROVIDERS,
	loadSettings,
	saveSettings
} from '$lib/server/ai/client.js';
import { describeTiers, TIER_REGISTRY, type Tier } from '$lib/server/ai/model-tiers.js';

const VALID_TIERS = new Set(Object.keys(TIER_REGISTRY));

export const GET: RequestHandler = async () => {
	const tiers = describeTiers();
	const providers = Object.entries(PROVIDERS).map(([id, def]) => ({
		id,
		label: def.label,
		defaultModel: def.defaultModel,
		region: def.region,
		dsgvo: def.dsgvo
	}));
	return json({ tiers, providers });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { tier, provider, model, clear } = body as {
		tier?: string;
		provider?: string;
		model?: string;
		clear?: boolean;
	};

	if (!tier || !VALID_TIERS.has(tier)) {
		return json({ error: `Unknown tier: ${tier}` }, { status: 400 });
	}

	const current = loadSettings();
	const tiers = { ...(current.tiers ?? {}) };

	if (clear) {
		delete tiers[tier];
	} else {
		if (!provider || !(provider in PROVIDERS)) {
			return json({ error: `Unknown provider: ${provider}` }, { status: 400 });
		}
		if (!model || typeof model !== 'string' || model.trim().length === 0) {
			return json({ error: 'Model required' }, { status: 400 });
		}
		tiers[tier] = { provider: provider as Provider, model: model.trim() };
	}

	saveSettings({ ...current, tiers: Object.keys(tiers).length > 0 ? tiers : undefined });

	return json({ ok: true, tier: tier as Tier, cleared: !!clear });
};
