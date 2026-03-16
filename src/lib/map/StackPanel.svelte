<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import { CLARKE_SW_QUESTIONS, CLARKE_ARENA_QUESTIONS, ANALYTICAL_DEEPENING } from '$lib/shared/constants.js';

	let { mode, item }: { mode: 'floating' | 'inline'; item?: any } = $props();

	const ms = getMapState();

	const stackNode = $derived(mode === 'floating' ? ms.findNode(ms.stackId!) : item);
</script>

{#if ms.stackId && ms.stackData}
	<div class={mode === 'floating' ? 'canvas-stack-panel' : 'history-panel'}>
		{#if mode === 'floating'}
			<div class="stack-panel-header">
				<span class="stack-title">{stackNode?.inscription || '(unnamed)'}</span>
				<button class="btn-link" onclick={() => { ms.stackId = null; ms.stackData = null; }}>close</button>
			</div>
		{/if}
		{#if stackNode?.is_collapsed}
			<button class="btn-xs btn-unpin" onclick={() => ms.unpinLayer(ms.stackId!)}>
				unpin (show latest)
			</button>
		{/if}
		{#if ms.stackData.inscriptions.length > 1}
			<div class="history-section">
				<span class="history-label">Inscriptions</span>
				{#each ms.stackData.inscriptions as hi}
					<div class="history-entry" class:pinned-layer={stackNode?.is_collapsed && stackNode?.properties?.collapseAt === hi.seq}>
						<span class="he-value">{hi.inscription}</span>
						<span class="he-by">{hi.by_inscription}</span>
						<span class="he-date">{new Date(hi.created_at).toLocaleString()}</span>
						<button class="btn-xs btn-pin" title="Pin to this layer" onclick={() => ms.pinToLayer(ms.stackId!, hi.seq)}>
							pin
						</button>
					</div>
				{/each}
			</div>
		{/if}
		<div class="history-section">
			<span class="history-label">Designations</span>
			{#each ms.stackData.designations as hd}
				<div class="history-entry">
					<span class="designation-dot-sm" style="background: {ms.designationColor(hd.designation)}"></span>
					<span class="he-value">{hd.designation}</span>
					<span class="he-by">{hd.by_inscription}</span>
					<span class="he-date">{new Date(hd.created_at).toLocaleString()}</span>
				</div>
			{/each}
		</div>
		{#if ms.stackData.memos?.length > 0}
			<div class="history-section">
				<span class="history-label">Memos ({ms.stackData.memos.length})</span>
				{#each ms.stackData.memos as memo}
					<div class="memo-entry" class:memo-ai={memo.isAiAuthored} class:memo-dismissed={memo.status === 'dismissed'}>
						<div class="memo-entry-header">
							<span class="memo-author-badge" class:badge-ai={memo.isAiAuthored}>
								{memo.isAiAuthored ? 'AI' : 'R'}
							</span>
							{#if memo.status && memo.status !== 'active'}
								<span class="memo-status-badge status-{memo.status}">{memo.status}</span>
							{/if}
							<span class="memo-label">{memo.label}</span>
							<span class="he-date">{new Date(memo.created_at).toLocaleString()}</span>
						</div>
						<span class="memo-content">{memo.content}</span>
						<div class="memo-actions">
							{#if memo.status === 'presented' || memo.status === 'discussed'}
								<button class="btn-xs" onclick={() => ms.updateMemoStatus(memo.id, 'acknowledged')}>ack</button>
								<button class="btn-xs" onclick={() => ms.updateMemoStatus(memo.id, 'dismissed')}>dismiss</button>
								<button class="btn-xs btn-promote" onclick={() => ms.promoteMemo(memo.id)}>promote</button>
							{/if}
							{#if memo.status === 'dismissed'}
								<button class="btn-xs" onclick={() => ms.updateMemoStatus(memo.id, 'presented')}>restore</button>
							{/if}
							{#if ms.memoDiscussTarget === memo.id}
								<form class="discuss-form" onsubmit={e => { e.preventDefault(); ms.submitMemoDiscussion(memo.id); }}>
									<input type="text" placeholder="Discuss this memo..." bind:value={ms.memoDiscussInput} disabled={ms.memoDiscussLoading} />
									<button type="submit" class="btn-xs" disabled={ms.memoDiscussLoading || !ms.memoDiscussInput.trim()}>
										{ms.memoDiscussLoading ? '...' : 'send'}
									</button>
								</form>
							{:else if memo.status !== 'dismissed'}
								<button class="btn-xs btn-discuss" onclick={() => { ms.memoDiscussTarget = memo.id; ms.memoDiscussInput = ''; }}>discuss</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
		{#if ms.stackData.aiSuggested}
			<div class="history-section ai-discussion-section">
				<span class="history-label">
					<img class="label-icon" src="/icons/comment.svg" alt="" />
					AI Cue {ms.stackData.aiWithdrawn ? '(withdrawn)' : ''}
				</span>
				{#if ms.stackData.aiReasoning}
					<div class="ai-reasoning">{ms.stackData.aiReasoning}</div>
				{/if}
				{#if ms.stackData.discussion && ms.stackData.discussion.length > 0}
					<div class="discussion-thread">
						{#each ms.stackData.discussion as turn}
							<div class="discussion-turn" class:turn-researcher={turn.role === 'researcher'} class:turn-ai={turn.role === 'ai'}>
								<span class="turn-role">{turn.role === 'researcher' ? 'You' : 'AI'}{turn.type === 'rewrite' ? ' (rewrote)' : turn.type === 'withdrawn' ? ' (withdrew)' : ''}</span>
								<span class="turn-content">{turn.content}</span>
							</div>
						{/each}
					</div>
				{/if}
				{#if !ms.stackData.aiWithdrawn}
					<form class="discuss-form" onsubmit={e => { e.preventDefault(); ms.submitDiscussion(); }}>
						<input type="text" placeholder="Discuss this cue..." bind:value={ms.discussInput} disabled={ms.discussLoading} />
						<button type="submit" class="btn-xs" disabled={ms.discussLoading || !ms.discussInput.trim()}>
							{ms.discussLoading ? '...' : 'send'}
						</button>
					</form>
				{/if}
			</div>
		{/if}
		{#if stackNode?.sw_role}
			{@const swRole = stackNode.sw_role as string}
			{@const questions = swRole === 'arena' ? CLARKE_ARENA_QUESTIONS
				: (swRole === 'social-world' || swRole === 'discourse' || swRole === 'organization') ? CLARKE_SW_QUESTIONS
				: []}
			{#if questions.length > 0}
				<div class="history-section analytical-questions">
					<details>
						<summary class="history-label">
							Analytical Questions ({swRole})
							{#if ms.stackData.memos?.length}
								<span class="aq-depth">{ms.stackData.memos.length} memo{ms.stackData.memos.length !== 1 ? 's' : ''}</span>
							{/if}
						</summary>
						<ol class="aq-list">
							{#each questions as q}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
								<li class="aq-item aq-clickable" onclick={() => { ms.clarkeFormOpen = true; ms.clarkeFormQuestion = q; ms.clarkeFormContent = ''; }}>{q}</li>
							{/each}
						</ol>
						<div class="aq-deepening">
							<span class="aq-deepening-label">Deepening moments</span>
							{#each ANALYTICAL_DEEPENING as d}
								<div class="aq-deepening-item">
									<span class="aq-deepening-key">{d.label}</span>
									<span class="aq-deepening-q">{d.question}</span>
								</div>
							{/each}
						</div>
					</details>
					{#if ms.clarkeFormOpen}
						<div class="clarke-memo-form">
							<div class="clarke-form-header">
								<span class="clarke-form-q">{ms.clarkeFormQuestion}</span>
								<button class="btn-link" onclick={() => { ms.clarkeFormOpen = false; }}>cancel</button>
							</div>
							<textarea placeholder="Your analytical reflection on this question..." bind:value={ms.clarkeFormContent} rows="3"></textarea>
							<button class="btn-xs" disabled={!ms.clarkeFormContent.trim()} onclick={() => ms.createClarkeQuestionMemo(ms.clarkeFormQuestion, ms.clarkeFormContent)}>
								Save memo
							</button>
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</div>
{/if}

<style>
	/* Floating (canvas) */
	.canvas-stack-panel {
		position: absolute; top: 0.75rem; right: 0.75rem;
		width: 320px; max-height: calc(100% - 1.5rem);
		overflow-y: auto;
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 0.75rem; z-index: 20;
		box-shadow: 0 4px 12px rgba(0,0,0,0.4);
	}
	.stack-panel-header {
		display: flex; align-items: center; justify-content: space-between;
		margin-bottom: 0.5rem;
	}
	.stack-title { font-size: 0.9rem; font-weight: 600; color: #e1e4e8; }

	/* Inline (list) */
	.history-panel {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.6rem 0.75rem; margin-top: -0.1rem; margin-bottom: 0.2rem;
	}

	/* Shared */
	.history-section { margin-bottom: 0.4rem; }
	.history-section:last-child { margin-bottom: 0; }
	.history-label {
		font-size: 0.65rem; color: #6b7280; text-transform: uppercase;
		letter-spacing: 0.04em; display: block; margin-bottom: 0.2rem;
	}
	.history-entry {
		display: flex; align-items: center; gap: 0.4rem;
		font-size: 0.75rem; color: #8b8fa3; padding: 0.1rem 0;
	}
	.he-value { color: #c9cdd5; }
	.he-by { color: #6b7280; }
	.he-by::before { content: '— '; }
	.he-date { color: #4b5563; margin-left: auto; font-size: 0.7rem; }
	.designation-dot-sm { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }

	/* Memo entries */
	.memo-entry {
		padding: 0.3rem 0; border-bottom: 1px solid #1e2030;
		font-size: 0.75rem;
	}
	.memo-entry:last-child { border-bottom: none; }
	.memo-entry-header { display: flex; align-items: center; gap: 0.4rem; }
	.memo-author-badge {
		font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
		background: rgba(107, 114, 128, 0.2); color: #9ca3af;
		padding: 0.05rem 0.3rem; border-radius: 3px; flex-shrink: 0;
	}
	.memo-author-badge.badge-ai { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.memo-label { color: #f59e0b; font-size: 0.72rem; display: block; }
	.memo-content {
		display: block; color: #a0a4b0; font-size: 0.75rem;
		margin-top: 0.15rem; white-space: pre-wrap;
		max-height: 4.5em; overflow-y: auto;
	}
	.memo-entry.memo-ai {
		border-left: 2px solid rgba(139, 156, 247, 0.3);
		padding-left: 0.4rem;
	}

	/* Memo status */
	.memo-status-badge {
		font-size: 0.58rem; font-weight: 600; text-transform: uppercase;
		padding: 0.05rem 0.3rem; border-radius: 3px; flex-shrink: 0;
	}
	.status-presented { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.status-discussed { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
	.status-acknowledged { background: rgba(16, 185, 129, 0.15); color: #10b981; }
	.status-promoted { background: rgba(16, 185, 129, 0.25); color: #10b981; }
	.status-dismissed { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
	.memo-dismissed { opacity: 0.5; }
	.memo-actions { display: flex; gap: 0.3rem; margin-top: 0.25rem; flex-wrap: wrap; align-items: center; }
	.btn-promote { border-color: #10b981; color: #10b981; }
	.btn-promote:hover { background: rgba(16, 185, 129, 0.1); }

	/* Pin/unpin */
	.btn-pin { margin-left: auto; border-color: #f59e0b; color: #f59e0b; }
	.btn-pin:hover { background: rgba(245, 158, 11, 0.1); }
	.btn-unpin { border-color: #f59e0b; color: #f59e0b; margin-bottom: 0.4rem; }
	.btn-unpin:hover { background: rgba(245, 158, 11, 0.1); }
	.pinned-layer { background: rgba(245, 158, 11, 0.1); border-radius: 3px; padding: 0.1rem 0.3rem; }

	/* AI discussion */
	.ai-discussion-section {
		border-top: 1px solid rgba(139, 156, 247, 0.2);
		padding-top: 0.5rem; margin-top: 0.3rem;
	}
	.label-icon { width: 14px; height: 14px; vertical-align: middle; margin-right: 0.2rem; opacity: 0.7; }
	.ai-reasoning {
		font-size: 0.75rem; color: #8b9cf7; font-style: italic;
		padding: 0.3rem 0.5rem; margin: 0.2rem 0;
		background: rgba(139, 156, 247, 0.06); border-radius: 4px;
		border-left: 2px solid rgba(139, 156, 247, 0.3);
	}
	.discussion-thread { margin: 0.3rem 0; }
	.discussion-turn {
		padding: 0.25rem 0.4rem; margin: 0.15rem 0;
		border-radius: 4px; font-size: 0.75rem;
	}
	.turn-researcher { background: rgba(245, 158, 11, 0.08); border-left: 2px solid rgba(245, 158, 11, 0.4); }
	.turn-ai { background: rgba(139, 156, 247, 0.06); border-left: 2px solid rgba(139, 156, 247, 0.3); }
	.turn-role { font-size: 0.68rem; font-weight: 600; display: block; margin-bottom: 0.1rem; }
	.turn-researcher .turn-role { color: #f59e0b; }
	.turn-ai .turn-role { color: #8b9cf7; }
	.turn-content { color: #c9cdd5; display: block; white-space: pre-wrap; }

	/* Discuss form */
	.discuss-form { display: flex; gap: 0.3rem; margin-top: 0.3rem; }
	.discuss-form input {
		flex: 1; background: #0f1117; border: 1px solid #2a2d3a;
		border-radius: 4px; padding: 0.3rem 0.5rem;
		color: #c9cdd5; font-size: 0.75rem;
	}
	.discuss-form input:focus { border-color: #8b9cf7; outline: none; }
	.discuss-form button { border-color: #8b9cf7; color: #8b9cf7; }
	.discuss-form button:hover:not(:disabled) { background: rgba(139, 156, 247, 0.1); }
	.discuss-form button:disabled { opacity: 0.4; }
	.btn-discuss { margin-top: 0.25rem; color: #8b9cf7; font-size: 0.7rem; }

	/* Analytical questions */
	.analytical-questions details { cursor: pointer; }
	.analytical-questions summary { list-style: none; }
	.analytical-questions summary::-webkit-details-marker { display: none; }
	.analytical-questions summary::before { content: '▸ '; color: #6b7280; }
	.analytical-questions details[open] summary::before { content: '▾ '; }
	.aq-depth { margin-left: 0.3rem; color: #8b9cf7; font-size: 0.6rem; }
	.aq-list {
		margin: 0.3rem 0 0 0; padding-left: 1.2rem;
		font-size: 0.72rem; color: #c9cdd5; line-height: 1.5;
	}
	.aq-item { margin-bottom: 0.15rem; }
	.aq-deepening { margin-top: 0.4rem; border-top: 1px solid #1e2130; padding-top: 0.3rem; }
	.aq-deepening-label {
		font-size: 0.6rem; color: #6b7280; text-transform: uppercase;
		letter-spacing: 0.04em; display: block; margin-bottom: 0.2rem;
	}
	.aq-deepening-item { margin-bottom: 0.2rem; }
	.aq-deepening-key { font-size: 0.7rem; font-weight: 600; color: #e1b54a; display: block; }
	.aq-deepening-q { font-size: 0.7rem; color: #9ca3af; }

	/* Clarke question -> memo */
	.aq-clickable { cursor: pointer; border-radius: 3px; padding: 0.1rem 0.2rem; margin: 0 -0.2rem; }
	.aq-clickable:hover { background: rgba(139, 156, 247, 0.1); }
	.clarke-memo-form {
		margin-top: 0.5rem; padding: 0.5rem;
		background: rgba(139, 156, 247, 0.04); border: 1px solid rgba(139, 156, 247, 0.15);
		border-radius: 6px;
	}
	.clarke-form-header { display: flex; align-items: flex-start; gap: 0.4rem; margin-bottom: 0.4rem; }
	.clarke-form-q { font-size: 0.75rem; color: #c9cdd5; font-style: italic; flex: 1; }
	.clarke-memo-form textarea {
		width: 100%; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		padding: 0.4rem 0.5rem; color: #c9cdd5; font-size: 0.78rem; resize: vertical;
		font-family: inherit;
	}
	.clarke-memo-form textarea:focus { border-color: #8b9cf7; outline: none; }
	.clarke-memo-form > .btn-xs { margin-top: 0.3rem; }

	/* Shared button styles */
	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
	}
	.btn-xs:hover { border-color: #8b9cf7; }
	.btn-link {
		background: none; border: none; color: #8b9cf7; cursor: pointer;
		font-size: 0.8rem; text-decoration: underline;
	}
</style>
