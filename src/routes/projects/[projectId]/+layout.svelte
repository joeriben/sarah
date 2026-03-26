<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';
	import CoachPanel from '$lib/coach/CoachPanel.svelte';
	import { createCoachState, setCoachState } from '$lib/coach/coachState.svelte.js';

	let { data, children }: { data: any; children: Snippet } = $props();
	const p = $derived(data.project);
	const c = $derived(data.counts);
	const base = $derived(`/projects/${p.id}`);
	const mapsByType = $derived(data.mapsByType as Record<string, { id: string; label: string }[]>);
	const pathname = $derived($page.url.pathname);

	// Coach: didactic AI persona
	const coach = createCoachState(p.id);
	setCoachState(coach);

	// Autonomous: autonomous researcher
	let autonomousRunning = $state(false);
	let autonomousStatus = $state('');
	let autonomousLog = $state<string[]>([]);
	let autonomousOpen = $state(false);
	let autonomousMapId = $state<string | null>(null);
	let logContainer: HTMLElement;

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
		<h2>{p.name}</h2>
		{#if p.description}
			<p class="desc">{p.description}</p>
		{/if}

		<nav>
			<a href="{base}/documents" class:active={pathname.startsWith(`${base}/documents`)}>Documents</a>
			<a href="{base}/namings" class:active={pathname.startsWith(`${base}/namings`)}>Namings</a>
			<a href="{base}/memos" class:active={pathname.startsWith(`${base}/memos`)}>Memos</a>

			{#each mapTypeOrder as type}
				{#if mapsByType[type]?.length}
					<a href="{base}/maps" class="map-group-label">{mapTypeLabels[type]}</a>
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

			<button
				class="autonomous-toggle"
				class:autonomous-active={autonomousRunning || autonomousOpen}
				onclick={() => { if (!autonomousRunning && autonomousLog.length === 0) startAutonomous(); else autonomousOpen = !autonomousOpen; }}
				disabled={autonomousRunning && autonomousOpen}
			>{autonomousRunning ? 'Autonoma...' : 'Autonoma'}</button>
			{#if autonomousStatus && !autonomousOpen}
				<span class="autonomous-status">{autonomousStatus}</span>
			{/if}

			<a href="/projects" class="back-link">← Projects</a>
		</nav>
	</div>

	<div class="project-content">
		{@render children()}
	</div>

	<CoachPanel />

	{#if autonomousOpen}
		<div class="autonomous-panel">
			<div class="autonomous-header">
				<span>Autonoma {autonomousRunning ? '(running...)' : ''}</span>
				<div class="autonomous-header-actions">
					{#if !autonomousRunning && autonomousLog.length > 0}
						<button class="autonomous-btn" onclick={startAutonomous}>Re-run</button>
					{/if}
					{#if autonomousMapId}
						<a href="{base}/maps/{autonomousMapId}" class="autonomous-btn">Open Map</a>
					{/if}
					<button class="autonomous-close" onclick={() => autonomousOpen = false}>x</button>
				</div>
			</div>
			<div class="autonomous-log" bind:this={logContainer}>
				{#each autonomousLog as line}
					<div class="autonomous-line">{line}</div>
				{/each}
				{#if autonomousRunning && autonomousLog.length === 0}
					<div class="autonomous-line">Waiting for autonomous agent...</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.project-layout {
		display: flex;
		gap: 0;
		height: 100%;
	}

	.project-sidebar {
		width: 200px;
		padding: 1.25rem;
		border-right: 1px solid #2a2d3a;
		background: #13151e;
	}

	.project-sidebar h2 {
		font-size: 0.95rem;
		font-weight: 600;
		margin-bottom: 0.25rem;
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

	.map-link {
		padding-left: 1.2rem !important;
	}

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
		padding: 2rem;
		overflow-y: auto;
	}
</style>
