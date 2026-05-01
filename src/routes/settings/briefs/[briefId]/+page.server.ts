// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { getBrief } from '$lib/server/db/queries/briefs.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const brief = await getBrief(params.briefId);
	if (!brief) error(404, 'Brief not found');
	return { brief };
};
