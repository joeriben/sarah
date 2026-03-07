<script lang="ts">
	import { untrack } from 'svelte';

	let { data } = $props();

	// untrack: intentionally capture initial value only; $effect below handles prop updates
	let elements = $state(untrack(() => data.elements));
	let relations = $state(untrack(() => data.relations));
	let silences = $state(untrack(() => data.silences));
	let processes = $state(untrack(() => data.processes));
	let constellations = $state(untrack(() => data.constellations));
	let phases = $state(untrack(() => data.phases));
	let designationProfile = $state(untrack(() => data.designationProfile));

	// Sync when SvelteKit re-runs the load function (navigation/invalidation)
	$effect(() => {
		elements = data.elements;
		relations = data.relations;
		silences = data.silences;
		processes = data.processes;
		constellations = data.constellations;
		phases = data.phases;
		designationProfile = data.designationProfile;
	});

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
	let expandedPhase = $state<string | null>(null);
	let phaseContents = $state<any[]>([]);

	// Inline rename: first step captures new value, then opens naming act prompt
	let editingId = $state<string | null>(null);
	let editingValue = $state('');

	// Naming act prompt: shown after rename or designation change
	// This is the transparency mechanism — every act of designation power
	// becomes a memo-naming linked to its co-actors.
	let actTarget = $state<string | null>(null);      // the naming being acted upon
	let actType = $state<'rename' | 'designate'>('rename');
	let actNewValue = $state('');                       // new inscription or designation
	let actMemo = $state('');                           // why / what influenced this
	let actLinkedIds = $state<string[]>([]);            // co-actors: other namings that influenced
	let showActLinks = $state(false);                   // expand co-actor selection

	// AI agent
	let aiEnabled = $state(true);
	let aiNotification = $state<string | null>(null);
	let aiNotificationTimeout: ReturnType<typeof setTimeout> | undefined;

	// SSE subscription for AI agent events
	$effect(() => {
		const evtSource = new EventSource(`/api/projects/${data.projectId}/maps/${data.map.id}/events`);

		evtSource.addEventListener('message', (e) => {
			try {
				const event = JSON.parse(e.data);
				switch (event.type) {
					case 'ai:element':
						elements = [...elements, event.payload];
						reload();
						break;
					case 'ai:relation':
						relations = [...relations, event.payload];
						reload();
						break;
					case 'ai:silence':
						silences = [...silences, event.payload];
						reload();
						break;
					case 'ai:memo':
						showAiNotification(event.payload?.text || 'AI memo created');
						break;
					case 'ai:phase':
						phases = [...phases, event.payload];
						reload();
						break;
				}
			} catch {
				// ignore malformed events
			}
		});

		return () => {
			evtSource.close();
		};
	});

	function showAiNotification(text: string) {
		aiNotification = text;
		clearTimeout(aiNotificationTimeout);
		aiNotificationTimeout = setTimeout(() => { aiNotification = null; }, 4000);
	}

	async function toggleAi() {
		const next = !aiEnabled;
		await mapAction('toggleAi', { enabled: next });
		aiEnabled = next;
	}

	async function requestAnalysis() {
		await mapAction('requestAnalysis');
		showAiNotification('AI analysis requested');
	}

	// History panel
	let historyId = $state<string | null>(null);
	let historyData = $state<{ inscriptions: any[]; designations: any[] } | null>(null);

	const mapType = $derived(data.map.properties?.mapType || 'situational');

	// Resolve any naming_id to its inscription across all map appearances
	function findInscription(namingId: string): string {
		if (!namingId) return '?';
		const all = [...elements, ...relations, ...silences, ...processes, ...constellations];
		const found = (all as any[]).find(a => a.naming_id === namingId);
		if (!found) return '?';
		if (found.inscription) return found.inscription;
		// Unnamed relation: show its endpoints instead
		if (found.mode === 'relation') {
			const src = findInscription(found.directed_from);
			const tgt = findInscription(found.directed_to);
			return `(${src} → ${tgt})`;
		}
		return '?';
	}

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
		await reload();
		if (expandedPhase === phaseId) await loadPhaseContents(phaseId);
	}

	async function removeElementFromPhase(phaseId: string, namingId: string) {
		await mapAction('removeFromPhase', { phaseId, namingId });
		await reload();
		if (expandedPhase === phaseId) await loadPhaseContents(phaseId);
	}

	async function loadPhaseContents(phaseId: string) {
		const res = await fetch(`/api/projects/${data.projectId}/maps/${phaseId}`);
		if (!res.ok) { phaseContents = []; return; }
		const fresh = await res.json();
		// Phase contents = all non-perspective appearances
		phaseContents = [...(fresh.elements || []), ...(fresh.relations || []), ...(fresh.silences || [])];
	}

	async function togglePhase(phaseId: string) {
		if (expandedPhase === phaseId) {
			expandedPhase = null;
			phaseContents = [];
		} else {
			expandedPhase = phaseId;
			await loadPhaseContents(phaseId);
		}
	}

	function startDesignation(namingId: string, designation: string) {
		actTarget = namingId;
		actType = 'designate';
		actNewValue = designation;
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
	}

	function startRename(namingId: string, currentInscription: string) {
		editingId = namingId;
		editingValue = currentInscription;
	}

	function confirmRename() {
		if (!editingId || !editingValue.trim()) return;
		// Close inline edit, open naming act prompt
		actTarget = editingId;
		actType = 'rename';
		actNewValue = editingValue.trim();
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
		editingId = null;
		editingValue = '';
	}

	async function submitAct() {
		if (!actTarget) return;
		if (actType === 'rename') {
			await mapAction('rename', {
				namingId: actTarget,
				inscription: actNewValue,
				memoText: actMemo.trim() || undefined,
				linkedNamingIds: actLinkedIds.length > 0 ? actLinkedIds : undefined
			});
		} else {
			await mapAction('designate', {
				namingId: actTarget,
				designation: actNewValue,
				memoText: actMemo.trim() || undefined,
				linkedNamingIds: actLinkedIds.length > 0 ? actLinkedIds : undefined
			});
		}
		cancelAct();
		await reload();
	}

	async function skipAct() {
		// Execute without memo
		if (!actTarget) return;
		if (actType === 'rename') {
			await mapAction('rename', { namingId: actTarget, inscription: actNewValue });
		} else {
			await mapAction('designate', { namingId: actTarget, designation: actNewValue });
		}
		cancelAct();
		await reload();
	}

	function cancelAct() {
		actTarget = null;
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
	}

	function toggleActLink(namingId: string) {
		if (actLinkedIds.includes(namingId)) {
			actLinkedIds = actLinkedIds.filter(id => id !== namingId);
		} else {
			actLinkedIds = [...actLinkedIds, namingId];
		}
	}

	async function showHistory(namingId: string) {
		if (historyId === namingId) { historyId = null; historyData = null; return; }
		historyId = namingId;
		historyData = await mapAction('getStack', { namingId });
	}

	async function pinToLayer(namingId: string, seq: number) {
		await mapAction('setCollapse', { namingId, collapseAt: seq });
		await reload();
	}

	async function unpinLayer(namingId: string) {
		await mapAction('setCollapse', { namingId, collapseAt: null });
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

		<div class="ai-controls">
			<button
				class="btn-ai-toggle"
				class:ai-active={aiEnabled}
				onclick={toggleAi}
				title={aiEnabled ? 'AI agent active — click to disable' : 'AI agent inactive — click to enable'}
			>
				AI
			</button>
			<button class="btn-sm btn-ask-ai" onclick={requestAnalysis} disabled={!aiEnabled}>
				Ask AI
			</button>
		</div>
	</div>

	{#if aiNotification}
		<div class="ai-notification">{aiNotification}</div>
	{/if}

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
				{@const fromLabel = findInscription(relatingFrom)}
				{@const toLabel = findInscription(relatingTo)}
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
					Relating from: <strong>{findInscription(relatingFrom)}</strong>
					— click "connect" on any element or relation, or
					<button class="btn-link" onclick={cancelRelation}>cancel</button>
				</div>
			{/if}

			<!-- Elements -->
			{#if elements.length === 0 && relations.length === 0}
				<p class="empty">Name what is in the situation. Everything is a cue at first.</p>
			{:else}
				<div class="element-list">
					{#each elements as el}
						<div class="element-card" class:ai-suggested={el.properties?.aiSuggested === true} title={el.properties?.aiReasoning || ''}>
							<div class="el-main">
								{#if el.is_collapsed}<span class="collapsed-indicator" title="Pinned to specific layer">&#x1F4CC;</span>{/if}
								<span class="designation-dot" style="background: {designationColor(el.designation)}"
									title={designationLabel(el.designation)}></span>
								<span class="provenance-indicator" title={el.has_document_anchor ? 'Empirically grounded (document annotation)' : el.has_memo_link ? 'Analytically grounded (memo link)' : 'No grounding yet'}>{el.has_document_anchor ? '📄' : el.has_memo_link ? '📝' : '∅'}</span>
								{#if editingId === el.naming_id}
									<form class="inline-rename" onsubmit={e => { e.preventDefault(); confirmRename(); }}>
										<input type="text" bind:value={editingValue} />
										<button type="submit" class="btn-xs">ok</button>
										<button type="button" class="btn-xs" onclick={() => editingId = null}>×</button>
									</form>
								{:else}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<span class="el-inscription editable" ondblclick={() => startRename(el.naming_id, el.inscription)}>
										{el.inscription}
									</span>
									{#if el.is_collapsed && el.current_inscription && el.current_inscription !== el.inscription}
										<span class="collapsed-current">currently: {el.current_inscription}</span>
									{/if}
								{/if}
							</div>
							<div class="el-actions">
								<select
									value={el.designation || 'cue'}
									onchange={e => startDesignation(el.naming_id, (e.target as HTMLSelectElement).value)}
								>
									<option value="cue">cue</option>
									<option value="characterization">characterization</option>
									<option value="specification">specification</option>
								</select>
								<button class="btn-xs" title="naming stack" onclick={() => showHistory(el.naming_id)}>
									stack
								</button>
								{#if relatingFrom && !relatingTo && relatingFrom !== el.naming_id}
									<button class="btn-sm btn-relate" onclick={() => startRelation(relatingFrom!, el.naming_id)}>
										connect
									</button>
								{:else if !relatingFrom}
									<button class="btn-sm" onclick={() => { relatingFrom = el.naming_id; relatingTo = null; }}>
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

						{#if historyId === el.naming_id && historyData}
							<div class="history-panel">
								{#if el.is_collapsed}
									<button class="btn-xs btn-unpin" onclick={() => unpinLayer(el.naming_id)}>
										unpin (show latest)
									</button>
								{/if}
								{#if historyData.inscriptions.length > 1}
									<div class="history-section">
										<span class="history-label">Inscriptions</span>
										{#each historyData.inscriptions as hi}
											<div class="history-entry" class:pinned-layer={el.is_collapsed && el.properties?.collapseAt === hi.seq}>
												<span class="he-value">{hi.inscription}</span>
												<span class="he-by">{hi.by_inscription}</span>
												<span class="he-date">{new Date(hi.created_at).toLocaleString()}</span>
												<button class="btn-xs btn-pin" title="Pin to this layer" onclick={() => pinToLayer(el.naming_id, hi.seq)}>
													pin
												</button>
											</div>
										{/each}
									</div>
								{/if}
								<div class="history-section">
									<span class="history-label">Designations</span>
									{#each historyData.designations as hd}
										<div class="history-entry">
											<span class="designation-dot-sm" style="background: {designationColor(hd.designation)}"></span>
											<span class="he-value">{hd.designation}</span>
											<span class="he-by">{hd.by_inscription}</span>
											<span class="he-date">{new Date(hd.created_at).toLocaleString()}</span>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					{/each}
				</div>
			{/if}

			<!-- Naming act prompt: transparency for every act of designation power -->
			{#if actTarget}
				{@const targetNaming = [...elements, ...relations].find((e: any) => e.naming_id === actTarget)}
				{@const allMapNamings = [...elements, ...relations].filter((e: any) => e.naming_id !== actTarget)}
				<div class="act-prompt">
					<div class="act-header">
						{#if actType === 'rename'}
							Rename: <strong>{targetNaming?.inscription}</strong> → <strong>{actNewValue}</strong>
						{:else}
							Designation: <strong>{targetNaming?.inscription}</strong> →
							<span style="color: {designationColor(actNewValue)}">{actNewValue}</span>
						{/if}
					</div>

					<textarea
						placeholder="What influenced this act? What changed in your understanding?"
						bind:value={actMemo}
						rows="2"
					></textarea>

					<div class="act-links-toggle">
						<button class="btn-xs" onclick={() => showActLinks = !showActLinks}>
							{showActLinks ? 'hide co-actors' : `link co-actors (${actLinkedIds.length})`}
						</button>
					</div>

					{#if showActLinks}
						<div class="act-links-list">
							{#each allMapNamings as n}
								<label class="act-link-item">
									<input
										type="checkbox"
										checked={actLinkedIds.includes(n.naming_id)}
										onchange={() => toggleActLink(n.naming_id)}
									/>
									<span class="designation-dot-sm" style="background: {designationColor(n.designation)}"></span>
									<span>{n.inscription || '(unnamed relation)'}</span>
								</label>
							{/each}
						</div>
					{/if}

					<div class="act-actions">
						<button class="btn-primary btn-sm-primary" onclick={submitAct}>
							{actMemo.trim() || actLinkedIds.length > 0 ? 'Apply + memo' : 'Apply + memo'}
						</button>
						<button class="btn-link" onclick={skipAct}>skip memo</button>
						<button class="btn-link" onclick={cancelAct}>cancel</button>
					</div>
				</div>
			{/if}

			<!-- Relations -->
			{#if relations.length > 0}
				<h3 class="section-header">Relations</h3>
				<div class="element-list">
					{#each relations as rel}
						{@const srcId = rel.directed_from || rel.part_source_id}
						{@const tgtId = rel.directed_to || rel.part_target_id}
						<div class="element-card relation-card" class:ai-suggested={rel.properties?.aiSuggested === true} title={rel.properties?.aiReasoning || ''}>
							<div class="el-main">
								{#if rel.is_collapsed}<span class="collapsed-indicator" title="Pinned to specific layer">&#x1F4CC;</span>{/if}
								<span class="designation-dot" style="background: {designationColor(rel.designation)}"></span>
								<span class="provenance-indicator" title={rel.has_document_anchor ? 'Empirically grounded' : rel.has_memo_link ? 'Analytically grounded' : 'No grounding yet'}>{rel.has_document_anchor ? '📄' : rel.has_memo_link ? '📝' : '∅'}</span>
								<span class="rel-source">
									{findInscription(srcId)}
								</span>
								<span class="rel-arrow">
									{#if rel.directed_from && rel.directed_to}
										{#if rel.valence}—{rel.valence}→{:else}→{/if}
									{:else}
										{#if rel.valence}—{rel.valence}—{:else}↔{/if}
									{/if}
								</span>
								<span class="rel-target">
									{findInscription(tgtId)}
								</span>
								{#if editingId === rel.naming_id}
									<form class="inline-rename" onsubmit={e => { e.preventDefault(); confirmRename(); }}>
										<input type="text" bind:value={editingValue} />
										<button type="submit" class="btn-xs">ok</button>
										<button type="button" class="btn-xs" onclick={() => editingId = null}>×</button>
									</form>
								{:else if rel.inscription}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<span class="rel-inscription editable" ondblclick={() => startRename(rel.naming_id, rel.inscription)}>
										{rel.inscription}
									</span>
								{:else}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<span class="rel-inscription editable unnamed" ondblclick={() => startRename(rel.naming_id, '')}>
										(name...)
									</span>
								{/if}
								{#if rel.is_collapsed && rel.current_inscription && rel.current_inscription !== rel.inscription}
									<span class="collapsed-current">currently: {rel.current_inscription}</span>
								{/if}
							</div>
							<div class="el-actions">
								<select
									value={rel.designation || 'cue'}
									onchange={e => startDesignation(rel.naming_id, (e.target as HTMLSelectElement).value)}
								>
									<option value="cue">cue</option>
									<option value="characterization">characterization</option>
									<option value="specification">specification</option>
								</select>
								<button class="btn-xs" title="naming stack" onclick={() => showHistory(rel.naming_id)}>
									stack
								</button>
								{#if relatingFrom && !relatingTo && relatingFrom !== rel.naming_id}
									<button class="btn-sm btn-relate" onclick={() => startRelation(relatingFrom!, rel.naming_id)}>
										connect
									</button>
								{:else if !relatingFrom}
									<button class="btn-sm" onclick={() => { relatingFrom = rel.naming_id; relatingTo = null; }}>
										relate
									</button>
								{/if}
								{#if assigningToPhase}
									<button class="btn-sm btn-phase" onclick={() => assignElement(assigningToPhase!, rel.naming_id)}>
										+ phase
									</button>
								{/if}
							</div>
						</div>

						{#if historyId === rel.naming_id && historyData}
							<div class="history-panel">
								{#if rel.is_collapsed}
									<button class="btn-xs btn-unpin" onclick={() => unpinLayer(rel.naming_id)}>
										unpin (show latest)
									</button>
								{/if}
								{#if historyData.inscriptions.length > 1}
									<div class="history-section">
										<span class="history-label">Inscriptions</span>
										{#each historyData.inscriptions as hi}
											<div class="history-entry" class:pinned-layer={rel.is_collapsed && rel.properties?.collapseAt === hi.seq}>
												<span class="he-value">{hi.inscription}</span>
												<span class="he-by">{hi.by_inscription}</span>
												<span class="he-date">{new Date(hi.created_at).toLocaleString()}</span>
												<button class="btn-xs btn-pin" title="Pin to this layer" onclick={() => pinToLayer(rel.naming_id, hi.seq)}>
													pin
												</button>
											</div>
										{/each}
									</div>
								{/if}
								<div class="history-section">
									<span class="history-label">Designations</span>
									{#each historyData.designations as hd}
										<div class="history-entry">
											<span class="designation-dot-sm" style="background: {designationColor(hd.designation)}"></span>
											<span class="he-value">{hd.designation}</span>
											<span class="he-by">{hd.by_inscription}</span>
											<span class="he-date">{new Date(hd.created_at).toLocaleString()}</span>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					{/each}
				</div>
			{/if}

			<!-- Silences -->
			{#if silences.length > 0}
				<h3 class="section-header">Silences</h3>
				<div class="element-list">
					{#each silences as s}
						<div class="element-card silence-card" class:ai-suggested={s.properties?.aiSuggested === true} title={s.properties?.aiReasoning || ''}>
							<span class="provenance-indicator" title={s.has_document_anchor ? 'Empirically grounded' : s.has_memo_link ? 'Analytically grounded' : 'No grounding yet'}>{s.has_document_anchor ? '📄' : s.has_memo_link ? '📝' : '∅'}</span>
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
					<div class="phase-card" class:assigning={assigningToPhase === phase.id} class:expanded={expandedPhase === phase.id}>
						<div class="phase-header">
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span class="phase-label clickable" onclick={() => togglePhase(phase.id)}>{phase.label}</span>
							<span class="phase-count">{phase.element_count}</span>
						</div>
						<div class="phase-actions">
							<button
								class="btn-xs"
								onclick={() => assigningToPhase = assigningToPhase === phase.id ? null : phase.id}
							>
								{assigningToPhase === phase.id ? 'done' : 'assign'}
							</button>
						</div>

						{#if expandedPhase === phase.id}
							<div class="phase-contents">
								{#if phaseContents.length === 0}
									<p class="empty-small">No elements assigned yet.</p>
								{:else}
									{#each phaseContents as pc}
										<div class="phase-element">
											<span class="designation-dot-sm" style="background: {designationColor(pc.designation)}"></span>
											{#if pc.is_collapsed}
												<span class="collapsed-indicator" title="Pinned at assignment">&#x1F4CC;</span>
											{/if}
											<span class="phase-el-label">{pc.inscription}</span>
											{#if pc.mode === 'relation'}
												<span class="phase-el-mode">rel</span>
											{:else if pc.mode === 'silence'}
												<span class="phase-el-mode">silence</span>
											{/if}
											{#if pc.is_collapsed && pc.current_inscription && pc.current_inscription !== pc.inscription}
												<span class="collapsed-current-sm">now: {pc.current_inscription}</span>
											{/if}
											<button class="btn-xs btn-remove" title="Remove from phase" onclick={() => removeElementFromPhase(phase.id, pc.naming_id)}>×</button>
										</div>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

<svelte:window onkeydown={e => { if (e.key === 'Escape') { cancelRelation(); cancelAct(); assigningToPhase = null; editingId = null; } }} />

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
	.btn-sm-primary {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 5px;
		padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer;
		margin-top: 0.5rem;
	}

	.relation-form {
		background: #161822; border: 1px solid #8b9cf7; border-radius: 8px;
		padding: 0.75rem 1rem; margin-bottom: 1rem;
	}
	.rel-form-header {
		display: flex; align-items: center; justify-content: space-between;
		margin-bottom: 0.6rem;
	}
	.rel-form-elements { font-size: 0.9rem; color: #e1e4e8; font-weight: 500; }
	.rel-form-arrow { color: #8b9cf7; margin: 0 0.35rem; }
	.rel-form-fields { display: flex; flex-direction: column; gap: 0.4rem; }
	.rel-form-fields label { display: flex; flex-direction: column; gap: 0.15rem; }
	.field-label { font-size: 0.7rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
	.rel-form-fields input[type="text"] {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.4rem 0.5rem; color: #e1e4e8; font-size: 0.85rem;
	}
	.rel-form-fields input[type="text"]:focus { outline: none; border-color: #8b9cf7; }
	.rel-form-row {
		display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem;
	}
	.toggle-label {
		display: flex; align-items: center; gap: 0.35rem;
		font-size: 0.8rem; color: #8b8fa3; cursor: pointer; flex-direction: row;
	}
	.toggle-label input[type="checkbox"] { accent-color: #8b9cf7; }
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
	.phase-label.clickable { cursor: pointer; }
	.phase-label.clickable:hover { color: #8b9cf7; }
	.phase-count { font-size: 0.7rem; color: #6b7280; }
	.phase-card.expanded { border-color: #4b5563; }
	.phase-actions { margin-bottom: 0.25rem; }

	.phase-contents {
		border-top: 1px solid #2a2d3a; padding-top: 0.4rem; margin-top: 0.3rem;
	}
	.phase-element {
		display: flex; align-items: center; gap: 0.3rem;
		padding: 0.2rem 0; font-size: 0.75rem; color: #c9cdd5;
	}
	.phase-el-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.phase-el-mode { font-size: 0.6rem; color: #6b7280; font-style: italic; }
	.collapsed-current-sm { font-size: 0.6rem; color: #4b5563; font-style: italic; }
	.btn-remove { color: #6b7280; border-color: transparent; padding: 0 0.2rem; }
	.btn-remove:hover { color: #ef4444; }

	/* Inline rename */
	.editable { cursor: pointer; }
	.editable:hover { text-decoration: underline dotted; text-underline-offset: 3px; }
	.unnamed { color: #4b5563; font-style: italic; }
	.inline-rename {
		display: flex; align-items: center; gap: 0.3rem;
	}
	.inline-rename input {
		background: #0f1117; border: 1px solid #8b9cf7; border-radius: 4px;
		padding: 0.2rem 0.4rem; color: #e1e4e8; font-size: 0.85rem; width: 200px;
	}

	/* Provenance indicators */
	.provenance-indicator {
		font-size: 0.6rem; cursor: default; flex-shrink: 0;
		opacity: 0.7; min-width: 0.9rem; text-align: center;
	}

	/* Naming act prompt */
	.act-prompt {
		background: #161822; border: 1px solid #f59e0b; border-radius: 8px;
		padding: 0.75rem 1rem; margin: 0.75rem 0;
	}
	.act-header { font-size: 0.85rem; color: #c9cdd5; margin-bottom: 0.4rem; }
	.act-prompt textarea {
		width: 100%; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.4rem 0.5rem; color: #e1e4e8; font-size: 0.85rem; resize: vertical;
		font-family: inherit;
	}
	.act-prompt textarea:focus { outline: none; border-color: #8b9cf7; }
	.act-links-toggle { margin-top: 0.35rem; }
	.act-links-list {
		display: flex; flex-direction: column; gap: 0.15rem;
		max-height: 150px; overflow-y: auto;
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.4rem; margin-top: 0.25rem;
	}
	.act-link-item {
		display: flex; align-items: center; gap: 0.35rem;
		font-size: 0.8rem; color: #c9cdd5; cursor: pointer;
		padding: 0.15rem 0.2rem; border-radius: 3px;
	}
	.act-link-item:hover { background: #1e2030; }
	.act-link-item input[type="checkbox"] { accent-color: #8b9cf7; }
	.act-actions { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.4rem; }

	/* History panel */
	.history-panel {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.6rem 0.75rem; margin-top: -0.1rem; margin-bottom: 0.2rem;
	}
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
	.designation-dot-sm {
		width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
	}

	/* Collapsed / pinned layer */
	.collapsed-indicator {
		font-size: 0.6rem;
		color: #f59e0b;
		margin-right: 0.2rem;
	}
	.collapsed-current {
		font-size: 0.7rem;
		color: #6b7280;
		font-style: italic;
		margin-left: 0.5rem;
	}
	.btn-pin {
		margin-left: auto;
		border-color: #f59e0b;
		color: #f59e0b;
	}
	.btn-pin:hover { background: rgba(245, 158, 11, 0.1); }
	.btn-unpin {
		border-color: #f59e0b;
		color: #f59e0b;
		margin-bottom: 0.4rem;
	}
	.btn-unpin:hover { background: rgba(245, 158, 11, 0.1); }
	.pinned-layer {
		background: rgba(245, 158, 11, 0.1);
		border-radius: 3px;
		padding: 0.1rem 0.3rem;
	}

	/* AI controls */
	.ai-controls {
		display: flex; align-items: center; gap: 0.4rem; margin-left: 0.75rem;
	}

	.btn-ai-toggle {
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #6b7280; font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.5rem;
		cursor: pointer; letter-spacing: 0.04em; transition: all 0.15s ease;
	}
	.btn-ai-toggle.ai-active {
		background: rgba(139, 156, 247, 0.15); border-color: #8b9cf7; color: #8b9cf7;
	}
	.btn-ai-toggle:hover { border-color: #8b9cf7; }

	.btn-ask-ai {
		border-color: #8b9cf7; color: #8b9cf7;
	}
	.btn-ask-ai:disabled { opacity: 0.4; cursor: not-allowed; }

	/* AI notification toast */
	.ai-notification {
		position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 100;
		background: #1e2030; border: 1px solid #8b9cf7; border-radius: 6px;
		padding: 0.5rem 1rem; font-size: 0.8rem; color: #c9cdd5;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
	}

	/* AI-suggested elements */
	.ai-suggested {
		border-style: dashed !important;
		border-color: rgba(139, 156, 247, 0.5) !important;
		background: rgba(139, 156, 247, 0.04) !important;
	}
</style>
