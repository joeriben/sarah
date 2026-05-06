// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Slot-Wahl pro Tool-LLM — siehe `src/lib/server/ai/llm-slots.ts`.
//
// GET   → describeSlots(): pro Slot seine kuratierte candidates-Liste
//         (Provider/Model + Token-Budgets), aktuelle Wahl und Empfehlung.
// POST  → setzt oder löscht die User-Wahl für einen Slot:
//           Body { slot, provider, model, maxInputTokens, maxOutputTokens } setzt
//           Body { slot, clear: true }                                       löscht
//         Andere Settings (provider/model/language/tiers) bleiben unangetastet.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	type Provider,
	PROVIDERS,
	loadSettings,
	saveSettings,
} from '$lib/server/ai/client.js';
import { describeSlots, SLOT_REGISTRY, type LlmSlot } from '$lib/server/ai/llm-slots.js';

const VALID_SLOTS = new Set(Object.keys(SLOT_REGISTRY));

export const GET: RequestHandler = async () => {
	return json({ slots: describeSlots() });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { slot, provider, model, maxInputTokens, maxOutputTokens, clear } = body as {
		slot?: string;
		provider?: string;
		model?: string;
		maxInputTokens?: number;
		maxOutputTokens?: number;
		clear?: boolean;
	};

	if (!slot || !VALID_SLOTS.has(slot)) {
		return json({ error: `Unknown slot: ${slot}` }, { status: 400 });
	}

	const current = loadSettings();
	const slots = { ...(current.slots ?? {}) };

	if (clear) {
		delete slots[slot];
	} else {
		if (!provider || !(provider in PROVIDERS)) {
			return json({ error: `Unknown provider: ${provider}` }, { status: 400 });
		}
		if (!model || typeof model !== 'string' || model.trim().length === 0) {
			return json({ error: 'Model required' }, { status: 400 });
		}
		if (typeof maxInputTokens !== 'number' || maxInputTokens <= 0) {
			return json({ error: 'maxInputTokens must be a positive number' }, { status: 400 });
		}
		if (typeof maxOutputTokens !== 'number' || maxOutputTokens <= 0) {
			return json({ error: 'maxOutputTokens must be a positive number' }, { status: 400 });
		}
		slots[slot] = {
			provider: provider as Provider,
			model: model.trim(),
			maxInputTokens: Math.floor(maxInputTokens),
			maxOutputTokens: Math.floor(maxOutputTokens),
		};
	}

	saveSettings({
		...current,
		slots: Object.keys(slots).length > 0 ? slots : undefined,
	});

	return json({ ok: true, slot: slot as LlmSlot, cleared: !!clear });
};
