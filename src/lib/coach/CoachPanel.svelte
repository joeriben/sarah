<script lang="ts">
	import { page } from '$app/stores';
	import { marked } from 'marked';
	import { getCoachState } from './coachState.svelte.js';

	const coach = getCoachState();

	let inputText = $state('');
	let messagesEl: HTMLDivElement | undefined = $state();

	// Resize state
	let panelWidth = $state(380);
	let panelHeight = $state(500);
	let resizing = $state(false);

	// Configure marked for safe, compact output
	marked.setOptions({ breaks: true, gfm: true });

	function renderMarkdown(text: string): string {
		return marked.parse(text, { async: false }) as string;
	}

	// Derive current page and mapId from route
	const currentPage = $derived.by(() => {
		const path = $page.url.pathname;
		const match = path.match(/\/projects\/[^/]+\/(.+)/);
		return match ? match[1] : 'project';
	});

	const currentMapId = $derived.by(() => {
		const match = $page.url.pathname.match(/\/maps\/([^/]+)/);
		return match ? match[1] : undefined;
	});

	// Auto-scroll to bottom on new messages
	$effect(() => {
		void coach.messages.length;
		if (messagesEl) {
			requestAnimationFrame(() => {
				messagesEl!.scrollTop = messagesEl!.scrollHeight;
			});
		}
	});

	function handleSend() {
		const text = inputText.trim();
		if (!text || coach.loading) return;
		inputText = '';
		coach.send(text, currentPage, currentMapId);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}

	function copyDialog() {
		const text = coach.messages
			.map(m => `${m.role === 'user' ? 'Researcher' : 'Coach'}:\n${m.content}`)
			.join('\n\n---\n\n');
		navigator.clipboard.writeText(text);
	}

	// Resize via top-left corner drag
	function startResize(e: PointerEvent) {
		e.preventDefault();
		resizing = true;
		const startX = e.clientX;
		const startY = e.clientY;
		const startW = panelWidth;
		const startH = panelHeight;

		function onMove(ev: PointerEvent) {
			panelWidth = Math.max(300, Math.min(800, startW - (ev.clientX - startX)));
			panelHeight = Math.max(300, Math.min(900, startH - (ev.clientY - startY)));
		}
		function onUp() {
			resizing = false;
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		}
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}
</script>

{#if coach.isOpen}
	<div
		class="coach-panel"
		class:resizing
		style="width: {panelWidth}px; height: {panelHeight}px;"
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="resize-handle" onpointerdown={startResize}></div>

		<div class="coach-header">
			<span class="coach-title">Coach</span>
			<div class="coach-header-actions">
				{#if coach.messages.length > 0}
					<button class="coach-btn-sm" onclick={copyDialog} title="Copy dialog to clipboard">copy</button>
					<button class="coach-btn-sm" onclick={() => coach.clear()} title="Clear conversation">clear</button>
				{/if}
				<button class="coach-btn-sm" onclick={() => coach.isOpen = false} title="Close">&times;</button>
			</div>
		</div>

		<div class="coach-messages" bind:this={messagesEl}>
			{#if coach.messages.length === 0}
				<div class="coach-welcome">
					<p class="coach-welcome-name">Coach</p>
					<p class="coach-welcome-text">Ich helfe dir, Situational Analysis zu verstehen und anzuwenden. Frag mich zur Methodik, zum CCS-Gradienten, zu Map-Typen oder zu deinem aktuellen Projektstand.</p>
				</div>
			{/if}
			{#each coach.messages as msg}
				<div class="coach-msg" class:msg-user={msg.role === 'user'} class:msg-assistant={msg.role === 'assistant'}>
					{#if msg.role === 'assistant'}
						<span class="msg-label">Coach</span>
					{/if}
					{#if msg.role === 'assistant'}
						<div class="msg-content msg-md">{@html renderMarkdown(msg.content)}</div>
					{:else}
						<div class="msg-content">{msg.content}</div>
					{/if}
				</div>
			{/each}
			{#if coach.loading}
				<div class="coach-msg msg-assistant">
					<span class="msg-label">Coach</span>
					<div class="msg-content msg-loading">...</div>
				</div>
			{/if}
			{#if coach.error}
				<div class="coach-error">{coach.error}</div>
			{/if}
		</div>

		<div class="coach-input">
			<textarea
				bind:value={inputText}
				onkeydown={handleKeydown}
				placeholder="Ask the coach..."
				rows="2"
				disabled={coach.loading}
			></textarea>
			<button class="coach-send" onclick={handleSend} disabled={coach.loading || !inputText.trim()} title="Send">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
			</button>
		</div>
	</div>
{/if}

<style>
	.coach-panel {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		max-width: calc(100vw - 2rem);
		max-height: calc(100vh - 4rem);
		background: #13151e;
		border: 1px solid #2a2d3a;
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		z-index: 900;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}

	/* Mobile: full-width */
	@media (max-width: 640px) {
		.coach-panel {
			bottom: 0;
			right: 0;
			width: 100vw !important;
			height: 70vh !important;
			border-radius: 10px 10px 0 0;
			max-width: 100vw;
			max-height: 100vh;
		}
	}

	.resizing {
		user-select: none;
	}

	/* Resize handle: top-left corner */
	.resize-handle {
		position: absolute;
		top: 0;
		left: 0;
		width: 16px;
		height: 16px;
		cursor: nw-resize;
		z-index: 2;
	}
	.resize-handle::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 8px;
		height: 8px;
		border-top: 2px solid #4b5563;
		border-left: 2px solid #4b5563;
		border-radius: 2px 0 0 0;
	}
	.resize-handle:hover::after {
		border-color: #a5b4fc;
	}

	.coach-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.6rem 0.8rem;
		border-bottom: 1px solid #2a2d3a;
		background: #0f1117;
		flex-shrink: 0;
	}

	.coach-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #a5b4fc;
		letter-spacing: -0.01em;
	}

	.coach-header-actions {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}

	.coach-btn-sm {
		background: none;
		border: none;
		color: #6b7280;
		font-size: 0.75rem;
		cursor: pointer;
		padding: 0.15rem 0.3rem;
		border-radius: 3px;
	}
	.coach-btn-sm:hover {
		color: #e1e4e8;
		background: rgba(255, 255, 255, 0.05);
	}

	.coach-messages {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.coach-welcome {
		text-align: center;
		padding: 1.5rem 0.5rem;
		color: #6b7280;
	}

	.coach-welcome-name {
		font-size: 1.1rem;
		font-weight: 600;
		color: #a5b4fc;
		margin-bottom: 0.5rem;
	}

	.coach-welcome-text {
		font-size: 0.8rem;
		line-height: 1.5;
	}

	.coach-msg {
		display: flex;
		flex-direction: column;
		max-width: 92%;
	}

	.msg-user {
		align-self: flex-end;
	}

	.msg-assistant {
		align-self: flex-start;
	}

	.msg-label {
		font-size: 0.65rem;
		color: #a5b4fc;
		margin-bottom: 0.15rem;
		font-weight: 600;
	}

	.msg-content {
		font-size: 0.82rem;
		line-height: 1.5;
		padding: 0.5rem 0.7rem;
		border-radius: 8px;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.msg-user .msg-content {
		background: #1e2030;
		color: #e1e4e8;
		border-bottom-right-radius: 2px;
	}

	.msg-assistant .msg-content {
		background: #181a24;
		color: #c9cdd5;
		border: 1px solid #2a2d3a;
		border-bottom-left-radius: 2px;
	}

	/* Markdown content styling */
	.msg-md {
		white-space: normal;
	}
	.msg-md :global(p) {
		margin: 0 0 0.4em;
	}
	.msg-md :global(p:last-child) {
		margin-bottom: 0;
	}
	.msg-md :global(strong) {
		color: #e1e4e8;
		font-weight: 600;
	}
	.msg-md :global(em) {
		color: #b4bcd0;
	}
	.msg-md :global(h1), .msg-md :global(h2), .msg-md :global(h3) {
		font-size: 0.88rem;
		font-weight: 600;
		color: #e1e4e8;
		margin: 0.6em 0 0.3em;
	}
	.msg-md :global(h1:first-child), .msg-md :global(h2:first-child), .msg-md :global(h3:first-child) {
		margin-top: 0;
	}
	.msg-md :global(ul), .msg-md :global(ol) {
		padding-left: 1.2em;
		margin: 0.3em 0;
	}
	.msg-md :global(li) {
		margin: 0.15em 0;
	}
	.msg-md :global(code) {
		background: rgba(255, 255, 255, 0.06);
		padding: 0.1em 0.3em;
		border-radius: 3px;
		font-size: 0.78rem;
	}
	.msg-md :global(blockquote) {
		border-left: 2px solid #a5b4fc;
		padding-left: 0.6em;
		margin: 0.4em 0;
		color: #8b8fa3;
	}
	.msg-md :global(hr) {
		border: none;
		border-top: 1px solid #2a2d3a;
		margin: 0.5em 0;
	}

	.msg-loading {
		color: #6b7280;
		font-style: italic;
	}

	.coach-error {
		font-size: 0.75rem;
		color: #ef4444;
		padding: 0.3rem 0.5rem;
		background: rgba(239, 68, 68, 0.1);
		border-radius: 4px;
	}

	.coach-input {
		display: flex;
		gap: 0.4rem;
		padding: 0.5rem 0.6rem;
		border-top: 1px solid #2a2d3a;
		background: #0f1117;
		flex-shrink: 0;
		align-items: flex-end;
	}

	.coach-input textarea {
		flex: 1;
		background: #1a1d2a;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		color: #e1e4e8;
		font-size: 0.82rem;
		padding: 0.45rem 0.6rem;
		resize: none;
		font-family: inherit;
		line-height: 1.4;
	}
	.coach-input textarea:focus {
		outline: none;
		border-color: #a5b4fc;
	}
	.coach-input textarea::placeholder {
		color: #4b5563;
	}

	.coach-send {
		background: #a5b4fc;
		border: none;
		border-radius: 6px;
		color: #0f1117;
		width: 32px;
		height: 32px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.coach-send:hover:not(:disabled) {
		background: #8b9cf7;
	}
	.coach-send:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
