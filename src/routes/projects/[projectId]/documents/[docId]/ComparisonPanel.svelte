<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	let {
		projectId,
		docId,
		selection,
		onannotate,
		documentTitle,
		onsimilar
	}: {
		projectId: string;
		docId: string;
		selection: { pos0: number; pos1: number; text: string } | null;
		onannotate: (codeId: string) => void;
		documentTitle?: string;
		onsimilar?: (passages: any[] | null) => void;
	} = $props();

	let loading = $state(false);
	let comparing = $state(false);
	let retrieval = $state<any>(null);
	let comparison = $state<any>(null);
	let error = $state<string | null>(null);

	// UI toggle states
	let showSimilar = $state(false);
	let scope = $state<'in-document' | 'cross-document'>('in-document');

	// Inline memo state
	let showMemoForm = $state(false);
	let memoText = $state('');
	let memoSaving = $state(false);
	let memoSaved = $state(false);
	let linkedCodeIds = $state<Set<string>>(new Set());

	// Discussion state
	let discussionHistory = $state<{ role: 'user' | 'assistant'; content: string }[]>([]);
	let discussInput = $state('');
	let discussing = $state(false);

	// Derived counts
	const similarCount = $derived(
		!retrieval ? 0 : retrieval.similarPassages.filter((sp: any) => sp.similarity >= 0.75).length
	);

	// Fetch retrieval data when selection or scope changes
	$effect(() => {
		const currentScope = scope; // explicit dependency — triggers refetch on scope change

		if (!selection || !selection.text || selection.text.length < 10) {
			retrieval = null;
			comparison = null;
			showSimilar = false;
			onsimilar?.(null);
			showMemoForm = false;
			memoSaved = false;
			linkedCodeIds = new Set();
			return;
		}

		// Reset on any change (new selection or new scope)
		comparison = null;
		showMemoForm = false;
		memoSaved = false;
		linkedCodeIds = new Set();
		discussionHistory = [];
		discussInput = '';

		const timeout = setTimeout(() => {
			fetchRetrieval(selection!.text, currentScope);
		}, 400);

		return () => clearTimeout(timeout);
	});

	async function fetchRetrieval(text: string, currentScope: string) {
		loading = true;
		error = null;
		retrieval = null;
		comparison = null;
		showSimilar = false;
		showMemoForm = false;
		memoSaved = false;

		try {
			const res = await fetch(`/api/projects/${projectId}/documents/${docId}/coding-companion`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text, compare: false, scope: currentScope })
			});

			if (!res.ok) {
				error = `Retrieval failed (${res.status})`;
				return;
			}

			const data = await res.json();
			retrieval = data.retrieval;
		} catch (e) {
			error = 'Connection error';
		} finally {
			loading = false;
		}
	}

	async function runComparison() {
		if (!selection?.text) return;
		comparing = true;
		error = null;

		try {
			const res = await fetch(`/api/projects/${projectId}/documents/${docId}/coding-companion`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: selection.text, compare: true, scope })
			});

			if (!res.ok) {
				error = `Comparison failed (${res.status})`;
				return;
			}

			const data = await res.json();
			retrieval = data.retrieval;
			comparison = data.comparison;

			// Pre-select all compared codes for memo linking
			if (comparison?.comparisons) {
				linkedCodeIds = new Set(comparison.comparisons.map((c: any) => c.codeId));
			}
		} catch (e) {
			error = 'Connection error';
		} finally {
			comparing = false;
		}
	}

	function toggleCodeLink(codeId: string) {
		const next = new Set(linkedCodeIds);
		if (next.has(codeId)) next.delete(codeId);
		else next.add(codeId);
		linkedCodeIds = next;
	}

	async function saveMemo() {
		if (!memoText.trim()) return;
		memoSaving = true;

		const passagePreview = selection?.text
			? selection.text.length > 100 ? selection.text.slice(0, 100) + '…' : selection.text
			: '';
		const docLabel = documentTitle || 'Document';

		// Build content with passage reference
		const passageRef = selection
			? `[Passage: "${passagePreview}" (pos ${selection.pos0}–${selection.pos1}, ${docLabel})]\n\n`
			: '';
		const content = passageRef + memoText.trim();

		// Label = first line or first 60 chars
		const firstLine = memoText.trim().split('\n')[0];
		const label = firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;

		try {
			const res = await fetch(`/api/projects/${projectId}/memos`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					label,
					content,
					linkedElementIds: [...linkedCodeIds]
				})
			});

			if (res.ok) {
				memoSaved = true;
				memoText = '';
				showMemoForm = false;
			} else {
				error = `Memo save failed (${res.status})`;
			}
		} catch (e) {
			error = 'Memo save failed';
		} finally {
			memoSaving = false;
		}
	}

	async function sendDiscussMessage() {
		const msg = discussInput.trim();
		if (!msg || !retrieval || !comparison) return;
		discussing = true;
		discussInput = '';
		discussionHistory = [...discussionHistory, { role: 'user' as const, content: msg }];

		try {
			const res = await fetch(`/api/projects/${projectId}/documents/${docId}/coding-companion`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					discuss: true,
					retrieval,
					comparisonResult: comparison,
					discussionHistory: discussionHistory.slice(0, -1), // exclude the just-added user message
					userMessage: msg
				})
			});

			if (res.ok) {
				const data = await res.json();
				discussionHistory = [...discussionHistory, { role: 'assistant' as const, content: data.discussion.response }];
			} else {
				discussionHistory = [...discussionHistory, { role: 'assistant' as const, content: '(Error: discussion failed)' }];
			}
		} catch {
			discussionHistory = [...discussionHistory, { role: 'assistant' as const, content: '(Connection error)' }];
		} finally {
			discussing = false;
		}
	}

	function designationBadge(d: string): string {
		switch (d) {
			case 'cue': return 'C';
			case 'characterization': return 'Ch';
			case 'specification': return 'Sp';
			default: return 'C';
		}
	}

	function designationClass(d: string): string {
		switch (d) {
			case 'characterization': return 'badge-ch';
			case 'specification': return 'badge-sp';
			default: return 'badge-c';
		}
	}
</script>

<div class="comparison-panel">
	{#if loading}
		<div class="loading">Retrieving…</div>
	{:else if error}
		<div class="error-msg">{error}</div>
	{:else if retrieval}
		<!-- Scope toggle -->
		<div class="scope-row">
			<button
				class="scope-btn"
				class:active={scope === 'in-document'}
				onclick={() => { scope = 'in-document'; }}
			>In Document</button>
			<button
				class="scope-btn"
				class:active={scope === 'cross-document'}
				onclick={() => { scope = 'cross-document'; }}
			>Cross-Document</button>
		</div>

		<!-- Action buttons -->
		<div class="action-row">
			<button
				class="action-btn"
				class:active={showSimilar}
				onclick={() => { showSimilar = !showSimilar; onsimilar?.(showSimilar ? null : (retrieval?.similarPassages || []).filter((sp: any) => sp.similarity >= 0.75)); }}
			>Similar ({similarCount})</button>
			<button
				class="action-btn compare-btn"
				onclick={runComparison}
				disabled={comparing || !!comparison}
			>{comparing ? 'Comparing…' : comparison ? 'Compare ✓' : 'Compare (LLM)'}</button>
		</div>


		<!-- LLM comparison results -->
		{#if comparison}
			{#if comparison.comparisons.length > 0}
				<div class="section-label">Comparison</div>
				{#each comparison.comparisons as comp}
					<div class="comparison-card">
						<div class="comp-header">
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<span class="comp-code clickable" role="button" tabindex="-1" onclick={() => onannotate(comp.codeId)} title="Click to annotate with this code">
								<span class="badge {designationClass(comp.designation)}">{designationBadge(comp.designation)}</span>
								{comp.codeLabel}
							</span>
						</div>
						<div class="comp-analysis">{comp.analysis}</div>
					</div>
				{/each}
			{/if}

			{#if comparison.questions.length > 0}
				<div class="section-label">Questions</div>
				<ul class="questions-list">
					{#each comparison.questions as q}
						<li>{q}</li>
					{/each}
				</ul>
			{/if}

			<!-- Discussion thread -->
			<div class="discussion-section">
				{#each discussionHistory as msg}
					<div class="discuss-msg" class:discuss-user={msg.role === 'user'} class:discuss-ai={msg.role === 'assistant'}>
						<span class="discuss-role">{msg.role === 'user' ? 'You' : 'AI'}</span>
						<span class="discuss-text">{msg.content}</span>
					</div>
				{/each}
				{#if discussing}
					<div class="discuss-msg discuss-ai">
						<span class="discuss-role">AI</span>
						<span class="discuss-text loading-dots">Thinking</span>
					</div>
				{/if}
				<form class="discuss-form" onsubmit={e => { e.preventDefault(); sendDiscussMessage(); }}>
					<input
						type="text"
						class="discuss-input"
						placeholder="Ask about this comparison..."
						bind:value={discussInput}
						disabled={discussing}
					/>
				</form>
			</div>

			<!-- Inline memo creation -->
			{#if memoSaved}
				<div class="memo-saved">Memo saved</div>
			{:else if showMemoForm}
				<div class="memo-form">
					<div class="section-label">Memo</div>
					<textarea
						class="memo-textarea"
						placeholder="Analytical note…"
						bind:value={memoText}
						rows="3"
					></textarea>
					<div class="memo-links">
						<span class="memo-links-label">Linked codes:</span>
						{#each comparison.comparisons as comp}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span
								class="memo-code-chip"
								class:selected={linkedCodeIds.has(comp.codeId)}
								onclick={() => toggleCodeLink(comp.codeId)}
							>
								<span class="badge {designationClass(comp.designation)}">{designationBadge(comp.designation)}</span>
								{comp.codeLabel}
							</span>
						{/each}
					</div>
					<div class="memo-actions">
						<button class="btn-memo-save" onclick={saveMemo} disabled={memoSaving || !memoText.trim()}>
							{memoSaving ? 'Saving…' : 'Save Memo'}
						</button>
						<button class="btn-memo-cancel" onclick={() => { showMemoForm = false; memoText = ''; }}>
							Cancel
						</button>
					</div>
				</div>
			{:else}
				<button class="btn-create-memo" onclick={() => { showMemoForm = true; }}>
					Create Memo
				</button>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.comparison-panel {
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 0.6rem;
		font-size: 0.78rem;
	}

	.loading, .error-msg, .empty-hint {
		color: #6b7280;
		font-size: 0.75rem;
		padding: 0.25rem 0;
	}
	.error-msg { color: #ef4444; }

	/* Scope toggle */
	.scope-row {
		display: flex;
		gap: 0;
		margin-bottom: 0.4rem;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		overflow: hidden;
	}
	.scope-btn {
		flex: 1;
		padding: 0.25rem 0.4rem;
		background: #0f1117;
		border: none;
		color: #6b7280;
		font-size: 0.68rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.scope-btn:first-child { border-right: 1px solid #2a2d3a; }
	.scope-btn.active {
		background: rgba(139, 156, 247, 0.12);
		color: #8b9cf7;
	}
	.scope-btn:hover:not(.active) { color: #9ca3af; }

	/* Action buttons row */
	.action-row {
		display: flex;
		gap: 0.35rem;
		margin-bottom: 0.4rem;
	}
	.action-btn {
		flex: 1;
		padding: 0.35rem 0.4rem;
		background: rgba(139, 156, 247, 0.06);
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #8b9cf7;
		font-size: 0.72rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.action-btn:hover { background: rgba(139, 156, 247, 0.15); border-color: #8b9cf7; }
	.action-btn.active { background: rgba(139, 156, 247, 0.18); border-color: #8b9cf7; }
	.action-btn:disabled { opacity: 0.5; cursor: default; }
	.compare-btn:disabled:not(:hover) { opacity: 0.5; }

	.section-label {
		font-size: 0.65rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin: 0.5rem 0 0.25rem;
	}
	.section-label:first-child { margin-top: 0; }

	/* Similar passages */
	.similar-card {
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.4rem;
		margin-bottom: 0.3rem;
	}
	.similar-codes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-bottom: 0.2rem;
	}
	.code-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.72rem;
		color: #c9cdd5;
		background: #252840;
		border: 1px solid #2a2d3a;
		border-radius: 3px;
		padding: 0.1rem 0.35rem;
	}
	.code-tag.clickable { cursor: pointer; }
	.code-tag.clickable:hover { border-color: #8b9cf7; color: #fff; }
	.similar-text {
		color: #9ca3af;
		font-style: italic;
		line-height: 1.3;
		margin-bottom: 0.15rem;
	}
	.similar-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.similar-doc {
		color: #4b5563;
		font-size: 0.68rem;
	}
	.similar-score {
		color: #6b7280;
		font-size: 0.62rem;
	}

	/* Comparison results */
	.comparison-card {
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.4rem;
		margin-bottom: 0.3rem;
	}
	.comp-header { margin-bottom: 0.2rem; }
	.comp-code {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.78rem;
		font-weight: 500;
		color: #e1e4e8;
	}
	.comp-code.clickable { cursor: pointer; }
	.comp-code.clickable:hover { color: #8b9cf7; }
	.comp-analysis {
		color: #9ca3af;
		line-height: 1.4;
	}

	/* Designation badges */
	.badge {
		display: inline-block;
		font-size: 0.6rem;
		font-weight: 600;
		padding: 0.05rem 0.25rem;
		border-radius: 3px;
		line-height: 1.2;
	}
	.badge-c { background: #374151; color: #9ca3af; }
	.badge-ch { background: #1e3a5f; color: #60a5fa; }
	.badge-sp { background: #1a3b2a; color: #4ade80; }

	/* Questions */
	.questions-list {
		margin: 0;
		padding-left: 1.2rem;
		color: #d1d5db;
		line-height: 1.5;
	}
	.questions-list li { margin-bottom: 0.2rem; }

	/* Discussion thread */
	.discussion-section {
		margin-top: 0.5rem;
		border-top: 1px solid #2a2d3a;
		padding-top: 0.4rem;
	}
	.discuss-msg {
		padding: 0.3rem 0.4rem;
		margin-bottom: 0.25rem;
		border-radius: 4px;
		font-size: 0.75rem;
		line-height: 1.4;
	}
	.discuss-user {
		background: rgba(139, 156, 247, 0.08);
		border-left: 2px solid #8b9cf7;
	}
	.discuss-ai {
		background: #1e2030;
		border-left: 2px solid #4b5563;
	}
	.discuss-role {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		color: #6b7280;
		display: block;
		margin-bottom: 0.1rem;
	}
	.discuss-text { color: #d1d5db; }
	.loading-dots::after {
		content: '...';
		animation: dots 1.2s steps(3) infinite;
	}
	@keyframes dots {
		0% { content: '.'; }
		33% { content: '..'; }
		66% { content: '...'; }
	}
	.discuss-form { margin-top: 0.3rem; }
	.discuss-input {
		width: 100%;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.35rem 0.5rem;
		color: #e1e4e8;
		font-size: 0.75rem;
		box-sizing: border-box;
	}
	.discuss-input:focus { outline: none; border-color: #8b9cf7; }
	.discuss-input:disabled { opacity: 0.5; }

	/* Create Memo button */
	.btn-create-memo {
		margin-top: 0.5rem;
		width: 100%;
		padding: 0.4rem;
		background: rgba(76, 175, 80, 0.08);
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #4ade80;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.btn-create-memo:hover { background: rgba(76, 175, 80, 0.15); border-color: #4ade80; }

	/* Memo form */
	.memo-form {
		margin-top: 0.5rem;
		padding: 0.5rem;
		background: #1e2030;
		border: 1px solid #4ade80;
		border-radius: 6px;
	}
	.memo-textarea {
		width: 100%;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.4rem;
		color: #e1e4e8;
		font-size: 0.78rem;
		font-family: system-ui, sans-serif;
		resize: vertical;
		box-sizing: border-box;
	}
	.memo-textarea:focus { outline: none; border-color: #4ade80; }

	.memo-links {
		margin-top: 0.35rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
	}
	.memo-links-label {
		font-size: 0.65rem;
		color: #6b7280;
		margin-right: 0.15rem;
	}
	.memo-code-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.68rem;
		color: #9ca3af;
		background: #252840;
		border: 1px solid #2a2d3a;
		border-radius: 3px;
		padding: 0.1rem 0.3rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.memo-code-chip.selected {
		border-color: #4ade80;
		color: #e1e4e8;
		background: rgba(76, 175, 80, 0.1);
	}
	.memo-code-chip:hover { border-color: #4ade80; }

	.memo-actions {
		display: flex;
		gap: 0.35rem;
		margin-top: 0.4rem;
	}
	.btn-memo-save {
		flex: 1;
		padding: 0.35rem;
		background: rgba(76, 175, 80, 0.12);
		border: 1px solid #4ade80;
		border-radius: 4px;
		color: #4ade80;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.btn-memo-save:hover { background: rgba(76, 175, 80, 0.2); }
	.btn-memo-save:disabled { opacity: 0.4; cursor: default; }
	.btn-memo-cancel {
		padding: 0.35rem 0.5rem;
		background: none;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #6b7280;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.btn-memo-cancel:hover { color: #e1e4e8; border-color: #6b7280; }

	.memo-saved {
		margin-top: 0.5rem;
		padding: 0.35rem;
		text-align: center;
		color: #4ade80;
		font-size: 0.75rem;
		background: rgba(76, 175, 80, 0.08);
		border: 1px solid rgba(76, 175, 80, 0.2);
		border-radius: 4px;
	}
</style>
