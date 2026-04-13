<script lang="ts">
	let { data } = $props();
	const p = $derived(data.project);
	const c = $derived(data.counts);

	let coworkReactive = $state(((p as any)?.properties as any)?.coworkReactive === true);
	let autonomaEnabled = $state(((p as any)?.properties as any)?.autonomaEnabled === true);
	let saving = $state(false);
	let savedFlash = $state<string | null>(null);

	async function patch(patch: Record<string, unknown>) {
		saving = true;
		try {
			const res = await fetch(`/api/projects/${p.id}/settings`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch)
			});
			savedFlash = res.ok ? 'Saved' : 'Save failed';
		} catch {
			savedFlash = 'Save failed';
		} finally {
			saving = false;
			setTimeout(() => { savedFlash = null; }, 2000);
		}
	}

	function onCoworkReactive() { patch({ coworkReactive }); }
	function onAutonomaEnabled() { patch({ autonomaEnabled }); }

	const isProjectNonEmpty = $derived(c.namings > 0 || c.documents > 0);

	// Autonoma runs — list + rollback
	type AutonomaRun = { runId: string; namingCount: number; startedAt: string; endedAt: string };
	let runs = $state<AutonomaRun[]>([]);
	let runsLoading = $state(false);
	let runsLoaded = $state(false);
	let rollingBack = $state<string | null>(null);

	async function loadRuns() {
		runsLoading = true;
		try {
			const res = await fetch(`/api/projects/${p.id}/autonoma-runs`);
			if (res.ok) runs = await res.json();
		} finally {
			runsLoading = false;
			runsLoaded = true;
		}
	}

	async function rollback(runId: string) {
		const run = runs.find(r => r.runId === runId);
		if (!run) return;
		const ok = confirm(`Soft-delete ${run.namingCount} namings created by this Autonoma run? They will disappear from all maps and lists. The action can be reversed by clearing deleted_at in the database.`);
		if (!ok) return;
		rollingBack = runId;
		try {
			const res = await fetch(`/api/projects/${p.id}/autonoma-runs`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ runId, action: 'rollback' })
			});
			if (res.ok) await loadRuns();
		} finally {
			rollingBack = null;
		}
	}

	function fmtDate(s: string) {
		return new Date(s).toLocaleString();
	}
</script>

<h1>Project Overview</h1>
<div class="stats">
	<div class="stat">
		<span class="val">{c.documents}</span>
		<span class="lbl">Documents</span>
	</div>
	<div class="stat">
		<span class="val">{c.namings}</span>
		<span class="lbl">Namings</span>
	</div>
	<div class="stat">
		<span class="val">{c.maps}</span>
		<span class="lbl">Maps</span>
	</div>
	<div class="stat">
		<span class="val">{c.memos}</span>
		<span class="lbl">Memos</span>
	</div>
</div>

<h2>AI Modes {#if savedFlash}<span class="flash">{savedFlash}</span>{/if}</h2>
<div class="settings-group">
	<label class="setting">
		<input type="checkbox" bind:checked={coworkReactive} onchange={onCoworkReactive} disabled={saving} />
		<div class="setting-body">
			<div class="setting-title">Cowork: react automatically</div>
			<div class="setting-desc">
				When on, Cowork answers every researcher act on a map (add element, withdraw, rename, …) with a memo or suggestion. When off, Cowork only runs when you press the <strong>Cowork</strong> button in the sidebar.
				<span class="hint">Default: off — reactive Cowork is intrusive and can be expensive on long sessions.</span>
			</div>
		</div>
	</label>

	<label class="setting">
		<input type="checkbox" bind:checked={autonomaEnabled} onchange={onAutonomaEnabled} disabled={saving} />
		<div class="setting-body">
			<div class="setting-title">Autonoma: enable autonomous coding</div>
			<div class="setting-desc">
				Autonoma reads every document and creates codes/relations/memos in bulk. The API endpoint refuses to run while this is off.
				{#if isProjectNonEmpty}
					<div class="warning">
						⚠ This project already has {c.namings} namings and {c.documents} documents. Re-running Autonoma on a non-empty project may duplicate work; runs are tagged with an aiRunId so they can be filtered with <em>Hide Autonoma</em> in the namings/memos lists or rolled back below.
					</div>
				{/if}
			</div>
		</div>
	</label>
</div>

<h2>
	Autonoma runs
	{#if !runsLoaded}
		<button class="link-btn" onclick={loadRuns} disabled={runsLoading}>
			{runsLoading ? 'loading…' : 'show'}
		</button>
	{:else}
		<button class="link-btn" onclick={loadRuns} disabled={runsLoading}>refresh</button>
	{/if}
</h2>
{#if runsLoaded}
	{#if runs.length === 0}
		<p class="empty">No Autonoma runs found in this project.</p>
	{:else}
		<table class="runs">
			<thead>
				<tr>
					<th>Started</th>
					<th>Ended</th>
					<th>Namings</th>
					<th>Run ID</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each runs as run (run.runId)}
					<tr>
						<td>{fmtDate(run.startedAt)}</td>
						<td>{fmtDate(run.endedAt)}</td>
						<td>{run.namingCount}</td>
						<td><code>{run.runId.slice(0, 8)}…</code></td>
						<td>
							<button
								class="rollback-btn"
								onclick={() => rollback(run.runId)}
								disabled={rollingBack === run.runId}
							>{rollingBack === run.runId ? 'rolling back…' : 'Rollback'}</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
{/if}

<style>
	h1 { font-size: 1.3rem; margin-bottom: 1.5rem; }
	h2 { font-size: 1rem; margin: 2rem 0 0.75rem; color: #c9cdd5; display: flex; align-items: center; gap: 0.6rem; }
	.flash { font-size: 0.7rem; color: #8b9cf7; font-weight: 400; font-style: italic; }

	.stats { display: flex; gap: 1rem; }
	.stat {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 1.25rem 1.5rem; display: flex; flex-direction: column; min-width: 120px;
	}
	.val { font-size: 1.8rem; font-weight: 700; color: #a5b4fc; }
	.lbl { font-size: 0.8rem; color: #6b7280; margin-top: 0.25rem; }

	.settings-group {
		display: flex; flex-direction: column; gap: 0.75rem;
		max-width: 720px;
	}
	.setting {
		display: flex; gap: 0.75rem; align-items: flex-start;
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 0.9rem 1rem; cursor: pointer;
	}
	.setting input[type="checkbox"] {
		margin-top: 0.2rem; accent-color: #8b9cf7; width: 1.05rem; height: 1.05rem;
	}
	.setting-body { flex: 1; }
	.setting-title { font-size: 0.9rem; font-weight: 600; color: #e1e4e8; margin-bottom: 0.25rem; }
	.setting-desc { font-size: 0.8rem; color: #8b8fa3; line-height: 1.5; }
	.hint { display: block; font-size: 0.72rem; color: #6b7280; margin-top: 0.3rem; }
	.warning {
		margin-top: 0.5rem; padding: 0.5rem 0.7rem;
		background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 4px;
		font-size: 0.78rem; color: #fbbf24;
	}

	.link-btn {
		background: none; border: none; color: #8b9cf7; cursor: pointer;
		font-size: 0.75rem; text-decoration: underline; padding: 0;
		font-weight: 400; font-family: inherit;
	}
	.link-btn:disabled { opacity: 0.5; cursor: progress; }
	.empty { font-size: 0.85rem; color: #6b7280; }

	.runs {
		border-collapse: collapse; max-width: 720px; width: 100%;
		font-size: 0.8rem;
	}
	.runs th, .runs td {
		text-align: left; padding: 0.45rem 0.6rem;
		border-bottom: 1px solid #2a2d3a; color: #c9cdd5;
	}
	.runs th { font-weight: 500; color: #6b7280; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; }
	.runs code { font-size: 0.72rem; color: #8b8fa3; }
	.rollback-btn {
		background: none; border: 1px solid #5f1e1e; border-radius: 4px;
		color: #fca5a5; padding: 0.2rem 0.6rem; font-size: 0.72rem; cursor: pointer;
		font-family: inherit;
	}
	.rollback-btn:hover { background: #5f1e1e; color: #fff; }
	.rollback-btn:disabled { opacity: 0.5; cursor: progress; }
</style>
