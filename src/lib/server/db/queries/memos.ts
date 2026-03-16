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
	return (
		await query(
			`SELECT n.id, n.inscription as label, n.created_at, n.created_by, mc.content, mc.format, mc.status,
			        (SELECT COUNT(*) FROM participations p
			         JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
			         WHERE p.naming_id = n.id OR p.participant_id = n.id) as link_count
			 FROM namings n
			 JOIN memo_content mc ON mc.naming_id = n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			 ORDER BY n.created_at DESC`,
			[projectId]
		)
	).rows;
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
