<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';
	import CoachPanel from '$lib/coach/CoachPanel.svelte';
	import { createCoachState, setCoachState } from '$lib/coach/coachState.svelte.js';

	let { data, children }: { data: any; children: Snippet } = $props();
	const p = $derived(data.project);
	const c = $derived(data.counts);
	const base = $derived(`/projects/${p.id}`);
	const mapsByType = $derived(data.mapsByType as Record<string, { id: string; label: string; isPrimary?: boolean }[]>);
	const documents = $derived(data.documents as { id: string; label: string }[]);
	const pathname = $derived($page.url.pathname);

	// Inline doc rename
	let renamingDocId = $state<string | null>(null);
	let renameValue = $state('');

	async function saveDocRename(docId: string) {
		if (!renameValue.trim()) { renamingDocId = null; return; }
		const res = await fetch(`/api/projects/${p.id}/documents/${docId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ label: renameValue.trim() })
		});
		if (res.ok) {
			const d = documents.find(d => d.id === docId);
			if (d) d.label = renameValue.trim();
		}
		renamingDocId = null;
	}

	// Coach: didactic AI persona
	const coach = createCoachState(p.id);
	setCoachState(coach);

	// Cowork: on-demand co-researcher on the current map.
	// Visible only when a map is open. The map's reactive-mode toggle
	// (auto-respond to researcher acts) is configured per-project in Settings;
	// the Cowork button is on-demand and runs regardless of that setting.
	const currentMapId = $derived.by(() => {
		const m = pathname.match(new RegExp(`^${base}/maps/([^/]+)$`));
		return m ? m[1] : null;
	});
	let coworkRequesting = $state(false);
	let coworkFlash = $state<string | null>(null);
	async function askCowork() {
		if (!currentMapId || coworkRequesting) return;
		coworkRequesting = true;
		coworkFlash = null;
		try {
			const res = await fetch(`/api/projects/${p.id}/maps/${currentMapId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'requestAnalysis' })
			});
			coworkFlash = res.ok ? 'Cowork analysis requested' : 'Request failed';
		} catch {
			coworkFlash = 'Request failed';
		} finally {
			coworkRequesting = false;
			setTimeout(() => { coworkFlash = null; }, 4000);
		}
	}

	// Autonomous: autonomous researcher
	let autonomousRunning = $state(false);
	let autonomousStatus = $state('');
	let autonomousLog = $state<string[]>([]);
	let autonomousOpen = $state(false);
	let autonomousMapId = $state<string | null>(null);
	let logContainer: HTMLElement = undefined as any;

	function scrollLog() {
		if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
	}

	async function startAutonomous() {
		if (autonomousRunning) return;
		autonomousRunning = true;
		autonomousOpen = true;
		autonomousLog = [];
		autonomousStatus = 'Starting...';
		autonomousMapId = null;

		try {
			const res = await fetch(`/api/projects/${p.id}/autonomous`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'start' })
			});

			if (!res.body) {
				autonomousStatus = 'Error: no response stream';
				autonomousRunning = false;
				return;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				let eventType = '';
				for (const line of lines) {
					if (line.startsWith('event: ')) {
						eventType = line.slice(7);
					} else if (line.startsWith('data: ') && eventType) {
						try {
							const data = JSON.parse(line.slice(6));
							handleAutonomousEvent(eventType, data);
						} catch {}
						eventType = '';
					}
				}
			}
		} catch (e) {
			autonomousStatus = `Error: ${e instanceof Error ? e.message : String(e)}`;
			autonomousLog.push(`ERROR: ${autonomousStatus}`);
			autonomousLog = autonomousLog;
		} finally {
			autonomousRunning = false;
		}
	}

	function handleAutonomousEvent(event: string, data: any) {
		if (event === 'progress') {
			if (data.message) {
				autonomousStatus = data.message;
				autonomousLog.push(`── ${data.message}`);
			}
			if (data.thinking) {
				autonomousLog.push(data.thinking);
			}
			if (data.toolCall) {
				const tc = data.toolCall;
				if (tc.name === 'code_passage') {
					autonomousLog.push(`  [code] "${tc.input.code_label}" ← "${(tc.input.passage || '').slice(0, 80)}..."`);
				} else if (tc.name === 'suggest_relation') {
					autonomousLog.push(`  [relation] ${tc.input.source_id?.slice(0, 8)} → ${tc.input.target_id?.slice(0, 8)}: ${tc.input.inscription || ''}`);
				} else if (tc.name === 'write_memo') {
					autonomousLog.push(`  [memo] "${tc.input.title}"`);
				} else if (tc.name === 'designate') {
					autonomousLog.push(`  [designate] → ${tc.input.designation}`);
				} else if (tc.name === 'identify_silence') {
					autonomousLog.push(`  [silence] "${tc.input.inscription}"`);
				} else if (tc.name === 'read_document') {
					autonomousLog.push(`  [reading document...]`);
				} else {
					autonomousLog.push(`  [${tc.name}]`);
				}
			}
			autonomousLog = autonomousLog;
			requestAnimationFrame(scrollLog);
		} else if (event === 'done') {
			autonomousMapId = data.mapId;
			autonomousStatus = 'Analysis complete';
			autonomousLog.push(`\n── Analysis complete. Map ready.`);
			autonomousLog = autonomousLog;
			requestAnimationFrame(scrollLog);
		} else if (event === 'error') {
			autonomousStatus = `Error: ${data.error}`;
			autonomousLog.push(`ERROR: ${data.error}`);
			autonomousLog = autonomousLog;
		}
	}

	const mapTypeLabels: Record<string, string> = {
		situational: 'Sit Map',
		'social-worlds': 'SW/A Map',
		positional: 'Pos Map'
	};
	const mapTypeOrder = ['situational', 'social-worlds', 'positional'];
</script>

<div class="project-layout">
	<div class="project-sidebar">
		<h2><a href={base} class:active={pathname === base} class="project-name-link">{p.name}</a></h2>
		{#if p.description}
			<p class="desc">{p.description}</p>
		{/if}

		<nav>
			<a href="{base}/documents" class:active={pathname === `${base}/documents`}>Documents</a>
			{#each documents as d}
				{#if renamingDocId === d.id}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="doc-rename-input"
						bind:value={renameValue}
						autofocus
						onkeydown={(e) => { if (e.key === 'Enter') saveDocRename(d.id); if (e.key === 'Escape') renamingDocId = null; }}
						onblur={() => saveDocRename(d.id)}
					/>
				{:else}
					<a
						href="{base}/documents/{d.id}"
						class="doc-link"
						class:active={pathname === `${base}/documents/${d.id}`}
						ondblclick={(e) => { e.preventDefault(); renamingDocId = d.id; renameValue = d.label; }}
					>{d.label}</a>
				{/if}
			{/each}
			<a href="{base}/namings" class:active={pathname.startsWith(`${base}/namings`)}>Namings</a>
			<a href="{base}/memos" class:active={pathname.startsWith(`${base}/memos`)}>Memos</a>
			<a href="{base}/maps" class:active={pathname === `${base}/maps`}>Maps</a>

			{#each mapTypeOrder as type}
				{#if mapsByType[type]?.length}
					<span class="map-group-label">{mapTypeLabels[type]}</span>
					{#each mapsByType[type] as map}
						<a
							href="{base}/maps/{map.id}"
							class="map-link"
							class:active={pathname === `${base}/maps/${map.id}`}
						>{map.label}</a>
					{/each}
				{/if}
			{/each}

			<a href="{base}/compare" class:active={pathname.startsWith(`${base}/compare`)}>Compare</a>
			<a href="{base}/members" class:active={pathname.startsWith(`${base}/members`)}>Members</a>

			<button
				class="coach-toggle"
				class:coach-active={coach.isOpen}
				onclick={() => coach.isOpen = !coach.isOpen}
			>Coach</button>

			{#if currentMapId}
				<button
					class="cowork-toggle"
					onclick={askCowork}
					disabled={coworkRequesting}
					title="Ask Cowork to analyse the current map (on-demand)"
				>{coworkRequesting ? 'Cowork…' : 'Cowork'}</button>
				{#if coworkFlash}
					<span class="cowork-flash">{coworkFlash}</span>
				{/if}
			{/if}

			<!-- Autonoma (Raichel) removed from general UI — belongs in dedicated Raichel-projects only (Session 23 design) -->

			<a href="/projects" class="back-link">← Projects</a>
		</nav>
	</div>

	<div class="project-content">
		{@render children()}
	</div>

	<CoachPanel />

	<!-- Autonoma panel removed — will be reintroduced as part of dedicated Raichel-project mode -->
</div>

<style>
	.project-layout {
		display: flex;
		gap: 0;
		height: 100%;
		min-height: 0;
	}

	.project-sidebar {
		width: 200px;
		flex-shrink: 0;
		padding: 1.25rem;
		border-right: 1px solid #2a2d3a;
		background: #13151e;
		overflow-y: auto;
	}

	.project-sidebar h2 {
		font-size: 0.95rem;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}
	.project-name-link {
		color: inherit;
		text-decoration: none;
		display: inline-block;
		padding: 0.1rem 0.3rem;
		margin: -0.1rem -0.3rem;
		border-radius: 4px;
	}
	.project-name-link:hover {
		color: #a5b4fc;
		background: #1e2030;
	}
	.project-name-link.active {
		color: #fff;
		background: #1e2030;
	}

	.desc {
		font-size: 0.8rem;
		color: #6b7280;
		margin-bottom: 1rem;
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-top: 1rem;
	}

	nav a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.45rem 0.65rem;
		border-radius: 5px;
		font-size: 0.85rem;
		color: #c9cdd5;
	}
	nav a:hover {
		background: #1e2030;
		color: #fff;
	}

	.map-group-label {
		font-size: 0.75rem;
		color: #6b7280 !important;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.5rem 0.65rem 0.15rem;
		margin-top: 0.15rem;
		text-decoration: none;
	}
	.map-group-label:hover {
		color: #a5b4fc !important;
	}

	.map-group-label:first-child {
		margin-top: 0;
	}

	.map-link, .doc-link {
		padding-left: 1.2rem !important;
		font-size: 0.78rem !important;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.doc-rename-input {
		margin-left: 1.2rem;
		width: calc(100% - 1.4rem);
		background: #0f1117;
		border: 1px solid #8b9cf7;
		border-radius: 4px;
		padding: 0.25rem 0.4rem;
		color: #e1e4e8;
		font-size: 0.78rem;
		font-family: inherit;
	}
	.doc-rename-input:focus { outline: none; }

	.active {
		background: #1e2030;
		color: #fff;
	}

	.coach-toggle {
		display: flex;
		align-items: center;
		padding: 0.45rem 0.65rem;
		border-radius: 5px;
		font-size: 0.85rem;
		color: #a5b4fc;
		background: none;
		border: 1px solid #2a2d3a;
		cursor: pointer;
		margin-top: 0.5rem;
		font-family: inherit;
		font-weight: 500;
	}
	.coach-toggle:hover {
		background: #1e2030;
		border-color: #a5b4fc;
	}
	.coach-active {
		background: rgba(165, 180, 252, 0.1);
		border-color: #a5b4fc;
	}

	.cowork-toggle {
		display: flex;
		align-items: center;
		padding: 0.45rem 0.65rem;
		border-radius: 5px;
		font-size: 0.85rem;
		color: #8b9cf7;
		background: none;
		border: 1px solid #2a2d3a;
		cursor: pointer;
		margin-top: 0.15rem;
		font-family: inherit;
		font-weight: 500;
	}
	.cowork-toggle:hover {
		background: #1e2030;
		border-color: #8b9cf7;
	}
	.cowork-toggle:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.cowork-flash {
		display: block;
		font-size: 0.7rem;
		color: #8b9cf7;
		padding: 0.1rem 0.5rem 0;
		font-style: italic;
	}

	.autonomous-toggle {
		display: flex;
		align-items: center;
		padding: 0.45rem 0.65rem;
		border-radius: 5px;
		font-size: 0.85rem;
		color: #f0abfc;
		background: none;
		border: 1px solid #2a2d3a;
		cursor: pointer;
		margin-top: 0.15rem;
		font-family: inherit;
		font-weight: 500;
	}
	.autonomous-toggle:hover:not(:disabled) {
		background: #1e2030;
		border-color: #f0abfc;
	}
	.autonomous-toggle:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.autonomous-active {
		background: rgba(240, 171, 252, 0.1);
		border-color: #f0abfc;
	}
	.autonomous-status {
		font-size: 0.72rem;
		color: #9ca3af;
		padding: 0.1rem 0.65rem;
		line-height: 1.3;
	}

	.autonomous-panel {
		position: fixed;
		right: 0;
		top: 0;
		bottom: 0;
		width: 420px;
		background: #13151e;
		border-left: 1px solid #2a2d3a;
		display: flex;
		flex-direction: column;
		z-index: 50;
	}
	.autonomous-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #2a2d3a;
		font-size: 0.85rem;
		font-weight: 600;
		color: #f0abfc;
	}
	.autonomous-header-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.autonomous-btn {
		font-size: 0.75rem;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		border: 1px solid #2a2d3a;
		background: none;
		color: #c9cdd5;
		cursor: pointer;
		font-family: inherit;
		text-decoration: none;
	}
	.autonomous-btn:hover {
		background: #1e2030;
		border-color: #f0abfc;
		color: #f0abfc;
	}
	.autonomous-close {
		font-size: 0.85rem;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		border: none;
		background: none;
		color: #6b7280;
		cursor: pointer;
		font-family: inherit;
	}
	.autonomous-close:hover { color: #fff; }
	.autonomous-log {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem 1rem;
		font-size: 0.78rem;
		line-height: 1.5;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: #d1d5db;
	}
	.autonomous-line {
		white-space: pre-wrap;
		word-break: break-word;
		margin-bottom: 0.25rem;
	}

	.back-link {
		font-size: 0.78rem;
		color: #6b7280 !important;
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid #2a2d3a;
	}
	.back-link:hover {
		color: #a5b4fc !important;
	}

	.project-content {
		flex: 1;
		min-width: 0;
		padding: 2rem;
		overflow-y: auto;
	}
</style>
