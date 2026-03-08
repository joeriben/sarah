import { query, queryOne, transaction } from '../index.js';
import { createNaming, setAppearance } from './namings.js';

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
	linkedNamingIds: string[] = []
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
			`INSERT INTO memo_content (naming_id, content, format) VALUES ($1, $2, 'html')`,
			[memo.id, content]
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
			`SELECT n.id, n.inscription as label, n.created_at, mc.content, mc.format,
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

export async function getMemo(memoId: string, projectId: string) {
	const memo = await queryOne(
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
