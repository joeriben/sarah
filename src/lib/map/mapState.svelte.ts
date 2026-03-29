import { getContext, setContext } from 'svelte';
import { regionColor } from '$lib/canvas/regions.js';
import type { SwRole } from '$lib/shared/types/index.js';

const MAP_STATE_KEY = Symbol('mapState');

export type StackData = {
	inscriptions: any[];
	designations: any[];
	memos: any[];
	annotations?: any[];
	discussion?: any[];
	aiReasoning?: string | null;
	aiSuggested?: boolean;
	aiWithdrawn?: boolean;
};

export type MemoPanelData = {
	id: string;
	title: string;
	content: string;
	linkedIds: string[];
	authorId: string;
};

export type MapState = ReturnType<typeof createMapState>;

export function createMapState(
	initialData: any,
	viewport: { x: number; y: number; zoom: number },
) {
	// ─── Core data ───
	let axes = $state<any[]>(initialData.axes || []);
	let elements = $state<any[]>(initialData.elements);
	let relations = $state<any[]>(initialData.relations);
	let silences = $state<any[]>(initialData.silences);
	let clusters = $state<any[]>(initialData.clusters);
	let designationProfile = $state<any[]>(initialData.designationProfile);
	let mapMeta = $state({ id: initialData.map.id, label: initialData.map.label, properties: initialData.map.properties });

	// ─── Derived ───
	const mapType = $derived(mapMeta.properties?.mapType || 'situational');
	const allItems = $derived([...axes, ...elements, ...relations, ...silences]);
	const clusterColorMap = $derived(
		new Map(clusters.map((p: any, i: number) => [p.id, regionColor(i)]))
	);

	const DECLINED_CLUSTER = '__declined__';
	const declinedCount = $derived(
		allItems.filter((n: any) => isWithdrawn(n.properties)).length
	);

	// ─── Shared interaction state ───
	let stackId = $state<string | null>(null);
	let stackData = $state<StackData | null>(null);
	let editingId = $state<string | null>(null);
	let editingValue = $state('');
	let relatingFrom = $state<string | null>(null);
	let relatingTo = $state<string | null>(null);

	// Naming act prompt
	let actTarget = $state<string | null>(null);
	let actType = $state<'rename' | 'designate' | 'relate'>('rename');
	let actNewValue = $state('');
	let actMemo = $state('');
	let actLinkedIds = $state<string[]>([]);
	let showActLinks = $state(false);
	let actExistingMemos = $state<any[]>([]);

	// Clusters
	let assigningToCluster = $state<string | null>(null);
	let highlightedCluster = $state<string | null>(null);
	const isDeclinedFilter = $derived(highlightedCluster === DECLINED_CLUSTER);

	// AI
	let aiEnabled = $state(true);
	let aiNotification = $state<string | null>(null);
	let aiNotificationTimeout: ReturnType<typeof setTimeout> | undefined;

	// Memo panel
	let memoPanel = $state<MemoPanelData | null>(null);

	// Outside participations
	let outsideId = $state<string | null>(null);
	let outsideData = $state<any[] | null>(null);
	let outsideLoading = $state(false);

	// Discussion (stack panel local)
	let discussInput = $state('');
	let discussLoading = $state(false);
	let memoDiscussInput = $state('');
	let memoDiscussLoading = $state(false);
	let memoDiscussTarget = $state<string | null>(null);
	let clarkeFormOpen = $state(false);
	let clarkeFormQuestion = $state('');
	let clarkeFormContent = $state('');

	// Memo creation from map
	let memoCreateOpen = $state(false);
	let memoCreateTitle = $state('');
	let memoCreateContent = $state('');
	let memoCreateLinkedIds = $state<string[]>([]);

	// Cluster sidebar state
	let showClusterForm = $state(false);
	let newClusterLabel = $state('');
	let expandedCluster = $state<string | null>(null);
	let clusterContents = $state<any[]>([]);

	// ─── Helpers ───

	function isWithdrawn(props: any): boolean {
		return props?.withdrawn === true || props?.aiWithdrawn === true;
	}

	function isHiddenByFilter(node: any): boolean {
		return isDeclinedFilter && isWithdrawn(node.properties);
	}

	function isClusterHighlighted(node: any): boolean {
		if (!highlightedCluster) return false;
		return node.cluster_ids?.includes(highlightedCluster) ?? false;
	}

	function connectionOpacity(rel: any, srcNode: any, tgtNode: any): number {
		if (isDeclinedFilter && isWithdrawn(rel.properties)) return 0;
		if (isDeclinedFilter && (isWithdrawn(srcNode?.properties) || isWithdrawn(tgtNode?.properties))) return 0;
		if (isWithdrawn(rel.properties)) return 0.2;
		return 1;
	}

	function designationColor(d: string | undefined) {
		if (d === 'specification') return '#10b981';
		if (d === 'characterization') return '#f59e0b';
		return '#6b7280';
	}

	function designationLabel(d: string | undefined) {
		if (d === 'specification') return 'spec';
		if (d === 'characterization') return 'char';
		return 'cue';
	}

	function findNode(namingId: string) {
		return allItems.find((n: any) => n.naming_id === namingId);
	}

	function findInscription(namingId: string): string {
		if (!namingId) return '?';
		const node = findNode(namingId);
		if (!node) return '?';
		if (node.inscription) return node.inscription;
		if (node.mode === 'relation') {
			const src = findInscription(node.directed_from || node.part_source_id);
			const tgt = findInscription(node.directed_to || node.part_target_id);
			return `(${src} -> ${tgt})`;
		}
		return '?';
	}

	function estimateNodeWidth(node: any): number {
		if (!node) return 100;
		if (node.mode === 'relation') {
			return node.inscription ? Math.max(100, Math.min(220, node.inscription.length * 8 + 40)) : 36;
		}
		return Math.max(100, Math.min(220, (node.inscription?.length || 5) * 8 + 40));
	}

	// ─── API ───

	async function mapAction(action: string, body: Record<string, unknown> = {}) {
		const res = await fetch(`/api/projects/${initialData.projectId}/maps/${mapMeta.id}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ...body })
		});
		if (!res.ok) return null;
		return res.json();
	}

	async function reload() {
		const res = await fetch(`/api/projects/${initialData.projectId}/maps/${mapMeta.id}`);
		if (!res.ok) return;
		const fresh = await res.json();
		axes = fresh.axes || [];
		elements = fresh.elements;
		relations = fresh.relations;
		silences = fresh.silences;
		clusters = fresh.clusters;
		designationProfile = fresh.designationProfile;
	}

	// ─── Shared actions ───

	async function showStack(namingId: string) {
		if (stackId === namingId) { stackId = null; stackData = null; return; }
		stackId = namingId;
		stackData = await mapAction('getStack', { namingId });
	}

	async function submitAct() {
		if (!actTarget) return;
		if (actType === 'rename') {
			await mapAction('rename', { namingId: actTarget, inscription: actNewValue, memoText: actMemo.trim() || undefined, linkedNamingIds: actLinkedIds.length > 0 ? actLinkedIds : undefined });
		} else if (actType === 'designate') {
			await mapAction('designate', { namingId: actTarget, designation: actNewValue, memoText: actMemo.trim() || undefined, linkedNamingIds: actLinkedIds.length > 0 ? actLinkedIds : undefined });
		} else if (actType === 'relate') {
			const links = [actTarget, ...actLinkedIds];
			await fetch(`/api/projects/${initialData.projectId}/memos`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					label: `Relation: ${actNewValue || '(unnamed)'}`,
					content: actMemo.trim(),
					linkedElementIds: links
				})
			});
		}
		cancelAct();
		await reload();
	}

	async function skipAct() {
		if (!actTarget) return;
		if (actType === 'rename') {
			await mapAction('rename', { namingId: actTarget, inscription: actNewValue });
		} else if (actType === 'designate') {
			await mapAction('designate', { namingId: actTarget, designation: actNewValue });
		}
		cancelAct();
		await reload();
	}

	async function loadActMemos(namingId: string) {
		const res = await mapAction('getMemosForNaming', { namingId });
		actExistingMemos = res?.memos || [];
	}

	function cancelAct() {
		actTarget = null;
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
		actExistingMemos = [];
	}

	function toggleActLink(namingId: string) {
		if (actLinkedIds.includes(namingId)) {
			actLinkedIds = actLinkedIds.filter(id => id !== namingId);
		} else {
			actLinkedIds = [...actLinkedIds, namingId];
		}
	}

	function confirmRename() {
		if (!editingId || !editingValue.trim()) return;
		actTarget = editingId;
		actType = 'rename';
		actNewValue = editingValue.trim();
		actMemo = '';
		loadActMemos(editingId);
		editingId = null;
		editingValue = '';
	}

	function startDesignation(namingId: string, designation: string) {
		actTarget = namingId;
		actType = 'designate';
		actNewValue = designation;
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
		loadActMemos(namingId);
	}

	function startRelating(fromId: string) {
		relatingFrom = fromId;
	}

	function completeRelating(toId: string) {
		if (!relatingFrom || relatingFrom === toId) return;
		relatingTo = toId;
	}

	async function submitRelation(relInscription: string, relValence: string, relDirected: boolean) {
		if (!relatingFrom || !relatingTo) return;
		const result = await mapAction('relate', {
			sourceId: relatingFrom,
			targetId: relatingTo,
			inscription: relInscription.trim() || undefined,
			valence: relValence.trim() || undefined,
			symmetric: !relDirected
		});
		const relationId = result?.id;
		relatingFrom = null;
		relatingTo = null;
		await reload();
		if (relationId) {
			actTarget = relationId;
			actType = 'relate';
			actNewValue = relInscription.trim() || relValence.trim() || '';
			actMemo = '';
			actLinkedIds = [];
			showActLinks = false;
			loadActMemos(relationId);
		}
	}

	function cancelRelation() {
		relatingFrom = null;
		relatingTo = null;
	}

	async function toggleWithdraw(namingId: string, currentlyWithdrawn: boolean) {
		await mapAction('withdraw', { namingId, withdrawn: !currentlyWithdrawn });
		await reload();
	}

	// AI
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

	// Discussion
	async function submitDiscussion() {
		if (!stackId || !discussInput.trim() || discussLoading) return;
		discussLoading = true;
		try {
			const result = await mapAction('discussCue', { namingId: stackId, message: discussInput.trim() });
			if (!result) { showAiNotification('Discussion failed (server error)'); return; }
			discussInput = '';
			const freshStack = await mapAction('getStack', { namingId: stackId });
			if (freshStack) stackData = freshStack;
			await reload();
		} catch {
			showAiNotification('Discussion failed');
		} finally {
			discussLoading = false;
		}
	}

	async function submitMemoDiscussion(memoId: string) {
		if (!memoDiscussInput.trim() || memoDiscussLoading) return;
		memoDiscussLoading = true;
		try {
			const result = await mapAction('discussMemo', { memoId, message: memoDiscussInput.trim() });
			if (!result) { showAiNotification('Memo discussion failed'); return; }
			memoDiscussInput = '';
			if (stackId) {
				const freshStack = await mapAction('getStack', { namingId: stackId });
				if (freshStack) stackData = freshStack;
			}
		} catch {
			showAiNotification('Memo discussion failed');
		} finally {
			memoDiscussLoading = false;
		}
	}

	async function updateMemoStatus(memoId: string, status: string) {
		await mapAction('updateMemoStatus', { memoId, status });
		// Refresh stack to show updated status
		if (stackId) {
			const freshStack = await mapAction('getStack', { namingId: stackId });
			if (freshStack) stackData = freshStack;
		}
	}

	async function promoteMemo(memoId: string) {
		const result = await mapAction('promoteMemo', { memoId });
		if (!result) { showAiNotification('Promote failed'); return; }
		// Refresh stack and reload map (new naming on map)
		if (stackId) {
			const freshStack = await mapAction('getStack', { namingId: stackId });
			if (freshStack) stackData = freshStack;
		}
		await reload();
	}

	async function createClarkeQuestionMemo(question: string, content: string) {
		if (!stackId || !content.trim()) return;
		// Create a memo linked to the element whose stack is open
		await fetch(`/api/projects/${initialData.projectId}/memos`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				label: question.length > 80 ? question.slice(0, 77) + '...' : question,
				content: content.trim(),
				linkedElementIds: [stackId]
			})
		});
		// Refresh stack to show new memo
		const freshStack = await mapAction('getStack', { namingId: stackId });
		if (freshStack) stackData = freshStack;
		clarkeFormOpen = false;
		clarkeFormQuestion = '';
		clarkeFormContent = '';
	}

	function dismissMemoPanel() {
		memoPanel = null;
	}

	function openMemoCreate(linkedIds: string[] = []) {
		memoCreateLinkedIds = linkedIds;
		memoCreateTitle = '';
		memoCreateContent = '';
		memoCreateOpen = true;
	}

	async function createMapMemo() {
		if (!memoCreateTitle.trim()) return;
		await fetch(`/api/projects/${initialData.projectId}/memos`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				label: memoCreateTitle.trim(),
				content: memoCreateContent.trim(),
				linkedElementIds: memoCreateLinkedIds
			})
		});
		memoCreateOpen = false;
		memoCreateTitle = '';
		memoCreateContent = '';
		memoCreateLinkedIds = [];
		await reload();
	}

	function cancelMemoCreate() {
		memoCreateOpen = false;
		memoCreateTitle = '';
		memoCreateContent = '';
		memoCreateLinkedIds = [];
	}

	// Memo-to-memo linking
	let memoLinkTarget = $state<string | null>(null);
	let memoLinkSearch = $state('');
	let memoLinkResults = $state<any[]>([]);
	let memoLinkLoading = $state(false);

	async function searchMemosForLink(query: string) {
		if (query.trim().length < 2) { memoLinkResults = []; return; }
		memoLinkLoading = true;
		const res = await fetch(`/api/projects/${initialData.projectId}/memos`);
		if (res.ok) {
			const all = await res.json();
			const q = query.toLowerCase();
			memoLinkResults = all
				.filter((m: any) => m.id !== memoLinkTarget && (m.inscription?.toLowerCase().includes(q) || m.content?.toLowerCase().includes(q)))
				.slice(0, 8);
		}
		memoLinkLoading = false;
	}

	async function linkMemoToMemo(sourceMemoId: string, targetMemoId: string) {
		await fetch(`/api/projects/${initialData.projectId}/memos`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				label: 'Link: memo reference',
				content: '',
				linkedElementIds: [sourceMemoId, targetMemoId]
			})
		});
		memoLinkTarget = null;
		memoLinkSearch = '';
		memoLinkResults = [];
		if (stackId) {
			const freshStack = await mapAction('getStack', { namingId: stackId });
			if (freshStack) stackData = freshStack;
		}
	}

	function cancelMemoLink() {
		memoLinkTarget = null;
		memoLinkSearch = '';
		memoLinkResults = [];
	}

	// Outside participations
	async function showOutsideParticipations(namingId: string) {
		if (outsideId === namingId) { outsideId = null; outsideData = null; return; }
		outsideId = namingId;
		outsideLoading = true;
		const res = await mapAction('getOutsideParticipations', { namingId });
		outsideData = res.participations || [];
		outsideLoading = false;
	}

	async function pullOntoMap(namingId: string) {
		await mapAction('placeExisting', { namingId });
		await reload();
		if (outsideId) {
			const res = await mapAction('getOutsideParticipations', { namingId: outsideId });
			outsideData = res.participations || [];
		}
	}

	// Clusters
	async function addCluster() {
		if (!newClusterLabel.trim()) return;
		await mapAction('createCluster', { inscription: newClusterLabel.trim() });
		newClusterLabel = '';
		showClusterForm = false;
		await reload();
	}

	async function assignToClusterFn(clusterId: string, namingId: string) {
		await mapAction('assignToCluster', { clusterId, namingId });
		await reload();
		if (expandedCluster === clusterId) {
			const res = await fetch(`/api/projects/${initialData.projectId}/maps/${clusterId}`);
			if (res.ok) {
				const fresh = await res.json();
				clusterContents = [...(fresh.elements || []), ...(fresh.relations || []), ...(fresh.silences || [])];
			}
		}
	}

	async function removeFromClusterFn(clusterId: string, namingId: string) {
		await mapAction('removeFromCluster', { clusterId, namingId });
		await reload();
		if (expandedCluster === clusterId) {
			const res = await fetch(`/api/projects/${initialData.projectId}/maps/${clusterId}`);
			if (res.ok) {
				const fresh = await res.json();
				clusterContents = [...(fresh.elements || []), ...(fresh.relations || []), ...(fresh.silences || [])];
			}
		}
	}

	async function toggleCluster(clusterId: string) {
		if (expandedCluster === clusterId) {
			expandedCluster = null;
			clusterContents = [];
		} else {
			expandedCluster = clusterId;
			const res = await fetch(`/api/projects/${initialData.projectId}/maps/${clusterId}`);
			if (res.ok) {
				const fresh = await res.json();
				clusterContents = [...(fresh.elements || []), ...(fresh.relations || []), ...(fresh.silences || [])];
			}
		}
	}

	// Perspectival collapse
	async function pinToLayer(namingId: string, seq: number) {
		await mapAction('setCollapse', { namingId, collapseAt: seq });
		await reload();
	}

	async function unpinLayer(namingId: string) {
		await mapAction('setCollapse', { namingId, collapseAt: null });
		await reload();
	}

	// ─── Sync data from page props ───
	function syncData(data: any) {
		axes = data.axes || [];
		elements = data.elements;
		relations = data.relations;
		silences = data.silences;
		clusters = data.clusters;
		designationProfile = data.designationProfile;
		mapMeta = { id: data.map.id, label: data.map.label, properties: data.map.properties };
	}

	return {
		// Data (getters)
		get axes() { return axes; },
		get elements() { return elements; },
		get relations() { return relations; },
		get silences() { return silences; },
		get clusters() { return clusters; },
		get designationProfile() { return designationProfile; },
		get mapType() { return mapType; },
		get allItems() { return allItems; },
		get clusterColorMap() { return clusterColorMap; },
		get declinedCount() { return declinedCount; },
		get isDeclinedFilter() { return isDeclinedFilter; },
		DECLINED_CLUSTER,

		// Interaction state (getters/setters)
		get stackId() { return stackId; },
		set stackId(v) { stackId = v; },
		get stackData() { return stackData; },
		set stackData(v) { stackData = v; },
		get editingId() { return editingId; },
		set editingId(v) { editingId = v; },
		get editingValue() { return editingValue; },
		set editingValue(v) { editingValue = v; },
		get relatingFrom() { return relatingFrom; },
		set relatingFrom(v) { relatingFrom = v; },
		get relatingTo() { return relatingTo; },
		set relatingTo(v) { relatingTo = v; },
		get actTarget() { return actTarget; },
		set actTarget(v) { actTarget = v; },
		get actType() { return actType; },
		set actType(v) { actType = v; },
		get actNewValue() { return actNewValue; },
		set actNewValue(v) { actNewValue = v; },
		get actMemo() { return actMemo; },
		set actMemo(v) { actMemo = v; },
		get actLinkedIds() { return actLinkedIds; },
		set actLinkedIds(v) { actLinkedIds = v; },
		get showActLinks() { return showActLinks; },
		set showActLinks(v) { showActLinks = v; },
		get actExistingMemos() { return actExistingMemos; },
		get assigningToCluster() { return assigningToCluster; },
		set assigningToCluster(v) { assigningToCluster = v; },
		get highlightedCluster() { return highlightedCluster; },
		set highlightedCluster(v) { highlightedCluster = v; },
		get aiEnabled() { return aiEnabled; },
		get aiNotification() { return aiNotification; },
		set aiNotification(v) { aiNotification = v; },
		get memoPanel() { return memoPanel; },
		set memoPanel(v) { memoPanel = v; },
		get outsideId() { return outsideId; },
		set outsideId(v) { outsideId = v; },
		get outsideData() { return outsideData; },
		set outsideData(v) { outsideData = v; },
		get outsideLoading() { return outsideLoading; },

		// Discussion state
		get discussInput() { return discussInput; },
		set discussInput(v) { discussInput = v; },
		get discussLoading() { return discussLoading; },
		get memoDiscussInput() { return memoDiscussInput; },
		set memoDiscussInput(v) { memoDiscussInput = v; },
		get memoDiscussLoading() { return memoDiscussLoading; },
		get memoDiscussTarget() { return memoDiscussTarget; },
		set memoDiscussTarget(v) { memoDiscussTarget = v; },
		get clarkeFormOpen() { return clarkeFormOpen; },
		set clarkeFormOpen(v) { clarkeFormOpen = v; },
		get clarkeFormQuestion() { return clarkeFormQuestion; },
		set clarkeFormQuestion(v) { clarkeFormQuestion = v; },
		get clarkeFormContent() { return clarkeFormContent; },
		set clarkeFormContent(v) { clarkeFormContent = v; },

		// Memo creation
		get memoCreateOpen() { return memoCreateOpen; },
		set memoCreateOpen(v) { memoCreateOpen = v; },
		get memoCreateTitle() { return memoCreateTitle; },
		set memoCreateTitle(v) { memoCreateTitle = v; },
		get memoCreateContent() { return memoCreateContent; },
		set memoCreateContent(v) { memoCreateContent = v; },
		get memoCreateLinkedIds() { return memoCreateLinkedIds; },
		set memoCreateLinkedIds(v) { memoCreateLinkedIds = v; },

		// Memo-to-memo linking
		get memoLinkTarget() { return memoLinkTarget; },
		set memoLinkTarget(v) { memoLinkTarget = v; },
		get memoLinkSearch() { return memoLinkSearch; },
		set memoLinkSearch(v) { memoLinkSearch = v; },
		get memoLinkResults() { return memoLinkResults; },
		get memoLinkLoading() { return memoLinkLoading; },

		// Cluster sidebar state
		get showClusterForm() { return showClusterForm; },
		set showClusterForm(v) { showClusterForm = v; },
		get newClusterLabel() { return newClusterLabel; },
		set newClusterLabel(v) { newClusterLabel = v; },
		get expandedCluster() { return expandedCluster; },
		get clusterContents() { return clusterContents; },

		// Helpers
		isWithdrawn,
		isHiddenByFilter,
		isClusterHighlighted,
		connectionOpacity,
		designationColor,
		designationLabel,
		findNode,
		findInscription,
		estimateNodeWidth,

		// API
		mapAction,
		reload,
		syncData,

		// Actions
		showStack,
		submitAct,
		skipAct,
		loadActMemos,
		cancelAct,
		toggleActLink,
		confirmRename,
		startDesignation,
		startRelating,
		completeRelating,
		submitRelation,
		cancelRelation,
		toggleWithdraw,
		showAiNotification,
		toggleAi,
		requestAnalysis,
		submitDiscussion,
		submitMemoDiscussion,
		updateMemoStatus,
		promoteMemo,
		createClarkeQuestionMemo,
		dismissMemoPanel,
		openMemoCreate,
		createMapMemo,
		cancelMemoCreate,
		searchMemosForLink,
		linkMemoToMemo,
		cancelMemoLink,
		showOutsideParticipations,
		pullOntoMap,
		addCluster,
		assignToCluster: assignToClusterFn,
		removeFromCluster: removeFromClusterFn,
		toggleCluster,
		pinToLayer,
		unpinLayer,

		// Data needed for API URLs
		projectId: initialData.projectId,
		get mapId() { return mapMeta.id; },
		get mapLabel() { return mapMeta.label; },
		get mapProperties() { return mapMeta.properties; },
	};
}

export function setMapState(state: MapState) {
	setContext(MAP_STATE_KEY, state);
}

export function getMapState(): MapState {
	return getContext<MapState>(MAP_STATE_KEY);
}
