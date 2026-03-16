<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import { SW_ROLES } from '$lib/shared/constants.js';
	import type { SwRole } from '$lib/shared/types/index.js';

	let {
		viewMode,
		displayMode,
		centeredId,
		onswitchview,
		onsetdisplaymode,
		onrunautolayout,
		onuncenter,
		onopentopo,
	}: {
		viewMode: 'canvas' | 'list';
		displayMode: 'entities' | 'relations' | 'full';
		centeredId: string | null;
		onswitchview: (mode: 'canvas' | 'list') => void;
		onsetdisplaymode: (mode: 'entities' | 'relations' | 'full') => void;
		onrunautolayout: () => void;
		onuncenter: () => void;
		onopentopo: () => void;
	} = $props();

	const ms = getMapState();

	let newInscription = $state('');
	let newSwRole = $state<SwRole>('social-world');
	let adding = $state(false);
	let addInputRef = $state<HTMLInputElement | null>(null);

	// Placement search
	let placementResults = $state<any[]>([]);
	let placementOpen = $state(false);
	let placementLoading = $state(false);
	let placementDebounce: ReturnType<typeof setTimeout> | undefined;

	// Import
	let importDropdownOpen = $state(false);
	let importDocuments = $state<any[]>([]);
	let importLoading = $state(false);

	async function addElement() {
		if (!newInscription.trim()) return;
		adding = true;
		closePlacementDropdown();
		if (ms.mapType === 'social-worlds') {
			await ms.mapAction('addFormation', { inscription: newInscription.trim(), swRole: newSwRole });
		} else {
			await ms.mapAction('addElement', { inscription: newInscription.trim() });
		}
		newInscription = '';
		adding = false;
		await ms.reload();
	}

	function onAddInputChange(query: string) {
		clearTimeout(placementDebounce);
		if (query.trim().length < 2) { closePlacementDropdown(); return; }
		placementDebounce = setTimeout(() => searchPlacement(query.trim()), 300);
	}

	async function searchPlacement(query: string) {
		placementLoading = true;
		const res = await ms.mapAction('searchForPlacement', { query });
		if (res?.results) {
			placementResults = res.results;
			placementOpen = placementResults.length > 0 || query.length >= 2;
		}
		placementLoading = false;
	}

	async function placeExistingNaming(namingId: string) {
		closePlacementDropdown();
		adding = true;
		await ms.mapAction('placeExisting', { namingId });
		newInscription = '';
		adding = false;
		await ms.reload();
	}

	function closePlacementDropdown() {
		placementOpen = false;
		placementResults = [];
		clearTimeout(placementDebounce);
	}

	async function openImportDropdown() {
		if (importDropdownOpen) { importDropdownOpen = false; return; }
		importLoading = true;
		importDropdownOpen = true;
		const res = await ms.mapAction('listDocumentsForImport');
		if (res) importDocuments = res.documents || [];
		importLoading = false;
	}

	async function importFromDocument(documentId: string) {
		importDropdownOpen = false;
		const res = await ms.mapAction('importFromDocument', { documentId });
		if (res?.placed > 0) await ms.reload();
	}

	// Expose for parent escape handler
	export function closeDropdowns() {
		if (importDropdownOpen) { importDropdownOpen = false; return true; }
		if (placementOpen) { closePlacementDropdown(); return true; }
		return false;
	}
</script>

<div class="map-toolbar">
	<a href="/projects/{ms.projectId}/maps" class="back">&larr; Maps</a>
	<h2>{ms.mapLabel}</h2>
	<span class="map-type-badge">{ms.mapType}</span>

	{#if ms.designationProfile.length > 0}
		<div class="designation-profile">
			{#each ms.designationProfile as dp}
				<span class="dp-item" style="color: {ms.designationColor(dp.designation)}">
					{dp.count} {ms.designationLabel(dp.designation)}
				</span>
			{/each}
		</div>
	{/if}

	<div class="toolbar-actions">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="add-form-wrapper" onclick={(e) => e.stopPropagation()}>
			<form class="add-form" onsubmit={e => { e.preventDefault(); addElement(); }}>
				{#if ms.mapType === 'social-worlds'}
					<select class="sw-role-select" bind:value={newSwRole}>
						{#each SW_ROLES as role}
							<option value={role}>{role}</option>
						{/each}
					</select>
				{/if}
				<input type="text" placeholder={ms.mapType === 'social-worlds' ? 'Formation name...' : 'Name or search...'} bind:value={newInscription} bind:this={addInputRef} disabled={adding}
					oninput={(e) => onAddInputChange((e.target as HTMLInputElement).value)}
					onfocus={() => { if (newInscription.trim().length >= 2) onAddInputChange(newInscription); }}
					onblur={() => { setTimeout(() => closePlacementDropdown(), 200); }}
				/>
				<button type="submit" class="btn-primary" disabled={adding || !newInscription.trim()}>Add</button>
			</form>
			{#if placementOpen}
				<div class="placement-dropdown">
					{#if placementResults.length > 0}
						{#each placementResults as result}
							<button class="placement-item" onmousedown={(e) => { e.preventDefault(); placeExistingNaming(result.id); }}>
								<span class="placement-inscription">{result.inscription}</span>
								<span class="placement-badge" style="color: {ms.designationColor(result.designation)}; border-color: {ms.designationColor(result.designation)}">
									{ms.designationLabel(result.designation)}
								</span>
								<span class="placement-maps">{result.appearance_count} map{result.appearance_count === 1 ? '' : 's'}</span>
							</button>
						{/each}
					{:else if !placementLoading}
						<span class="placement-empty">No existing namings found</span>
					{/if}
					{#if placementLoading}
						<span class="placement-loading">searching...</span>
					{/if}
					<div class="placement-separator"></div>
					<button class="placement-item placement-create" onmousedown={(e) => { e.preventDefault(); addElement(); }}>
						<span class="placement-create-label">Create new:</span>
						<span class="placement-create-value">{newInscription.trim()}</span>
					</button>
				</div>
			{/if}
		</div>
		<div class="view-toggle">
			<button class="btn-view" class:active={viewMode === 'list'} onclick={() => onswitchview('list')}>List</button>
			<button class="btn-view" class:active={viewMode === 'canvas'} onclick={() => onswitchview('canvas')}>Canvas</button>
		</div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="import-wrapper" onclick={(e) => e.stopPropagation()}>
			<button class="btn-sm" onclick={openImportDropdown} title="Import namings from a document">Import</button>
			{#if importDropdownOpen}
				<div class="import-dropdown">
					{#if importLoading}
						<span class="import-loading">loading...</span>
					{:else if importDocuments.length === 0}
						<span class="import-empty">No documents in project</span>
					{:else}
						{#each importDocuments as doc}
							<button class="import-item" onmousedown={(e) => { e.preventDefault(); importFromDocument(doc.id); }}
								disabled={doc.importable_count === 0}>
								<span class="import-doc-label">{doc.label}</span>
								{#if doc.importable_count > 0}
									<span class="import-doc-count">+{doc.importable_count}</span>
								{:else}
									<span class="import-doc-done">all placed</span>
								{/if}
							</button>
						{/each}
					{/if}
				</div>
			{/if}
		</div>
		<div class="display-mode-group" style="{viewMode !== 'canvas' ? 'opacity: 0.3; pointer-events: none;' : ''}">
			<button class="btn-mode" class:active={displayMode === 'entities'}
				onclick={() => onsetdisplaymode('entities')}
				title="Entities only (messy map)">Entities</button>
			<button class="btn-mode" class:active={displayMode === 'relations'}
				onclick={() => onsetdisplaymode('relations')}
				title="Relations only (relational map)">Relations</button>
			<button class="btn-mode" class:active={displayMode === 'full'}
				onclick={() => onsetdisplaymode('full')}
				title="Full view: entities + relations + connections">Full</button>
		</div>
		<button class="btn-sm" onclick={onrunautolayout} title="Re-compute layout"
			disabled={viewMode !== 'canvas'} style="{viewMode !== 'canvas' ? 'opacity: 0.3;' : ''}">Layout</button>
		<button class="btn-sm" onclick={onopentopo}
			title="Topology snapshots"
			disabled={viewMode !== 'canvas'} style="{viewMode !== 'canvas' ? 'opacity: 0.3;' : ''}">Topo</button>
		{#if centeredId}
			<button class="btn-sm btn-centered" onclick={onuncenter}
				title="Centered on: {ms.findInscription(centeredId)} — click to uncenter">
				<img src="/icons/target.svg" alt="centered" class="toolbar-icon" />
				<span class="centered-label">{ms.findInscription(centeredId)}</span>
				<span class="centered-close">×</span>
			</button>
		{/if}
		<button class="btn-ai-toggle" class:ai-active={ms.aiEnabled} onclick={ms.toggleAi}>AI</button>
		<button class="btn-sm" onclick={ms.requestAnalysis} disabled={!ms.aiEnabled}>Ask AI</button>
	</div>
</div>

<style>
	.map-toolbar {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 0.5rem 1rem; border-bottom: 1px solid #2a2d3a;
		background: #13151e; flex-shrink: 0;
	}
	.back { font-size: 0.8rem; color: #6b7280; text-decoration: none; }
	h2 { font-size: 1rem; font-weight: 600; color: #e1e4e8; margin: 0; }
	.map-type-badge {
		font-size: 0.7rem; color: #8b9cf7; text-transform: uppercase;
		background: rgba(139, 156, 247, 0.1); padding: 0.15rem 0.5rem; border-radius: 4px;
	}
	.designation-profile { display: flex; gap: 0.75rem; font-size: 0.8rem; }
	.dp-item { font-weight: 500; }
	.toolbar-actions { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; }

	/* View toggle */
	.view-toggle { display: flex; border: 1px solid #2a2d3a; border-radius: 5px; overflow: hidden; }
	.btn-view {
		background: transparent; border: none; color: #6b7280; padding: 0.25rem 0.5rem;
		font-size: 0.75rem; cursor: pointer;
	}
	.btn-view.active { background: #2a2d3a; color: #e1e4e8; }
	.btn-view:hover:not(.active) { color: #c9cdd5; }

	/* Add form */
	.add-form { display: flex; gap: 0.4rem; }
	.add-form input {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.4rem 0.6rem; color: #e1e4e8; font-size: 0.85rem; width: 200px;
	}
	.add-form input:focus { outline: none; border-color: #8b9cf7; }
	.sw-role-select {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.3rem 0.4rem; color: #c9cdd5; font-size: 0.75rem; cursor: pointer;
	}
	.sw-role-select:focus { outline: none; border-color: #8b9cf7; }
	.add-form-wrapper { position: relative; }

	/* Placement dropdown */
	.placement-dropdown {
		position: absolute; top: 100%; left: 0; right: 0;
		margin-top: 4px; min-width: 280px;
		background: #1e2030; border: 1px solid #3a3d4a; border-radius: 8px;
		padding: 0.25rem 0; z-index: 300;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		max-height: 280px; overflow-y: auto;
	}
	.placement-item {
		display: flex; align-items: center; gap: 0.5rem;
		width: 100%; background: none; border: none; color: #c9cdd5;
		padding: 0.4rem 0.75rem; font-size: 0.8rem; cursor: pointer; text-align: left;
	}
	.placement-item:hover { background: #2a2d3a; }
	.placement-inscription { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.placement-badge {
		font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.03em;
		border: 1px solid; border-radius: 3px; padding: 0.05rem 0.3rem; flex-shrink: 0;
	}
	.placement-maps { font-size: 0.7rem; color: #6b7280; flex-shrink: 0; }
	.placement-separator { height: 1px; background: #2a2d3a; margin: 0.2rem 0.5rem; }
	.placement-create { color: #8b9cf7; }
	.placement-create:hover { background: rgba(139, 156, 247, 0.1); }
	.placement-create-label { font-size: 0.75rem; color: #6b7280; flex-shrink: 0; }
	.placement-create-value { font-weight: 600; }
	.placement-empty { display: block; padding: 0.35rem 0.75rem; font-size: 0.75rem; color: #4b5563; }
	.placement-loading { display: block; padding: 0.35rem 0.75rem; font-size: 0.75rem; color: #8b9cf7; }

	/* Import */
	.import-wrapper { position: relative; }
	.import-dropdown {
		position: absolute; top: 100%; left: 0; z-index: 300;
		background: #1e2030; border: 1px solid #3a3d4a; border-radius: 6px;
		min-width: 220px; max-height: 300px; overflow-y: auto;
		box-shadow: 0 4px 12px rgba(0,0,0,0.4); margin-top: 4px;
	}
	.import-item {
		display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
		width: 100%; background: none; border: none; color: #c9cdd5;
		padding: 0.4rem 0.75rem; font-size: 0.8rem; cursor: pointer; text-align: left;
	}
	.import-item:hover:not(:disabled) { background: #2a2d3a; }
	.import-item:disabled { opacity: 0.4; cursor: default; }
	.import-doc-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.import-doc-count { color: #10b981; font-size: 0.7rem; font-weight: 600; flex-shrink: 0; }
	.import-doc-done { color: #6b7280; font-size: 0.7rem; flex-shrink: 0; }
	.import-loading, .import-empty { display: block; padding: 0.4rem 0.75rem; font-size: 0.75rem; color: #6b7280; }

	/* Buttons */
	.btn-primary {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px;
		padding: 0.4rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer;
	}
	.btn-primary:disabled { opacity: 0.5; }
	.btn-sm {
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #c9cdd5; font-size: 0.75rem; padding: 0.25rem 0.5rem; cursor: pointer;
	}
	.btn-sm:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.btn-ai-toggle {
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #6b7280; font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.5rem;
		cursor: pointer; letter-spacing: 0.04em;
	}
	.btn-ai-toggle.ai-active {
		background: rgba(139, 156, 247, 0.15); border-color: #8b9cf7; color: #8b9cf7;
	}
	/* Display mode selector */
	.display-mode-group {
		display: flex; border: 1px solid #2a2d3a; border-radius: 5px; overflow: hidden;
	}
	.btn-mode {
		background: #1e2030; border: none; color: #6b7280;
		font-size: 0.7rem; padding: 0.2rem 0.5rem; cursor: pointer;
		border-right: 1px solid #2a2d3a; white-space: nowrap;
	}
	.btn-mode:last-child { border-right: none; }
	.btn-mode:hover { color: #c9cdd5; }
	.btn-mode.active {
		background: rgba(139, 156, 247, 0.15); color: #8b9cf7; font-weight: 600;
	}
	.btn-centered {
		display: flex; align-items: center; gap: 0.3rem; padding: 0.2rem 0.5rem;
		border-color: #f59e0b; color: #f59e0b; background: rgba(245, 158, 11, 0.1);
	}
	.btn-centered .toolbar-icon { width: 14px; height: 14px; opacity: 0.9; }
	.btn-centered .centered-label {
		font-size: 0.7rem; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.btn-centered .centered-close { font-size: 0.85rem; margin-left: 0.15rem; }
</style>
