/**
 * QDPX Export — Dual-namespace approach
 *
 * Produces a valid QDPX (REFI-QDA v1.0) ZIP archive with:
 * - Standard namespace (urn:QDA-XML:project:1.0): readable by ATLAS.ti, MAXQDA, NVivo, etc.
 * - Custom namespace (urn:transact-qda:1.0): preserves naming_acts, appearances, AI metadata, phases
 *
 * On re-import into transact-qda, the tq: namespace restores full fidelity.
 */

import archiver from 'archiver';
import { query } from '../db/index.js';
import { resolveFilePath } from '../files/index.js';
import { readFile } from 'fs/promises';
import { Writable } from 'stream';

const NS = 'urn:QDA-XML:project:1.0';
const TQ_NS = 'urn:transact-qda:1.0';

// ---- Data fetching ----

async function fetchProjectData(projectId: string) {
	const [
		project,
		users,
		namings,
		namingActs,
		participations,
		appearances,
		documents,
		memoContents,
		phaseMemberships,
		topologySnapshots
	] = await Promise.all([
		query(`SELECT * FROM projects WHERE id = $1`, [projectId]),
		query(
			`SELECT u.id, u.username, u.display_name FROM users u
			 JOIN project_members pm ON pm.user_id = u.id
			 WHERE pm.project_id = $1`,
			[projectId]
		),
		query(
			`SELECT * FROM namings WHERE project_id = $1 AND deleted_at IS NULL ORDER BY seq`,
			[projectId]
		),
		query(
			`SELECT na.* FROM naming_acts na
			 JOIN namings n ON n.id = na.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			 ORDER BY na.naming_id, na.seq`,
			[projectId]
		),
		query(
			`SELECT p.* FROM participations p
			 JOIN namings n ON n.id = p.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL`,
			[projectId]
		),
		query(
			`SELECT a.* FROM appearances a
			 JOIN namings n ON n.id = a.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL`,
			[projectId]
		),
		query(
			`SELECT dc.*, n.inscription FROM document_content dc
			 JOIN namings n ON n.id = dc.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL`,
			[projectId]
		),
		query(
			`SELECT mc.*, n.inscription FROM memo_content mc
			 JOIN namings n ON n.id = mc.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL`,
			[projectId]
		),
		query(
			`SELECT pm.* FROM phase_memberships pm
			 JOIN namings n ON n.id = pm.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			 ORDER BY pm.seq`,
			[projectId]
		),
		query(
			`SELECT ts.* FROM topology_snapshots ts
			 JOIN namings n ON n.id = ts.map_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL`,
			[projectId]
		)
	]);

	return {
		project: project.rows[0],
		users: users.rows,
		namings: namings.rows,
		namingActs: namingActs.rows,
		participations: participations.rows,
		appearances: appearances.rows,
		documents: documents.rows,
		memoContents: memoContents.rows,
		phaseMemberships: phaseMemberships.rows,
		topologySnapshots: topologySnapshots.rows
	};
}

// ---- XML helpers ----

function esc(s: string | null | undefined): string {
	if (!s) return '';
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function isoDate(d: string | Date | null): string {
	if (!d) return new Date().toISOString();
	return new Date(d).toISOString();
}

// ---- Classification helpers ----

function isMap(appearances: any[], namingId: string): any | null {
	return appearances.find(
		(a: any) => a.naming_id === namingId && a.perspective_id === namingId
			&& a.mode === 'perspective' && a.properties?.mapType
	);
}

function isDocument(documents: any[], namingId: string): any | null {
	return documents.find((d: any) => d.naming_id === namingId);
}

function isMemo(memoContents: any[], namingId: string): any | null {
	return memoContents.find((m: any) => m.naming_id === namingId);
}

function isResearcher(appearances: any[], namingId: string): boolean {
	return appearances.some(
		(a: any) => a.naming_id === namingId && a.perspective_id === namingId
			&& a.properties?.role === 'researcher'
	);
}

function isInfrastructure(appearances: any[], namingId: string): boolean {
	return appearances.some(
		(a: any) => a.naming_id === namingId && a.perspective_id === namingId
			&& a.properties?.role && ['grounding-workspace', 'memo-system', 'docnet'].includes(a.properties.role)
	);
}

function isAnnotation(appearances: any[], namingId: string): boolean {
	return appearances.some(
		(a: any) => a.naming_id === namingId && a.valence === 'codes'
	);
}

function isCode(appearances: any[], namingId: string): boolean {
	return appearances.some(
		(a: any) => a.naming_id === namingId && a.mode === 'entity'
			&& !['perspective', 'researcher', 'grounding-workspace', 'memo-system', 'docnet'].includes(a.properties?.role || '')
	);
}

function currentDesignation(namingActs: any[], namingId: string): string {
	const acts = namingActs.filter(
		(a: any) => a.naming_id === namingId && a.designation
	);
	return acts.length > 0 ? acts[acts.length - 1].designation : 'cue';
}

function currentInscription(namingActs: any[], namingId: string, fallback: string): string {
	const acts = namingActs.filter(
		(a: any) => a.naming_id === namingId && a.inscription
	);
	return acts.length > 0 ? acts[acts.length - 1].inscription : fallback;
}

// ---- XML generation ----

function buildQDE(data: Awaited<ReturnType<typeof fetchProjectData>>): string {
	const { project, users, namings, namingActs, participations, appearances,
		documents, memoContents, phaseMemberships, topologySnapshots } = data;

	const lines: string[] = [];
	const w = (s: string) => lines.push(s);

	// Classify namings
	const codeNamings = namings.filter((n: any) =>
		isCode(appearances, n.id)
		&& !isDocument(documents, n.id)
		&& !isMemo(memoContents, n.id)
		&& !isMap(appearances, n.id)
		&& !isResearcher(appearances, n.id)
		&& !isInfrastructure(appearances, n.id)
		&& !isAnnotation(appearances, n.id)
		&& !participations.some((p: any) => p.id === n.id) // not a participation-naming
	);

	const docNamings = namings.filter((n: any) => isDocument(documents, n.id));
	const memoNamings = namings.filter((n: any) =>
		isMemo(memoContents, n.id)
		&& !n.inscription.startsWith('MemoDiscussion:')
		&& !n.inscription.startsWith('Discussion:')
	);
	const mapNamings = namings.filter((n: any) => isMap(appearances, n.id));

	// Relations (participations that are rendered as relations on maps)
	const relationNamings = namings.filter((n: any) => {
		const part = participations.find((p: any) => p.id === n.id);
		if (!part) return false;
		// Has a relation appearance on a map
		return appearances.some((a: any) => a.naming_id === n.id && a.mode === 'relation'
			&& a.valence !== 'codes' && a.valence !== 'references');
	});

	// DocNets (Sets)
	const docnetNamings = namings.filter((n: any) =>
		appearances.some((a: any) => a.naming_id === n.id && a.perspective_id === n.id
			&& a.properties?.role === 'docnet')
	);

	// Header
	w(`<?xml version="1.0" encoding="UTF-8"?>`);
	w(`<Project xmlns="${NS}" xmlns:tq="${TQ_NS}"`);
	w(`  name="${esc(project.name)}"`);
	w(`  origin="transact-qda"`);
	w(`  creationDateTime="${isoDate(project.created_at)}"`);
	w(`  modifiedDateTime="${isoDate(project.created_at)}"`);
	w(`  basePath="">`);

	if (project.description) {
		w(`  <Description>${esc(project.description)}</Description>`);
	}

	// Users
	w(`  <Users>`);
	for (const u of users) {
		w(`    <User guid="${u.id}" name="${esc(u.display_name || u.username)}" id="${esc(u.username)}"/>`);
	}
	w(`  </Users>`);

	// CodeBook
	w(`  <CodeBook>`);
	w(`    <Codes>`);
	for (const code of codeNamings) {
		const desig = currentDesignation(namingActs, code.id);
		const inscription = currentInscription(namingActs, code.id, code.inscription);
		const color = appearances.find((a: any) => a.naming_id === code.id && a.properties?.color)?.properties?.color;

		w(`      <Code guid="${code.id}" name="${esc(inscription)}" isCodable="true"${color ? ` color="${esc(color)}"` : ''}>`);
		w(`        <Description>CCS: ${desig}</Description>`);

		// tq: namespace — full naming_acts stack
		const acts = namingActs.filter((a: any) => a.naming_id === code.id);
		if (acts.length > 0) {
			w(`        <tq:NamingActs>`);
			for (const act of acts) {
				const attrs: string[] = [`seq="${act.seq}"`];
				if (act.inscription) attrs.push(`inscription="${esc(act.inscription)}"`);
				if (act.designation) attrs.push(`designation="${esc(act.designation)}"`);
				if (act.mode) attrs.push(`mode="${esc(act.mode)}"`);
				if (act.valence) attrs.push(`valence="${esc(act.valence)}"`);
				attrs.push(`by="${act.by}"`);
				attrs.push(`at="${isoDate(act.created_at)}"`);
				if (act.memo_text) attrs.push(`memo="${esc(act.memo_text)}"`);
				w(`          <tq:Act ${attrs.join(' ')}/>`);
			}
			w(`        </tq:NamingActs>`);
		}

		// tq: appearances on maps
		const codeAppearances = appearances.filter(
			(a: any) => a.naming_id === code.id && a.perspective_id !== code.id
		);
		if (codeAppearances.length > 0) {
			w(`        <tq:Appearances>`);
			for (const app of codeAppearances) {
				const aAttrs: string[] = [
					`perspective="${app.perspective_id}"`,
					`mode="${esc(app.mode)}"`
				];
				if (app.directed_from) aAttrs.push(`directedFrom="${app.directed_from}"`);
				if (app.directed_to) aAttrs.push(`directedTo="${app.directed_to}"`);
				if (app.valence) aAttrs.push(`valence="${esc(app.valence)}"`);
				if (app.properties && Object.keys(app.properties).length > 0) {
					aAttrs.push(`properties="${esc(JSON.stringify(app.properties))}"`);
				}
				w(`          <tq:Appearance ${aAttrs.join(' ')}/>`);
			}
			w(`        </tq:Appearances>`);
		}

		// tq: AI metadata
		const aiApp = appearances.find(
			(a: any) => a.naming_id === code.id && a.properties?.aiSuggested
		);
		if (aiApp) {
			w(`        <tq:AI suggested="true" reasoning="${esc(aiApp.properties?.aiReasoning || '')}" withdrawn="${aiApp.properties?.aiWithdrawn || false}"/>`);
		}

		w(`      </Code>`);
	}
	w(`    </Codes>`);
	w(`  </CodeBook>`);

	// Sources (Documents)
	w(`  <Sources>`);
	for (const doc of docNamings) {
		const dc = documents.find((d: any) => d.naming_id === doc.id);
		if (!dc) continue;

		const ext = dc.file_path ? dc.file_path.split('.').pop()?.toLowerCase() : 'txt';
		// Detect media type from MIME or file extension (octet-stream fallback)
		const mime = dc.mime_type || 'text/plain';
		const isImage = mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '');
		const isPdf = mime === 'application/pdf' || ext === 'pdf';
		const isAudio = mime.startsWith('audio/') || ['wav', 'mp3', 'm4a', 'ogg', 'flac', 'aac'].includes(ext || '');
		const isVideo = mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext || '');

		if (isImage) {
			w(`    <PictureSource guid="${doc.id}" name="${esc(doc.inscription)}" path="internal://${doc.id}.${ext}">`);

			// Image annotations
			const imgAnnotations = appearances.filter(
				(a: any) => a.valence === 'codes' && a.directed_to === doc.id
					&& a.properties?.anchorType === 'image_region'
			);
			for (const ann of imgAnnotations) {
				const anchor = ann.properties?.anchor;
				if (!anchor) continue;
				const selGuid = ann.naming_id;
				w(`      <PictureSelection guid="${selGuid}" name="" firstX="${anchor.x || 0}" firstY="${anchor.y || 0}" secondX="${(anchor.x || 0) + (anchor.width || 0)}" secondY="${(anchor.y || 0) + (anchor.height || 0)}">`);
				if (ann.directed_from) {
					w(`        <Coding guid="${selGuid}-coding"><CodeRef targetGUID="${ann.directed_from}"/></Coding>`);
				}
				w(`      </PictureSelection>`);
			}

			w(`    </PictureSource>`);
		} else if (isAudio) {
			w(`    <AudioSource guid="${doc.id}" name="${esc(doc.inscription)}" path="internal://${doc.id}.${ext}">`);
			w(`    </AudioSource>`);
		} else if (isVideo) {
			w(`    <VideoSource guid="${doc.id}" name="${esc(doc.inscription)}" path="internal://${doc.id}.${ext}">`);
			w(`    </VideoSource>`);
		} else if (isPdf) {
			w(`    <PDFSource guid="${doc.id}" name="${esc(doc.inscription)}" path="internal://${doc.id}.${ext}">`);
			if (dc.full_text) {
				w(`      <Representation guid="${doc.id}-repr" name="Text">`);
				// Text annotations on the PDF's text representation
				const textAnnotations = appearances.filter(
					(a: any) => a.valence === 'codes' && a.directed_to === doc.id
						&& a.properties?.anchorType === 'text'
				);
				for (const ann of textAnnotations) {
					const anchor = ann.properties?.anchor;
					if (!anchor) continue;
					const selGuid = ann.naming_id;
					w(`        <PlainTextSelection guid="${selGuid}" name="" startPosition="${anchor.pos0 || 0}" endPosition="${anchor.pos1 || 0}">`);
					if (ann.directed_from) {
						w(`          <Coding guid="${selGuid}-coding"><CodeRef targetGUID="${ann.directed_from}"/></Coding>`);
					}
					w(`        </PlainTextSelection>`);
				}
				w(`      </Representation>`);
			}
			w(`    </PDFSource>`);
		} else {
			// TextSource — use original extension for file reference, plainTextPath for the text
			const textExt = ext || 'txt';
			w(`    <TextSource guid="${doc.id}" name="${esc(doc.inscription)}" plainTextPath="internal://${doc.id}.${textExt}">`);

			// Text annotations
			const textAnnotations = appearances.filter(
				(a: any) => a.valence === 'codes' && a.directed_to === doc.id
					&& a.properties?.anchorType === 'text'
			);
			for (const ann of textAnnotations) {
				const anchor = ann.properties?.anchor;
				if (!anchor) continue;
				const selGuid = ann.naming_id;
				w(`      <PlainTextSelection guid="${selGuid}" name="" startPosition="${anchor.pos0 || 0}" endPosition="${anchor.pos1 || 0}">`);
				if (ann.directed_from) {
					w(`        <Coding guid="${selGuid}-coding"><CodeRef targetGUID="${ann.directed_from}"/></Coding>`);
				}
				w(`      </PlainTextSelection>`);
			}

			w(`    </TextSource>`);
		}
	}
	w(`  </Sources>`);

	// Notes (Memos)
	w(`  <Notes>`);
	for (const memo of memoNamings) {
		const mc = memoContents.find((m: any) => m.naming_id === memo.id);
		if (!mc) continue;
		w(`    <Note guid="${memo.id}" name="${esc(memo.inscription)}" creatingUser="${memo.created_by}" creationDateTime="${isoDate(memo.created_at)}">`);
		w(`      <PlainTextContent>${esc(mc.content)}</PlainTextContent>`);

		// tq: memo metadata
		w(`      <tq:MemoMeta status="${esc(mc.status || 'active')}" format="${esc(mc.format || 'html')}"/>`);

		w(`    </Note>`);
	}
	w(`  </Notes>`);

	// NoteRefs: link memos to codes/elements
	// (These are embedded via participations — memo participates with element)
	// We add NoteRef as child of Code elements above would be cleaner,
	// but QDPX also supports standalone Links for this.

	// Links (Relations between namings + memo links)
	w(`  <Links>`);
	for (const rel of relationNamings) {
		const part = participations.find((p: any) => p.id === rel.id);
		if (!part) continue;
		const relApp = appearances.find(
			(a: any) => a.naming_id === rel.id && a.mode === 'relation'
		);
		const direction = relApp?.valence === 'symmetric' ? 'Bidirectional' : 'Associative';
		w(`    <Link guid="${rel.id}" name="${esc(rel.inscription)}" originGUID="${part.naming_id}" targetGUID="${part.participant_id}" direction="${direction}">`);

		// tq: full relation metadata
		const acts = namingActs.filter((a: any) => a.naming_id === rel.id);
		if (acts.length > 0) {
			w(`      <tq:NamingActs>`);
			for (const act of acts) {
				const attrs: string[] = [`seq="${act.seq}"`];
				if (act.inscription) attrs.push(`inscription="${esc(act.inscription)}"`);
				if (act.designation) attrs.push(`designation="${esc(act.designation)}"`);
				attrs.push(`by="${act.by}" at="${isoDate(act.created_at)}"`);
				w(`        <tq:Act ${attrs.join(' ')}/>`);
			}
			w(`      </tq:NamingActs>`);
		}

		w(`    </Link>`);
	}

	// Memo-to-element links (participations where one side is a memo)
	const memoIds = new Set(memoNamings.map((m: any) => m.id));
	for (const part of participations) {
		const isMemoLink = memoIds.has(part.naming_id) || memoIds.has(part.participant_id);
		if (!isMemoLink) continue;
		// Skip if the participation-naming is already a relation above
		if (relationNamings.some((r: any) => r.id === part.id)) continue;
		const memoSide = memoIds.has(part.naming_id) ? part.naming_id : part.participant_id;
		const otherSide = memoSide === part.naming_id ? part.participant_id : part.naming_id;
		w(`    <Link guid="${part.id}" name="" originGUID="${memoSide}" targetGUID="${otherSide}" direction="Associative">`);
		w(`      <tq:LinkType type="memo-reference"/>`);
		w(`    </Link>`);
	}
	w(`  </Links>`);

	// Sets (DocNets)
	if (docnetNamings.length > 0) {
		w(`  <Sets>`);
		for (const dn of docnetNamings) {
			w(`    <Set guid="${dn.id}" name="${esc(dn.inscription)}">`);
			// DocNet members: participations where the docnet participates with documents
			const members = participations.filter(
				(p: any) => p.naming_id === dn.id || p.participant_id === dn.id
			);
			for (const m of members) {
				const docId = m.naming_id === dn.id ? m.participant_id : m.naming_id;
				if (documents.some((d: any) => d.naming_id === docId)) {
					w(`      <MemberSource targetGUID="${docId}"/>`);
				}
			}
			w(`    </Set>`);
		}
		w(`  </Sets>`);
	}

	// Graphs (Maps as visual representations)
	if (mapNamings.length > 0) {
		w(`  <Graphs>`);
		for (const map of mapNamings) {
			const mapApp = isMap(appearances, map.id);
			const mapType = mapApp?.properties?.mapType || 'situational';
			w(`    <Graph guid="${map.id}" name="${esc(map.inscription)}">`);
			w(`      <tq:Perspective mapType="${esc(mapType)}"/>`);

			// Get topology for positions
			const topo = topologySnapshots.find(
				(t: any) => t.map_id === map.id && t.seq === 0
			) || topologySnapshots.find(
				(t: any) => t.map_id === map.id
			);
			const positions: Record<string, { x: number; y: number }> = topo?.positions || {};

			// Elements on this map
			const mapElements = appearances.filter(
				(a: any) => a.perspective_id === map.id && a.naming_id !== map.id
					&& ['entity', 'silence', 'constellation', 'process'].includes(a.mode)
			);
			for (const el of mapElements) {
				const pos = positions[el.naming_id];
				const x = pos?.x || 0;
				const y = pos?.y || 0;
				const naming = namings.find((n: any) => n.id === el.naming_id);
				if (!naming) continue;
				const inscription = currentInscription(namingActs, naming.id, naming.inscription);
				w(`      <Vertex guid="${el.naming_id}-v" representedGUID="${el.naming_id}" name="${esc(inscription)}" firstX="${x}" firstY="${y}" secondX="${x + 120}" secondY="${y + 40}" shape="Rectangle"/>`);
			}

			// Relations on this map
			const mapRelations = appearances.filter(
				(a: any) => a.perspective_id === map.id && a.mode === 'relation'
					&& a.valence !== 'codes' && a.valence !== 'references'
			);
			for (const rel of mapRelations) {
				if (!rel.directed_from || !rel.directed_to) continue;
				const naming = namings.find((n: any) => n.id === rel.naming_id);
				if (!naming) continue;
				w(`      <Edge guid="${rel.naming_id}-e" representedGUID="${rel.naming_id}" name="${esc(naming.inscription)}" sourceVertex="${rel.directed_from}-v" targetVertex="${rel.directed_to}-v" direction="Associative"/>`);
			}

			// tq: phases
			const phases = appearances.filter(
				(a: any) => a.perspective_id === map.id && a.mode === 'perspective'
					&& a.naming_id !== map.id
			);
			if (phases.length > 0) {
				w(`      <tq:Phases>`);
				for (const phase of phases) {
					const phaseNaming = namings.find((n: any) => n.id === phase.naming_id);
					if (!phaseNaming) continue;
					const members = phaseMemberships.filter(
						(pm: any) => pm.phase_id === phase.naming_id && pm.action === 'assign'
					).filter((pm: any) => {
						// Not removed later
						const removeAfter = phaseMemberships.find(
							(pm2: any) => pm2.phase_id === pm.phase_id && pm2.naming_id === pm.naming_id
								&& pm2.action === 'remove' && pm2.seq > pm.seq
						);
						return !removeAfter;
					});
					w(`        <tq:Phase guid="${phase.naming_id}" name="${esc(phaseNaming.inscription)}">`);
					for (const m of members) {
						w(`          <tq:Member targetGUID="${m.naming_id}"/>`);
					}
					w(`        </tq:Phase>`);
				}
				w(`      </tq:Phases>`);
			}

			w(`    </Graph>`);
		}
		w(`  </Graphs>`);
	}

	// tq: Full participations table (for lossless re-import)
	w(`  <tq:Participations>`);
	for (const p of participations) {
		w(`    <tq:Participation id="${p.id}" namingId="${p.naming_id}" participantId="${p.participant_id}"/>`);
	}
	w(`  </tq:Participations>`);

	// tq: Researcher and AI naming mappings
	w(`  <tq:ResearcherNamings>`);
	for (const u of users) {
		const rn = namings.find((n: any) =>
			appearances.some((a: any) => a.naming_id === n.id && a.perspective_id === n.id
				&& a.properties?.role === 'researcher')
			&& n.created_by === u.id
		);
		if (rn) {
			w(`    <tq:ResearcherNaming userId="${u.id}" namingId="${rn.id}"/>`);
		}
	}
	w(`  </tq:ResearcherNamings>`);

	w(`</Project>`);

	return lines.join('\n');
}

// ---- ZIP packaging ----

export async function exportProject(projectId: string): Promise<Buffer> {
	const data = await fetchProjectData(projectId);
	const qde = buildQDE(data);

	// Resolve all file paths before entering the archive stream
	const resolvedDocs: Array<{ namingId: string; ext: string; absolutePath: string | null; fullText: string | null }> = [];
	for (const doc of data.documents) {
		if (doc.file_path) {
			const ext = doc.file_path.split('.').pop() || 'txt';
			const absolutePath = await resolveFilePath(projectId, doc.file_path);
			resolvedDocs.push({ namingId: doc.naming_id, ext, absolutePath, fullText: doc.full_text });
		} else if (doc.full_text) {
			resolvedDocs.push({ namingId: doc.naming_id, ext: 'txt', absolutePath: null, fullText: doc.full_text });
		}
	}

	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const writable = new Writable({
			write(chunk, _encoding, callback) {
				chunks.push(chunk);
				callback();
			}
		});

		const archive = archiver('zip', { zlib: { level: 9 } });
		archive.on('error', reject);
		writable.on('finish', () => resolve(Buffer.concat(chunks)));

		archive.pipe(writable);

		// Add the XML
		archive.append(qde, { name: 'project.qde' });

		// Add source files
		for (const doc of resolvedDocs) {
			const internalName = `Sources/${doc.namingId}.${doc.ext}`;
			if (doc.absolutePath) {
				try {
					archive.file(doc.absolutePath, { name: internalName });
				} catch {
					// File not found on disk — skip
				}
			} else if (doc.fullText) {
				archive.append(doc.fullText, { name: internalName });
			}
		}

		archive.finalize();
	});
}
