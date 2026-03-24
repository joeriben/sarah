import { getContext, setContext } from 'svelte';

const AIDELE_KEY = Symbol('aidele');

export type AideleMessage = {
	role: 'user' | 'assistant';
	content: string;
};

export type AideleState = ReturnType<typeof createAideleState>;

export function createAideleState(projectId: string) {
	const STORAGE_KEY = `aidele-${projectId}`;

	// Load from sessionStorage
	let messages = $state<AideleMessage[]>(loadFromSession());
	let isOpen = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);

	function loadFromSession(): AideleMessage[] {
		if (typeof sessionStorage === 'undefined') return [];
		try {
			const raw = sessionStorage.getItem(STORAGE_KEY);
			return raw ? JSON.parse(raw) : [];
		} catch {
			return [];
		}
	}

	function saveToSession() {
		if (typeof sessionStorage === 'undefined') return;
		try {
			sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
		} catch {
			// sessionStorage full or unavailable — ignore
		}
	}

	// Sync to sessionStorage on changes
	$effect(() => {
		// Serialize triggers dependency on the full array content
		JSON.stringify(messages);
		saveToSession();
	});

	async function send(message: string, currentPage: string, currentMapId?: string) {
		messages.push({ role: 'user', content: message });
		loading = true;
		error = null;

		try {
			const res = await fetch(`/api/projects/${projectId}/aidele`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message,
					history: messages.slice(0, -1), // all except the just-added user message
					currentPage,
					currentMapId
				})
			});

			const data = await res.json();

			if (!res.ok || data.error) {
				throw new Error(data.error || `HTTP ${res.status}`);
			}

			messages.push({ role: 'assistant', content: data.response });
		} catch (e: any) {
			error = e.message || 'Unknown error';
			// Remove the failed user message
			messages.pop();
		} finally {
			loading = false;
		}
	}

	function clear() {
		messages = [];
		error = null;
	}

	return {
		get messages() { return messages; },
		get isOpen() { return isOpen; },
		set isOpen(v: boolean) { isOpen = v; },
		get loading() { return loading; },
		get error() { return error; },
		send,
		clear
	};
}

export function setAideleState(state: AideleState) {
	setContext(AIDELE_KEY, state);
}

export function getAideleState(): AideleState {
	return getContext<AideleState>(AIDELE_KEY);
}
