<script lang="ts">
	let { data } = $props();

	let elements = $state(data.elements);
	let relations = $state(data.relations);
	let silences = $state(data.silences);
	let processes = $state(data.processes);
	let constellations = $state(data.constellations);
	let phases = $state(data.phases);
	let designationProfile = $state(data.designationProfile);

	let newInscription = $state('');
	let adding = $state(false);
	let relatingFrom = $state<string | null>(null);
	let relatingTo = $state<string | null>(null);
	let relInscription = $state('');
	let relValence = $state('');
	let relDirected = $state(true);
	let newPhaseLabel = $state('');
	let showPhaseForm = $state(false);
	let assigningToPhase = $state<string | null>(null);

	const mapType = $derived(data.map.properties?.mapType || 'situational');

	// API helper
	async function mapAction(action: string, body: Record<string, unknown> = {}) {
		const res = await fetch(`/api/projects/${data.projectId}/maps/${data.map.id}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ...body })
		});
		if (!res.ok) return null;
		return res.json();
	}

	async function reload() {
		const res = await fetch(`/api/projects/${data.projectId}/maps/${data.map.id}`);
		if (!res.ok) return;
		const fresh = await res.json();
		elements = fresh.elements;
		relations = fresh.relations;
		silences = fresh.silences;
		processes = fresh.processes;
		constellations = fresh.constellations;
		phases = fresh.phases;
		designationProfile = fresh.designationProfile;
	}

	async function addElement() {
		if (!newInscription.trim()) return;
		adding = true;
		await mapAction('addElement', { inscription: newInscription.trim() });
		newInscription = '';
		adding = false;
		await reload();
	}

	function startRelation(fromId: string, toId: string) {
		relatingFrom = fromId;
		relatingTo = toId;
		relInscription = '';
		relValence = '';
		relDirected = true;
	}

	function cancelRelation() {
		relatingFrom = null;
		relatingTo = null;
		relInscription = '';
		relValence = '';
		relDirected = true;
	}

	async function submitRelation() {
		if (!relatingFrom || !relatingTo) return;
		const sourceId = relDirected ? relatingFrom : relatingFrom;
		const targetId = relDirected ? relatingTo : relatingTo;
		await mapAction('relate', {
			sourceId: relDirected ? sourceId : sourceId,
			targetId: relDirected ? targetId : targetId,
			inscription: relInscription.trim() || undefined,
			valence: relValence.trim() || undefined,
			// If not directed, don't set directed_from/to
			symmetric: !relDirected
		});
		cancelRelation();
		await reload();
	}

	async function addPhase() {
		if (!newPhaseLabel.trim()) return;
		await mapAction('createPhase', { inscription: newPhaseLabel.trim() });
		newPhaseLabel = '';
		showPhaseForm = false;
		await reload();
	}

	async function assignElement(phaseId: string, namingId: string) {
		await mapAction('assignToPhase', { phaseId, namingId });
		assigningToPhase = null;
		await reload();
	}

	async function removeElementFromPhase(phaseId: string, namingId: string) {
		await mapAction('removeFromPhase', { phaseId, namingId });
		await reload();
	}

	async function changeDesignation(namingId: string, designation: string) {
		await mapAction('designate', { namingId, designation });
		await reload();
	}

	function designationColor(d: string | undefined) {
		if (d === 'specification') return '#10b981';
		if (d === 'characterization') return '#f59e0b';
		return '#6b7280'; // cue
	}

	function designationLabel(d: string | undefined) {
		if (d === 'specification') return 'spec';
		if (d === 'characterization') return 'char';
		return 'cue';
	}

	// Find which phases an element belongs to
	function phasesForElement(namingId: string): any[] {
		// An element belongs to a phase if it has an appearance where perspective_id = phase.id
		// We approximate this from the data we have — phases that contain this element
		return []; // Will be populated when we have phase-element data
	}
</script>

<div class="map-page">
	<div class="map-toolbar">
		<a href="/projects/{data.projectId}/maps" class="back">&larr; Maps</a>
		<h2>{data.map.label}</h2>
		<span class="map-type-badge">{mapType}</span>

		{#if designationProfile.length > 0}
			<div class="designation-profile">
				{#each designationProfile as dp}
					<span class="dp-item" style="color: {designationColor(dp.designation)}">
						{dp.count} {designationLabel(dp.designation)}
					</span>
				{/each}
			</div>
		{/if}
	</div>

	<div class="map-workspace">
		<div class="main-area">
			<!-- Add element -->
			<form class="add-form" onsubmit={e => { e.preventDefault(); addElement(); }}>
				<input
					type="text"
					placeholder="Name something in the situation..."
					bind:value={newInscription}
					disabled={adding}
				/>
				<button type="submit" class="btn-primary" disabled={adding || !newInscription.trim()}>
					Add
				</button>
			</form>

			<!-- Relation form (inline) -->
			{#if relatingFrom && relatingTo}
				{@const fromLabel = elements.find((e: any) => e.naming_id === relatingFrom)?.inscription || '?'}
				{@const toLabel = elements.find((e: any) => e.naming_id === relatingTo)?.inscription || '?'}
				<div class="relation-form">
					<div class="rel-form-header">
						<span class="rel-form-elements">
							{fromLabel}
							{#if relDirected}
								<span class="rel-form-arrow">→</span>
							{:else}
								<span class="rel-form-arrow">↔</span>
							{/if}
							{toLabel}
						</span>
						<button class="btn-link" onclick={cancelRelation}>cancel</button>
					</div>
					<div class="rel-form-fields">
						<label>
							<span class="field-label">Valence</span>
							<input type="text" placeholder="e.g. enables, constrains, constitutes..." bind:value={relValence} />
						</label>
						<label>
							<span class="field-label">Name</span>
							<input type="text" placeholder="Name for this relation (optional)" bind:value={relInscription} />
						</label>
						<div class="rel-form-row">
							<label class="toggle-label">
								<input type="checkbox" bind:checked={relDirected} />
								<span>directed ({relDirected ? `${fromLabel} → ${toLabel}` : 'symmetric'})</span>
							</label>
							{#if relDirected}
								<button class="btn-xs" onclick={() => { const tmp = relatingFrom; relatingFrom = relatingTo; relatingTo = tmp; }}>
									flip
								</button>
							{/if}
						</div>
					</div>
					<button class="btn-primary btn-sm-primary" onclick={submitRelation}>Create relation</button>
				</div>
			{:else if relatingFrom && !relatingTo}
				<div class="action-bar">
					Relating from: <strong>{elements.find((e: any) => e.naming_id === relatingFrom)?.inscription}</strong>
					— click "connect" on another element, or
					<button class="btn-link" onclick={cancelRelation}>cancel</button>
				</div>
			{/if}

			<!-- Elements -->
			{#if elements.length === 0 && relations.length === 0}
				<p class="empty">Name what is in the situation. Everything is a cue at first.</p>
			{:else}
				<div class="element-list">
					{#each elements as el}
						<div class="element-card">
							<div class="el-main">
								<span class="designation-dot" style="background: {designationColor(el.designation)}"
									title={designationLabel(el.designation)}></span>
								<span class="el-inscription">{el.inscription}</span>
							</div>
							<div class="el-actions">
								<select
									value={el.designation || 'cue'}
									onchange={e => changeDesignation(el.naming_id, (e.target as HTMLSelectElement).value)}
								>
									<option value="cue">cue</option>
									<option value="characterization">characterization</option>
									<option value="specification">specification</option>
								</select>
								{#if relatingFrom && relatingFrom !== el.naming_id}
									<button class="btn-sm btn-relate" onclick={() => relate(relatingFrom!, el.naming_id)}>
										connect
									</button>
								{:else}
									<button class="btn-sm" onclick={() => relatingFrom = el.naming_id}>
										relate
									</button>
								{/if}
								{#if assigningToPhase}
									<button class="btn-sm btn-phase" onclick={() => assignElement(assigningToPhase!, el.naming_id)}>
										+ phase
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Relations -->
			{#if relations.length > 0}
				<h3 class="section-header">Relations</h3>
				<div class="element-list">
					{#each relations as rel}
						<div class="element-card relation-card">
							<div class="el-main">
								<span class="designation-dot" style="background: {designationColor(rel.designation)}"></span>
								<span class="rel-source">
									{elements.find((e: any) => e.naming_id === rel.directed_from)?.inscription || '?'}
								</span>
								<span class="rel-arrow">
									{#if rel.valence}
										—{rel.valence}→
									{:else}
										→
									{/if}
								</span>
								<span class="rel-target">
									{elements.find((e: any) => e.naming_id === rel.directed_to)?.inscription || '?'}
								</span>
								{#if rel.inscription}
									<span class="rel-inscription">{rel.inscription}</span>
								{/if}
							</div>
							<div class="el-actions">
								<select
									value={rel.designation || 'cue'}
									onchange={e => changeDesignation(rel.naming_id, (e.target as HTMLSelectElement).value)}
								>
									<option value="cue">cue</option>
									<option value="characterization">characterization</option>
									<option value="specification">specification</option>
								</select>
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Silences -->
			{#if silences.length > 0}
				<h3 class="section-header">Silences</h3>
				<div class="element-list">
					{#each silences as s}
						<div class="element-card silence-card">
							<span class="el-inscription">{s.inscription}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Phases sidebar -->
		<div class="phases-panel">
			<div class="phases-header">
				<h3>Phases</h3>
				<button class="btn-sm" onclick={() => showPhaseForm = !showPhaseForm}>
					{showPhaseForm ? '×' : '+'}
				</button>
			</div>

			{#if showPhaseForm}
				<form class="phase-form" onsubmit={e => { e.preventDefault(); addPhase(); }}>
					<input type="text" placeholder="Phase label..." bind:value={newPhaseLabel} />
					<button type="submit" class="btn-sm">Create</button>
				</form>
			{/if}

			{#if phases.length === 0}
				<p class="empty-small">No phases yet. Create one to cluster elements.</p>
			{:else}
				{#each phases as phase}
					<div class="phase-card" class:assigning={assigningToPhase === phase.id}>
						<div class="phase-header">
							<span class="phase-label">{phase.label}</span>
							<span class="phase-count">{phase.element_count}</span>
						</div>
						<button
							class="btn-xs"
							onclick={() => assigningToPhase = assigningToPhase === phase.id ? null : phase.id}
						>
							{assigningToPhase === phase.id ? 'done' : 'assign elements'}
						</button>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

<svelte:window onkeydown={e => { if (e.key === 'Escape') { relatingFrom = null; assigningToPhase = null; } }} />

<style>
	.map-page {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 6rem);
		margin: -2rem;
	}

	.map-toolbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #2a2d3a;
		background: #13151e;
	}

	.back { font-size: 0.8rem; color: #6b7280; }
	h2 { font-size: 1rem; font-weight: 600; }

	.map-type-badge {
		font-size: 0.7rem; color: #8b9cf7; text-transform: uppercase;
		background: rgba(139, 156, 247, 0.1); padding: 0.15rem 0.5rem; border-radius: 4px;
	}

	.designation-profile {
		display: flex; gap: 0.75rem; margin-left: auto; font-size: 0.8rem;
	}
	.dp-item { font-weight: 500; }

	.map-workspace { display: flex; flex: 1; min-height: 0; }

	.main-area {
		flex: 1;
		padding: 1.25rem;
		overflow-y: auto;
	}

	.add-form {
		display: flex; gap: 0.5rem; margin-bottom: 1.25rem;
	}
	.add-form input {
		flex: 1; background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.6rem 0.75rem; color: #e1e4e8; font-size: 0.9rem;
	}
	.add-form input:focus { outline: none; border-color: #8b9cf7; }

	.btn-primary {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px;
		padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
	}
	.btn-primary:disabled { opacity: 0.5; }

	.action-bar {
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.6rem 0.75rem; margin-bottom: 1rem; font-size: 0.85rem; color: #c9cdd5;
	}
	.btn-link {
		background: none; border: none; color: #8b9cf7; cursor: pointer;
		font-size: 0.85rem; text-decoration: underline;
	}

	.empty { color: #6b7280; font-size: 0.9rem; padding: 2rem 0; text-align: center; }

	.section-header {
		font-size: 0.75rem; color: #6b7280; text-transform: uppercase;
		letter-spacing: 0.05em; margin: 1.5rem 0 0.5rem;
	}

	.element-list { display: flex; flex-direction: column; gap: 0.35rem; }

	.element-card {
		display: flex; align-items: center; justify-content: space-between;
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.5rem 0.75rem;
	}
	.element-card:hover { border-color: #3a3d4a; }

	.relation-card { background: #141620; }
	.silence-card { border-style: dashed; opacity: 0.7; }

	.el-main { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }

	.designation-dot {
		width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
	}

	.el-inscription { font-size: 0.9rem; color: #e1e4e8; }

	.rel-source, .rel-target { font-size: 0.85rem; color: #c9cdd5; }
	.rel-arrow { font-size: 0.8rem; color: #6b7280; margin: 0 0.25rem; }
	.rel-inscription { font-size: 0.75rem; color: #8b8fa3; margin-left: 0.5rem; font-style: italic; }

	.el-actions { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }

	.el-actions select {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.2rem 0.3rem; cursor: pointer;
	}

	.btn-sm {
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #c9cdd5; font-size: 0.75rem; padding: 0.25rem 0.5rem; cursor: pointer;
	}
	.btn-sm:hover { border-color: #8b9cf7; color: #e1e4e8; }

	.btn-relate { border-color: #f59e0b; color: #f59e0b; }
	.btn-phase { border-color: #10b981; color: #10b981; }

	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
	}
	.btn-xs:hover { border-color: #8b9cf7; }

	/* Phases panel */
	.phases-panel {
		width: 220px;
		background: #13151e;
		border-left: 1px solid #2a2d3a;
		padding: 1rem;
		overflow-y: auto;
	}

	.phases-header {
		display: flex; align-items: center; justify-content: space-between;
		margin-bottom: 0.75rem;
	}
	.phases-header h3 { font-size: 0.85rem; color: #8b8fa3; }

	.phase-form {
		display: flex; gap: 0.4rem; margin-bottom: 0.75rem;
	}
	.phase-form input {
		flex: 1; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		padding: 0.35rem 0.5rem; color: #e1e4e8; font-size: 0.8rem;
	}
	.phase-form input:focus { outline: none; border-color: #8b9cf7; }

	.empty-small { color: #6b7280; font-size: 0.8rem; }

	.phase-card {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.5rem 0.6rem; margin-bottom: 0.35rem;
	}
	.phase-card.assigning { border-color: #10b981; }

	.phase-header {
		display: flex; justify-content: space-between; align-items: center;
		margin-bottom: 0.25rem;
	}
	.phase-label { font-size: 0.85rem; color: #e1e4e8; font-weight: 500; }
	.phase-count { font-size: 0.7rem; color: #6b7280; }
</style>
