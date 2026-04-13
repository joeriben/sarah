// Tool execution: maps AI tool calls to naming acts in the data space.
// Extracted from agent.ts — now shared by all runtime entry points.

import { query, transaction } from '../../db/index.js';
import { createMemo, updateMemoContent } from '../../db/queries/memos.js';
import { assignToCluster } from '../../db/queries/maps.js';
import { emit } from '../sse.js';
import { SW_ROLE_DEFAULTS } from '$lib/shared/constants.js';
import { createAnnotation, createOrphanNaming, getOrCreateGroundingWorkspace } from '../../db/queries/codes.js';
import { designate as designateNaming } from '../../db/queries/namings.js';
import type {
	SuggestElementInput, SuggestRelationInput, IdentifySilenceInput,
	WriteMemoInput, CreateClusterInput, SuggestFormationInput,
	SuggestPositionInput, SuggestAxisRefinementInput, IdentifyEmptyRegionInput,
	RewriteCueInput, RespondInput, WithdrawCueInput, ReviseMemoInput,
	ReadDocumentInput, CodePassageInput, DesignateInput,
	SemanticSearchInput, FindOutliersInput, CrossDocumentCompareInput
} from '../tools.js';
import {
	findSimilarToElement, findSimilarToText, findOutliers, crossDocumentSimilarity
} from '../../documents/embedding-queries.js';

const AI_SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';

// ── Persona provenance ───────────────────────────────────────────
// Every AI write tags its appearances/annotations with {aiPersona, aiRunId?}
// so filters (hide by persona) and rollback (revert a run) can target them.

export type AiPersona = 'cowork' | 'autonoma';
export type WriteProvenance = { persona: AiPersona; runId?: string };

const DEFAULT_PROV: WriteProvenance = { persona: 'cowork' };

function personaLabelOf(prov: WriteProvenance): string {
	return prov.persona === 'autonoma' ? 'Autonoma' : 'Cowork';
}

export function provenanceProps(prov: WriteProvenance): Record<string, unknown> {
	return prov.runId ? { aiPersona: prov.persona, aiRunId: prov.runId } : { aiPersona: prov.persona };
}

// ── Map agent tool execution ─────────────────────────────────────

export async function executeMapTool(
	toolName: string,
	input: Record<string, unknown>,
	projectId: string,
	mapId: string,
	aiNamingId: string,
	prov: WriteProvenance = DEFAULT_PROV
): Promise<{ success: boolean; result: unknown }> {
	const personaLabel = personaLabelOf(prov);
	try {
		switch (toolName) {
			case 'suggest_element': {
				const { inscription, reasoning } = input as unknown as SuggestElementInput;
				const element = await addElementToAiMap(projectId, aiNamingId, mapId, inscription, { aiReasoning: reasoning }, prov);
				emit(mapId, 'ai:element', { element, reasoning });
				return { success: true, result: { id: element.id, inscription } };
			}

			case 'suggest_relation': {
				const { source_id, target_id, inscription, valence, symmetric, reasoning } = input as unknown as SuggestRelationInput;
				const relation = await relateElementsAsAi(projectId, aiNamingId, mapId, source_id, target_id, {
					inscription, valence, symmetric, properties: { aiReasoning: reasoning }
				}, prov);
				emit(mapId, 'ai:relation', { relation, reasoning });
				return { success: true, result: { id: relation.id, sourceId: source_id, targetId: target_id } };
			}

			case 'identify_silence': {
				const { inscription, reasoning } = input as unknown as IdentifySilenceInput;
				const silence = await addSilenceToMap(projectId, aiNamingId, mapId, inscription, { aiReasoning: reasoning }, prov);
				emit(mapId, 'ai:silence', { silence, reasoning });
				return { success: true, result: { id: silence.id, inscription } };
			}

			case 'write_memo': {
				const { title, content, linked_element_ids } = input as unknown as WriteMemoInput;
				const prefix = `${personaLabel}: `;
				const memoTitle = title.startsWith(prefix) || title.startsWith('AI:') ? title : `${prefix}${title}`;
				const memo = await createMemo(projectId, AI_SYSTEM_UUID, memoTitle, content, linked_element_ids || [], 'presented');
				emit(mapId, 'ai:memo', {
					memo, title, content,
					linkedIds: linked_element_ids || [],
					authorId: AI_SYSTEM_UUID
				});
				return { success: true, result: { id: memo.id, title } };
			}

			case 'create_cluster': {
				const { inscription, element_ids, reasoning } = input as unknown as CreateClusterInput;
				const cluster = await createClusterAsAi(projectId, aiNamingId, mapId, inscription, { aiReasoning: reasoning }, prov);
				for (const elementId of element_ids) {
					await assignToCluster(cluster.id, elementId, undefined, undefined, aiNamingId);
				}
				emit(mapId, 'ai:cluster', { cluster, elementIds: element_ids, reasoning });
				return { success: true, result: { id: cluster.id, inscription, elementCount: element_ids.length } };
			}

			case 'suggest_formation': {
				const mapRow = await query(
					`SELECT a.properties FROM appearances a
					 WHERE a.naming_id = $1 AND a.perspective_id = $1 AND a.mode = 'perspective'`,
					[mapId]
				);
				if (mapRow.rows[0]?.properties?.mapType !== 'social-worlds') {
					return { success: false, result: 'suggest_formation is only available on social-worlds maps' };
				}
				const { inscription, sw_role, reasoning } = input as unknown as SuggestFormationInput;
				const defaults = SW_ROLE_DEFAULTS[sw_role] || SW_ROLE_DEFAULTS['social-world'];
				const element = await addElementToAiMap(projectId, aiNamingId, mapId, inscription, {
					...defaults, aiReasoning: reasoning
				}, prov);
				await createMemo(projectId, AI_SYSTEM_UUID,
					`Formation: ${sw_role}`, reasoning, [element.id]);
				emit(mapId, 'ai:formation', { element, swRole: sw_role, reasoning });
				return { success: true, result: { id: element.id, inscription, swRole: sw_role } };
			}

			case 'suggest_position': {
				const { inscription, x, y, absent, reasoning } = input as unknown as SuggestPositionInput;
				const element = await addElementToAiMap(projectId, aiNamingId, mapId, inscription, {
					x: Math.max(0, Math.min(800, x)),
					y: -Math.max(0, Math.min(800, y)),
					absent: absent || false,
					aiReasoning: reasoning
				}, prov);
				emit(mapId, 'ai:element', { element, reasoning });
				return { success: true, result: { id: element.id, inscription, x, y, absent } };
			}

			case 'suggest_axis_refinement': {
				const { axis_id, new_inscription, reasoning } = input as unknown as SuggestAxisRefinementInput;
				const memoContent = `${reasoning}\n\nSuggested label: "${new_inscription}"`;
				const memo = await createMemo(projectId, AI_SYSTEM_UUID,
					`${personaLabel}: Axis refinement`, memoContent, [axis_id]);
				emit(mapId, 'ai:memo', {
					memo, title: 'AI: Axis refinement', content: memoContent,
					linkedIds: [axis_id], authorId: AI_SYSTEM_UUID
				});
				return { success: true, result: { axisId: axis_id, suggestedLabel: new_inscription } };
			}

			case 'identify_empty_region': {
				const { inscription, x, y, reasoning } = input as unknown as IdentifyEmptyRegionInput;
				const element = await addElementToAiMap(projectId, aiNamingId, mapId, inscription, {
					x: Math.max(0, Math.min(800, x)),
					y: -Math.max(0, Math.min(800, y)),
					absent: true,
					aiReasoning: reasoning
				}, prov);
				emit(mapId, 'ai:element', { element, reasoning });
				return { success: true, result: { id: element.id, inscription, x, y } };
			}

			default:
				return { success: false, result: `Unknown tool: ${toolName}` };
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, result: message };
	}
}

// ── Cue discussion tool execution ────────────────────────────────

export async function executeCueDiscussionTool(
	toolName: string,
	input: Record<string, unknown>,
	projectId: string,
	mapId: string,
	namingId: string,
	aiNamingId: string
): Promise<{ type: string; detail: unknown } | null> {
	switch (toolName) {
		case 'rewrite_cue': {
			const { new_inscription, reasoning } = input as unknown as RewriteCueInput;
			if (!new_inscription?.trim()) return null;
			await transaction(async (client) => {
				await client.query(
					`UPDATE namings SET inscription = $1 WHERE id = $2`,
					[new_inscription.trim(), namingId]
				);
				await client.query(
					`INSERT INTO naming_acts (naming_id, inscription, by)
					 VALUES ($1, $2, $3)`,
					[namingId, new_inscription.trim(), aiNamingId]
				);
			});
			await createMemo(projectId, AI_SYSTEM_UUID,
				`Discussion: rewrite`, reasoning || new_inscription, [namingId]);
			emit(mapId, 'ai:rewrite', { namingId, newInscription: new_inscription, reasoning });
			return { type: 'rewrite', detail: { newInscription: new_inscription, reasoning } };
		}
		case 'respond': {
			const { content } = input as unknown as RespondInput;
			if (!content?.trim()) return null;
			await createMemo(projectId, AI_SYSTEM_UUID,
				`Discussion: response`, content, [namingId]);
			return { type: 'respond', detail: { content } };
		}
		case 'withdraw_cue': {
			const { reasoning } = input as unknown as WithdrawCueInput;
			await query(
				`UPDATE appearances SET properties = properties || '{"aiWithdrawn": true}'::jsonb, updated_at = now()
				 WHERE naming_id = $1 AND perspective_id = $2`,
				[namingId, mapId]
			);
			await createMemo(projectId, AI_SYSTEM_UUID,
				`Discussion: withdrawn`, reasoning || '(withdrawn)', [namingId]);
			emit(mapId, 'ai:withdraw', { namingId, reasoning });
			return { type: 'withdraw', detail: { reasoning } };
		}
		default:
			return null;
	}
}

// ── Memo discussion tool execution ───────────────────────────────

export async function executeMemoDiscussionTool(
	toolName: string,
	input: Record<string, unknown>,
	projectId: string,
	mapId: string,
	memoId: string
): Promise<{ type: string; detail: unknown } | null> {
	switch (toolName) {
		case 'respond': {
			const { content } = input as unknown as RespondInput;
			if (!content?.trim()) return null;
			await createMemo(projectId, AI_SYSTEM_UUID,
				`MemoDiscussion: response`, content, [memoId]);
			return { type: 'respond', detail: { content } };
		}
		case 'revise_memo': {
			const { revised_content, reasoning } = input as unknown as ReviseMemoInput;
			if (!revised_content?.trim()) return null;
			await updateMemoContent(memoId, revised_content);
			await createMemo(projectId, AI_SYSTEM_UUID,
				`MemoDiscussion: revise`, reasoning || revised_content, [memoId]);
			emit(mapId, 'ai:memo-revised', { memoId, revised_content, reasoning });
			return { type: 'revise', detail: { revised_content, reasoning } };
		}
		default:
			return null;
	}
}

// ── Autonomous document tool execution ──────────────────────────

export async function executeAutonomousTool(
	toolName: string,
	input: Record<string, unknown>,
	projectId: string,
	mapId: string,
	aiNamingId: string,
	prov: WriteProvenance = { persona: 'autonoma' }
): Promise<{ success: boolean; result: unknown }> {
	const personaLabel = personaLabelOf(prov);
	try {
		switch (toolName) {
			case 'read_document': {
				const { document_id } = input as unknown as ReadDocumentInput;
				const doc = await query(
					`SELECT n.inscription as title, dc.full_text
					 FROM document_content dc
					 JOIN namings n ON n.id = dc.naming_id
					 WHERE dc.naming_id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
					[document_id, projectId]
				);
				if (doc.rows.length === 0) {
					return { success: false, result: 'Document not found' };
				}

				// Load structured elements (if parsed)
				const elements = await query<{
					id: string; element_type: string; content: string | null;
					parent_id: string | null; seq: number; char_start: number; char_end: number;
				}>(
					`SELECT id, element_type, content, parent_id, seq, char_start, char_end
					 FROM document_elements WHERE document_id = $1
					 ORDER BY char_start, seq`,
					[document_id]
				);

				if (elements.rows.length > 0) {
					// Format as structured text with element IDs
					const formatted = formatElementsForLLM(elements.rows);
					return { success: true, result: {
						title: doc.rows[0].title,
						structured: true,
						text: formatted
					}};
				}

				// Fallback: no elements yet (document not reparsed)
				return { success: true, result: {
					title: doc.rows[0].title,
					structured: false,
					text: doc.rows[0].full_text || '(no text content)'
				}};
			}

			case 'code_passage': {
				const { document_id, passage, code_label, reasoning } = input as unknown as CodePassageInput;
				// Strip prefix (LLM may send "S:uuid" or "P:uuid" from read_document output)
				const element_id = (input as any).element_id?.replace(/^[A-Z]\d*:/, '') || undefined;

				if (element_id) {
					// Element-based: direct UUID lookup — 100% match rate
					const el = await query<{
						id: string; content: string; char_start: number; char_end: number;
					}>(
						`SELECT e.id, e.content, e.char_start, e.char_end
						 FROM document_elements e
						 JOIN namings n ON n.id = e.document_id
						 WHERE e.id = $1 AND e.document_id = $2
						   AND n.project_id = $3 AND n.deleted_at IS NULL`,
						[element_id, document_id, projectId]
					);

					if (el.rows.length === 0) {
						return { success: false, result: `Element ${element_id} not found in document ${document_id}` };
					}

					const { char_start, char_end, content } = el.rows[0];

					// If element is a container (no content), read text from full_text via offsets
					let text = content;
					if (!text) {
						const docText = await query<{ full_text: string }>(
							`SELECT full_text FROM document_content WHERE naming_id = $1`,
							[document_id]
						);
						text = docText.rows[0]?.full_text?.slice(char_start, char_end) || '';
					}

					const anchor = { pos0: char_start, pos1: char_end, text, elementId: element_id };
					return await createCodeAndAnnotation(projectId, mapId, aiNamingId, document_id, code_label, anchor, reasoning, prov);
				}

				if (passage) {
					// Legacy fallback: text matching for unparsed documents
					const docText = await query<{ full_text: string }>(
						`SELECT dc.full_text FROM document_content dc
						 JOIN namings n ON n.id = dc.naming_id
						 WHERE dc.naming_id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
						[document_id, projectId]
					);
					if (docText.rows.length === 0) {
						return { success: false, result: 'Document not found' };
					}

					const fullText = docText.rows[0].full_text || '';
					const pos0 = fullText.indexOf(passage);
					if (pos0 === -1) {
						const normFull = fullText.replace(/\s+/g, ' ');
						const normPassage = passage.replace(/\s+/g, ' ');
						const normPos = normFull.indexOf(normPassage);
						if (normPos === -1) {
							return { success: false, result: 'Passage not found in document.' };
						}
						const origStart = mapNormalizedPosToOriginal(fullText, normPos);
						const origEnd = mapNormalizedPosToOriginal(fullText, normPos + normPassage.length);
						const anchor = { pos0: origStart, pos1: origEnd, text: fullText.slice(origStart, origEnd) };
						return await createCodeAndAnnotation(projectId, mapId, aiNamingId, document_id, code_label, anchor, reasoning, prov);
					}

					const anchor = { pos0, pos1: pos0 + passage.length, text: passage };
					return await createCodeAndAnnotation(projectId, mapId, aiNamingId, document_id, code_label, anchor, reasoning, prov);
				}

				return { success: false, result: 'Either element_id or passage is required' };
			}

			case 'designate': {
				const { naming_id, designation, reasoning } = input as unknown as DesignateInput;
				await designateNaming(naming_id, designation, aiNamingId);
				// Look up the naming inscription for a meaningful memo title
				const namingRow = await query(
					`SELECT inscription FROM namings WHERE id = $1`, [naming_id]
				);
				const namingLabel = namingRow.rows[0]?.inscription || naming_id;
				await createMemo(projectId, AI_SYSTEM_UUID,
					`${personaLabel}: "${namingLabel}" → ${designation}`, reasoning, [naming_id]);
				emit(mapId, 'ai:designate', { namingId: naming_id, designation, reasoning });
				return { success: true, result: { namingId: naming_id, designation } };
			}

			case 'semantic_search': {
				const { query: searchQuery, document_id, limit } = input as unknown as SemanticSearchInput;
				const n = Math.min(limit || 10, 30);

				// If query looks like a UUID, search by element similarity
				// Strip element prefix if present (LLM may send "S:uuid")
				const cleanQuery = searchQuery.replace(/^[A-Z]\d*:/, '');
				const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanQuery);
				const results = isUuid
					? await findSimilarToElement(cleanQuery, projectId, n, !!document_id)
					: await findSimilarToText(cleanQuery, projectId, n, document_id);

				return { success: true, result: {
					matches: results.map(r => ({
						elementId: r.id,
						documentId: r.documentId,
						document: r.documentTitle,
						content: r.content,
						similarity: Math.round(r.similarity * 1000) / 1000
					}))
				}};
			}

			case 'find_outliers': {
				const { document_id, limit } = input as unknown as FindOutliersInput;
				const results = await findOutliers(document_id, projectId, Math.min(limit || 10, 30));

				return { success: true, result: {
					outliers: results.map(r => ({
						elementId: r.id,
						content: r.content,
						distanceFromCenter: Math.round((1 - r.similarity) * 1000) / 1000
					}))
				}};
			}

			case 'cross_document_compare': {
				const { document_a_id, document_b_id, limit } = input as unknown as CrossDocumentCompareInput;
				const pairs = await crossDocumentSimilarity(
					document_a_id, document_b_id, projectId, Math.min(limit || 20, 50)
				);

				return { success: true, result: {
					pairs: pairs.map(p => ({
						elementA: { id: p.elementA.id, content: p.elementA.content },
						elementB: { id: p.elementB.id, content: p.elementB.content },
						similarity: Math.round(p.similarity * 1000) / 1000
					}))
				}};
			}

			default:
				return { success: false, result: `Unknown autonomous tool: ${toolName}` };
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, result: message };
	}
}

// Format parsed document elements into a readable structure with stable IDs for LLM consumption
function formatElementsForLLM(rows: {
	id: string; element_type: string; content: string | null;
	parent_id: string | null; seq: number; char_start: number; char_end: number;
}[]): string {
	const lines: string[] = [];
	// Build parent → children map
	const childrenOf = new Map<string | null, typeof rows>();
	for (const row of rows) {
		const key = row.parent_id;
		if (!childrenOf.has(key)) childrenOf.set(key, []);
		childrenOf.get(key)!.push(row);
	}

	// Sequential counters per type for human-readable labels
	const counters = new Map<string, number>();
	function nextLabel(type: string): string {
		const n = (counters.get(type) || 0) + 1;
		counters.set(type, n);
		const prefix = type === 'paragraph' ? 'P' : type === 'sentence' ? 'S' : type === 'heading' ? 'H' : type[0].toUpperCase();
		return `${prefix}${n}`;
	}

	function render(parentId: string | null, indent: string) {
		const children = childrenOf.get(parentId) || [];
		for (const child of children) {
			const label = nextLabel(child.element_type);
			if (child.content) {
				lines.push(`${indent}[${label}:${child.id}] ${child.content}`);
			} else {
				lines.push(`${indent}[${label}:${child.id}]`);
				render(child.id, indent + '  ');
			}
		}
	}

	render(null, '');
	return lines.join('\n');
}

// Helper: create or reuse a code naming, create annotation, place on map
async function createCodeAndAnnotation(
	projectId: string,
	mapId: string,
	aiNamingId: string,
	documentId: string,
	codeLabel: string,
	anchor: { pos0: number; pos1: number; text: string; elementId?: string },
	reasoning: string,
	prov: WriteProvenance = DEFAULT_PROV
): Promise<{ success: boolean; result: unknown }> {
	// Check if code already exists (case-insensitive)
	const existing = await query(
		`SELECT n.id FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		   AND LOWER(n.inscription) = LOWER($2)
		 LIMIT 1`,
		[projectId, codeLabel]
	);

	let codeId: string;
	let isNewCode = false;

	if (existing.rows.length > 0) {
		codeId = existing.rows[0].id;
	} else {
		// Create new code naming on grounding workspace
		const code = await createOrphanNaming(projectId, AI_SYSTEM_UUID, codeLabel, {
			description: reasoning,
			provenance: provenanceProps(prov)
		});
		codeId = code.id;
		isNewCode = true;

		// Record designation as cue (initial)
		await transaction(async (client) => {
			await client.query(
				`INSERT INTO naming_acts (naming_id, designation, by)
				 VALUES ($1, 'cue', $2)`,
				[codeId, aiNamingId]
			);
		});
	}

	// Create annotation (grounded relation: code → document with passage anchor)
	await createAnnotation(
		projectId, AI_SYSTEM_UUID, codeId, documentId,
		'text', anchor, reasoning, provenanceProps(prov)
	);

	// Place code on map if not already there
	const onMap = await query(
		`SELECT 1 FROM appearances WHERE naming_id = $1 AND perspective_id = $2 LIMIT 1`,
		[codeId, mapId]
	);
	if (onMap.rows.length === 0) {
		await query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', $3)`,
			[codeId, mapId, JSON.stringify({ aiSuggested: true, aiReasoning: reasoning, ...provenanceProps(prov) })]
		);
	}

	emit(mapId, 'ai:element', { element: { id: codeId, inscription: codeLabel }, reasoning });

	return { success: true, result: {
		codeId,
		codeLabel,
		isNewCode,
		documentId,
		passage: anchor.text.slice(0, 100),
		pos0: anchor.pos0,
		pos1: anchor.pos1
	}};
}

// ── AI-as-actor naming helpers ───────────────────────────────────

async function addElementToAiMap(
	projectId: string,
	aiNamingId: string,
	mapId: string,
	inscription: string,
	properties?: Record<string, unknown>,
	prov: WriteProvenance = DEFAULT_PROV
) {
	return transaction(async (client) => {
		// Dedup: check if a naming with the same label already exists on this map
		const existing = await client.query(
			`SELECT n.* FROM namings n
			 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = $1 AND a.mode = 'entity'
			 WHERE n.project_id = $2 AND LOWER(n.inscription) = LOWER($3) AND n.deleted_at IS NULL
			 LIMIT 1`,
			[mapId, projectId, inscription]
		);
		if (existing.rows.length > 0) {
			return existing.rows[0];
		}

		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, inscription, AI_SYSTEM_UUID]
		);
		const naming = namingRes.rows[0];

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', $3)`,
			[naming.id, mapId, JSON.stringify({ ...properties, aiSuggested: true, ...provenanceProps(prov) })]
		);

		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[naming.id, aiNamingId]
		);

		return naming;
	});
}

async function relateElementsAsAi(
	projectId: string,
	aiNamingId: string,
	mapId: string,
	sourceId: string,
	targetId: string,
	opts?: { inscription?: string; valence?: string; symmetric?: boolean; properties?: Record<string, unknown> },
	prov: WriteProvenance = DEFAULT_PROV
) {
	return transaction(async (client) => {
		const partNamingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, opts?.inscription || '', AI_SYSTEM_UUID]
		);
		const partNaming = partNamingRes.rows[0];

		await client.query(
			`INSERT INTO participations (id, naming_id, participant_id)
			 VALUES ($1, $2, $3)`,
			[partNaming.id, sourceId, targetId]
		);

		const dirFrom = opts?.symmetric ? null : sourceId;
		const dirTo = opts?.symmetric ? null : targetId;
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
			 VALUES ($1, $2, 'relation', $3, $4, $5, $6)`,
			[partNaming.id, mapId, dirFrom, dirTo, opts?.valence || null, JSON.stringify({ ...opts?.properties, aiSuggested: true, ...provenanceProps(prov) })]
		);

		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[partNaming.id, aiNamingId]
		);

		return { id: partNaming.id, sourceId, targetId, valence: opts?.valence };
	});
}

async function addSilenceToMap(
	projectId: string,
	aiNamingId: string,
	mapId: string,
	inscription: string,
	properties?: Record<string, unknown>,
	prov: WriteProvenance = DEFAULT_PROV
) {
	return transaction(async (client) => {
		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, inscription, AI_SYSTEM_UUID]
		);
		const naming = namingRes.rows[0];

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'silence', $3)`,
			[naming.id, mapId, JSON.stringify({ ...properties, aiSuggested: true, ...provenanceProps(prov) })]
		);

		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[naming.id, aiNamingId]
		);

		return naming;
	});
}

async function createClusterAsAi(
	projectId: string,
	aiNamingId: string,
	mapId: string,
	inscription: string,
	properties?: Record<string, unknown>,
	prov: WriteProvenance = DEFAULT_PROV
) {
	return transaction(async (client) => {
		const clusterRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, inscription, AI_SYSTEM_UUID]
		);
		const cluster = clusterRes.rows[0];

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $1, 'perspective', $2)`,
			[cluster.id, JSON.stringify({ parentMapId: mapId, ...properties, aiSuggested: true, ...provenanceProps(prov) })]
		);

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'perspective', $3)`,
			[cluster.id, mapId, JSON.stringify({ ...properties, aiSuggested: true, ...provenanceProps(prov) })]
		);

		await client.query(
			`INSERT INTO participations (id, naming_id, participant_id)
			 VALUES ($1, $1, $2)`,
			[cluster.id, mapId]
		);

		// Clustering IS characterizing (D/B)
		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'characterization', $2)`,
			[cluster.id, aiNamingId]
		);

		return cluster;
	});
}

// ── Map AI state ─────────────────────────────────────────────────

export async function isAiEnabled(mapId: string): Promise<boolean> {
	// Read both the map-level appearance properties and the owning project's
	// AI-modes setting in a single query. The map's readOnly flag still wins
	// (read-only maps never trigger reactive responses). Otherwise, reactive
	// Cowork is off by default and only on when the project enables it.
	const row = await query<{ map_props: Record<string, any> | null; project_props: Record<string, any> | null }>(
		`SELECT a.properties as map_props, p.properties as project_props
		 FROM appearances a
		 JOIN namings n ON n.id = a.naming_id
		 JOIN projects p ON p.id = n.project_id
		 WHERE a.naming_id = $1 AND a.perspective_id = $1 AND a.mode = 'perspective'`,
		[mapId]
	);
	if (row.rows.length === 0) return false;
	const mapProps = row.rows[0].map_props || {};
	const projectProps = row.rows[0].project_props || {};
	if (mapProps.readOnly) return false;
	return projectProps.coworkReactive === true;
}

export async function setAiEnabled(mapId: string, enabled: boolean): Promise<void> {
	await query(
		`UPDATE appearances
		 SET properties = properties || $1::jsonb, updated_at = now()
		 WHERE naming_id = $2 AND perspective_id = $2 AND mode = 'perspective'`,
		[JSON.stringify({ aiEnabled: enabled }), mapId]
	);
}

// Map a position in whitespace-normalized text back to original text
function mapNormalizedPosToOriginal(original: string, normPos: number): number {
	let origIdx = 0;
	let normIdx = 0;
	let inWhitespace = false;

	while (normIdx < normPos && origIdx < original.length) {
		if (/\s/.test(original[origIdx])) {
			if (!inWhitespace) {
				normIdx++; // one space in normalized
				inWhitespace = true;
			}
			origIdx++;
		} else {
			normIdx++;
			origIdx++;
			inWhitespace = false;
		}
	}
	return origIdx;
}
