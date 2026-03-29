<script lang="ts">
	import type { Snippet } from 'svelte';
	import { marked } from 'marked';

	let { data, children }: { data: { user: any }; children: Snippet } = $props();

	let settingsOpen = $state(false);
	let legalOpen = $state(false);

	// Overlay state
	let overlay = $state<'manual' | 'impressum' | null>(null);
	let manualHtml = $state<string | null>(null);

	async function openManual() {
		overlay = 'manual';
		if (!manualHtml) {
			const res = await fetch('/api/manual');
			if (res.ok) {
				const { content } = await res.json();
				manualHtml = marked(content) as string;
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
	<title>transact-qda</title>
</svelte:head>

{#if data.user}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="app" onclick={closeDropdowns}>
		<header class="app-header">
			<div class="header-content">
				<div class="header-left">
					<a href="https://www.ucdcae.fau.de/" target="_blank" rel="noopener noreferrer" class="header-logo-link">
						<img src="/logos/unesco_chair.png" alt="UNESCO Chair" class="header-logo" />
					</a>
					<span class="app-title">UCDCAE AI LAB</span>
				</div>

				<div class="header-center">
					<span class="app-name">transact-qda</span>
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
								<button class="dropdown-item" onclick={() => { legalOpen = false; overlay = 'impressum'; }}>Impressum</button>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</header>

		<main class="content">
			{@render children()}
		</main>

		<!-- Overlays -->
		{#if overlay}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="overlay-backdrop" onclick={() => overlay = null}>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="overlay-panel" onclick={e => e.stopPropagation()}>
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
							<p><strong>Herausgeber</strong><br>
							Friedrich-Alexander-Universität Erlangen-Nürnberg<br>
							Vertreten durch den Präsidenten Prof. Dr. Joachim Hornegger<br>
							Freyeslebenstraße 1, 91058 Erlangen<br>
							E-Mail: <a href="mailto:poststelle@fau.de">poststelle@fau.de</a></p>

							<p><strong>Inhaltlich verantwortlich gem. § 18 Abs. 2 MStV</strong><br>
							Prof. Dr. Benjamin Jörissen<br>
							Bismarckstraße 1a, 91054 Erlangen<br>
							E-Mail: <a href="mailto:benjamin.joerissen@fau.de">benjamin.joerissen@fau.de</a></p>

							<p><strong>Zuständige Aufsichtsbehörde</strong><br>
							Bayerisches Staatsministerium für Wissenschaft und Kunst<br>
							Salvatorstraße 2, 80327 München<br>
							<a href="https://www.stmwk.bayern.de/" target="_blank" rel="noopener">www.stmwk.bayern.de</a></p>

							<p><strong>Weitere Informationen</strong><br>
							Das vollständige Impressum der FAU finden Sie unter:<br>
							<a href="https://www.fau.de/impressum" target="_blank" rel="noopener">www.fau.de/impressum</a></p>
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
		justify-content: center;
	}

	.app-name {
		font-size: 1rem;
		font-weight: 700;
		color: #a5b4fc;
		letter-spacing: -0.02em;
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

	/* Content */
	.content {
		flex: 1;
		overflow-y: auto;
		height: 0; /* flex child: let flex: 1 control actual height */
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
