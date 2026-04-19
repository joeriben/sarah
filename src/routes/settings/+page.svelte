<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	let activeTab: 'provider' | 'usage' | 'library' = $state('provider');

	// ── Provider state ────────────────────────────────────────
	interface ProviderInfo {
		id: string;
		label: string;
		defaultModel: string;
		needsKey: boolean;
		keyConfigured: boolean;
		keyMasked: string;
		dsgvo: boolean;
		region: string;
	}

	let providers = $state<ProviderInfo[]>([]);
	let selectedProvider = $state('');
	let model = $state('');
	let apiKeyInput = $state('');
	let saving = $state(false);
	let testing = $state(false);
	let testResult = $state<{ ok: boolean; error?: string; model?: string } | null>(null);
	let message = $state<{ type: 'ok' | 'error'; text: string } | null>(null);
	let loading = $state(true);

	// Language state
	let language = $state('auto');
	let languages = $state<Record<string, string>>({});

	// Delegation agent state
	let delegationProvider = $state('');
	let delegationModel = $state('');
	const delegationProviderInfo = $derived(providers.find(p => p.id === delegationProvider));

	const currentProviderInfo = $derived(providers.find(p => p.id === selectedProvider));

	// Ollama model list
	let ollamaModels = $state<string[]>([]);

	async function fetchOllamaModels() {
		try {
			const res = await fetch('http://localhost:11434/api/tags');
			if (!res.ok) return;
			const data = await res.json();
			ollamaModels = (data.models || []).map((m: any) => m.name).sort();
		} catch {
			ollamaModels = [];
		}
	}

	// Fetch Ollama models when provider is Ollama
	$effect(() => {
		if (selectedProvider === 'ollama' || delegationProvider === 'ollama') {
			fetchOllamaModels();
		}
	});

	async function loadSettings() {
		loading = true;
		try {
			const res = await fetch('/api/settings/ai');
			const data = await res.json();
			providers = data.providers;
			selectedProvider = data.provider;
			model = data.model;
			delegationProvider = data.delegationAgent?.provider || '';
			delegationModel = data.delegationAgent?.model || '';
			language = data.language || 'auto';
			languages = data.languages || {};
		} catch (e: any) {
			message = { type: 'error', text: e.message };
		} finally {
			loading = false;
		}
	}

	async function save() {
		saving = true;
		message = null;
		testResult = null;
		try {
			const body: Record<string, any> = { provider: selectedProvider, model };
			if (apiKeyInput) body.apiKey = apiKeyInput;
			body.delegationAgent = delegationProvider
				? { provider: delegationProvider, model: delegationModel }
				: null;
			body.language = language;
			const res = await fetch('/api/settings/ai', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error((await res.json()).error);
			message = { type: 'ok', text: 'Settings saved.' };
			apiKeyInput = '';
			await loadSettings();
		} catch (e: any) {
			message = { type: 'error', text: e.message };
		} finally {
			saving = false;
		}
	}

	async function test() {
		testing = true;
		testResult = null;
		try {
			const res = await fetch('/api/settings/ai/test', { method: 'POST' });
			testResult = await res.json();
		} catch (e: any) {
			testResult = { ok: false, error: e.message };
		} finally {
			testing = false;
		}
	}

	function selectProvider(id: string) {
		selectedProvider = id;
		const info = providers.find(p => p.id === id);
		if (info) model = info.defaultModel;
		apiKeyInput = '';
		testResult = null;
		message = null;
	}

	// ── Usage state ───────────────────────────────────────────
	interface UsageStats { calls: number; input_tokens: number; output_tokens: number; tokens: number }

	let usageData = $state<{
		total_calls: number;
		total_input_tokens: number;
		total_output_tokens: number;
		total_tokens: number;
		by_model: Record<string, UsageStats>;
		by_type: Record<string, UsageStats>;
		by_provider: Record<string, UsageStats>;
	} | null>(null);
	let usageLoading = $state(false);
	let usageError = $state<string | null>(null);
	let activePeriod = $state('month');
	let customFrom = $state('');
	let customTo = $state('');

	const periodPresets = [
		{ key: 'today', label: 'Today', days: 1 },
		{ key: 'week', label: 'Week', days: 7 },
		{ key: 'month', label: 'Month', days: 30 },
		{ key: 'year', label: 'Year', days: 365 },
		{ key: 'all', label: 'All', days: 0 },
	];

	async function fetchUsage() {
		usageLoading = true;
		usageError = null;
		try {
			const params = new URLSearchParams();
			if (activePeriod === 'custom') {
				if (customFrom) params.set('from', customFrom);
				if (customTo) params.set('to', customTo);
			} else {
				const preset = periodPresets.find(p => p.key === activePeriod);
				if (preset) params.set('days', String(preset.days));
			}
			const qs = params.toString() ? `?${params}` : '';
			const res = await fetch(`/api/settings/usage${qs}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			usageData = await res.json();
		} catch (e: any) {
			usageError = e.message;
		} finally {
			usageLoading = false;
		}
	}

	function selectPeriod(key: string) {
		activePeriod = key;
		if (key !== 'custom') { customFrom = ''; customTo = ''; }
		fetchUsage();
	}

	function formatTokens(n: number): string {
		if (!n) return '0';
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
		if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
		return n.toString();
	}

	// ── Library state ────────────────────────────────────────
	interface LibRef {
		id: string;
		title: string;
		author: string | null;
		description: string | null;
		format: string;
		chunk_count: string;
		total_words: string;
		created_at: string;
		indexed_at: string | null;
	}

	let libRefs = $state<LibRef[]>([]);
	let libLoading = $state(false);
	let libMessage = $state<{ type: 'ok' | 'error'; text: string } | null>(null);

	// Upload form
	let libTitle = $state('');
	let libAuthor = $state('');
	let libDescription = $state('');
	let libPasteContent = $state('');
	let libFile: File | null = $state(null);
	let libUploading = $state(false);
	let libMode: 'file' | 'paste' = $state('file');

	async function loadLibrary() {
		libLoading = true;
		try {
			const res = await fetch('/api/coach-library');
			const data = await res.json();
			libRefs = data.references || [];
		} catch (e: any) {
			libMessage = { type: 'error', text: e.message };
		} finally {
			libLoading = false;
		}
	}

	async function uploadReference() {
		libUploading = true;
		libMessage = null;
		try {
			if (libMode === 'file' && libFile) {
				const form = new FormData();
				form.append('file', libFile);
				form.append('title', libTitle);
				form.append('author', libAuthor);
				form.append('description', libDescription);
				const res = await fetch('/api/coach-library', { method: 'POST', body: form });
				const data = await res.json();
				if (data.error) throw new Error(data.error);
			} else if (libMode === 'paste' && libPasteContent.trim()) {
				const res = await fetch('/api/coach-library', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						title: libTitle, author: libAuthor, description: libDescription,
						content: libPasteContent
					})
				});
				const data = await res.json();
				if (data.error) throw new Error(data.error);
			} else {
				throw new Error('No content provided');
			}
			libMessage = { type: 'ok', text: 'Reference added successfully' };
			libTitle = ''; libAuthor = ''; libDescription = ''; libPasteContent = ''; libFile = null;
			await loadLibrary();
		} catch (e: any) {
			libMessage = { type: 'error', text: e.message };
		} finally {
			libUploading = false;
		}
	}

	async function deleteRef(id: string, title: string) {
		if (!confirm(`Delete "${title}"?`)) return;
		try {
			await fetch(`/api/coach-library/${id}`, { method: 'DELETE' });
			await loadLibrary();
		} catch (e: any) {
			libMessage = { type: 'error', text: e.message };
		}
	}

	let preprocessing = $state<string | null>(null); // ID of reference being preprocessed

	async function preprocessRef(id: string) {
		preprocessing = id;
		libMessage = null;
		try {
			const res = await fetch(`/api/coach-library/${id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'preprocess' })
			});
			const data = await res.json();
			if (data.error) throw new Error(data.error);
			libMessage = { type: 'ok', text: 'Index created successfully' };
			await loadLibrary();
		} catch (e: any) {
			libMessage = { type: 'error', text: e.message };
		} finally {
			preprocessing = null;
		}
	}

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		libFile = input.files?.[0] || null;
		// Auto-fill title from filename if empty
		if (libFile && !libTitle) {
			libTitle = libFile.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
		}
	}

	// Init
	$effect(() => {
		loadSettings();
		fetchUsage();
		loadLibrary();
	});
</script>

<div class="settings-page">
	<div class="settings-header">
		<h1>Settings</h1>
		<a href="/projects" class="back-link">Back to Projects</a>
	</div>

	<div class="tabs">
		<button class="tab" class:active={activeTab === 'provider'} onclick={() => activeTab = 'provider'}>
			AI Provider
		</button>
		<button class="tab" class:active={activeTab === 'usage'} onclick={() => { activeTab = 'usage'; fetchUsage(); }}>
			Usage
		</button>
		<button class="tab" class:active={activeTab === 'library'} onclick={() => { activeTab = 'library'; loadLibrary(); }}>
			Coach Library
		</button>
	</div>

	{#if activeTab === 'provider'}
		<!-- ═══════ Provider Config ═══════ -->
		{#if loading}
			<div class="loading">Loading...</div>
		{:else}
			<div class="section">
				<h2>Provider</h2>
				<div class="provider-grid">
					{#each providers as p}
						<button
							class="provider-card"
							class:selected={selectedProvider === p.id}
							onclick={() => selectProvider(p.id)}
						>
							<div class="provider-name">{p.label}</div>
							<div class="provider-meta">
								<span class:dsgvo-ok={p.dsgvo} class:dsgvo-warn={!p.dsgvo}>
									{p.dsgvo ? 'DSGVO' : 'Non-EU'}
								</span>
								<span class="provider-region">{p.region}</span>
							</div>
							{#if p.needsKey}
								<div class="key-status">
									<span class:status-ok={p.keyConfigured} class:status-missing={!p.keyConfigured}>
										{p.keyConfigured ? 'Key: ' + p.keyMasked : 'No key'}
									</span>
								</div>
							{:else}
								<div class="key-status"><span class="status-ok">No key needed</span></div>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<div class="section">
				<h2>Model</h2>
				<div class="form-row">
					{#if selectedProvider === 'ollama' && ollamaModels.length > 0}
						<select class="input-field model-input" bind:value={model}>
							{#each ollamaModels as m}
								<option value={m}>{m}</option>
							{/each}
						</select>
					{:else}
						<input type="text" bind:value={model} placeholder="Model name" class="input-field model-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other" />
					{/if}
					<span class="hint">Default: {currentProviderInfo?.defaultModel || '—'}</span>
				</div>
			</div>

			{#if currentProviderInfo?.needsKey}
				<div class="section">
					<h2>API Key</h2>
					{#if currentProviderInfo.keyConfigured}
						<div class="current-key">Current: <code>{currentProviderInfo.keyMasked}</code></div>
					{/if}
					<div class="form-row">
						<input
							type="text"
							bind:value={apiKeyInput}
							placeholder={currentProviderInfo.keyConfigured ? 'Enter new key to replace' : 'Enter API key'}
							class="input-field api-key-input"
							autocomplete="off"
							data-1p-ignore
							data-lpignore="true"
							data-form-type="other"
						/>
					</div>
				</div>
			{/if}

			<div class="section">
				<h2>Delegation Agent</h2>
				<p class="section-hint">Model for delegated subtasks. Saves context for the main LLM: document chunks, passage extraction, classification. Can be the same quality — the point is parallel context, not lower capability.</p>
				<div class="form-row">
					<select class="input-field" bind:value={delegationProvider}>
						<option value="">No delegation agent</option>
						{#each providers as p}
							{#if p.keyConfigured || !p.needsKey}
								<option value={p.id}>{p.label} — {p.region}</option>
							{/if}
						{/each}
					</select>
				</div>
				{#if delegationProvider}
					<div class="form-row">
						{#if delegationProvider === 'ollama' && ollamaModels.length > 0}
							<select class="input-field model-input" bind:value={delegationModel}>
								{#each ollamaModels as m}
									<option value={m}>{m}</option>
								{/each}
							</select>
						{:else}
							<input type="text" bind:value={delegationModel} placeholder="Model name" class="input-field model-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other" />
						{/if}
						<span class="hint">Default: {delegationProviderInfo?.defaultModel || '—'}</span>
					</div>
				{/if}
			</div>

			<div class="section">
				<h2>Analysis Language</h2>
				<p class="section-hint">Language for codes, memos, and all AI output. "Auto-detect" uses the language of the documents.</p>
				<div class="form-row">
					<select class="input-field" bind:value={language}>
						{#each Object.entries(languages) as [code, label]}
							<option value={code}>{label}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="actions">
				<button class="btn btn-primary" onclick={save} disabled={saving}>
					{saving ? 'Saving...' : 'Save'}
				</button>
				<button class="btn btn-secondary" onclick={test} disabled={testing}>
					{testing ? 'Testing...' : 'Test Connection'}
				</button>
			</div>

			{#if message}
				<div class="message" class:message-ok={message.type === 'ok'} class:message-error={message.type === 'error'}>
					{message.text}
				</div>
			{/if}
			{#if testResult}
				<div class="message" class:message-ok={testResult.ok} class:message-error={!testResult.ok}>
					{#if testResult.ok}
						Connection OK — Model: {testResult.model}
					{:else}
						Connection failed: {testResult.error}
					{/if}
				</div>
			{/if}
		{/if}

	{/if}

	{#if activeTab === 'usage'}
		<!-- ═══════ Usage ═══════ -->
		<div class="section">
			<div class="period-selector">
				<div class="period-presets">
					{#each periodPresets as p}
						<button
							class="preset-btn"
							class:active={activePeriod === p.key}
							onclick={() => selectPeriod(p.key)}
						>{p.label}</button>
					{/each}
				</div>
				<div class="period-custom">
					<label for="usage-from">From</label>
					<input id="usage-from" type="date" bind:value={customFrom} onchange={() => selectPeriod('custom')} />
					<label for="usage-to">To</label>
					<input id="usage-to" type="date" bind:value={customTo} onchange={() => selectPeriod('custom')} />
				</div>
			</div>

			{#if usageLoading}
				<div class="loading">Loading usage data...</div>
			{:else if usageError}
				<div class="message message-error">{usageError}</div>
			{:else if usageData}
				{#if usageData.total_calls === 0}
					<div class="empty-state">No usage data for this period.</div>
				{:else}
					<!-- Totals -->
					<div class="usage-totals">
						<span>{usageData.total_calls} calls</span>
						<span>{formatTokens(usageData.total_input_tokens)} in</span>
						<span>{formatTokens(usageData.total_output_tokens)} out</span>
						<span class="total-tokens">{formatTokens(usageData.total_tokens)} total</span>
					</div>

					<!-- By Model -->
					<div class="subsection">
						<h3>By Model</h3>
						<table class="usage-table">
							<thead>
								<tr><th>Model</th><th>Calls</th><th>In</th><th>Out</th><th>Total</th></tr>
							</thead>
							<tbody>
								{#each Object.entries(usageData.by_model) as [name, stats]}
									<tr>
										<td class="mono">{name}</td>
										<td class="mono right">{stats.calls}</td>
										<td class="mono right">{formatTokens(stats.input_tokens)}</td>
										<td class="mono right">{formatTokens(stats.output_tokens)}</td>
										<td class="mono right">{formatTokens(stats.tokens)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<!-- By Request Type -->
					<div class="subsection">
						<h3>By Request Type</h3>
						<table class="usage-table">
							<thead>
								<tr><th>Type</th><th>Calls</th><th>In</th><th>Out</th><th>Total</th></tr>
							</thead>
							<tbody>
								{#each Object.entries(usageData.by_type) as [type, stats]}
									<tr>
										<td>{type}</td>
										<td class="mono right">{stats.calls}</td>
										<td class="mono right">{formatTokens(stats.input_tokens)}</td>
										<td class="mono right">{formatTokens(stats.output_tokens)}</td>
										<td class="mono right">{formatTokens(stats.tokens)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<!-- By Provider -->
					{#if Object.keys(usageData.by_provider).length > 0}
						<div class="subsection">
							<h3>By Provider</h3>
							<table class="usage-table">
								<thead>
									<tr><th>Provider</th><th>Calls</th><th>In</th><th>Out</th><th>Total</th></tr>
								</thead>
								<tbody>
									{#each Object.entries(usageData.by_provider) as [prov, stats]}
										<tr>
											<td>{prov}</td>
											<td class="mono right">{stats.calls}</td>
											<td class="mono right">{formatTokens(stats.input_tokens)}</td>
											<td class="mono right">{formatTokens(stats.output_tokens)}</td>
											<td class="mono right">{formatTokens(stats.tokens)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{/if}
			{/if}
		</div>
	{/if}

	{#if activeTab === 'library'}
		<!-- ═══════ Coach Reference Library ═══════ -->
		<div class="section">
			<h2>Reference Library</h2>
			<p class="section-desc">Methodological texts for the coaching agent. Upload Clarke, Strauss/Corbin, or other SA literature so the coach can cite concrete passages. The library folder (<code>coach-library/</code>) is portable — copy it to a new installation and the index is auto-imported.</p>

			<!-- Upload form -->
			<div class="lib-upload">
				<div class="lib-mode-switch">
					<button class="preset-btn" class:active={libMode === 'file'} onclick={() => libMode = 'file'}>Upload File</button>
					<button class="preset-btn" class:active={libMode === 'paste'} onclick={() => libMode = 'paste'}>Paste Text</button>
				</div>

				<div class="form-row">
					<input type="text" bind:value={libTitle} placeholder="Title (e.g., Situational Analysis)" class="form-input" />
					<input type="text" bind:value={libAuthor} placeholder="Author (optional)" class="form-input form-input-sm" />
				</div>

				<input type="text" bind:value={libDescription} placeholder="Description (optional)" class="form-input" />

				{#if libMode === 'file'}
					<div class="file-drop">
						<input type="file" accept=".pdf,.txt,.md,.text" onchange={handleFileSelect} />
						<span class="file-hint">.pdf, .txt, .md</span>
					</div>
				{:else}
					<textarea
						bind:value={libPasteContent}
						placeholder="Paste text content here..."
						rows="6"
						class="form-input lib-paste"
					></textarea>
				{/if}

				<button
					class="btn btn-primary"
					onclick={uploadReference}
					disabled={libUploading || !libTitle || (libMode === 'file' ? !libFile : !libPasteContent.trim())}
				>
					{libUploading ? 'Processing...' : 'Add Reference'}
				</button>

				{#if libMessage}
					<div class="msg" class:msg-ok={libMessage.type === 'ok'} class:msg-err={libMessage.type === 'error'}>
						{libMessage.text}
					</div>
				{/if}
			</div>

			<!-- Reference list -->
			<div class="lib-list">
				{#if libLoading}
					<div class="loading">Loading...</div>
				{:else if libRefs.length === 0}
					<div class="lib-empty">
						<p>No reference texts uploaded yet.</p>
						<p class="lib-suggestion">Recommended: Clarke, A.E. (2005/2023). <em>Situational Analysis</em>. Sage.</p>
					</div>
				{:else}
					{#each libRefs as ref}
						<div class="lib-item">
							<div class="lib-item-info">
								<span class="lib-item-title">{ref.title}</span>
								{#if ref.author}
									<span class="lib-item-author">{ref.author}</span>
								{/if}
								<span class="lib-item-meta">
									{ref.chunk_count} chunks, {parseInt(ref.total_words).toLocaleString()} words
									<span class="lib-item-format">{ref.format.toUpperCase()}</span>
									{#if ref.indexed_at}
										<span class="lib-indexed">indexed</span>
									{/if}
								</span>
							</div>
							<div class="lib-item-actions">
								{#if !ref.indexed_at}
									<button
										class="btn btn-sm"
										onclick={() => preprocessRef(ref.id)}
										disabled={preprocessing === ref.id}
									>
										{preprocessing === ref.id ? 'Indexing...' : 'Preprocess'}
									</button>
								{:else}
									<button
										class="btn btn-sm btn-ghost"
										onclick={() => preprocessRef(ref.id)}
										disabled={preprocessing === ref.id}
										title="Re-index"
									>
										{preprocessing === ref.id ? 'Indexing...' : 'Re-index'}
									</button>
								{/if}
								<button class="coach-btn-sm" onclick={() => deleteRef(ref.id, ref.title)} title="Delete">delete</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.settings-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
	}

	.settings-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}
	.settings-header h1 {
		font-size: 1.4rem;
		font-weight: 600;
		color: #e1e4e8;
	}
	.back-link {
		font-size: 0.85rem;
		color: #8b9cf7;
	}

	/* Tabs */
	.tabs {
		display: flex;
		gap: 2px;
		margin-bottom: 1.5rem;
		border-bottom: 1px solid rgba(255,255,255,0.1);
	}
	.tab {
		padding: 0.6rem 1.2rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: #888;
		font-size: 0.9rem;
		cursor: pointer;
	}
	.tab:hover { color: #ccc; }
	.tab.active {
		color: #a5b4fc;
		border-bottom-color: #a5b4fc;
	}

	/* Sections */
	.section {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 8px;
		padding: 1.2rem;
		margin-bottom: 1rem;
	}
	.section h2 {
		font-size: 0.95rem;
		font-weight: 600;
		color: #ccc;
		margin-bottom: 0.8rem;
	}

	/* Provider grid */
	.provider-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.6rem;
	}
	.provider-card {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.1);
		border-radius: 6px;
		padding: 0.8rem;
		cursor: pointer;
		text-align: left;
		color: #ccc;
		transition: border-color 0.15s;
	}
	.provider-card:hover { border-color: rgba(255,255,255,0.2); }
	.provider-card.selected {
		border-color: #a5b4fc;
		background: rgba(165,180,252,0.06);
	}
	.provider-name {
		font-weight: 600;
		font-size: 0.9rem;
		margin-bottom: 0.4rem;
	}
	.provider-meta {
		display: flex;
		gap: 0.5rem;
		font-size: 0.75rem;
		margin-bottom: 0.3rem;
	}
	.dsgvo-ok { color: #4caf50; }
	.dsgvo-warn { color: #ffb74d; }
	.provider-region { color: #888; }
	.key-status { font-size: 0.75rem; }
	.status-ok { color: #4caf50; }
	.status-missing { color: #ff6b6b; }

	/* Form */
	.form-row {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}
	.input-field {
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.15);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		color: #e1e4e8;
		font-size: 0.85rem;
		font-family: 'JetBrains Mono', monospace;
		flex: 1;
		max-width: 400px;
	}
	.input-field:focus {
		outline: none;
		border-color: #a5b4fc;
	}
	.model-input { max-width: 500px; }
	.api-key-input {
		-webkit-text-security: disc;
	}
	.hint { font-size: 0.75rem; color: #666; }
	.section-hint { font-size: 0.8rem; color: #888; margin: 0.25rem 0 0.75rem; line-height: 1.4; }
	.current-key {
		font-size: 0.8rem;
		color: #888;
		margin-bottom: 0.5rem;
	}
	.current-key code {
		font-family: 'JetBrains Mono', monospace;
		color: #aaa;
	}

	/* Buttons */
	.actions {
		display: flex;
		gap: 0.6rem;
		margin-bottom: 1rem;
	}
	.btn {
		padding: 0.5rem 1.2rem;
		border: 1px solid rgba(255,255,255,0.15);
		border-radius: 6px;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.btn:disabled { opacity: 0.5; cursor: default; }
	.btn-primary {
		background: #a5b4fc;
		color: #0f1117;
		border-color: #a5b4fc;
		font-weight: 600;
	}
	.btn-primary:hover:not(:disabled) { background: #8b9cf7; }
	.btn-secondary {
		background: rgba(255,255,255,0.05);
		color: #ccc;
	}
	.btn-secondary:hover:not(:disabled) { background: rgba(255,255,255,0.1); }

	/* Messages */
	.message {
		padding: 0.6rem 1rem;
		border-radius: 6px;
		font-size: 0.85rem;
		margin-bottom: 0.5rem;
	}
	.message-ok {
		background: rgba(76,175,80,0.1);
		border: 1px solid rgba(76,175,80,0.3);
		color: #4caf50;
	}
	.message-error {
		background: rgba(255,107,107,0.1);
		border: 1px solid rgba(255,107,107,0.3);
		color: #ff6b6b;
	}

	.loading, .empty-state {
		padding: 1.5rem;
		text-align: center;
		color: #666;
		font-size: 0.9rem;
	}

	/* ── Usage tab ── */
	.period-selector {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}
	.period-presets {
		display: flex;
		gap: 4px;
	}
	.preset-btn {
		padding: 0.35rem 0.8rem;
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.12);
		border-radius: 4px;
		color: #888;
		cursor: pointer;
		font-size: 0.8rem;
	}
	.preset-btn:hover { color: #ccc; border-color: rgba(255,255,255,0.25); }
	.preset-btn.active {
		background: rgba(165,180,252,0.1);
		border-color: #a5b4fc;
		color: #a5b4fc;
	}
	.period-custom {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: #888;
	}
	.period-custom input[type="date"] {
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.12);
		border-radius: 4px;
		color: #ccc;
		padding: 0.3rem 0.5rem;
		font-size: 0.8rem;
		font-family: 'JetBrains Mono', monospace;
	}

	.usage-totals {
		display: flex;
		gap: 1.5rem;
		font-size: 0.9rem;
		color: #aaa;
		margin-bottom: 1rem;
		font-family: 'JetBrains Mono', monospace;
	}
	.total-tokens {
		color: #a5b4fc;
		font-weight: 600;
	}

	.subsection {
		margin-top: 1.2rem;
	}
	.subsection h3 {
		font-size: 0.85rem;
		color: #888;
		font-weight: 500;
		margin-bottom: 0.5rem;
	}

	.usage-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}
	.usage-table th {
		text-align: left;
		padding: 0.5rem 0.75rem;
		color: #666;
		font-weight: 500;
		border-bottom: 1px solid rgba(255,255,255,0.08);
	}
	.usage-table td {
		padding: 0.5rem 0.75rem;
		color: #ccc;
		border-bottom: 1px solid rgba(255,255,255,0.04);
	}
	.mono { font-family: 'JetBrains Mono', monospace; }
	.right { text-align: right; }

	/* ── Library ────────────────────────── */
	.section-desc {
		font-size: 0.82rem;
		color: #6b7280;
		margin-bottom: 1.2rem;
		line-height: 1.5;
	}

	.lib-upload {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-bottom: 1.5rem;
		padding: 1rem;
		background: rgba(255,255,255,0.02);
		border: 1px solid #2a2d3a;
		border-radius: 8px;
	}

	.lib-mode-switch {
		display: flex;
		gap: 0.3rem;
	}

	.form-row {
		display: flex;
		gap: 0.5rem;
	}

	.form-input {
		flex: 1;
		background: #1a1d2a;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		color: #e1e4e8;
		font-size: 0.85rem;
		padding: 0.5rem 0.7rem;
		font-family: inherit;
	}
	.form-input:focus {
		outline: none;
		border-color: #a5b4fc;
	}
	.form-input::placeholder { color: #4b5563; }
	.form-input-sm { max-width: 220px; }

	.lib-paste {
		resize: vertical;
		min-height: 80px;
		line-height: 1.4;
	}

	.file-drop {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem;
		border: 1px dashed #2a2d3a;
		border-radius: 6px;
	}
	.file-drop input[type="file"] {
		font-size: 0.82rem;
		color: #c9cdd5;
	}
	.file-hint {
		font-size: 0.75rem;
		color: #4b5563;
	}

	.btn {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 6px;
		font-size: 0.85rem;
		cursor: pointer;
		font-family: inherit;
		align-self: flex-start;
	}
	.btn-primary {
		background: #a5b4fc;
		color: #0f1117;
		font-weight: 500;
	}
	.btn-primary:hover:not(:disabled) { background: #8b9cf7; }
	.btn-primary:disabled { opacity: 0.4; cursor: default; }

	.msg { font-size: 0.82rem; padding: 0.4rem 0.6rem; border-radius: 4px; }
	.msg-ok { color: #34d399; background: rgba(52, 211, 153, 0.1); }
	.msg-err { color: #ef4444; background: rgba(239, 68, 68, 0.1); }

	.lib-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.lib-empty {
		text-align: center;
		padding: 2rem 1rem;
		color: #6b7280;
		font-size: 0.85rem;
	}
	.lib-suggestion {
		margin-top: 0.5rem;
		font-size: 0.8rem;
		color: #4b5563;
	}

	.lib-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.7rem 0.8rem;
		background: rgba(255,255,255,0.02);
		border: 1px solid #2a2d3a;
		border-radius: 6px;
	}

	.lib-item-info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.lib-item-title {
		font-size: 0.88rem;
		font-weight: 500;
		color: #e1e4e8;
	}
	.lib-item-author {
		font-size: 0.78rem;
		color: #8b8fa3;
	}
	.lib-item-meta {
		font-size: 0.72rem;
		color: #4b5563;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.lib-item-format {
		background: rgba(165, 180, 252, 0.15);
		color: #a5b4fc;
		padding: 0.1rem 0.35rem;
		border-radius: 3px;
		font-size: 0.65rem;
		font-weight: 600;
	}

	.lib-indexed {
		background: rgba(52, 211, 153, 0.15);
		color: #34d399;
		padding: 0.1rem 0.35rem;
		border-radius: 3px;
		font-size: 0.65rem;
		font-weight: 600;
	}

	.lib-item-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.btn-sm {
		padding: 0.3rem 0.6rem;
		font-size: 0.75rem;
	}
	.btn-ghost {
		background: none;
		color: #6b7280;
		border: 1px solid #2a2d3a;
	}
	.btn-ghost:hover:not(:disabled) {
		color: #a5b4fc;
		border-color: #a5b4fc;
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
		color: #ef4444;
		background: rgba(239, 68, 68, 0.1);
	}
</style>
