<script lang="ts">
	let { data } = $props();

	// ---- Types ----
	type NamingRow = {
		naming_id: string;
		inscription: string;
		current_inscription: string | null;
		designation: string | null;
		mode: string | null;
		directed_from: string | null;
		directed_to: string | null;
		source_inscription: string | null;
		target_inscription: string | null;
		valence: string | null;
		has_document_anchor: boolean;
		has_memo_link: boolean;
		properties: Record<string, any> | null;
		appears_on_maps: { id: string; label: string }[] | null;
		created_at: string;
		seq: string;
	};

	type StackData = {
		inscriptions: any[];
		designations: any[];
		memos: any[];
		discussion?: any[];
		aiReasoning?: string | null;
		aiSuggested?: boolean;
		aiWithdrawn?: boolean;
	};

	// ---- State ----
	let namings = $derived<NamingRow[]>(data.namings);
	let filterCCS = $state<'all' | 'cue' | 'characterization' | 'specification'>('all');
	let filterGrounding = $state<'all' | 'grounded' | 'memo' | 'ungrounded'>('all');
	let filterMode = $state<'all' | 'entity' | 'relation' | 'silence'>('all');
	let searchQuery = $state('');
	let hideAI = $state(false);
	let hideWithdrawn = $state(true);

	let newNamingValue = $state('');
	let creatingNaming = $state(false);

	let editingId = $state<string | null>(null);
	let editingValue = $state('');

	// Valence editing (separate from inscription rename)
	let editingValenceId = $state<string | null>(null);
	let editingValenceValue = $state('');

	let stackId = $state<string | null>(null);
	let stackData = $state<StackData | null>(null);

	// Act-prompt state
	let actTarget = $state<string | null>(null);
	let actType = $state<'rename' | 'designate' | 'relate'>('rename');
	let actNewValue = $state('');
	let actMemo = $state('');
	let actLinkedIds = $state<string[]>([]);
	let showActLinks = $state(false);

	// Relate mode
	let relateSource = $state<string | null>(null);

	// Reify-as-relation mode: entity → relation
	// Step 1: pick source, Step 2: pick target
	let reifyNamingId = $state<string | null>(null);
	let reifySourceId = $state<string | null>(null);

	// Local withdrawn set (keeps items visible until next page load)
	let localWithdrawn = $state<Set<string>>(new Set());

	// ---- Helpers ----
	function designationColor(d: string | null | undefined) {
		if (d === 'specification') return '#10b981';
		if (d === 'characterization') return '#f59e0b';
		return '#6b7280';
	}

	function designationLabel(d: string | null | undefined) {
		if (d === 'specification') return 'spec';
		if (d === 'characterization') return 'char';
		return 'cue';
	}

	// Check if a string contains UUIDs (technical noise, not user-facing)
	const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
	function hasMeaningfulInscription(text: string | null | undefined): boolean {
		if (!text?.trim()) return false;
		return !UUID_RE.test(text);
	}

	function isWithdrawn(namingId: string, props: any): boolean {
		return localWithdrawn.has(namingId) || props?.withdrawn === true || props?.aiWithdrawn === true;
	}

	// ---- Escape key handler ----
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (actTarget) { cancelAct(); e.preventDefault(); return; }
			if (reifyNamingId) { cancelReify(); e.preventDefault(); return; }
			if (relateSource) { cancelRelate(); e.preventDefault(); return; }
			if (editingValenceId) { editingValenceId = null; e.preventDefault(); return; }
			if (editingId) { editingId = null; e.preventDefault(); return; }
			if (stackId) { stackId = null; stackData = null; e.preventDefault(); return; }
		}
	}

	// ---- Filtering ----
	const filtered = $derived.by(() => {
		let result = namings as NamingRow[];

		if (filterCCS !== 'all') {
			result = result.filter(n => (n.designation || 'cue') === filterCCS);
		}
		if (filterGrounding === 'grounded') {
			result = result.filter(n => n.has_document_anchor);
		} else if (filterGrounding === 'memo') {
			result = result.filter(n => n.has_memo_link && !n.has_document_anchor);
		} else if (filterGrounding === 'ungrounded') {
			result = result.filter(n => !n.has_document_anchor && !n.has_memo_link);
		}
		if (filterMode !== 'all') {
			result = result.filter(n => (n.mode || 'entity') === filterMode);
		}
		if (hideAI) {
			result = result.filter(n =>
				!n.properties?.aiSuggested
				&& !(n.current_inscription || n.inscription).startsWith('AI:')
				&& !(n.source_inscription?.startsWith('AI:'))
				&& !(n.target_inscription?.startsWith('AI:'))
			);
		}
		if (hideWithdrawn) {
			result = result.filter(n => !isWithdrawn(n.naming_id, n.properties));
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(n =>
				(n.current_inscription || n.inscription).toLowerCase().includes(q)
			);
		}
		return result;
	});

	const entities = $derived(filtered.filter(n => (n.mode || 'entity') === 'entity'));
	const relations = $derived(filtered.filter(n => n.mode === 'relation'));
	const silences = $derived(filtered.filter(n => n.mode === 'silence'));

	const counts = $derived({
		total: (namings as NamingRow[]).length,
		cue: (namings as NamingRow[]).filter(n => (n.designation || 'cue') === 'cue').length,
		char: (namings as NamingRow[]).filter(n => n.designation === 'characterization').length,
		spec: (namings as NamingRow[]).filter(n => n.designation === 'specification').length
	});

	// ---- API ----
	async function apiAction(action: string, params: Record<string, any> = {}) {
		const res = await fetch(`/api/projects/${data.projectId}/namings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ...params })
		});
		return res.json();
	}

	// ---- Create ----
	async function createNaming() {
		if (!newNamingValue.trim() || creatingNaming) return;
		creatingNaming = true;
		await apiAction('create', { inscription: newNamingValue.trim() });
		newNamingValue = '';
		creatingNaming = false;
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	// ---- Stack ----
	async function showStack(namingId: string) {
		if (stackId === namingId) { stackId = null; stackData = null; return; }
		stackId = namingId;
		stackData = await apiAction('getStack', { namingId });
	}

	// ---- Inline Rename ----
	function startRename(namingId: string, currentInscription: string) {
		editingId = namingId;
		editingValue = currentInscription;
	}

	function confirmRename() {
		if (!editingId || !editingValue.trim()) { editingId = null; return; }
		actTarget = editingId;
		actType = 'rename';
		actNewValue = editingValue.trim();
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
		editingId = null;
	}

	// ---- Designation ----
	function startDesignation(namingId: string, designation: string) {
		actTarget = namingId;
		actType = 'designate';
		actNewValue = designation;
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
	}

	// ---- Valence ----
	function startValenceEdit(namingId: string, currentValence: string) {
		editingValenceId = namingId;
		editingValenceValue = currentValence;
	}

	async function confirmValence() {
		if (!editingValenceId) { editingValenceId = null; return; }
		await apiAction('setValence', { namingId: editingValenceId, valence: editingValenceValue.trim() });
		editingValenceId = null;
		editingValenceValue = '';
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	// ---- Relate ----
	async function startRelate(namingId: string) {
		if (relateSource && relateSource !== namingId) {
			// Second click: create relation immediately
			const src = relateSource;
			relateSource = null;
			await apiAction('relate', { sourceId: src, targetId: namingId });
			const module = await import('$app/navigation');
			module.invalidateAll();
		} else if (relateSource === namingId) {
			// Clicked same naming again: cancel
			relateSource = null;
		} else {
			relateSource = namingId;
		}
	}

	function cancelRelate() {
		relateSource = null;
	}

	// ---- Act-prompt actions ----
	async function submitAct() {
		if (!actTarget) return;

		if (actType === 'rename') {
			await apiAction('rename', {
				namingId: actTarget,
				inscription: actNewValue,
				memoText: actMemo,
				linkedNamingIds: actLinkedIds
			});
		} else if (actType === 'designate') {
			await apiAction('designate', {
				namingId: actTarget,
				designation: actNewValue,
				memoText: actMemo,
				linkedNamingIds: actLinkedIds
			});
		}

		actTarget = null;
		actMemo = '';
		actLinkedIds = [];
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	async function skipAct() {
		if (!actTarget) return;

		if (actType === 'rename') {
			await apiAction('rename', { namingId: actTarget, inscription: actNewValue });
		} else if (actType === 'designate') {
			await apiAction('designate', { namingId: actTarget, designation: actNewValue });
		}

		actTarget = null;
		actMemo = '';
		actLinkedIds = [];
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	function cancelAct() {
		actTarget = null;
		actMemo = '';
		actLinkedIds = [];
	}

	// ---- Withdraw ----
	async function withdraw(namingId: string) {
		// Mark locally first so the item stays in place with visual feedback
		localWithdrawn = new Set([...localWithdrawn, namingId]);
		await apiAction('withdraw', { namingId });
		// Don't invalidate — item stays visible (struck through) until next navigation
	}

	// ---- Mode switching ----
	async function switchToEntity(namingId: string) {
		await apiAction('switchToEntity', { namingId });
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	function startReifyAsRelation(namingId: string) {
		reifyNamingId = namingId;
		reifySourceId = null;
	}

	async function reifyPickTarget(targetId: string) {
		if (!reifyNamingId || !reifySourceId) return;
		await apiAction('reifyAsRelation', {
			namingId: reifyNamingId,
			sourceId: reifySourceId,
			targetId
		});
		reifyNamingId = null;
		reifySourceId = null;
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	function reifyPickSource(sourceId: string) {
		reifySourceId = sourceId;
	}

	function cancelReify() {
		reifyNamingId = null;
		reifySourceId = null;
	}

	function findNaming(id: string): NamingRow | undefined {
		return (namings as NamingRow[]).find(n => n.naming_id === id);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="namings-page">
	<!-- Header -->
	<div class="header">
		<h1>Namings</h1>
		<form class="create-form" onsubmit={e => { e.preventDefault(); createNaming(); }}>
			<input
				type="text"
				class="create-input"
				placeholder="New naming..."
				bind:value={newNamingValue}
				disabled={creatingNaming}
			/>
		</form>
		<span class="summary">
			{counts.total} total
			<span class="sep">|</span>
			<span style="color: #6b7280">{counts.cue} cue</span>
			<span class="sep">/</span>
			<span style="color: #f59e0b">{counts.char} char</span>
			<span class="sep">/</span>
			<span style="color: #10b981">{counts.spec} spec</span>
		</span>
	</div>

	<!-- Filters -->
	<div class="filter-bar">
		<div class="filter-group">
			<span class="filter-label">CCS</span>
			<button class="filter-btn" class:active={filterCCS === 'all'} onclick={() => filterCCS = 'all'}>All</button>
			<button class="filter-btn" class:active={filterCCS === 'cue'} onclick={() => filterCCS = 'cue'}>
				<span class="dot" style="background: #6b7280"></span> Cue
			</button>
			<button class="filter-btn" class:active={filterCCS === 'characterization'} onclick={() => filterCCS = 'characterization'}>
				<span class="dot" style="background: #f59e0b"></span> Char
			</button>
			<button class="filter-btn" class:active={filterCCS === 'specification'} onclick={() => filterCCS = 'specification'}>
				<span class="dot" style="background: #10b981"></span> Spec
			</button>
		</div>

		<div class="filter-group">
			<span class="filter-label">Grounding</span>
			<button class="filter-btn" class:active={filterGrounding === 'all'} onclick={() => filterGrounding = 'all'}>All</button>
			<button class="filter-btn" class:active={filterGrounding === 'grounded'} onclick={() => filterGrounding = 'grounded'}>
				<img src="/icons/text_snippet.svg" alt="" class="filter-icon" /> Doc
			</button>
			<button class="filter-btn" class:active={filterGrounding === 'memo'} onclick={() => filterGrounding = 'memo'}>
				<img src="/icons/stylus_note.svg" alt="" class="filter-icon" /> Memo
			</button>
			<button class="filter-btn" class:active={filterGrounding === 'ungrounded'} onclick={() => filterGrounding = 'ungrounded'}>
				<img src="/icons/question_mark.svg" alt="" class="filter-icon" /> None
			</button>
		</div>

		<div class="filter-group">
			<span class="filter-label">Mode</span>
			<button class="filter-btn" class:active={filterMode === 'all'} onclick={() => filterMode = 'all'}>All</button>
			<button class="filter-btn" class:active={filterMode === 'entity'} onclick={() => filterMode = 'entity'}>Entity</button>
			<button class="filter-btn" class:active={filterMode === 'relation'} onclick={() => filterMode = 'relation'}>Relation</button>
			<button class="filter-btn" class:active={filterMode === 'silence'} onclick={() => filterMode = 'silence'}>Silence</button>
		</div>

		<div class="filter-group">
			<button class="filter-btn toggle" class:active={hideWithdrawn} onclick={() => hideWithdrawn = !hideWithdrawn}>Hide withdrawn</button>
			<button class="filter-btn toggle" class:active={hideAI} onclick={() => hideAI = !hideAI}>Hide AI</button>
		</div>

		<input
			class="search-input"
			type="text"
			placeholder="Search..."
			bind:value={searchQuery}
		/>
	</div>

	<!-- Relate mode indicator -->
	{#if relateSource}
		{@const srcNaming = findNaming(relateSource)}
		<div class="relate-banner">
			Relating: <strong>{srcNaming?.current_inscription || srcNaming?.inscription}</strong> — click another naming to connect
			<button class="btn-xs" onclick={cancelRelate}>cancel</button>
		</div>
	{/if}

	<!-- Reify-as-relation mode indicator -->
	{#if reifyNamingId}
		{@const reifyNaming = findNaming(reifyNamingId)}
		<div class="relate-banner">
			{#if !reifySourceId}
				<strong>{reifyNaming?.current_inscription || reifyNaming?.inscription}</strong> → Relation: click the <strong>source</strong> naming
			{:else}
				{@const srcNaming = findNaming(reifySourceId)}
				<strong>{reifyNaming?.current_inscription || reifyNaming?.inscription}</strong>: <strong>{srcNaming?.current_inscription || srcNaming?.inscription}</strong> → click the <strong>target</strong> naming
			{/if}
			<button class="btn-xs" onclick={cancelReify}>cancel</button>
		</div>
	{/if}

	<!-- Act-prompt bar -->
	{#if actTarget}
		{@const targetNaming = findNaming(actTarget)}
		{@const allOtherNamings = (namings as NamingRow[]).filter(n => n.naming_id !== actTarget && n.mode !== 'relation')}
		<div class="act-prompt-bar">
			<div class="act-header">
				{#if actType === 'rename'}
					Rename: <strong>{targetNaming?.current_inscription || targetNaming?.inscription}</strong> → <strong>{actNewValue}</strong>
				{:else if actType === 'designate'}
					Designation: <strong>{targetNaming?.current_inscription || targetNaming?.inscription}</strong> →
					<span style="color: {designationColor(actNewValue)}">{actNewValue}</span>
				{/if}
			</div>
			<textarea
				placeholder="What influenced this act? What changed in your understanding?"
				bind:value={actMemo}
				rows="2"
			></textarea>
			{#if showActLinks}
				<div class="act-links">
					{#each allOtherNamings as n (n.naming_id)}
						<label class="act-link-item">
							<input
								type="checkbox"
								checked={actLinkedIds.includes(n.naming_id)}
								onchange={() => {
									if (actLinkedIds.includes(n.naming_id)) {
										actLinkedIds = actLinkedIds.filter(id => id !== n.naming_id);
									} else {
										actLinkedIds = [...actLinkedIds, n.naming_id];
									}
								}}
							/>
							{n.current_inscription || n.inscription}
						</label>
					{/each}
				</div>
			{/if}
			<div class="act-bottom">
				<button class="btn-link-toggle" onclick={() => showActLinks = !showActLinks}>
					{showActLinks ? 'hide links' : 'link namings...'}
				</button>
				<div class="act-actions">
					<button class="btn-primary btn-sm-primary" onclick={submitAct}>Apply + memo</button>
					<button class="btn-link" onclick={skipAct}>skip memo</button>
					<button class="btn-link" onclick={cancelAct}>cancel</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Entities -->
	{#if entities.length > 0}
		<div class="section">
			<h2 class="section-label">Entities <span class="section-count">{entities.length}</span></h2>
			<div class="naming-list">
				{#each entities as n (n.naming_id)}
					{@const withdrawn = isWithdrawn(n.naming_id, n.properties)}
					<div class="naming-card" class:withdrawn class:relate-target={(relateSource && relateSource !== n.naming_id) || (reifyNamingId && reifyNamingId !== n.naming_id)}>
						<div class="naming-main" onclick={() => {
							if (relateSource) { startRelate(n.naming_id); return; }
							if (reifyNamingId && reifyNamingId !== n.naming_id) {
								if (!reifySourceId) { reifyPickSource(n.naming_id); return; }
								reifyPickTarget(n.naming_id); return;
							}
						}}>
							<span class="designation-dot" style="background: {designationColor(n.designation)}" title="{designationLabel(n.designation)}"></span>
							{#if n.has_document_anchor}
								<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
							{:else if n.has_memo_link}
								<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Memo linked" />
							{:else}
								<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
							{/if}

							{#if editingId === n.naming_id}
								<form class="inline-rename" onsubmit={e => { e.preventDefault(); confirmRename(); }}>
									<input type="text" bind:value={editingValue} />
									<button type="submit" class="btn-xs">ok</button>
									<button type="button" class="btn-xs" onclick={() => editingId = null}>x</button>
								</form>
							{:else}
								<span
									class="naming-inscription"
									class:editable={!relateSource}
									ondblclick={() => startRename(n.naming_id, n.current_inscription || n.inscription)}
									onclick={() => !relateSource && showStack(n.naming_id)}
								>
									{n.current_inscription || n.inscription}
								</span>
							{/if}
						</div>

						<div class="naming-actions">
							<select
								value={n.designation || 'cue'}
								onchange={e => startDesignation(n.naming_id, (e.target as HTMLSelectElement).value)}
							>
								<option value="cue">cue</option>
								<option value="characterization">characterization</option>
								<option value="specification">specification</option>
							</select>
							<button class="btn-xs" onclick={() => showStack(n.naming_id)}>stack</button>
							<button class="btn-xs" onclick={() => startRelate(n.naming_id)}>relate</button>
							<button class="btn-xs btn-mode" onclick={() => startReifyAsRelation(n.naming_id)}>→ relation</button>
							<button class="btn-xs btn-withdraw" onclick={() => withdraw(n.naming_id)}>
								{withdrawn ? 'restore' : 'withdraw'}
							</button>
						</div>

						<!-- Map appearances -->
						{#if n.appears_on_maps && n.appears_on_maps.length > 0}
							<div class="map-links">
								{#each n.appears_on_maps as m (m.id)}
									<a href="/projects/{data.projectId}/maps/{m.id}" class="map-link">{m.label}</a>
								{/each}
							</div>
						{/if}

						<!-- Inline stack panel -->
						{#if stackId === n.naming_id && stackData}
							<div class="stack-panel">
								{#if stackData.inscriptions.length > 0}
									<div class="stack-section">
										<h4>Inscription Chain</h4>
										{#each stackData.inscriptions as hi}
											<div class="history-entry">
												<span class="he-value">{hi.inscription}</span>
												<span class="he-by">{hi.by_inscription}</span>
												<span class="he-date">{new Date(hi.created_at).toLocaleString()}</span>
											</div>
										{/each}
									</div>
								{/if}
								{#if stackData.designations.length > 0}
									<div class="stack-section">
										<h4>Designation Chain</h4>
										{#each stackData.designations as hd}
											<div class="history-entry">
												<span class="he-value" style="color: {designationColor(hd.designation)}">{hd.designation}</span>
												<span class="he-by">{hd.by_inscription}</span>
												<span class="he-date">{new Date(hd.created_at).toLocaleString()}</span>
											</div>
										{/each}
									</div>
								{/if}
								{#if stackData.memos.length > 0}
									<div class="stack-section">
										<h4>Memos</h4>
										{#each stackData.memos as memo}
											<div class="memo-entry">
												<span class="memo-label">{memo.label}</span>
												<div class="memo-content">{@html memo.content}</div>
											</div>
										{/each}
									</div>
								{/if}
								{#if stackData.discussion && stackData.discussion.length > 0}
									<div class="stack-section">
										<h4>AI Discussion</h4>
										{#each stackData.discussion as msg}
											<div class="discussion-msg" class:ai={msg.role === 'ai'}>
												<span class="msg-role">{msg.role}</span>
												<span class="msg-content">{msg.content}</span>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Relations -->
	{#if relations.length > 0}
		<div class="section">
			<h2 class="section-label">Relations <span class="section-count">{relations.length}</span></h2>
			<div class="naming-list">
				{#each relations as n (n.naming_id)}
					{@const withdrawn = isWithdrawn(n.naming_id, n.properties)}
					{@const hasInscription = hasMeaningfulInscription(n.current_inscription || n.inscription)}
					<div class="naming-card relation-card" class:withdrawn>
						<div class="naming-main">
							<span class="designation-dot" style="background: {designationColor(n.designation)}" title="{designationLabel(n.designation)}"></span>
							{#if n.has_document_anchor}
								<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
							{:else if n.has_memo_link}
								<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Memo linked" />
							{:else}
								<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
							{/if}

							<div class="relation-proposition">
								{#if hasInscription}
									<span
										class="rel-title editable"
										ondblclick={() => startRename(n.naming_id, n.current_inscription || n.inscription)}
										onclick={() => showStack(n.naming_id)}
									>{n.current_inscription || n.inscription}:</span>
								{/if}
								<span class="rel-source">{n.source_inscription || '?'}</span>
								<span class="rel-connector">—</span>
								{#if editingValenceId === n.naming_id}
									<form class="inline-rename" onsubmit={e => { e.preventDefault(); confirmValence(); }}>
										<input type="text" bind:value={editingValenceValue} placeholder="valence" />
										<button type="submit" class="btn-xs">ok</button>
										<button type="button" class="btn-xs" onclick={() => editingValenceId = null}>x</button>
									</form>
									<span class="rel-connector">—</span>
								{:else if n.valence}
									<span
										class="rel-predicate"
										ondblclick={() => startValenceEdit(n.naming_id, n.valence || '')}
										onclick={() => showStack(n.naming_id)}
									>{n.valence}</span>
									<span class="rel-connector">—</span>
								{:else}
									<span
										class="rel-predicate-empty"
										ondblclick={() => startValenceEdit(n.naming_id, '')}
									>+ valence</span>
									<span class="rel-connector">—</span>
								{/if}
								<span class="rel-target">{n.target_inscription || '?'}</span>
							</div>
						</div>

						<div class="naming-actions">
							<select
								value={n.designation || 'cue'}
								onchange={e => startDesignation(n.naming_id, (e.target as HTMLSelectElement).value)}
							>
								<option value="cue">cue</option>
								<option value="characterization">characterization</option>
								<option value="specification">specification</option>
							</select>
							<button class="btn-xs" onclick={() => showStack(n.naming_id)}>stack</button>
							<button class="btn-xs btn-mode" onclick={() => switchToEntity(n.naming_id)}>→ entity</button>
							<button class="btn-xs btn-withdraw" onclick={() => withdraw(n.naming_id)}>
								{withdrawn ? 'restore' : 'withdraw'}
							</button>
						</div>

						{#if n.appears_on_maps && n.appears_on_maps.length > 0}
							<div class="map-links">
								{#each n.appears_on_maps as m (m.id)}
									<a href="/projects/{data.projectId}/maps/{m.id}" class="map-link">{m.label}</a>
								{/each}
							</div>
						{/if}

						{#if stackId === n.naming_id && stackData}
							<div class="stack-panel">
								{#if stackData.inscriptions.length > 0}
									<div class="stack-section">
										<h4>Inscription Chain</h4>
										{#each stackData.inscriptions as hi}
											<div class="history-entry">
												<span class="he-value">{hi.inscription}</span>
												<span class="he-by">{hi.by_inscription}</span>
												<span class="he-date">{new Date(hi.created_at).toLocaleString()}</span>
											</div>
										{/each}
									</div>
								{/if}
								{#if stackData.designations.length > 0}
									<div class="stack-section">
										<h4>Designation Chain</h4>
										{#each stackData.designations as hd}
											<div class="history-entry">
												<span class="he-value" style="color: {designationColor(hd.designation)}">{hd.designation}</span>
												<span class="he-by">{hd.by_inscription}</span>
												<span class="he-date">{new Date(hd.created_at).toLocaleString()}</span>
											</div>
										{/each}
									</div>
								{/if}
								{#if stackData.memos.length > 0}
									<div class="stack-section">
										<h4>Memos</h4>
										{#each stackData.memos as memo}
											<div class="memo-entry">
												<span class="memo-label">{memo.label}</span>
												<div class="memo-content">{@html memo.content}</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Silences -->
	{#if silences.length > 0}
		<div class="section">
			<h2 class="section-label">Silences <span class="section-count">{silences.length}</span></h2>
			<div class="naming-list">
				{#each silences as n (n.naming_id)}
					<div class="naming-card silence-card">
						<div class="naming-main">
							<span class="designation-dot" style="background: {designationColor(n.designation)}"></span>
							<span class="naming-inscription" onclick={() => showStack(n.naming_id)}>
								{n.current_inscription || n.inscription}
							</span>
						</div>
						<div class="naming-actions">
							<button class="btn-xs" onclick={() => showStack(n.naming_id)}>stack</button>
						</div>

						{#if stackId === n.naming_id && stackData}
							<div class="stack-panel">
								{#if stackData.inscriptions.length > 0}
									<div class="stack-section">
										<h4>Inscription Chain</h4>
										{#each stackData.inscriptions as hi}
											<div class="history-entry">
												<span class="he-value">{hi.inscription}</span>
												<span class="he-by">{hi.by_inscription}</span>
												<span class="he-date">{new Date(hi.created_at).toLocaleString()}</span>
											</div>
										{/each}
									</div>
								{/if}
								{#if stackData.designations.length > 0}
									<div class="stack-section">
										<h4>Designation Chain</h4>
										{#each stackData.designations as hd}
											<div class="history-entry">
												<span class="he-value" style="color: {designationColor(hd.designation)}">{hd.designation}</span>
												<span class="he-by">{hd.by_inscription}</span>
												<span class="he-date">{new Date(hd.created_at).toLocaleString()}</span>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if filtered.length === 0}
		<p class="empty">No namings match your filters.</p>
	{/if}
</div>

<style>
	.namings-page {
		max-width: 800px;
		padding-bottom: 2rem;
	}

	/* Header */
	.header {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	h1 { font-size: 1.3rem; margin: 0; }
	.summary { font-size: 0.8rem; color: #6b7280; }
	.sep { color: #3a3d4a; margin: 0 0.15rem; }

	/* Create naming */
	.create-form { flex: 1; }
	.create-input {
		width: 100%;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 5px;
		padding: 0.35rem 0.55rem;
		color: #e1e4e8;
		font-size: 0.85rem;
		box-sizing: border-box;
	}
	.create-input:focus { outline: none; border-color: #8b9cf7; }
	.create-input::placeholder { color: #4b5563; }
	.create-input:disabled { opacity: 0.5; }

	/* Filters */
	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
		margin-bottom: 1.25rem;
	}
	.filter-group {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.filter-label {
		font-size: 0.7rem;
		color: #4b5563;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-right: 0.15rem;
	}
	.filter-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.3rem 0.55rem;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 5px;
		color: #9ca3af;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.filter-btn:hover { border-color: #4b5060; color: #e1e4e8; }
	.filter-btn.active { border-color: #8b9cf7; color: #e1e4e8; background: rgba(139, 156, 247, 0.08); }
	.filter-icon { width: 13px; height: 13px; opacity: 0.5; }
	.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.search-input {
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 5px;
		padding: 0.3rem 0.55rem;
		color: #e1e4e8;
		font-size: 0.8rem;
		width: 140px;
		margin-left: auto;
	}
	.search-input:focus { outline: none; border-color: #8b9cf7; }
	.search-input::placeholder { color: #4b5563; }

	/* Relate banner */
	.relate-banner {
		position: sticky;
		top: 0;
		z-index: 10;
		background: rgba(22, 24, 34, 0.95);
		border: 1px solid #8b9cf7;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		font-size: 0.85rem;
		color: #c9cdd5;
		margin-bottom: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* Act-prompt bar */
	.act-prompt-bar {
		background: #161822;
		border: 1px solid #f59e0b;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin-bottom: 0.75rem;
	}
	.act-header {
		font-size: 0.85rem;
		color: #c9cdd5;
		margin-bottom: 0.4rem;
	}
	.act-prompt-bar textarea {
		width: 100%;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 5px;
		padding: 0.4rem 0.5rem;
		color: #e1e4e8;
		font-size: 0.85rem;
		resize: vertical;
		font-family: inherit;
		box-sizing: border-box;
	}
	.act-prompt-bar textarea:focus { outline: none; border-color: #8b9cf7; }
	.act-links {
		max-height: 120px;
		overflow-y: auto;
		margin-top: 0.4rem;
		padding: 0.3rem;
		background: #0f1117;
		border-radius: 4px;
	}
	.act-link-item {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.75rem;
		color: #8b8fa3;
		padding: 0.1rem 0;
		cursor: pointer;
	}
	.act-link-item input { width: 14px; height: 14px; }
	.act-bottom {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.4rem;
	}
	.act-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.btn-primary { background: #8b9cf7; color: #0f1117; border: none; font-weight: 600; cursor: pointer; }
	.btn-sm-primary { padding: 0.3rem 0.7rem; border-radius: 5px; font-size: 0.8rem; }
	.btn-primary:hover { background: #a0aff9; }
	.btn-link { background: none; border: none; color: #6b7280; font-size: 0.75rem; cursor: pointer; }
	.btn-link:hover { color: #c9cdd5; }
	.btn-link-toggle { background: none; border: none; color: #4b5563; font-size: 0.7rem; cursor: pointer; }
	.btn-link-toggle:hover { color: #8b8fa3; }

	/* Sections */
	.section { margin-bottom: 1.5rem; }
	.section-label {
		font-size: 0.75rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.4rem;
		padding-left: 0.25rem;
	}
	.section-count {
		font-weight: 400;
		color: #4b5563;
	}

	/* Naming list */
	.naming-list {
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 0.25rem;
	}

	/* Naming card */
	.naming-card {
		padding: 0.5rem 0.65rem;
		border-radius: 5px;
	}
	.naming-card:hover { background: #1e2030; }
	.naming-card.withdrawn { opacity: 0.4; }
	.naming-card.withdrawn .naming-inscription { text-decoration: line-through; }
	.naming-card.relate-target { cursor: crosshair; }
	.naming-card.relate-target:hover { background: rgba(139, 156, 247, 0.12); }

	.naming-main {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.designation-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.provenance-indicator {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		opacity: 0.5;
	}

	.naming-inscription {
		flex: 1;
		font-size: 0.88rem;
		color: #e1e4e8;
		cursor: default;
	}
	.naming-inscription.editable { cursor: pointer; }
	.naming-inscription.editable:hover { color: #8b9cf7; }

	.naming-actions {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.2rem;
		padding-left: 1.6rem;
	}
	.naming-actions select {
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #8b8fa3;
		font-size: 0.7rem;
		padding: 0.2rem 0.3rem;
		cursor: pointer;
	}

	.btn-xs {
		background: none;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #8b8fa3;
		font-size: 0.7rem;
		padding: 0.15rem 0.35rem;
		cursor: pointer;
	}
	.btn-xs:hover { border-color: #4b5060; color: #e1e4e8; }
	.btn-icon { width: 14px; height: 14px; opacity: 0.5; display: block; }
	.btn-withdraw { border-color: #6b7280; color: #6b7280; font-size: 0.65rem; }
	.btn-withdraw:hover { background: rgba(107, 114, 128, 0.1); }
	.btn-mode { border-color: #8b9cf7; color: #8b9cf7; font-size: 0.65rem; opacity: 0.6; }
	.btn-mode:hover { opacity: 1; background: rgba(139, 156, 247, 0.08); }

	/* Inline rename */
	.inline-rename {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		flex: 1;
	}
	.inline-rename input {
		background: #0f1117;
		border: 1px solid #8b9cf7;
		border-radius: 4px;
		padding: 0.15rem 0.35rem;
		color: #e1e4e8;
		font-size: 0.85rem;
		flex: 1;
	}

	/* Relation card — proposition format */
	.relation-proposition {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
		flex: 1;
		min-width: 0;
		font-size: 0.82rem;
		flex-wrap: wrap;
	}
	.rel-title {
		color: #e1e4e8;
		font-weight: 600;
		cursor: default;
	}
	.rel-title.editable { cursor: pointer; }
	.rel-title.editable:hover { color: #8b9cf7; }
	.rel-source, .rel-target { color: #8b8fa3; }
	.rel-connector { color: #3a3d4a; }
	.rel-predicate {
		color: #f59e0b;
		cursor: default;
	}
	.rel-predicate:hover { color: #fbbf24; }
	.rel-predicate-empty {
		color: #3a3d4a;
		font-size: 0.72rem;
		cursor: pointer;
	}
	.rel-predicate-empty:hover { color: #6b7280; }

	/* Map links */
	.map-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.25rem;
		padding-left: 1.6rem;
	}
	.map-link {
		font-size: 0.65rem;
		color: #4b5563;
		background: #0f1117;
		padding: 0.1rem 0.4rem;
		border-radius: 3px;
		text-decoration: none;
	}
	.map-link:hover { color: #8b9cf7; }

	/* Stack panel */
	.stack-panel {
		margin-top: 0.4rem;
		padding: 0.5rem 0.65rem;
		padding-left: 1.6rem;
		border-top: 1px solid #2a2d3a;
	}
	.stack-section { margin-bottom: 0.5rem; }
	.stack-section h4 {
		font-size: 0.7rem;
		color: #4b5563;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.2rem;
	}
	.history-entry {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		color: #8b8fa3;
		padding: 0.1rem 0;
	}
	.he-value { color: #c9cdd5; }
	.he-by { color: #6b7280; }
	.he-by::before { content: '— '; }
	.he-date { color: #4b5563; margin-left: auto; font-size: 0.7rem; }

	.memo-entry { margin-bottom: 0.3rem; }
	.memo-label { font-size: 0.75rem; color: #f59e0b; }
	.memo-content { font-size: 0.75rem; color: #8b8fa3; margin-top: 0.1rem; }

	.discussion-msg {
		padding: 0.2rem 0;
		font-size: 0.75rem;
	}
	.discussion-msg .msg-role {
		color: #6b7280;
		font-size: 0.65rem;
		margin-right: 0.3rem;
	}
	.discussion-msg .msg-content { color: #c9cdd5; }
	.discussion-msg.ai .msg-role { color: #8b9cf7; }

	/* Silence */
	.silence-card { border-left: 2px solid #4b5563; }

	.empty { color: #6b7280; font-size: 0.9rem; }
</style>
