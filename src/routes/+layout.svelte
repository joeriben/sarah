<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { env } from '$env/dynamic/public';

	let { data, children }: { data: { user: any; dbStatus?: { status: string; error: string | null } }; children: Snippet } = $props();

	const BRAND_LOGO_URL = env.PUBLIC_BRAND_LOGO_URL || '';
	const BRAND_NAME = env.PUBLIC_BRAND_NAME || '';
	const BRAND_LINK = env.PUBLIC_BRAND_LINK || '';
	const IMPRESSUM_URL = env.PUBLIC_IMPRESSUM_URL || '/brand/impressum.html';

	let settingsOpen = $state(false);
	let legalOpen = $state(false);

	// DB status banner
	function getInitialDbStatus() {
		return (data.dbStatus?.status as 'healthy' | 'starting' | 'error') ?? 'healthy';
	}

	function getInitialDbError() {
		return data.dbStatus?.error ?? null;
	}

	let dbStatusValue = $state<'healthy' | 'starting' | 'error'>(getInitialDbStatus());
	let dbError = $state<string | null>(getInitialDbError());

	$effect(() => {
		if (dbStatusValue === 'healthy') return;

		const interval = setInterval(async () => {
			try {
				const res = await fetch('/api/db-status');
				if (res.ok) {
					const result = await res.json();
					dbStatusValue = result.status;
					dbError = result.error;
					if (result.status === 'healthy') {
						clearInterval(interval);
						location.reload();
					}
				}
			} catch {
				// Network error — keep polling
			}
		}, 2000);

		return () => clearInterval(interval);
	});

	// Embedding-model download status (first run pulls ~150 MB from HuggingFace Hub).
	type EmbedStatus = { phase: 'idle' | 'downloading' | 'ready' | 'error'; model: string; file?: string; percent?: number; error?: string };
	let embedStatus = $state<EmbedStatus>({ phase: 'idle', model: '' });
	let embedDismissed = $state(false);

	$effect(() => {
		if (!data.user) return;
		let stopped = false;
		const tick = async () => {
			try {
				const res = await fetch('/api/embed-status');
				if (res.ok) {
					embedStatus = await res.json();
					if (embedStatus.phase === 'ready' || embedStatus.phase === 'error') {
						// One more render (to flash ready/error), then stop polling.
						stopped = true;
					}
				}
			} catch {
				// ignore
			}
		};
		void tick();
		const interval = setInterval(() => {
			if (stopped) { clearInterval(interval); return; }
			void tick();
		}, 2000);
		return () => clearInterval(interval);
	});

	// Overlay state
	let overlay = $state<'manual' | 'impressum' | 'about' | 'change-password' | null>(null);
	let manualHtml = $state<string | null>(null);
	let impressumHtml = $state<string | null>(null);
	let impressumLoaded = $state(false);

	// Change-password form
	let cpOld = $state('');
	let cpNew = $state('');
	let cpNew2 = $state('');
	let cpError = $state<string | null>(null);
	let cpSubmitting = $state(false);

	async function submitChangePassword(e: Event) {
		e.preventDefault();
		cpError = null;
		if (cpNew !== cpNew2) {
			cpError = 'New passwords do not match.';
			return;
		}
		cpSubmitting = true;
		try {
			const res = await fetch('/api/auth/change-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ oldPassword: cpOld, newPassword: cpNew })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				cpError = body.error ?? 'Could not change password.';
				return;
			}
			cpOld = cpNew = cpNew2 = '';
			overlay = null;
			location.reload();
		} finally {
			cpSubmitting = false;
		}
	}

	async function openImpressum() {
		overlay = 'impressum';
		if (impressumLoaded) return;
		try {
			const res = await fetch(IMPRESSUM_URL);
			impressumHtml = res.ok ? await res.text() : null;
		} catch {
			impressumHtml = null;
		}
		impressumLoaded = true;
	}

	async function openManual() {
		overlay = 'manual';
		if (!manualHtml) {
			const res = await fetch('/api/manual');
			if (res.ok) {
				const { content } = await res.json();
				const { marked } = await import('marked');
				const renderer = new marked.Renderer();
				renderer.heading = ({ text, depth }: { text: string; depth: number }) => {
					const slug = text.toLowerCase().replace(/[^\w]+/g, '-').replace(/(^-|-$)/g, '');
					return `<h${depth} id="${slug}">${text}</h${depth}>`;
				};
				manualHtml = marked(content, { renderer }) as string;
			}
		}
	}

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/login';
	}

	function closeDropdowns(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.dropdown')) {
			settingsOpen = false;
			legalOpen = false;
		}
	}
</script>

<svelte:head>
	<title>SARAH</title>
</svelte:head>

{#if data.user}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="app" onclick={closeDropdowns}>
		<header class="app-header">
			<div class="header-content">
				<div class="header-left">
					{#if BRAND_LOGO_URL}
						{#if BRAND_LINK}
							<a href={BRAND_LINK} target="_blank" rel="noopener noreferrer" class="header-logo-link">
								<img src={BRAND_LOGO_URL} alt={BRAND_NAME || 'Operator logo'} class="header-logo" />
							</a>
						{:else}
							<img src={BRAND_LOGO_URL} alt={BRAND_NAME || 'Operator logo'} class="header-logo" />
						{/if}
					{/if}
					{#if BRAND_NAME}
						<span class="app-title">{BRAND_NAME}</span>
					{/if}
				</div>

				<div class="header-center">
					<span class="app-name">SARAH</span>
					<span class="app-version" title="Fork of transact-qda — see About">v0.1</span>
				</div>

				<div class="header-right">
					<button class="nav-btn" title="Manual" onclick={openManual}>?</button>

					<div class="dropdown">
						<button class="nav-btn" title="Settings" onclick={() => { settingsOpen = !settingsOpen; legalOpen = false; }}>
							<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>
						</button>
						{#if settingsOpen}
							<div class="dropdown-menu">
								<a href="/projects" class="dropdown-item" onclick={() => settingsOpen = false}>Projects</a>
								<a href="/settings" class="dropdown-item" onclick={() => settingsOpen = false}>Settings</a>
								<div class="dropdown-divider"></div>
								<span class="dropdown-label">User</span>
								<span class="dropdown-info">{data.user.displayName || data.user.username}</span>
								<button class="dropdown-item" onclick={logout}>Logout</button>
							</div>
						{/if}
					</div>

					<div class="dropdown">
						<button class="nav-btn nav-btn-text" title="Legal" onclick={() => { legalOpen = !legalOpen; settingsOpen = false; }}>§</button>
						{#if legalOpen}
							<div class="dropdown-menu">
								<button class="dropdown-item" onclick={() => { legalOpen = false; overlay = 'about'; }}>About</button>
								<button class="dropdown-item" onclick={() => { legalOpen = false; openImpressum(); }}>Impressum</button>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</header>

		{#if data.user?.mustChangePassword}
			<div class="security-banner">
				<span>⚠️ You are still using the default password. Please change it now to secure this installation.</span>
				<button class="security-banner-btn" onclick={() => overlay = 'change-password'}>Change password</button>
			</div>
		{/if}

		{#if dbStatusValue !== 'healthy'}
			<div class="db-banner" class:db-error={dbStatusValue === 'error'}>
				{#if dbStatusValue === 'starting'}
					<span class="db-spinner"></span>
					Datenbank wird gestartet…
				{:else}
					Datenbank nicht erreichbar{dbError ? `: ${dbError}` : ''}
				{/if}
			</div>
		{/if}

		<main class="content">
			{@render children()}
		</main>

		{#if !embedDismissed && embedStatus.phase === 'downloading'}
			<div class="embed-toast" role="status" aria-live="polite">
				<div class="embed-toast-head">
					<span class="embed-toast-title">Loading embedding model (first run)</span>
					<button class="embed-toast-close" onclick={() => embedDismissed = true} aria-label="Dismiss">×</button>
				</div>
				<div class="embed-toast-body">
					Downloading <code>{embedStatus.model}</code> from the Hugging Face Hub
					(~150 MB, Apache-2.0). This happens once; later starts run offline.
				</div>
				<div class="embed-progress">
					<div class="embed-progress-bar" style="width: {embedStatus.percent ?? 0}%"></div>
				</div>
				<div class="embed-toast-meta">
					{embedStatus.percent ?? 0}%{embedStatus.file ? ` — ${embedStatus.file}` : ''}
				</div>
			</div>
		{:else if !embedDismissed && embedStatus.phase === 'error'}
			<div class="embed-toast embed-toast-error" role="status" aria-live="polite">
				<div class="embed-toast-head">
					<span class="embed-toast-title">Embedding model failed to load</span>
					<button class="embed-toast-close" onclick={() => embedDismissed = true} aria-label="Dismiss">×</button>
				</div>
				<div class="embed-toast-body">
					AI features that use semantic search will not work until this is resolved.
					Check the server logs and network connectivity to huggingface.co.
					{#if embedStatus.error}
						<div class="embed-toast-meta">{embedStatus.error}</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Overlays -->
		{#if overlay}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="overlay-backdrop" onclick={() => overlay = null}>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="overlay-panel" onclick={e => {
					e.stopPropagation();
					const target = e.target as HTMLElement;
					if (target.tagName === 'A' && target.getAttribute('href')?.startsWith('#')) {
						e.preventDefault();
						const id = target.getAttribute('href')!.slice(1);
						const el = (e.currentTarget as HTMLElement).querySelector('#' + CSS.escape(id));
						if (el) el.scrollIntoView({ behavior: 'smooth' });
					}
				}}>
					<button class="overlay-close" onclick={() => overlay = null}>×</button>
					{#if overlay === 'manual'}
						<div class="overlay-content manual-content">
							{#if manualHtml}
								{@html manualHtml}
							{:else}
								<p>Loading...</p>
							{/if}
						</div>
					{:else if overlay === 'impressum'}
						<div class="overlay-content">
							<h1>Impressum</h1>
							{#if !impressumLoaded}
								<p>Loading…</p>
							{:else if impressumHtml}
								{@html impressumHtml}
							{:else}
								<p>No legal notice has been configured for this instance.</p>
								<p style="opacity: 0.7; font-size: 0.85rem;">
									Instance operators: provide an HTML snippet at
									<code>static/brand/impressum.html</code> or set
									<code>PUBLIC_IMPRESSUM_URL</code> in <code>.env</code>.
									See <code>static/brand/README.md</code>.
								</p>
							{/if}
						</div>
					{:else if overlay === 'change-password'}
						<div class="overlay-content">
							<h1>Change password</h1>
							<p style="opacity: 0.8;">
								Set a new password for your account. The new password must be
								at least 8 characters and different from the current one.
							</p>
							<form onsubmit={submitChangePassword} class="cp-form">
								<label>
									Current password
									<input type="password" bind:value={cpOld} required autocomplete="current-password" />
								</label>
								<label>
									New password
									<input type="password" bind:value={cpNew} required minlength={8} autocomplete="new-password" />
								</label>
								<label>
									Confirm new password
									<input type="password" bind:value={cpNew2} required minlength={8} autocomplete="new-password" />
								</label>
								{#if cpError}
									<div class="cp-error">{cpError}</div>
								{/if}
								<div class="cp-actions">
									<button type="button" class="cp-btn cp-btn-secondary" onclick={() => { overlay = null; cpError = null; }}>Later</button>
									<button type="submit" class="cp-btn cp-btn-primary" disabled={cpSubmitting}>
										{cpSubmitting ? 'Saving…' : 'Save'}
									</button>
								</div>
							</form>
						</div>
					{:else if overlay === 'about'}
						<div class="overlay-content">
							<h1>About SARAH</h1>
							<p>
								<strong>SARAH</strong> — Structured Analysis, Review, and Assessment
								Helper — is a local single-user workstation for hermeneutic reading,
								peer review and assessment drafting on academic texts. SARAH is forked
								from <a href="https://github.com/joeriben/transact-qda" target="_blank" rel="noopener">transact-qda</a>
								and reuses its document model, parsers, embeddings, and AI client; the
								QDA-specific layer (situational maps, code system, naming acts) is
								removed in favour of a case-triade and a sequential per-paragraph
								analysis pipeline.
							</p>
							<p>
								Originally developed at the
								<a href="https://www.ucdcae.fau.de/" target="_blank" rel="noopener">
									UNESCO Chair in Digital Culture and Arts Education
								</a>,
								Friedrich-Alexander-Universität Erlangen-Nürnberg
								(Prof. Dr. Benjamin Jörissen).
							</p>
							<p>
								Released under the
								<a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">
									GNU Affero General Public License, Version 3 or later
								</a>.
								A commercial license is available on request — see
								<code>COMMERCIAL-LICENSE.md</code> in the source repository.
							</p>
							<p style="opacity: 0.7; font-size: 0.85rem;">
								This attribution is part of the project's required notices
								and must not be removed in redistributions or forks.
							</p>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{:else}
	{@render children()}
{/if}

<style>
	:global(*, *::before, *::after) {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	:global(body) {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		background: #0f1117;
		color: #e1e4e8;
		min-height: 100vh;
	}

	:global(a) {
		color: #8b9cf7;
		text-decoration: none;
	}
	:global(a:hover) {
		color: #a5b4fc;
	}

	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}

	/* Header */
	.app-header {
		background: rgba(10, 10, 10, 0.97);
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		padding: 0.4rem 0;
		z-index: 1000;
		flex-shrink: 0;
		position: sticky;
		top: 0;
	}

	.header-content {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		padding: 0 1rem;
	}

	/* Left: Logo + Lab name */
	.header-left {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.header-logo-link {
		display: flex;
		align-items: center;
		opacity: 0.85;
	}
	.header-logo-link:hover {
		opacity: 1;
	}

	.header-logo {
		height: 28px;
		width: auto;
		border-radius: 3px;
	}

	.app-title {
		font-size: 0.85rem;
		font-weight: 700;
		color: rgba(255, 255, 255, 0.9);
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	/* Center: App name */
	.header-center {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.4rem;
	}

	.app-name {
		font-size: 1rem;
		font-weight: 700;
		color: #a5b4fc;
		letter-spacing: -0.02em;
	}

	.app-version {
		font-size: 0.65rem;
		font-weight: 600;
		color: #f59e0b;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 0.05rem 0.35rem;
		border: 1px solid rgba(245, 158, 11, 0.4);
		border-radius: 4px;
		line-height: 1.3;
	}

	/* Right: Nav buttons */
	.header-right {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 0.25rem;
	}

	.nav-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: none;
		border: none;
		border-radius: 6px;
		color: rgba(255, 255, 255, 0.6);
		cursor: pointer;
		font-size: 0.95rem;
		font-weight: 600;
	}
	.nav-btn:hover {
		background: rgba(255, 255, 255, 0.05);
		color: rgba(255, 255, 255, 0.9);
	}

	.nav-btn-text {
		font-size: 0.85rem;
	}

	/* Dropdowns */
	.dropdown {
		position: relative;
	}

	.dropdown-menu {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 0.25rem;
		background: #1a1a1a;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		min-width: 160px;
		padding: 0.25rem 0;
		z-index: 1001;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	}

	.dropdown-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.75rem;
		font-size: 0.85rem;
		background: none;
		border: none;
		color: #e1e4e8;
		cursor: pointer;
		text-decoration: none;
	}
	.dropdown-item:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}

	.dropdown-label {
		display: block;
		padding: 0.3rem 0.75rem 0.1rem;
		font-size: 0.7rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.dropdown-info {
		display: block;
		padding: 0.1rem 0.75rem 0.3rem;
		font-size: 0.8rem;
		color: #8b8fa3;
	}

	.dropdown-divider {
		height: 1px;
		background: rgba(255, 255, 255, 0.1);
		margin: 0.25rem 0;
	}

	/* Embedding-model download toast (bottom-right) */
	.embed-toast {
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		width: 340px;
		background: #161822;
		border: 1px solid #3a4670;
		border-radius: 10px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		padding: 0.75rem 0.9rem;
		color: #e1e4e8;
		font-size: 0.85rem;
		z-index: 1500;
	}
	.embed-toast-error { border-color: #7a2a2a; }
	.embed-toast-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
	}
	.embed-toast-title { font-weight: 600; color: #a5b4fc; }
	.embed-toast-error .embed-toast-title { color: #fca5a5; }
	.embed-toast-close {
		background: none;
		border: none;
		color: #8b8fa3;
		font-size: 1.1rem;
		cursor: pointer;
		line-height: 1;
		padding: 0 0.3rem;
	}
	.embed-toast-close:hover { color: #e1e4e8; }
	.embed-toast-body { color: #c9cdd5; line-height: 1.45; }
	.embed-toast-body code { background: #0f1117; padding: 0.05rem 0.3rem; border-radius: 3px; font-size: 0.85em; color: #f59e0b; }
	.embed-progress {
		margin-top: 0.5rem;
		height: 6px;
		background: #0f1117;
		border-radius: 3px;
		overflow: hidden;
	}
	.embed-progress-bar {
		height: 100%;
		background: linear-gradient(90deg, #8b9cf7, #a5b4fc);
		transition: width 0.25s ease-out;
	}
	.embed-toast-meta { margin-top: 0.35rem; font-size: 0.75rem; color: #8b8fa3; word-break: break-all; }

	/* Security Banner (default-password warning) */
	.security-banner {
		background: #5f3b1e;
		color: #fcd9a5;
		text-align: center;
		padding: 0.45rem 1rem;
		font-size: 0.85rem;
		font-weight: 500;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		flex-shrink: 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}
	.security-banner-btn {
		background: #fcd9a5;
		color: #5f3b1e;
		border: none;
		border-radius: 4px;
		padding: 0.25rem 0.75rem;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
	.security-banner-btn:hover { background: #fde4bb; }

	/* Change-password form */
	.cp-form { display: flex; flex-direction: column; gap: 0.9rem; margin-top: 1rem; }
	.cp-form label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; color: #c9cdd5; }
	.cp-form input {
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.5rem 0.7rem;
		color: #e1e4e8;
		font-size: 0.9rem;
	}
	.cp-form input:focus { outline: none; border-color: #8b9cf7; }
	.cp-error { background: #5f1e1e; color: #fca5a5; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.85rem; }
	.cp-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.5rem; }
	.cp-btn { border: none; border-radius: 6px; padding: 0.5rem 1rem; font-size: 0.9rem; font-weight: 600; cursor: pointer; }
	.cp-btn-primary { background: #8b9cf7; color: #0f1117; }
	.cp-btn-primary:hover:not(:disabled) { background: #a5b4fc; }
	.cp-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
	.cp-btn-secondary { background: transparent; color: #c9cdd5; border: 1px solid #2a2d3a; }
	.cp-btn-secondary:hover { border-color: #8b9cf7; }

	/* DB Status Banner */
	.db-banner {
		background: #1e3a5f;
		color: #93c5fd;
		text-align: center;
		padding: 0.35rem 1rem;
		font-size: 0.8rem;
		font-weight: 500;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}
	.db-banner.db-error {
		background: #5f1e1e;
		color: #fca5a5;
	}
	.db-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(147, 197, 253, 0.3);
		border-top-color: #93c5fd;
		border-radius: 50%;
		animation: db-spin 0.8s linear infinite;
		flex-shrink: 0;
	}
	@keyframes db-spin {
		to { transform: rotate(360deg); }
	}

	/* Content
	 * Bounded flex child of .app (height: 100vh). Does NOT scroll itself —
	 * scrolling is delegated to .project-content (or to inline columns on
	 * pages that need their own scroll containers). This keeps the app
	 * header and the project sidebar fixed in place. */
	.content {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	/* Overlay */
	.overlay-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		z-index: 2000;
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding: 3rem 1rem;
		overflow-y: auto;
	}
	.overlay-panel {
		position: relative;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 10px;
		max-width: 800px;
		width: 100%;
		max-height: calc(100vh - 6rem);
		overflow-y: auto;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
	}
	.overlay-close {
		position: sticky;
		top: 0;
		float: right;
		margin: 0.5rem;
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		color: #c9cdd5;
		font-size: 1.2rem;
		width: 32px;
		height: 32px;
		cursor: pointer;
		z-index: 1;
	}
	.overlay-close:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.overlay-content {
		padding: 1.5rem 2rem 2rem;
		color: #e1e4e8;
		line-height: 1.7;
	}
	.overlay-content :global(h1) { font-size: 1.5rem; margin: 1.5rem 0 0.8rem; color: #e1e4e8; border-bottom: 1px solid #2a2d3a; padding-bottom: 0.3rem; }
	.overlay-content :global(h2) { font-size: 1.25rem; margin: 1.5rem 0 0.6rem; color: #c9cdd5; border-bottom: 1px solid #1e2030; padding-bottom: 0.2rem; }
	.overlay-content :global(h3) { font-size: 1.05rem; margin: 1.2rem 0 0.4rem; color: #8b9cf7; }
	.overlay-content :global(h4) { font-size: 0.95rem; margin: 0.8rem 0 0.3rem; color: #f59e0b; }
	.overlay-content :global(p) { margin: 0.5rem 0; }
	.overlay-content :global(code) { background: #1e2030; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.9em; color: #f59e0b; }
	.overlay-content :global(pre) { background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px; padding: 0.8rem; overflow-x: auto; }
	.overlay-content :global(pre code) { background: none; padding: 0; color: #c9cdd5; }
	.overlay-content :global(ul), .overlay-content :global(ol) { padding-left: 1.5rem; }
	.overlay-content :global(li) { margin: 0.3rem 0; }
	.overlay-content :global(strong) { color: #e1e4e8; }
	.overlay-content :global(blockquote) { border-left: 3px solid #8b9cf7; padding-left: 1rem; margin: 0.5rem 0; color: #9ca3af; }
	.overlay-content :global(table) { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
	.overlay-content :global(th), .overlay-content :global(td) { border: 1px solid #2a2d3a; padding: 0.4rem 0.6rem; font-size: 0.85rem; }
	.overlay-content :global(th) { background: #1e2030; color: #8b8fa3; text-align: left; }
	.overlay-content :global(hr) { border: none; border-top: 1px solid #2a2d3a; margin: 1.5rem 0; }
</style>
