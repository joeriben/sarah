import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { transaction } from '$lib/server/db/index.js';
import { projectSchema } from '$lib/shared/validation.js';
import { slugify, resolveFilePath } from '$lib/server/files/index.js';
import { mkdir, copyFile } from 'fs/promises';
import { join, basename } from 'path';

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json();
	const userId = locals.user!.id;

	// Save As (duplicate project)
	if (body.action === 'duplicate') {
		const { sourceProjectId, name } = body;
		if (!sourceProjectId) return json({ error: 'sourceProjectId required' }, { status: 400 });

		const project = await transaction(async (client) => {
			// Get source project
			const src = (await client.query(
				`SELECT name, description FROM projects WHERE id = $1`, [sourceProjectId]
			)).rows[0];
			if (!src) throw new Error('Source project not found');

			// Create new project
			const newName = name || `${src.name} (copy)`;
			const pRes = await client.query(
				`INSERT INTO projects (name, description, created_by)
				 VALUES ($1, $2, $3) RETURNING id, name, description, created_at`,
				[newName, src.description, userId]
			);
			const newProjectId = pRes.rows[0].id;

			await client.query(
				`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
				[newProjectId, userId]
			);

			// Copy all namings, build old→new ID map
			const srcNamings = (await client.query(
				`SELECT id, inscription, created_by, created_at FROM namings
				 WHERE project_id = $1 AND deleted_at IS NULL`,
				[sourceProjectId]
			)).rows;

			const idMap = new Map<string, string>();
			for (const n of srcNamings) {
				const r = await client.query(
					`INSERT INTO namings (project_id, inscription, created_by)
					 VALUES ($1, $2, $3) RETURNING id`,
					[newProjectId, n.inscription, n.created_by]
				);
				idMap.set(n.id, r.rows[0].id);
			}

			// Helper: remap a naming ID. Returns null for dangling references
			// (e.g. directed_from/to pointing at soft-deleted namings).
			const remap = (id: string | null): string | null => {
				if (!id) return null;
				return idMap.get(id) || null;
			};

			// Copy appearances (remap all naming ID references)
			const apps = (await client.query(
				`SELECT a.naming_id, a.perspective_id, a.mode, a.directed_from, a.directed_to, a.valence, a.properties
				 FROM appearances a
				 JOIN namings n ON n.id = a.naming_id
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL`,
				[sourceProjectId]
			)).rows;

			for (const a of apps) {
				const newNamingId = remap(a.naming_id);
				const newPerspId = remap(a.perspective_id);
				// Skip appearances where core naming is gone (dangling)
				if (!newNamingId || !newPerspId) continue;
				await client.query(
					`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
					 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
					[newNamingId, newPerspId, a.mode, remap(a.directed_from), remap(a.directed_to), a.valence, a.properties]
				);
			}

			// Copy naming_acts (remap naming_id, by, linked_naming_ids)
			const acts = (await client.query(
				`SELECT na.naming_id, na.by, na.inscription, na.designation, na.mode, na.valence, na.memo_text, na.linked_naming_ids
				 FROM naming_acts na
				 JOIN namings n ON n.id = na.naming_id
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL
				 ORDER BY na.seq`,
				[sourceProjectId]
			)).rows;

			for (const act of acts) {
				const newNamingId = remap(act.naming_id);
				if (!newNamingId) continue;
				const newBy = remap(act.by); // null if actor naming was deleted
				const newLinked = act.linked_naming_ids
					? act.linked_naming_ids.map((id: string) => remap(id)).filter(Boolean)
					: null;
				await client.query(
					`INSERT INTO naming_acts (naming_id, by, inscription, designation, mode, valence, memo_text, linked_naming_ids)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
					[newNamingId, newBy, act.inscription, act.designation, act.mode, act.valence, act.memo_text, newLinked]
				);
			}

			// Copy participations
			const parts = (await client.query(
				`SELECT p.id, p.naming_id, p.participant_id
				 FROM participations p
				 JOIN namings n ON n.id = p.naming_id
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL`,
				[sourceProjectId]
			)).rows;

			for (const p of parts) {
				const newId = remap(p.id);
				const newNamingId = remap(p.naming_id);
				const newPartId = remap(p.participant_id);
				// Skip participations where any side references a deleted naming
				if (!newId || !newNamingId || !newPartId) continue;
				await client.query(
					`INSERT INTO participations (id, naming_id, participant_id) VALUES ($1, $2, $3)`,
					[newId, newNamingId, newPartId]
				);
			}

			// Copy memo_content
			const memos = (await client.query(
				`SELECT mc.naming_id, mc.content, mc.format
				 FROM memo_content mc
				 JOIN namings n ON n.id = mc.naming_id
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL`,
				[sourceProjectId]
			)).rows;

			for (const m of memos) {
				await client.query(
					`INSERT INTO memo_content (naming_id, content, format) VALUES ($1, $2, $3)`,
					[remap(m.naming_id), m.content, m.format]
				);
			}

			// Copy document_content (with physical file copies)
			const docs = (await client.query(
				`SELECT dc.naming_id, dc.full_text, dc.file_path, dc.mime_type, dc.file_size, dc.thumbnail_path
				 FROM document_content dc
				 JOIN namings n ON n.id = dc.naming_id
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL`,
				[sourceProjectId]
			)).rows;

			const newFilesDir = join(process.cwd(), 'projekte', slugify(newName), 'files');
			await mkdir(newFilesDir, { recursive: true });

			for (const d of docs) {
				let newFilePath = d.file_path;
				if (d.file_path) {
					const resolved = await resolveFilePath(sourceProjectId, d.file_path);
					if (resolved) {
						const fname = basename(resolved);
						await copyFile(resolved, join(newFilesDir, fname));
						newFilePath = `files/${fname}`;
					}
				}
				await client.query(
					`INSERT INTO document_content (naming_id, full_text, file_path, mime_type, file_size, thumbnail_path)
					 VALUES ($1, $2, $3, $4, $5, $6)`,
					[remap(d.naming_id), d.full_text, newFilePath, d.mime_type, d.file_size, d.thumbnail_path]
				);
			}

			// Copy cluster_memberships
			const cms = (await client.query(
				`SELECT cm.cluster_id, cm.naming_id, cm.action, cm.mode, cm.by, cm.properties
				 FROM cluster_memberships cm
				 JOIN namings n ON n.id = cm.naming_id
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL`,
				[sourceProjectId]
			)).rows;

			for (const cm of cms) {
				const newCluster = remap(cm.cluster_id);
				const newNaming = remap(cm.naming_id);
				if (!newCluster || !newNaming) continue;
				await client.query(
					`INSERT INTO cluster_memberships (cluster_id, naming_id, action, mode, by, properties)
					 VALUES ($1, $2, $3, $4, $5, $6)`,
					[newCluster, newNaming, cm.action, cm.mode, remap(cm.by), cm.properties]
				);
			}

			// Copy topology_snapshots
			const topos = (await client.query(
				`SELECT ts.map_id, ts.seq, ts.label, ts.positions
				 FROM topology_snapshots ts
				 JOIN namings n ON n.id = ts.map_id
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL`,
				[sourceProjectId]
			)).rows;

			for (const t of topos) {
				// Remap position keys (soft: skip stale IDs from deleted namings)
				const newPositions: Record<string, unknown> = {};
				if (t.positions && typeof t.positions === 'object') {
					for (const [oldId, pos] of Object.entries(t.positions)) {
						const mapped = idMap.get(oldId);
						if (mapped) newPositions[mapped] = pos;
					}
				}
				await client.query(
					`INSERT INTO topology_snapshots (map_id, seq, label, positions)
					 VALUES ($1, $2, $3, $4)`,
					[remap(t.map_id), t.seq, t.label, JSON.stringify(newPositions)]
				);
			}

			// Post-copy validation: count rows in source vs target
			const srcCount = (await client.query(
				`SELECT COUNT(*) FROM namings WHERE project_id = $1 AND deleted_at IS NULL`,
				[sourceProjectId]
			)).rows[0].count;
			const tgtCount = (await client.query(
				`SELECT COUNT(*) FROM namings WHERE project_id = $1 AND deleted_at IS NULL`,
				[newProjectId]
			)).rows[0].count;
			if (srcCount !== tgtCount) {
				throw new Error(`Integrity check failed: source has ${srcCount} namings, copy has ${tgtCount}`);
			}

			return pRes.rows[0];
		});

		return json(project, { status: 201 });
	}

	// Regular create
	const parsed = projectSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: 'Invalid input' }, { status: 400 });
	}

	const { name, description } = parsed.data;

	const project = await transaction(async (client) => {
		const res = await client.query(
			`INSERT INTO projects (name, description, created_by) VALUES ($1, $2, $3) RETURNING id, name, description, created_at`,
			[name, description || null, userId]
		);
		const p = res.rows[0];

		await client.query(
			`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
			[p.id, userId]
		);

		return p;
	});

	return json(project, { status: 201 });
};
