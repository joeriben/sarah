/**
 * QDPX Import — Two-phase, dual-mode
 *
 * Phase 1: Parse XML, collect everything into memory, remap all GUIDs
 * Phase 2: Insert in dependency order — no forward references, no ON CONFLICT
 *
 * Mode detection:
 * - tq: namespace present → full fidelity (naming_acts, appearances, phases, AI)
 * - standard QDPX only → codes as cues, documents + annotations, memos
 */

import { XMLParser } from 'fast-xml-parser';
import yauzl from 'yauzl';
import { transaction } from '../db/index.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

import { slugify } from '../files/index.js';

const PROJECTS_DIR = join(process.cwd(), 'projekte');

// ---- ZIP extraction ----

interface ZipEntry {
	name: string;
	getData: () => Promise<Buffer>;
}

function readZip(buffer: Buffer): Promise<ZipEntry[]> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
			if (err || !zipfile) return reject(err || new Error('Failed to open ZIP'));
			const entries: ZipEntry[] = [];
			zipfile.readEntry();
			zipfile.on('entry', (entry) => {
				if (/\/$/.test(entry.fileName)) { zipfile.readEntry(); return; }
				entries.push({
					name: entry.fileName,
					getData: () => new Promise((res, rej) => {
						zipfile.openReadStream(entry, (err2, stream) => {
							if (err2 || !stream) return rej(err2);
							const chunks: Buffer[] = [];
							stream.on('data', (c: Buffer) => chunks.push(c));
							stream.on('end', () => res(Buffer.concat(chunks)));
							stream.on('error', rej);
						});
					})
				});
				zipfile.readEntry();
			});
			zipfile.on('end', () => resolve(entries));
			zipfile.on('error', reject);
		});
	});
}

// ---- XML helpers ----

function parseQDE(xml: string) {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@_',
		processEntities: false,
		isArray: (name) => [
			'User', 'Code', 'Note', 'Link', 'Set', 'Graph',
			'TextSource', 'PictureSource', 'PDFSource', 'AudioSource', 'VideoSource',
			'PlainTextSelection', 'PictureSelection', 'PDFSelection',
			'Coding', 'CodeRef', 'NoteRef',
			'Vertex', 'Edge',
			'MemberSource', 'MemberCode', 'MemberNote',
			'tq:Act', 'tq:Appearance', 'tq:Phase', 'tq:Member',
			'tq:Participation', 'tq:ResearcherNaming'
		].includes(name),
	});
	return parser.parse(xml);
}

function arr<T>(val: T | T[] | undefined | null): T[] {
	if (!val) return [];
	return Array.isArray(val) ? val : [val];
}

function unesc(s: string): string {
	return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// ---- Collected data types ----

interface CollectedNaming {
	id: string;
	inscription: string;
}

interface CollectedNamingAct {
	namingId: string;
	seq?: number;
	by: string;
	inscription?: string;
	designation?: string;
	mode?: string;
	valence?: string;
	memoText?: string;
	createdAt?: string;
}

interface CollectedAppearance {
	namingId: string;
	perspectiveId: string;
	mode: string;
	directedFrom?: string;
	directedTo?: string;
	valence?: string;
	properties: Record<string, any>;
}

interface CollectedParticipation {
	id: string;
	namingId: string;
	participantId: string;
}

interface CollectedDocContent {
	namingId: string;
	fullText: string | null;
	filePath: string | null;
	mimeType: string;
	fileSize: number;
}

interface CollectedMemoContent {
	namingId: string;
	content: string;
	format: string;
	status: string;
}

interface CollectedPhaseMembership {
	phaseId: string;
	namingId: string;
	by: string;
}

interface CollectedTopology {
	mapId: string;
	positions: Record<string, { x: number; y: number }>;
}

// ---- Phase 1: Parse and collect ----

export interface ImportResult {
	projectId: string;
	projectName: string;
	counts: { codes: number; documents: number; annotations: number; memos: number; relations: number; maps: number };
	mode: 'transact-qda' | 'standard';
}

export async function importProject(
	zipBuffer: Buffer,
	userId: string,
	projectName?: string
): Promise<ImportResult> {
	const entries = await readZip(zipBuffer);
	const qdeEntry = entries.find(e => e.name === 'project.qde');
	if (!qdeEntry) throw new Error('No project.qde found in QDPX archive');

	const xml = (await qdeEntry.getData()).toString('utf-8');
	const parsed = parseQDE(xml);
	const project = parsed.Project;
	if (!project) throw new Error('Invalid QDPX: no Project element');

	const mode: 'transact-qda' | 'standard' = xml.includes('urn:transact-qda:1.0') ? 'transact-qda' : 'standard';

	// Source files from ZIP
	const sourceFiles = new Map<string, ZipEntry>();
	for (const entry of entries) {
		if (entry.name.startsWith('Sources/')) {
			sourceFiles.set(entry.name.replace('Sources/', ''), entry);
		}
	}

	// GUID remapping — every old GUID gets a fresh UUID
	const guidMap = new Map<string, string>();
	const remap = (guid: string): string => {
		if (!guidMap.has(guid)) guidMap.set(guid, randomUUID());
		return guidMap.get(guid)!;
	};

	// Collectors
	const namings: CollectedNaming[] = [];
	const namingActs: CollectedNamingAct[] = [];
	const appearances: CollectedAppearance[] = [];
	const participations: CollectedParticipation[] = [];
	const docContents: CollectedDocContent[] = [];
	const memoContents: CollectedMemoContent[] = [];
	const phaseMemberships: CollectedPhaseMembership[] = [];
	const topologies: CollectedTopology[] = [];
	const counts = { codes: 0, documents: 0, annotations: 0, memos: 0, relations: 0, maps: 0 };

	// Fixed IDs created during import
	const researcherNamingId = randomUUID();
	const gwId = randomUUID();
	const memoSysId = randomUUID();

	// Track all naming IDs that will be inserted — used by tq:Participations
	// to create stubs for any referenced IDs not yet in the list
	const allNamingIds = new Set<string>([researcherNamingId, gwId, memoSysId]);

	// ---- Collect infrastructure namings ----
	namings.push({ id: researcherNamingId, inscription: '(researcher)' }); // updated below
	namings.push({ id: gwId, inscription: 'Grounding Workspace' });
	namings.push({ id: memoSysId, inscription: 'Memo System' });

	appearances.push({ namingId: researcherNamingId, perspectiveId: researcherNamingId, mode: 'perspective', properties: { role: 'researcher' } });
	appearances.push({ namingId: gwId, perspectiveId: gwId, mode: 'perspective', properties: { role: 'grounding-workspace' } });
	appearances.push({ namingId: memoSysId, perspectiveId: memoSysId, mode: 'perspective', properties: { role: 'memo-system' } });

	namingActs.push({ namingId: researcherNamingId, by: researcherNamingId, designation: 'characterization' });

	// ---- Collect all by-references as namings ----
	// naming_acts reference `by` GUIDs (researcher/AI namings from original project).
	// These must exist as namings before naming_acts can reference them.
	const byIds = new Set<string>();
	for (const code of arr(project.CodeBook?.Codes?.Code)) {
		for (const act of arr(code['tq:NamingActs']?.['tq:Act'])) {
			if (act['@_by']) byIds.add(act['@_by']);
		}
	}
	for (const link of arr(project.Links?.Link)) {
		for (const act of arr(link['tq:NamingActs']?.['tq:Act'])) {
			if (act['@_by']) byIds.add(act['@_by']);
		}
	}
	// Check ResearcherNamings from export for label
	const exportedResearchers = new Map<string, string>();
	for (const rn of arr(project['tq:ResearcherNamings']?.['tq:ResearcherNaming'])) {
		if (rn['@_namingId']) exportedResearchers.set(rn['@_namingId'], rn['@_userId'] || '');
	}
	for (const origId of byIds) {
		const mappedId = remap(origId);
		if (mappedId === researcherNamingId) continue; // already created
		const userLabel = exportedResearchers.has(origId) ? '(original researcher)' : '(original actor)';
		namings.push({ id: mappedId, inscription: userLabel });
	}

	// ---- Collect codes ----
	for (const code of arr(project.CodeBook?.Codes?.Code)) {
		const id = remap(code['@_guid']);
		const name = code['@_name'] || 'unnamed';
		const color = code['@_color'] || null;
		namings.push({ id, inscription: name });

		if (mode === 'transact-qda' && code['tq:NamingActs']) {
			for (const act of arr(code['tq:NamingActs']['tq:Act'])) {
				namingActs.push({
					namingId: id, seq: parseInt(act['@_seq']), by: remap(act['@_by']),
					inscription: act['@_inscription'] || undefined,
					designation: act['@_designation'] || undefined,
					mode: act['@_mode'] || undefined,
					valence: act['@_valence'] || undefined,
					memoText: act['@_memo'] || undefined,
					createdAt: act['@_at'] || undefined
				});
			}
		} else {
			namingActs.push({ namingId: id, by: researcherNamingId, inscription: name, designation: 'cue' });
		}

		if (mode === 'transact-qda' && code['tq:Appearances']) {
			for (const app of arr(code['tq:Appearances']['tq:Appearance'])) {
				const props = app['@_properties'] ? JSON.parse(unesc(app['@_properties'])) : {};
				if (color && !props.color) props.color = color;
				appearances.push({
					namingId: id, perspectiveId: remap(app['@_perspective']),
					mode: app['@_mode'] || 'entity',
					directedFrom: app['@_directedFrom'] ? remap(app['@_directedFrom']) : undefined,
					directedTo: app['@_directedTo'] ? remap(app['@_directedTo']) : undefined,
					valence: app['@_valence'] || undefined,
					properties: props
				});
			}
		}

		counts.codes++;
	}

	// ---- Collect documents ----
	const mimeMap: Record<string, string> = {
		txt: 'text/plain', md: 'text/markdown', pdf: 'application/pdf',
		jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
		wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4',
		mp4: 'video/mp4', webm: 'video/webm', avi: 'video/x-msvideo',
		docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	};

	// Will be set during Phase 2 (file writing)
	const pendingFiles: { namingId: string; internalRef: string; ext: string }[] = [];

	function collectSource(el: any, sourceType: 'text' | 'image' | 'pdf' | 'audio' | 'video') {
		const id = remap(el['@_guid']);
		const name = el['@_name'] || 'untitled';
		const pathAttr = el['@_path'] || el['@_plainTextPath'] || '';
		const internalRef = pathAttr.replace('internal://', '');
		const ext = internalRef.split('.').pop()?.toLowerCase() || 'txt';
		const mimeType = mimeMap[ext] || 'application/octet-stream';

		namings.push({ id, inscription: name });
		namingActs.push({ namingId: id, by: researcherNamingId, inscription: name, designation: 'characterization' });

		// Inline text
		let fullText: string | null = null;
		if (el.PlainTextContent) {
			fullText = typeof el.PlainTextContent === 'string' ? el.PlainTextContent : String(el.PlainTextContent);
		}

		docContents.push({ namingId: id, fullText, filePath: null, mimeType, fileSize: 0 });
		pendingFiles.push({ namingId: id, internalRef, ext });

		counts.documents++;

		// Text annotations
		const textSels = [...arr(el.PlainTextSelection)];
		for (const repr of arr(el.Representation)) {
			textSels.push(...arr(repr.PlainTextSelection));
		}
		for (const sel of textSels) {
			for (const coding of arr(sel.Coding)) {
				for (const ref of arr(coding.CodeRef)) {
					const codeId = remap(ref['@_targetGUID']);
					collectAnnotation(id, codeId, 'text', {
						pos0: parseInt(sel['@_startPosition'] || '0'),
						pos1: parseInt(sel['@_endPosition'] || '0')
					});
				}
			}
		}

		// Image annotations
		for (const sel of arr(el.PictureSelection)) {
			for (const coding of arr(sel.Coding)) {
				for (const ref of arr(coding.CodeRef)) {
					const codeId = remap(ref['@_targetGUID']);
					collectAnnotation(id, codeId, 'image_region', {
						x: parseFloat(sel['@_firstX'] || '0'),
						y: parseFloat(sel['@_firstY'] || '0'),
						width: parseFloat(sel['@_secondX'] || '0') - parseFloat(sel['@_firstX'] || '0'),
						height: parseFloat(sel['@_secondY'] || '0') - parseFloat(sel['@_firstY'] || '0')
					});
				}
			}
		}
	}

	function collectAnnotation(docId: string, codeId: string, anchorType: string, anchor: Record<string, any>) {
		const annId = randomUUID();
		const partCodeId = randomUUID();
		const partDocId = randomUUID();

		namings.push({ id: annId, inscription: `annotation: ${codeId} → ${docId}` });
		namings.push({ id: partCodeId, inscription: `annotation ${annId} ↔ ${codeId}` });
		namings.push({ id: partDocId, inscription: `annotation ${annId} ↔ ${docId}` });

		participations.push({ id: partCodeId, namingId: annId, participantId: codeId });
		participations.push({ id: partDocId, namingId: annId, participantId: docId });

		appearances.push({
			namingId: annId, perspectiveId: gwId,
			mode: 'relation', directedFrom: codeId, directedTo: docId,
			valence: 'codes', properties: { anchorType, anchor }
		});

		// Ensure code appears on grounding workspace
		if (!appearances.some(a => a.namingId === codeId && a.perspectiveId === gwId)) {
			appearances.push({ namingId: codeId, perspectiveId: gwId, mode: 'entity', properties: {} });
		}

		counts.annotations++;
	}

	for (const src of arr(project.Sources?.TextSource)) collectSource(src, 'text');
	for (const src of arr(project.Sources?.PictureSource)) collectSource(src, 'image');
	for (const src of arr(project.Sources?.PDFSource)) collectSource(src, 'pdf');
	for (const src of arr(project.Sources?.AudioSource)) collectSource(src, 'audio');
	for (const src of arr(project.Sources?.VideoSource)) collectSource(src, 'video');

	// ---- Collect memos ----
	for (const note of arr(project.Notes?.Note)) {
		const id = remap(note['@_guid']);
		const label = note['@_name'] || 'Untitled memo';
		const content = note.PlainTextContent || '';
		const tqMeta = note['tq:MemoMeta'];

		namings.push({ id, inscription: label });
		appearances.push({ namingId: id, perspectiveId: memoSysId, mode: 'entity', properties: {} });
		memoContents.push({
			namingId: id, content: typeof content === 'string' ? content : String(content),
			format: tqMeta?.['@_format'] || 'html',
			status: tqMeta?.['@_status'] || 'active'
		});
		counts.memos++;
	}

	// ---- Collect links (relations + memo references) ----
	for (const link of arr(project.Links?.Link)) {
		const originGuid = link['@_originGUID'];
		const targetGuid = link['@_targetGUID'];
		if (!originGuid || !targetGuid) continue;

		const linkId = remap(link['@_guid']);
		const originId = remap(originGuid);
		const targetId = remap(targetGuid);
		const isMemoRef = link['tq:LinkType']?.['@_type'] === 'memo-reference';

		if (isMemoRef) {
			// Memo-element link as participation
			namings.push({ id: linkId, inscription: `memo ${originId} ↔ ${targetId}` });
			participations.push({ id: linkId, namingId: originId, participantId: targetId });
		} else {
			// Analytical relation
			const name = link['@_name'] || '';
			namings.push({ id: linkId, inscription: name || `${originId} ↔ ${targetId}` });
			participations.push({ id: linkId, namingId: originId, participantId: targetId });

			if (mode === 'transact-qda' && link['tq:NamingActs']) {
				for (const act of arr(link['tq:NamingActs']['tq:Act'])) {
					namingActs.push({
						namingId: linkId, seq: parseInt(act['@_seq']), by: remap(act['@_by']),
						inscription: act['@_inscription'] || undefined,
						designation: act['@_designation'] || undefined,
						createdAt: act['@_at'] || undefined
					});
				}
			} else {
				namingActs.push({ namingId: linkId, by: researcherNamingId, inscription: name, designation: 'cue' });
			}

			counts.relations++;
		}
	}

	// ---- Collect sets (DocNets) ----
	for (const set of arr(project.Sets?.Set)) {
		const id = remap(set['@_guid']);
		const name = set['@_name'] || 'Untitled set';

		namings.push({ id, inscription: name });
		appearances.push({ namingId: id, perspectiveId: id, mode: 'perspective', properties: { role: 'docnet' } });

		for (const member of arr(set.MemberSource)) {
			const docId = remap(member['@_targetGUID']);
			const partId = randomUUID();
			namings.push({ id: partId, inscription: `docnet ${id} ↔ ${docId}` });
			participations.push({ id: partId, namingId: id, participantId: docId });
		}
	}

	// ---- Collect graphs/maps (tq mode) ----
	if (mode === 'transact-qda') {
		for (const graph of arr(project.Graphs?.Graph)) {
			const id = remap(graph['@_guid']);
			const name = graph['@_name'] || 'Imported Map';
			const mapType = graph['tq:Perspective']?.['@_mapType'] || 'situational';

			namings.push({ id, inscription: name });
			appearances.push({ namingId: id, perspectiveId: id, mode: 'perspective', properties: { mapType } });

			// Topology
			const vertices = arr(graph.Vertex);
			if (vertices.length > 0) {
				const positions: Record<string, { x: number; y: number }> = {};
				for (const v of vertices) {
					const elemId = v['@_representedGUID'];
					if (elemId) {
						positions[remap(elemId)] = {
							x: parseFloat(v['@_firstX'] || '0'),
							y: parseFloat(v['@_firstY'] || '0')
						};
					}
				}
				topologies.push({ mapId: id, positions });
			}

			// Phases
			for (const phase of arr(graph['tq:Phases']?.['tq:Phase'])) {
				const phaseId = remap(phase['@_guid']);
				namings.push({ id: phaseId, inscription: phase['@_name'] || 'Phase' });
				appearances.push({ namingId: phaseId, perspectiveId: id, mode: 'perspective', properties: {} });

				for (const member of arr(phase['tq:Member'])) {
					phaseMemberships.push({
						phaseId, namingId: remap(member['@_targetGUID']), by: researcherNamingId
					});
				}
			}

			counts.maps++;
		}

		// Full participations — ensure all referenced namings exist
		// Build set of all known naming IDs first
		for (const n of namings) allNamingIds.add(n.id);

		for (const p of arr(project['tq:Participations']?.['tq:Participation'])) {
			const pId = remap(p['@_id']);
			const nId = remap(p['@_namingId']);
			const partId = remap(p['@_participantId']);

			for (const id of [pId, nId, partId]) {
				if (!allNamingIds.has(id)) {
					allNamingIds.add(id);
					namings.push({ id, inscription: '(imported)' });
				}
			}

			participations.push({ id: pId, namingId: nId, participantId: partId });
		}
	}

	// Standard mode: create a default SitMap
	if (mode === 'standard' && counts.codes > 0) {
		const mapId = randomUUID();
		namings.push({ id: mapId, inscription: 'Imported Map' });
		appearances.push({ namingId: mapId, perspectiveId: mapId, mode: 'perspective', properties: { mapType: 'situational' } });

		// Place codes on map
		const codeIds = arr(project.CodeBook?.Codes?.Code).map((c: any) => remap(c['@_guid']));
		for (let i = 0; i < codeIds.length; i++) {
			appearances.push({
				namingId: codeIds[i], perspectiveId: mapId, mode: 'entity',
				properties: { x: (i % 8) * 180 + 100, y: Math.floor(i / 8) * 100 + 100 }
			});
		}

		// Place relations
		for (const link of arr(project.Links?.Link)) {
			if (link['tq:LinkType']?.['@_type'] === 'memo-reference') continue;
			const relId = remap(link['@_guid']);
			const originId = remap(link['@_originGUID']);
			const targetId = remap(link['@_targetGUID']);
			appearances.push({
				namingId: relId, perspectiveId: mapId, mode: 'relation',
				directedFrom: originId, directedTo: targetId, properties: {}
			});
		}

		counts.maps = 1;
	}

	// ---- Phase 2: Insert in dependency order ----

	const result = await transaction(async (client) => {
		let pName = projectName || project['@_name'] || 'Imported Project';

		// Ensure unique project name
		const existing = await client.query('SELECT 1 FROM projects WHERE name = $1', [pName]);
		if (existing.rows.length > 0) {
			let suffix = 2;
			while ((await client.query('SELECT 1 FROM projects WHERE name = $1', [`${pName} (${suffix})`])).rows.length > 0) {
				suffix++;
			}
			pName = `${pName} (${suffix})`;
		}

		// 1. Project
		const projRes = await client.query(
			`INSERT INTO projects (name, description, created_by) VALUES ($1, $2, $3) RETURNING id`,
			[pName, project.Description || null, userId]
		);
		const projectId = projRes.rows[0].id;
		await client.query(
			`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
			[projectId, userId]
		);

		// Update researcher naming inscription
		const userRes = await client.query(`SELECT display_name, username FROM users WHERE id = $1`, [userId]);
		const displayName = userRes.rows[0]?.display_name || userRes.rows[0]?.username || 'Researcher';
		namings[0].inscription = displayName;

		// 2. All namings (deduplicated by id)
		const seenIds = new Set<string>();
		for (const n of namings) {
			if (seenIds.has(n.id)) continue;
			seenIds.add(n.id);
			await client.query(
				`INSERT INTO namings (id, project_id, inscription, created_by) VALUES ($1, $2, $3, $4)`,
				[n.id, projectId, n.inscription, userId]
			);
		}

		// 3. All naming_acts (order: explicit seq first, then auto-seq)
		const withSeq = namingActs.filter(a => a.seq !== undefined).sort((a, b) => (a.seq || 0) - (b.seq || 0));
		const withoutSeq = namingActs.filter(a => a.seq === undefined);

		for (const a of withSeq) {
			await client.query(
				`INSERT INTO naming_acts (naming_id, seq, by, inscription, designation, mode, valence, memo_text, created_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				[a.namingId, a.seq, a.by, a.inscription || null, a.designation || null,
				 a.mode || null, a.valence || null, a.memoText || null,
				 a.createdAt || new Date().toISOString()]
			);
		}
		for (const a of withoutSeq) {
			await client.query(
				`INSERT INTO naming_acts (naming_id, by, inscription, designation, mode, valence, memo_text)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[a.namingId, a.by, a.inscription || null, a.designation || null,
				 a.mode || null, a.valence || null, a.memoText || null]
			);
		}

		// 4. All appearances (deduplicated by naming_id + perspective_id)
		// Ensure all referenced perspective_ids exist as namings
		for (const a of appearances) {
			if (!seenIds.has(a.perspectiveId)) {
				seenIds.add(a.perspectiveId);
				await client.query(
					`INSERT INTO namings (id, project_id, inscription, created_by) VALUES ($1, $2, $3, $4)`,
					[a.perspectiveId, projectId, '(imported perspective)', userId]
				);
			}
			if (!seenIds.has(a.namingId)) {
				seenIds.add(a.namingId);
				await client.query(
					`INSERT INTO namings (id, project_id, inscription, created_by) VALUES ($1, $2, $3, $4)`,
					[a.namingId, projectId, '(imported)', userId]
				);
			}
		}
		const seenApp = new Set<string>();
		for (const a of appearances) {
			const key = `${a.namingId}|${a.perspectiveId}`;
			if (seenApp.has(key)) continue;
			seenApp.add(key);
			await client.query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[a.namingId, a.perspectiveId, a.mode,
				 a.directedFrom || null, a.directedTo || null,
				 a.valence || null, JSON.stringify(a.properties)]
			);
		}

		// 5. All participations (deduplicated by naming_id + participant_id)
		const seenPart = new Set<string>();
		for (const p of participations) {
			const key = `${p.namingId}|${p.participantId}`;
			if (seenPart.has(key)) continue;
			seenPart.add(key);
			await client.query(
				`INSERT INTO participations (id, naming_id, participant_id) VALUES ($1, $2, $3)`,
				[p.id, p.namingId, p.participantId]
			);
		}

		// 6. Document content + files
		const filesDir = join(PROJECTS_DIR, slugify(pName), 'files');
		await mkdir(filesDir, { recursive: true });

		for (const dc of docContents) {
			const pending = pendingFiles.find(f => f.namingId === dc.namingId);
			if (pending) {
				const sourceFile = sourceFiles.get(pending.internalRef);
				if (sourceFile) {
					const fileData = await sourceFile.getData();
					const diskName = `${randomUUID()}.${pending.ext}`;
					dc.filePath = `files/${diskName}`;
					dc.fileSize = fileData.length;
					await writeFile(join(filesDir, diskName), fileData);
					if (!dc.fullText && ['txt', 'md'].includes(pending.ext)) {
						dc.fullText = fileData.toString('utf-8');
					}
				}
			}
			await client.query(
				`INSERT INTO document_content (naming_id, full_text, file_path, mime_type, file_size) VALUES ($1, $2, $3, $4, $5)`,
				[dc.namingId, dc.fullText, dc.filePath, dc.mimeType, dc.fileSize]
			);
		}

		// 7. Memo content
		for (const mc of memoContents) {
			await client.query(
				`INSERT INTO memo_content (naming_id, content, format, status) VALUES ($1, $2, $3, $4)`,
				[mc.namingId, mc.content, mc.format, mc.status]
			);
		}

		// 8. Phase memberships
		for (const pm of phaseMemberships) {
			await client.query(
				`INSERT INTO phase_memberships (phase_id, naming_id, action, by) VALUES ($1, $2, 'assign', $3)`,
				[pm.phaseId, pm.namingId, pm.by]
			);
		}

		// 9. Topology snapshots
		for (const t of topologies) {
			await client.query(
				`INSERT INTO topology_snapshots (id, map_id, seq, label, positions) VALUES ($1, $2, 0, 'imported', $3)`,
				[randomUUID(), t.mapId, JSON.stringify(t.positions)]
			);
		}

		// 10. Researcher naming registration
		await client.query(
			`INSERT INTO researcher_namings (user_id, project_id, naming_id) VALUES ($1, $2, $3)`,
			[userId, projectId, researcherNamingId]
		);

		return { projectId, projectName: pName, counts, mode };
	});

	return result;
}
