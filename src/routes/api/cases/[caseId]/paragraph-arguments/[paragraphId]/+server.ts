// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Liefert die Argument-Knoten und Edges eines Paragraphen für das
// Hover-Popover im Outline-Tab. Lazy gefetched pro Paragraph beim ersten
// Hover über einen §X:AY-Anker; Frontend-Cache verhindert Wiederfetches.
//
// Cross-paragraph-Edges (scope='prior_paragraph') werden in beide Richtungen
// aufgelöst — pro Edge liefert die andere Seite Paragraph-ID, arg_local_id,
// einen Claim-Snippet und (sofern auflösbar) die §-Position im Subkapitel,
// damit das Popover Beziehungen wie "wird gestützt von §3:A5" anzeigen kann.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';

interface ArgumentNodeDto {
	id: string;
	argLocalId: string;
	claim: string;
	premises: Array<{ type: 'stated' | 'carried' | 'background'; text: string }>;
	anchorPhrase: string;
	anchorCharStart: number;
	anchorCharEnd: number;
	positionInParagraph: number;
}

interface EdgeOtherSide {
	argLocalId: string;
	paragraphId: string;
	paraNumWithinChapter: number | null;
	claimSnippet: string;
}

interface EdgeDto {
	kind: 'supports' | 'refines' | 'contradicts' | 'presupposes';
	scope: 'inter_argument' | 'prior_paragraph';
	direction: 'outgoing' | 'incoming';
	selfArgLocalId: string;
	other: EdgeOtherSide;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { caseId, paragraphId } = params;
	if (!caseId || !paragraphId) error(400, 'caseId und paragraphId required');

	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) error(404, 'case not found');
	if (!caseRow.central_document_id) error(409, 'case has no central document');

	const para = await queryOne<{ document_id: string }>(
		`SELECT document_id FROM document_elements WHERE id = $1 AND element_type = 'paragraph'`,
		[paragraphId]
	);
	if (!para) error(404, 'paragraph not found');
	if (para.document_id !== caseRow.central_document_id) {
		error(403, 'paragraph does not belong to case central document');
	}

	const argRows = (
		await query<{
			id: string;
			arg_local_id: string;
			claim: string;
			premises: unknown;
			anchor_phrase: string;
			anchor_char_start: number;
			anchor_char_end: number;
			position_in_paragraph: number;
		}>(
			`SELECT id, arg_local_id, claim, premises, anchor_phrase,
			        anchor_char_start, anchor_char_end, position_in_paragraph
			 FROM argument_nodes
			 WHERE paragraph_element_id = $1
			 ORDER BY position_in_paragraph ASC`,
			[paragraphId]
		)
	).rows;

	const args: ArgumentNodeDto[] = argRows.map((r) => ({
		id: r.id,
		argLocalId: r.arg_local_id,
		claim: r.claim,
		premises: Array.isArray(r.premises)
			? (r.premises as Array<{ type: 'stated' | 'carried' | 'background'; text: string }>)
			: [],
		anchorPhrase: r.anchor_phrase,
		anchorCharStart: r.anchor_char_start,
		anchorCharEnd: r.anchor_char_end,
		positionInParagraph: r.position_in_paragraph,
	}));

	if (args.length === 0) {
		return json({ args, edges: [] satisfies EdgeDto[] });
	}

	const argIds = args.map((a) => a.id);

	// Edges, in denen ein Argument dieses Paragraphen als from_node ODER to_node auftaucht.
	// Für jede Edge brauchen wir die "andere Seite" — paragraph_id + arg_local_id +
	// Claim-Snippet — und die paragraph_seq_within_chapter (für §-Numerierung).
	//
	// paragraph_seq_within_chapter: zähle Paragraphen seit dem letzten heading mit
	// gleichem section_kind im selben document. Heuristik via window-function über
	// document_elements; gibt für jeden paragraph eine Position relativ zum
	// vorhergehenden heading. Stimmt mit dem UI-Code (paragraphsByHeading) überein,
	// solange section_kind='main'. Headings mit excluded=true filtern wir nicht
	// raus, weil die §-Numerierung im UI auch alle headings (auch excluded ggf.)
	// als Reset-Punkte nutzt — siehe +page.svelte paragraphsByHeading.
	const edgeRows = (
		await query<{
			edge_id: string;
			kind: 'supports' | 'refines' | 'contradicts' | 'presupposes';
			scope: 'inter_argument' | 'prior_paragraph';
			from_id: string;
			to_id: string;
			from_para_id: string;
			from_arg_local: string;
			from_claim: string;
			to_para_id: string;
			to_arg_local: string;
			to_claim: string;
		}>(
			`SELECT e.id AS edge_id, e.kind, e.scope,
			        e.from_node_id AS from_id, e.to_node_id AS to_id,
			        fn.paragraph_element_id AS from_para_id,
			        fn.arg_local_id AS from_arg_local,
			        fn.claim AS from_claim,
			        tn.paragraph_element_id AS to_para_id,
			        tn.arg_local_id AS to_arg_local,
			        tn.claim AS to_claim
			 FROM argument_edges e
			 JOIN argument_nodes fn ON fn.id = e.from_node_id
			 JOIN argument_nodes tn ON tn.id = e.to_node_id
			 WHERE e.from_node_id = ANY($1::uuid[]) OR e.to_node_id = ANY($1::uuid[])`,
			[argIds]
		)
	).rows;

	// Für die §-Numerierung der "anderen Seite" einer Edge: pro betroffenem
	// fremden Paragraph ein Lookup, der die Position-im-Subkapitel berechnet.
	// Wir machen das für ALLE Paragraphen, die in den Edges auftauchen.
	const otherParaIds = new Set<string>();
	for (const e of edgeRows) {
		if (e.from_para_id !== paragraphId) otherParaIds.add(e.from_para_id);
		if (e.to_para_id !== paragraphId) otherParaIds.add(e.to_para_id);
	}

	const paraNumByParaId = new Map<string, number | null>();
	if (otherParaIds.size > 0) {
		// Berechne paragraph_seq_within_chapter für jeden Paragraphen: zähle
		// alle vorhergehenden paragraphs seit dem nächsten vorangehenden heading
		// im selben document. Wir nutzen ROW_NUMBER() OVER (PARTITION BY heading_block).
		const seqRows = (
			await query<{ id: string; para_seq: number }>(
				`WITH ordered AS (
				  SELECT id, element_type, char_start, seq,
				         SUM(CASE WHEN element_type = 'heading' THEN 1 ELSE 0 END)
				           OVER (ORDER BY char_start ASC, char_end DESC, seq ASC) AS heading_block
				  FROM document_elements
				  WHERE document_id = $1
				    AND section_kind = 'main'
				), paras AS (
				  SELECT id,
				         ROW_NUMBER() OVER (PARTITION BY heading_block ORDER BY char_start ASC, seq ASC) AS para_seq
				  FROM ordered
				  WHERE element_type = 'paragraph'
				)
				SELECT id, para_seq::int FROM paras WHERE id = ANY($2::uuid[])`,
				[para.document_id, Array.from(otherParaIds)]
			)
		).rows;
		for (const r of seqRows) paraNumByParaId.set(r.id, r.para_seq);
	}

	// Auch für den eigenen paragraph: für die direction-Logik brauchen wir's nicht,
	// aber wir reichen die §-Numerierung des EIGENEN paragraphen mit (UI braucht's
	// nicht zwingend, kann aber in zukünftigen Erweiterungen helfen).
	const selfNumRow = await queryOne<{ para_seq: number }>(
		`WITH ordered AS (
		  SELECT id, element_type, char_start, char_end, seq,
		         SUM(CASE WHEN element_type = 'heading' THEN 1 ELSE 0 END)
		           OVER (ORDER BY char_start ASC, char_end DESC, seq ASC) AS heading_block
		  FROM document_elements
		  WHERE document_id = $1
		    AND section_kind = 'main'
		), paras AS (
		  SELECT id,
		         ROW_NUMBER() OVER (PARTITION BY heading_block ORDER BY char_start ASC, seq ASC) AS para_seq
		  FROM ordered
		  WHERE element_type = 'paragraph'
		)
		SELECT para_seq::int FROM paras WHERE id = $2`,
		[para.document_id, paragraphId]
	);
	const selfParaNum = selfNumRow?.para_seq ?? null;

	const SNIPPET_MAX = 140;
	function snippet(claim: string): string {
		if (claim.length <= SNIPPET_MAX) return claim;
		return claim.slice(0, SNIPPET_MAX - 1).trimEnd() + '…';
	}

	const edges: EdgeDto[] = edgeRows.map((e) => {
		const isOutgoing = argIds.includes(e.from_id);
		const direction: 'outgoing' | 'incoming' = isOutgoing ? 'outgoing' : 'incoming';
		const selfArgLocalId = isOutgoing ? e.from_arg_local : e.to_arg_local;
		const otherParaId = isOutgoing ? e.to_para_id : e.from_para_id;
		const otherArgLocalId = isOutgoing ? e.to_arg_local : e.from_arg_local;
		const otherClaim = isOutgoing ? e.to_claim : e.from_claim;
		return {
			kind: e.kind,
			scope: e.scope,
			direction,
			selfArgLocalId,
			other: {
				argLocalId: otherArgLocalId,
				paragraphId: otherParaId,
				paraNumWithinChapter: paraNumByParaId.get(otherParaId) ?? null,
				claimSnippet: snippet(otherClaim),
			},
		};
	});

	return json({
		paragraphId,
		paraNumWithinChapter: selfParaNum,
		args,
		edges,
	});
};
