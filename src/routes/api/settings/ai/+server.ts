// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	type Provider,
	PROVIDERS,
	SUPPORTED_LANGUAGES,
	loadSettings,
	saveSettings,
	readApiKey,
	writeApiKey,
	maskKey,
	testConnection
} from '$lib/server/ai/client.js';

// GET: current AI settings + provider list with key status
export const GET: RequestHandler = async () => {
	const settings = loadSettings();
	const providers = Object.entries(PROVIDERS).map(([id, def]) => {
		const key = readApiKey(id as Provider);
		return {
			id,
			label: def.label,
			defaultModel: def.defaultModel,
			needsKey: !!def.keyFile,
			keyConfigured: !!key,
			keyMasked: maskKey(key),
			dsgvo: def.dsgvo,
			region: def.region
		};
	});

	return json({
		provider: settings.provider,
		model: settings.model || PROVIDERS[settings.provider].defaultModel,
		delegationAgent: settings.delegationAgent || null,
		language: settings.language || 'auto',
		languages: SUPPORTED_LANGUAGES,
		providers
	});
};

// POST: update settings (provider, model, apiKey, delegationAgent)
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { provider, model, apiKey, delegationAgent, language } = body;

	if (provider && !(provider in PROVIDERS)) {
		return json({ error: `Unknown provider: ${provider}` }, { status: 400 });
	}

	// Validate delegation agent if provided
	if (delegationAgent && delegationAgent.provider && !(delegationAgent.provider in PROVIDERS)) {
		return json({ error: `Unknown delegation provider: ${delegationAgent.provider}` }, { status: 400 });
	}

	// Save API key if provided
	if (provider && apiKey !== undefined) {
		if (apiKey === '') {
			// Don't delete key file, just ignore empty string
		} else {
			writeApiKey(provider as Provider, apiKey);
		}
	}

	// Save settings (preserve tier-overrides — `tiers` is managed via
	// /api/settings/tiers and must not be lost when the global provider/model
	// changes here).
	const current = loadSettings();
	const newSettings = {
		provider: (provider as Provider) || current.provider,
		model: model !== undefined ? model : current.model,
		delegationAgent: delegationAgent !== undefined
			? (delegationAgent?.provider ? delegationAgent : undefined)
			: current.delegationAgent,
		language: language !== undefined
			? (language in SUPPORTED_LANGUAGES ? language : undefined)
			: current.language,
		tiers: current.tiers
	};
	saveSettings(newSettings);

	return json({ ok: true, ...newSettings });
};
