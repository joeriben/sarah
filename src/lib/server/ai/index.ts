import { chat, getModel } from './client.js';
import { query } from '../db/index.js';

export async function suggestCodes(
	projectId: string,
	passage: string,
	existingCodes: { label: string; description?: string }[]
) {
	const codeList = existingCodes.map(c => `- ${c.label}${c.description ? ': ' + c.description : ''}`).join('\n');

	const response = await chat({
		maxTokens: 1024,
		messages: [{
			role: 'user',
			content: `You are assisting a qualitative researcher doing Situational Analysis (Adele Clarke). The researcher is coding a text passage.

Existing codes:
${codeList || '(none yet)'}

Text passage to code:
"""
${passage}
"""

Suggest 2-5 codes for this passage. For each code:
1. If an existing code fits, use it exactly
2. If a new code is needed, suggest one with a short label

Respond in JSON format:
[{"code": "code label", "existing": true/false, "reasoning": "brief explanation"}]`
		}]
	});

	return {
		suggestions: response.text,
		model: response.model,
		tokensUsed: response.tokensUsed
	};
}

export async function summarizeDocument(text: string, maxLength: number = 500) {
	const response = await chat({
		maxTokens: 1024,
		messages: [{
			role: 'user',
			content: `Summarize the following document for a qualitative researcher doing Situational Analysis. Focus on identifying key actors (human and nonhuman), discursive constructions, and the situation described. Keep it under ${maxLength} words.

Document:
"""
${text.slice(0, 8000)}
"""`
		}]
	});

	return {
		summary: response.text,
		model: response.model,
		tokensUsed: response.tokensUsed
	};
}

export async function findPatterns(
	items: { label: string; kind: string; properties?: Record<string, unknown> }[]
) {
	const itemList = items.map(i => `- [${i.kind}] ${i.label}`).join('\n');

	const response = await chat({
		maxTokens: 1500,
		messages: [{
			role: 'user',
			content: `You are assisting a qualitative researcher doing Situational Analysis (Adele Clarke). Analyze the following elements from their project and identify patterns, clusters, contradictions, or silences (what is notably absent).

Elements:
${itemList}

Provide your analysis structured as:
1. **Clusters**: Groups of related elements
2. **Tensions/Contradictions**: Elements that seem to conflict
3. **Silences**: What seems notably absent given the situation
4. **Suggested relations**: Connections worth investigating`
		}]
	});

	return {
		analysis: response.text,
		model: response.model,
		tokensUsed: response.tokensUsed
	};
}

export async function assistMemo(
	memoContent: string,
	linkedElements: { label: string; kind: string }[]
) {
	const links = linkedElements.map(e => `- [${e.kind}] ${e.label}`).join('\n');

	const response = await chat({
		maxTokens: 1500,
		messages: [{
			role: 'user',
			content: `You are assisting a qualitative researcher doing Situational Analysis (Adele Clarke). They are writing an analytical memo.

Current memo content:
"""
${memoContent || '(empty)'}
"""

Linked elements:
${links || '(none)'}

Provide:
1. **Analytical questions** the researcher might explore
2. **Theoretical connections** to situational analysis concepts (social worlds, arenas, implicated actors, discursive constructions)
3. **Suggestions** for deepening the analysis`
		}]
	});

	return {
		assistance: response.text,
		model: response.model,
		tokensUsed: response.tokensUsed
	};
}

export async function logInteraction(
	projectId: string,
	requestType: string,
	model: string,
	inputContext: Record<string, unknown>,
	response: Record<string, unknown>,
	tokensUsed: number
) {
	await query(
		`INSERT INTO ai_interactions (project_id, request_type, model, input_context, response, tokens_used)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		[projectId, requestType, model, JSON.stringify(inputContext), JSON.stringify(response), tokensUsed]
	);
}
