<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	let {
		x1 = 0,
		y1 = 0,
		x2 = 0,
		y2 = 0,
		label = '',
		color = '#4b5563',
		selected = false,
		directed = false,
		isMeta = false,
		opacity = 1,
		onclick
	}: {
		x1?: number;
		y1?: number;
		x2?: number;
		y2?: number;
		label?: string;
		color?: string;
		selected?: boolean;
		directed?: boolean;
		isMeta?: boolean;
		opacity?: number;
		onclick?: () => void;
	} = $props();

	const midX = $derived((x1 + x2) / 2);
	const midY = $derived((y1 + y2) / 2);

	// Bezier control point offset for a slight curve
	const cpOffset = $derived(Math.min(50, Math.hypot(x2 - x1, y2 - y1) * 0.15));
	const angle = $derived(Math.atan2(y2 - y1, x2 - x1));
	const cpX = $derived(midX + Math.sin(angle) * cpOffset);
	const cpY = $derived(midY - Math.cos(angle) * cpOffset);

	const pathD = $derived(`M ${x1} ${y1} Q ${cpX} ${cpY} ${x2} ${y2}`);

	// Arrowhead: point at the end of the curve, oriented along the last segment
	const arrowAngle = $derived(Math.atan2(y2 - cpY, x2 - cpX));
	const arrowSize = 8;
	const a1x = $derived(x2 - arrowSize * Math.cos(arrowAngle - 0.4));
	const a1y = $derived(y2 - arrowSize * Math.sin(arrowAngle - 0.4));
	const a2x = $derived(x2 - arrowSize * Math.cos(arrowAngle + 0.4));
	const a2y = $derived(y2 - arrowSize * Math.sin(arrowAngle + 0.4));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<svg class="canvas-connection" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; overflow:visible; opacity: {opacity};">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<path
		d={pathD}
		fill="none"
		stroke={color}
		stroke-width={selected ? 3 : 1.5}
		stroke-dasharray={isMeta ? '6 3' : 'none'}
		style="pointer-events: stroke; cursor: pointer;"
		onclick={onclick}
	/>

	{#if directed}
		<polygon
			points="{x2},{y2} {a1x},{a1y} {a2x},{a2y}"
			fill={color}
		/>
	{/if}

	{#if label}
		<text
			x={cpX}
			y={cpY - 8}
			text-anchor="middle"
			fill="#8b8fa3"
			font-size="11"
			style="pointer-events: none;"
		>{label}</text>
	{/if}

	{#if isMeta}
		<polygon
			points="{midX},{midY - 6} {midX + 6},{midY} {midX},{midY + 6} {midX - 6},{midY}"
			fill={color}
			stroke="#0f1117"
			stroke-width="1"
		/>
	{/if}
</svg>
