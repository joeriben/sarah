<script lang="ts">
	let username = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);
	let mode = $state<'login' | 'register'>('login');
	let email = $state('');
	let displayName = $state('');

	async function submit() {
		error = '';
		loading = true;
		try {
			const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
			const body = mode === 'login'
				? { username, password }
				: { username, password, email, displayName: displayName || undefined };

			const res = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			const data = await res.json();
			if (!res.ok) {
				error = data.error || 'Something went wrong';
				return;
			}

			window.location.href = '/projects';
		} catch {
			error = 'Connection failed';
		} finally {
			loading = false;
		}
	}
</script>

<div class="login-page">
	<div class="login-card">
		<h1>transact-qda</h1>
		<p class="subtitle">Qualitative Data Analysis<br>for Situational Analysis</p>

		<div class="tabs">
			<button class:active={mode === 'login'} onclick={() => mode = 'login'}>Login</button>
			<button class:active={mode === 'register'} onclick={() => mode = 'register'}>Register</button>
		</div>

		<form onsubmit={e => { e.preventDefault(); submit(); }}>
			<label>
				Username
				<input type="text" bind:value={username} required autocomplete="username" />
				{#if mode === 'register'}
					<span class="hint">Letters, numbers, hyphens and underscores only</span>
				{/if}
			</label>

			{#if mode === 'register'}
				<label>
					Email
					<input type="email" bind:value={email} required autocomplete="email" />
				</label>
				<label>
					Display name
					<input type="text" bind:value={displayName} autocomplete="name" />
				</label>
			{/if}

			<label>
				Password
				<input type="password" bind:value={password} required minlength="8" autocomplete={mode === 'login' ? 'current-password' : 'new-password'} />
			</label>

			{#if error}
				<div class="error">{error}</div>
			{/if}

			<button type="submit" class="submit" disabled={loading}>
				{loading ? '...' : mode === 'login' ? 'Sign in' : 'Create account'}
			</button>
		</form>
	</div>
</div>

<style>
	.login-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #0f1117;
	}

	.login-card {
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 12px;
		padding: 2.5rem;
		width: 380px;
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: #a5b4fc;
		letter-spacing: -0.02em;
	}

	.subtitle {
		font-size: 0.85rem;
		color: #6b7280;
		margin-top: 0.25rem;
		margin-bottom: 1.5rem;
		line-height: 1.4;
	}

	.tabs {
		display: flex;
		gap: 0;
		margin-bottom: 1.5rem;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		overflow: hidden;
	}

	.tabs button {
		flex: 1;
		padding: 0.5rem;
		background: transparent;
		border: none;
		color: #8b8fa3;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.tabs button.active {
		background: #1e2030;
		color: #e1e4e8;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: #8b8fa3;
	}

	input {
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.6rem 0.75rem;
		color: #e1e4e8;
		font-size: 0.9rem;
	}
	input:focus {
		outline: none;
		border-color: #8b9cf7;
	}

	.hint {
		font-size: 0.75rem;
		color: #6b7280;
		margin-top: -0.1rem;
	}

	.error {
		color: #f87171;
		font-size: 0.85rem;
	}

	.submit {
		background: #8b9cf7;
		color: #0f1117;
		border: none;
		border-radius: 6px;
		padding: 0.65rem;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		margin-top: 0.5rem;
	}
	.submit:hover {
		background: #a5b4fc;
	}
	.submit:disabled {
		opacity: 0.5;
	}
</style>
