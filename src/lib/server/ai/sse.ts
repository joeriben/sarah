// Server-Sent Events for map-level AI notifications.
// In-memory EventEmitter per map (single-server architecture).
// Clients subscribe via GET /api/projects/[projectId]/maps/[mapId]/events

type MapEventData = {
	type: string;
	payload: unknown;
};

type Listener = (data: MapEventData) => void;

const mapListeners = new Map<string, Set<Listener>>();

export function subscribe(mapId: string, listener: Listener): () => void {
	if (!mapListeners.has(mapId)) {
		mapListeners.set(mapId, new Set());
	}
	mapListeners.get(mapId)!.add(listener);

	return () => {
		const listeners = mapListeners.get(mapId);
		if (listeners) {
			listeners.delete(listener);
			if (listeners.size === 0) mapListeners.delete(mapId);
		}
	};
}

export function emit(mapId: string, type: string, payload: unknown) {
	const listeners = mapListeners.get(mapId);
	if (!listeners) return;
	for (const listener of listeners) {
		listener({ type, payload });
	}
}
