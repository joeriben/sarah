import { getContext, setContext } from 'svelte';

const COACH_KEY = Symbol('coach');

export type CoachMessage = {
	role: 'user' | 'assistant';
	content: string;
};

export type CoachState = ReturnType<typeof createCoachState>;

export function createCoachState(projectId: string) {
	const STORAGE_KEY = `coach-${projectId}`;

	// Load from sessionStorage
	let messages = $state<CoachMessage[]>(loadFromSession());
	let isOpen = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);

	function loadFromSession(): CoachMessage[] {
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
			const res = await fetch(`/api/projects/${projectId}/coach`, {
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

export function setCoachState(state: CoachState) {
	setContext(COACH_KEY, state);
}

export function getCoachState(): CoachState {
	return getContext<CoachState>(COACH_KEY);
}
