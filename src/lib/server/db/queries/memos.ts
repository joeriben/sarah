import { query, queryOne, transaction } from '../index.js';
import { createNaming, setAppearance, getOrCreateResearcherNaming } from './namings.js';

// The "memo system" perspective — lazily created per project
async function getOrCreateMemoSystemPerspective(projectId: string, userId: string) {
	let perspective = await queryOne<{ id: string }>(
		`SELECT n.id FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
		 WHERE n.project_id = $1 AND a.mode = 'perspective'
		   AND a.properties->>'role' = 'memo-system'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[projectId]
	);

	if (!perspective) {
		const n = await createNaming(projectId, userId, 'Memo System');
		await setAppearance(n.id, n.id, 'perspective', {
			properties: { role: 'memo-system' }
		});
		perspective = { id: n.id };
	}

	return perspective.id;
}

export async function createMemo(
	projectId: string,
	userId: string,
	label: string,
	content: string = '',
	linkedNamingIds: string[] = [],
	status: string = 'active'
) {
	return transaction(async (client) => {
		const perspectiveId = await getOrCreateMemoSystemPerspective(projectId, userId);

		// Create memo naming
		const memoRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, label, userId]
		);
		const memo = memoRes.rows[0];

		// It appears as entity from the memo-system perspective
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', '{}')`,
			[memo.id, perspectiveId]
		);

		// Store content
		await client.query(
			`INSERT INTO memo_content (naming_id, content, format, status) VALUES ($1, $2, 'html', $3)`,
			[memo.id, content, status]
		);

		// Create participations for links
		for (const targetId of linkedNamingIds) {
			const partNaming = await client.query(
				`INSERT INTO namings (project_id, inscription, created_by)
				 VALUES ($1, $2, $3) RETURNING id`,
				[projectId, `memo ${memo.id} ↔ ${targetId}`, userId]
			);
			await client.query(
				`INSERT INTO participations (id, naming_id, participant_id)
				 VALUES ($1, $2, $3)`,
				[partNaming.rows[0].id, memo.id, targetId]
			);
			// Appears as reference relation from memo perspective
			await client.query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
				 VALUES ($1, $2, 'relation', $3, $4, 'references', '{}')`,
				[partNaming.rows[0].id, perspectiveId, memo.id, targetId]
			);
		}

		return memo;
	});
}

export async function getMemosByProject(projectId: string) {
	const AI_SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';

	// Get all memos (excluding discussion entries)
	const memos = (
		await query(
			`SELECT n.id, n.inscription as label, n.created_at, n.created_by, mc.content, mc.format, mc.status
			 FROM namings n
			 JOIN memo_content mc ON mc.naming_id = n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND n.inscription NOT LIKE 'MemoDiscussion:%'
			   AND n.inscription NOT LIKE 'Discussion:%'
			 ORDER BY n.created_at DESC`,
			[projectId]
		)
	).rows;

	const memoIds = memos.map((m: any) => m.id);
	if (memoIds.length === 0) return [];

	// Get linked elements for all memos (element name + mode)
	const links = await query(
		`SELECT
			CASE WHEN p.naming_id = ANY($1::uuid[]) THEN p.naming_id ELSE p.participant_id END as memo_id,
			t.id as target_id, t.inscription as target_label,
			COALESCE((SELECT a.mode FROM appearances a WHERE a.naming_id = t.id LIMIT 1), 'entity') as target_mode
		 FROM participations p
		 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
		 JOIN namings t ON t.id = CASE WHEN p.naming_id = ANY($1::uuid[]) THEN p.participant_id ELSE p.naming_id END
		 WHERE (p.naming_id = ANY($1::uuid[]) OR p.participant_id = ANY($1::uuid[]))
		   AND t.deleted_at IS NULL AND NOT (t.id = ANY($1::uuid[]))
		   AND t.inscription NOT LIKE 'MemoDiscussion:%'
		   AND t.inscription NOT LIKE 'Discussion:%'
		   AND NOT EXISTS (SELECT 1 FROM memo_content mc2 WHERE mc2.naming_id = t.id)`,
		[memoIds]
	);
	const linkMap = new Map<string, any[]>();
	for (const row of links.rows) {
		if (!linkMap.has(row.memo_id)) linkMap.set(row.memo_id, []);
		linkMap.get(row.memo_id)!.push({ id: row.target_id, label: row.target_label, mode: row.target_mode });
	}

	// Get discussion threads for all memos
	const discRows = await query(
		`SELECT DISTINCT d.id, d.inscription as label, dc.content, d.created_at, d.created_by,
		        CASE WHEN p.naming_id = ANY($1::uuid[]) THEN p.naming_id ELSE p.participant_id END as parent_memo_id
		 FROM participations p
		 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
		 JOIN namings d ON d.id = CASE WHEN p.naming_id = ANY($1::uuid[]) THEN p.participant_id ELSE p.naming_id END
		 JOIN memo_content dc ON dc.naming_id = d.id
		 WHERE (p.naming_id = ANY($1::uuid[]) OR p.participant_id = ANY($1::uuid[]))
		   AND d.deleted_at IS NULL
		   AND NOT (d.id = ANY($1::uuid[]))
		   AND d.inscription LIKE 'MemoDiscussion:%'
		 ORDER BY d.created_at ASC`,
		[memoIds]
	);
	const discMap = new Map<string, any[]>();
	for (const row of discRows.rows) {
		const parentId = row.parent_memo_id;
		if (!discMap.has(parentId)) discMap.set(parentId, []);
		discMap.get(parentId)!.push({
			id: row.id,
			role: row.created_by === AI_SYSTEM_UUID ? 'ai' as const : 'researcher' as const,
			type: row.label?.includes(': researcher') ? 'researcher'
				: row.label?.includes(': revise') ? 'revise'
				: 'response',
			content: row.content,
			created_at: row.created_at,
		});
	}

	return memos.map((m: any) => ({
		id: m.id,
		label: m.label,
		content: m.content,
		format: m.format,
		status: m.status || 'active',
		created_at: m.created_at,
		created_by: m.created_by,
		isAiAuthored: m.created_by === AI_SYSTEM_UUID,
		links: linkMap.get(m.id) || [],
		discussion: discMap.get(m.id) || [],
	}));
}

export async function updateMemoStatus(memoId: string, status: string) {
	await query(
		`UPDATE memo_content SET status = $1 WHERE naming_id = $2`,
		[status, memoId]
	);
}

export async function promoteMemoToNaming(
	projectId: string,
	userId: string,
	memoId: string,
	mapId: string
) {
	return transaction(async (client) => {
		// Get memo content
		const memo = await client.query(
			`SELECT n.inscription, mc.content FROM namings n
			 JOIN memo_content mc ON mc.naming_id = n.id
			 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
			[memoId, projectId]
		);
		if (memo.rows.length === 0) throw new Error('Memo not found');

		// Create a new naming from the memo title
		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, memo.rows[0].inscription, userId]
		);
		const naming = namingRes.rows[0];

		// Place it on the map as entity
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', '{}')`,
			[naming.id, mapId]
		);

		// Initial designation act: cue
		const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[naming.id, researcherNamingId]
		);

		// Link the original memo to the new naming via participation
		const partRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[projectId, `promoted memo ${memoId} → ${naming.id}`, userId]
		);
		await client.query(
			`INSERT INTO participations (id, naming_id, participant_id)
			 VALUES ($1, $2, $3)`,
			[partRes.rows[0].id, memoId, naming.id]
		);

		// Update memo status to 'promoted'
		await client.query(
			`UPDATE memo_content SET status = 'promoted' WHERE naming_id = $1`,
			[memoId]
		);

		return naming;
	});
}

export async function getMemo(memoId: string, projectId: string) {
	const memo = await queryOne<{
		id: string;
		label: string;
		created_at: string;
		content: string;
		format: string;
	}>(
		`SELECT n.id, n.inscription as label, n.created_at,
		        mc.content, mc.format
		 FROM namings n
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[memoId, projectId]
	);
	if (!memo) return null;

	// Get linked namings (via participations)
	const links = await query(
		`SELECT p.id, t.id as target_id, t.inscription as target_label,
		        COALESCE(a.mode, 'entity') as target_mode
		 FROM participations p
		 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
		 JOIN namings t ON t.id = CASE WHEN p.naming_id = $1 THEN p.participant_id ELSE p.naming_id END
		 LEFT JOIN appearances a ON a.naming_id = t.id
		 WHERE (p.naming_id = $1 OR p.participant_id = $1)
		   AND t.deleted_at IS NULL AND t.id != $1
		 GROUP BY p.id, t.id, t.inscription, a.mode`,
		[memoId]
	);

	return { ...memo, links: links.rows };
}

export async function getMemosForNaming(namingId: string, projectId: string) {
	return (
		await query(
			`SELECT DISTINCT m.id, m.inscription as label, mc.content, m.created_at
			 FROM participations p
			 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
			 JOIN namings m ON m.id = CASE WHEN p.naming_id = $1 THEN p.participant_id ELSE p.naming_id END
			 JOIN memo_content mc ON mc.naming_id = m.id
			 WHERE (p.naming_id = $1 OR p.participant_id = $1)
			   AND m.project_id = $2
			   AND m.deleted_at IS NULL
			   AND m.id != $1
			 ORDER BY m.created_at DESC`,
			[namingId, projectId]
		)
	).rows;
}

export async function updateMemoContent(memoId: string, content: string) {
	await query(
		`UPDATE memo_content SET content = $1 WHERE naming_id = $2`,
		[content, memoId]
	);
}
