<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Dokumentenzentrierte, informationsangereicherte Volltext-Ansicht
  (transact-qda-Stil): Volltext links, Argumente/Edges/Scaffolding/Codes/Memos
  rechts pro Paragraph. Wird sowohl im Reader-Modal (Argumente-Mode, als
  Peek-Sicht aus Outline-§X:AY-Klicks) als auch als eigenständiger Doc-Page-Tab
  "Dokument" verwendet.

  Die "Vorwärts"-Sicht (Synthesen referenzieren §X:AY) lebt im Outline-Tab;
  diese Komponente ist die "Rückwärts"-Sicht: Argumente am Dokument.
-->
<script lang="ts">
	import type {
		DocumentElement,
		ParagraphMemo,
		CodeAnchor,
		HeadingSynthesis,
		ParagraphAnalysis,
		ParagraphArgument,
		ParagraphPremise,
		ParagraphEdge,
	} from './+page.server.js';

	interface Props {
		elements: DocumentElement[];
		memosByElement: Record<string, ParagraphMemo[]>;
		codesByElement: Record<string, CodeAnchor[]>;
		synthesesByHeading: Record<string, HeadingSynthesis>;
		analysisByElement: Record<string, ParagraphAnalysis>;
		scrollTarget?: { elementId: string; argumentId?: string } | null;
	}

	let {
		elements,
		memosByElement,
		codesByElement,
		synthesesByHeading,
		analysisByElement,
		scrollTarget = null,
	}: Props = $props();

	function premiseLabel(p: { type: 'stated' | 'carried' | 'background'; from_paragraph?: number }): string {
		if (p.type === 'stated') return 'im Absatz';
		if (p.type === 'background') return 'Hintergrund';
		// carried: aus früherem Absatz desselben Unterkapitels
		if (typeof p.from_paragraph === 'number' && p.from_paragraph >= 1) {
			return `aus §${p.from_paragraph}`;
		}
		return 'aus früherem Absatz';
	}
	const KIND_VERB: Record<ParagraphEdge['kind'], { out: string; in: string }> = {
		supports: { out: 'stützt', in: 'wird gestützt von' },
		refines: { out: 'präzisiert', in: 'wird präzisiert durch' },
		contradicts: { out: 'widerspricht', in: 'widersprochen von' },
		presupposes: { out: 'setzt voraus', in: 'wird vorausgesetzt von' },
	};
	// a1-Klassifikation des Belegtyps. Wortwahl konsistent: "Beleg" = Literaturverweis,
	// nicht zu verwechseln mit Premissen-Bezug auf andere Argumente. Pipeline-Klassifikation,
	// neutral angezeigt; Reviewer-Wertung trägt die separate Bodenkontakt-Pille.
	const GROUNDING_LABEL: Record<'none' | 'namedropping' | 'abstract' | 'concrete', string> = {
		none: 'kein Beleg',
		namedropping: 'Pseudo-Beleg',
		abstract: 'Werkbezug ohne Stelle',
		concrete: 'Stellenbeleg',
	};
	// Schluss-Form aus dem Charity-Pass (opt-in argument_validity).
	const FORM_LABEL: Record<'deductive' | 'inductive' | 'abductive', string> = {
		deductive: 'deduktiv',
		inductive: 'induktiv',
		abductive: 'abduktiv',
	};
	function formatEdgeTarget(e: ParagraphEdge): string {
		if (e.scope === 'prior_paragraph' && e.other.paraNumWithinChapter) {
			return `§${e.other.paraNumWithinChapter}:${e.other.argLocalId}`;
		}
		return e.other.argLocalId;
	}

	// Bodenkontakt-Severity = abgeleitete Reviewer-Achse, rekursiv über carried-/
	// inter-argument-Edges. Quellen werden konkret aufgelöst (Premissen-Label
	// "aus §N:Aₓ", nicht "Prämisse nicht belegt"); Severity erbt sich vom Quell-
	// Argument. Pipeline-Realität: Cross-Paragraph-Edges kommen häufig als
	// "refines" statt "presupposes" — beide werden für Resolution akzeptiert.
	//   a1 — eigener Literaturbeleg im Absatz (referentialGrounding)
	//   c  — Bezug auf anderes Argument (intra-¶ supports/refines, cross-¶
	//        prior_paragraph supports/refines/presupposes)
	//   b (common sense) bleibt blinder Fleck; Heuristik "alle Prämissen sind
	//      Hintergrund" → gelb.
	type GroundSeverity = {
		level: 'rooted' | 'partial' | 'broken';
		label: string;
		reason: string;
	};
	type CarriedSource = {
		paragraphId: string;
		argLocalId: string;
		paraNum: number | null;
	};

	const SEV_ORDER: Record<GroundSeverity['level'], number> = { rooted: 0, partial: 1, broken: 2 };

	// Globaler Argument-Lookup, paragraphId → argLocalId → ParagraphArgument
	const argsIndex = $derived.by(() => {
		const idx = new Map<string, Map<string, ParagraphArgument>>();
		for (const [pid, an] of Object.entries(analysisByElement ?? {})) {
			if (!an) continue;
			const sub = new Map<string, ParagraphArgument>();
			for (const a of an.args) sub.set(a.argLocalId, a);
			idx.set(pid, sub);
		}
		return idx;
	});

	// Auflösung einer carried-Prämisse zu einem konkreten Quell-Argument.
	// Sucht prior_paragraph-Edges (presupposes bevorzugt, dann refines/supports);
	// matcht über paraNumWithinChapter == premise.from_paragraph wenn möglich.
	function resolveCarriedSource(
		premise: ParagraphPremise,
		edgesOfArg: ParagraphEdge[]
	): CarriedSource | null {
		if (premise.type !== 'carried') return null;
		const candidates = edgesOfArg.filter(
			(e) => e.direction === 'outgoing' && e.scope === 'prior_paragraph'
		);
		if (candidates.length === 0) return null;
		const presup = candidates.filter((e) => e.kind === 'presupposes');
		const pool = presup.length > 0 ? presup : candidates;
		const target = (typeof premise.from_paragraph === 'number'
			? pool.find((e) => e.other.paraNumWithinChapter === premise.from_paragraph)
			: null) ?? pool[0];
		return {
			paragraphId: target.other.paragraphId,
			argLocalId: target.other.argLocalId,
			paraNum: target.other.paraNumWithinChapter ?? premise.from_paragraph ?? null,
		};
	}

	function argumentSeverity(
		arg: ParagraphArgument,
		paragraphId: string,
		visited: Set<string>,
		memo: Map<string, GroundSeverity>
	): GroundSeverity {
		const key = `${paragraphId}:${arg.argLocalId}`;
		const cached = memo.get(key);
		if (cached) return cached;
		if (visited.has(key)) {
			const cyc: GroundSeverity = {
				level: 'partial',
				label: 'zyklischer Verweis',
				reason: 'Stützkette führt rekursiv auf sich selbst zurück',
			};
			return cyc;
		}
		const v = new Set(visited);
		v.add(key);

		const finish = (r: GroundSeverity): GroundSeverity => {
			memo.set(key, r);
			return r;
		};

		// a1 — direktes grounding hat Vorrang
		if (arg.referentialGrounding === 'concrete') {
			return finish({ level: 'rooted', label: 'im Absatz belegt', reason: 'a1 — Stellenbeleg im Absatz' });
		}
		if (arg.referentialGrounding === 'namedropping') {
			return finish({ level: 'broken', label: 'Pseudo-Beleg', reason: 'a1 — Autoritätsanruf ohne Werkbezug' });
		}
		if (arg.referentialGrounding === 'abstract') {
			return finish({ level: 'partial', label: 'Werk genannt, ohne Stelle', reason: 'a1 — Werkbezug abstrakt' });
		}

		// grounding=none/null → Prämissen-Profil + Cross-Refs
		if (arg.premises.length === 0) {
			return finish({ level: 'broken', label: 'frei behauptet', reason: 'kein Beleg, keine Prämisse' });
		}
		if (arg.premises.every((p) => p.type === 'background')) {
			return finish({
				level: 'partial',
				label: 'nur Hintergrund-Prämissen',
				reason: 'kein eigener Beleg, nur fachüblicher Konsens — Eigenleistung sichten',
			});
		}

		const ana = analysisByElement?.[paragraphId];
		const edgesOfArg = ana?.edges.filter((e) => e.selfArgLocalId === arg.argLocalId) ?? [];

		// Sammle Severity aller verfolgbaren Quellen
		type SourceSev = { sev: GroundSeverity; via: string };
		const sources: SourceSev[] = [];

		// Carried-Prämissen → rekursiv das Quell-Argument
		for (const p of arg.premises) {
			if (p.type !== 'carried') continue;
			const src = resolveCarriedSource(p, edgesOfArg);
			if (!src) {
				const num = p.from_paragraph;
				sources.push({
					sev: {
						level: 'partial',
						label: 'Quelle nicht verlinkt',
						reason: 'c — Pipeline hat keinen prior_paragraph-Edge zur Quelle gesetzt',
					},
					via: num ? `§${num}` : '?',
				});
				continue;
			}
			const srcArg = argsIndex.get(src.paragraphId)?.get(src.argLocalId);
			const via = src.paraNum != null ? `§${src.paraNum}:${src.argLocalId}` : src.argLocalId;
			if (!srcArg) {
				sources.push({
					sev: { level: 'partial', label: 'Quelle nicht ladbar', reason: 'Ziel-Argument nicht im aktuellen Render-Set' },
					via,
				});
				continue;
			}
			sources.push({ sev: argumentSeverity(srcArg, src.paragraphId, v, memo), via });
		}

		// Intra-¶ supports/refines incoming — A wird durch Aₓ aus demselben ¶ gestützt
		const incoming = edgesOfArg.filter(
			(e) =>
				e.direction === 'incoming' &&
				e.scope === 'inter_argument' &&
				(e.kind === 'supports' || e.kind === 'refines')
		);
		for (const e of incoming) {
			const supporter = argsIndex.get(paragraphId)?.get(e.other.argLocalId);
			if (!supporter) continue;
			sources.push({
				sev: argumentSeverity(supporter, paragraphId, v, memo),
				via: e.other.argLocalId,
			});
		}

		if (sources.length === 0) {
			return finish({
				level: 'broken',
				label: 'frei behauptet',
				reason: 'kein Beleg, keine verfolgbare Prämissen-Quelle',
			});
		}

		// Aggregat: schlechteste Severity der Quellen erbt sich.
		const worst = sources.reduce((acc, s) => (SEV_ORDER[s.sev.level] > SEV_ORDER[acc.sev.level] ? s : acc));
		if (worst.sev.level === 'rooted') {
			return finish({
				level: 'rooted',
				label: `aus ${worst.via} geerbt`,
				reason: `c — alle ${sources.length} Quelle(n) belegt; entscheidend ${worst.via}`,
			});
		}
		return finish({
			level: worst.sev.level,
			label: `Quelle ${worst.via}: ${worst.sev.label}`,
			reason: `geerbt von ${worst.via} (${worst.sev.label}); ${sources.length} Quelle(n) insgesamt`,
		});
	}

	// Vollständige Severity-Map vorab — pro Render einmal, statt pro Argument-Aufruf.
	const severityMap = $derived.by(() => {
		const memo = new Map<string, GroundSeverity>();
		for (const [pid, an] of Object.entries(analysisByElement ?? {})) {
			if (!an) continue;
			for (const a of an.args) {
				const key = `${pid}:${a.argLocalId}`;
				if (!memo.has(key)) argumentSeverity(a, pid, new Set(), memo);
			}
		}
		return memo;
	});

	const documentElements = $derived(
		elements.filter(
			(e) =>
				e.section_kind === 'main' &&
				(e.element_type === 'heading' || e.element_type === 'paragraph')
		)
	);

	const positionInDocument = $derived.by(() => {
		const map = new Map<string, number>();
		let pos = 0;
		for (const el of documentElements) {
			if (el.element_type === 'paragraph') {
				pos += 1;
				map.set(el.id, pos);
			}
		}
		return map;
	});

	function memosFor(id: string): ParagraphMemo[] {
		return memosByElement[id] ?? [];
	}
	function codesFor(id: string): CodeAnchor[] {
		return codesByElement[id] ?? [];
	}
	function synthesisFor(id: string): HeadingSynthesis | null {
		return synthesesByHeading[id] ?? null;
	}
	function analysisFor(id: string): ParagraphAnalysis | null {
		return analysisByElement?.[id] ?? null;
	}
	function hasAnyAnalysis(a: ParagraphAnalysis | null): boolean {
		return !!a && (a.args.length > 0 || a.scaffolding.length > 0 || a.edges.length > 0);
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		const target = scrollTarget;
		if (!target) return;
		queueMicrotask(() => {
			const argEl = target.argumentId
				? window.document.getElementById(`arg-${target.elementId}-${target.argumentId}`)
				: null;
			const paraEl = window.document.getElementById(`para-${target.elementId}`);
			const focus = argEl ?? paraEl;
			if (!focus) return;
			focus.scrollIntoView({ behavior: 'smooth', block: 'center' });
			if (paraEl) {
				paraEl.classList.add('flash');
				setTimeout(() => paraEl.classList.remove('flash'), 1600);
			}
			if (argEl) {
				argEl.classList.add('arg-flash');
				setTimeout(() => argEl.classList.remove('arg-flash'), 2400);
			}
		});
	});
</script>

<div class="doc-reader">
	{#each documentElements as el (el.id)}
		{#if el.element_type === 'heading'}
			{@const synthesis = synthesisFor(el.id)}
			<section class="doc-section" id="head-{el.id}">
				<h3 class="doc-heading">{el.text?.trim()}</h3>
				{#if synthesis}
					<div class="synthesis">
						<div class="synth-label">Kontextualisierende Synthese</div>
						<div class="synth-content">{synthesis.content}</div>
					</div>
				{/if}
			</section>
		{:else}
			{@const interpr = memosFor(el.id).find((m) => m.memo_type === 'interpretierend')}
			{@const formul = memosFor(el.id).find((m) => m.memo_type === 'formulierend')}
			{@const codes = codesFor(el.id)}
			{@const analysis = analysisFor(el.id)}
			{@const showAnalysis = hasAnyAnalysis(analysis)}
			{@const hasRightPane = !!interpr || !!formul || codes.length > 0 || showAnalysis}
			{@const pos = positionInDocument.get(el.id)}
			<article class="doc-paragraph" class:no-memo={!hasRightPane} id="para-{el.id}">
				<div class="para-text">
					{#if pos != null}
						<span class="para-num">§{pos}</span>
					{/if}
					{el.text}
				</div>
				{#if hasRightPane}
					<aside class="memo-pane">
						{#if formul}
							<div class="memo memo-formulierend">
								<div class="memo-label">formulierend</div>
								<div class="memo-content">{formul.content}</div>
							</div>
						{/if}
						{#if interpr}
							<div class="memo memo-interpretierend">
								<div class="memo-label">interpretierend</div>
								<div class="memo-content">{interpr.content}</div>
							</div>
						{/if}
						{#if codes.length > 0}
							<div class="codes">
								{#each codes as c}
									<span class="code-chip" title={`${c.char_start}–${c.char_end}`}>{c.phrase}</span>
								{/each}
							</div>
						{/if}
						{#if showAnalysis && analysis}
							{#if analysis.args.length > 0}
								<div class="analysis-block">
									<div class="memo-label analysis-label">Argumente ({analysis.args.length})</div>
									{#each analysis.args as a (a.id)}
										{@const argEdges = analysis.edges.filter((e) => e.selfArgLocalId === a.argLocalId)}
										{@const sev = severityMap.get(`${el.id}:${a.argLocalId}`) ?? { level: 'partial' as const, label: '—', reason: 'noch nicht berechnet' }}
										<div
											class="arg-block"
											class:arg-target={scrollTarget?.elementId === el.id && scrollTarget?.argumentId === a.argLocalId}
											id="arg-{el.id}-{a.argLocalId}"
										>
											<div class="arg-head">
												<span class="arg-id">{a.argLocalId}</span>
												<span class="arg-pos">Position {a.positionInParagraph}</span>
												{#if a.referentialGrounding}
													<span
														class="ref-chip"
														title="Belegtyp im Absatz (Pipeline-Klassifikation): {a.referentialGrounding}"
													>{GROUNDING_LABEL[a.referentialGrounding]}</span>
												{/if}
											</div>
											<div class="arg-claim">{a.claim}</div>
											{#if a.anchorPhrase}
												<blockquote class="arg-anchor">„{a.anchorPhrase}"</blockquote>
											{/if}
											{#if a.premises.length > 0}
												<ul class="premises">
													{#each a.premises as p, pIdx}
														{@const pid = `P${pIdx + 1}`}
														{@const isFallacyTarget = a.validityAssessment && !a.validityAssessment.carries && a.validityAssessment.fallacy.target_premise === pid}
														{@const carriedSrc = p.type === 'carried' ? resolveCarriedSource(p, argEdges) : null}
														<li class:prem-target={isFallacyTarget}>
															<span class="prem-id">{pid}</span>
															{#if p.type === 'carried' && carriedSrc && carriedSrc.paraNum != null}
																<span
																	class="prem-type prem-carried"
																	title="Cross-Paragraph-Verweis aus prior_paragraph-Edge"
																>aus §{carriedSrc.paraNum}:{carriedSrc.argLocalId}</span>
															{:else}
																<span class="prem-type prem-{p.type}">{premiseLabel(p)}</span>
															{/if}
															<span class="prem-text">{p.text}</span>
														</li>
													{/each}
												</ul>
											{/if}
											<!-- Bewertungs-Block: zwei orthogonale Reviewer-Achsen direkt aneinander.
													 Bodenkontakt (a1/c) zuerst, dann Konkludenz (a2). -->
											<div class="assessment">
												<div class="assess-row assess-ground sev-{sev.level}" title={sev.reason}>
													<span class="assess-label">Bodenkontakt</span>
													<span class="assess-value">{sev.label}</span>
												</div>
												{#if a.validityAssessment}
													{@const va = a.validityAssessment}
													{#if va.carries}
														<div class="assess-row assess-validity sev-rooted">
															<span class="assess-label">Konkludenz</span>
															<span class="assess-value">formal konkludent <span class="assess-form">· {FORM_LABEL[va.inference_form]}</span></span>
															<div class="assess-rationale">{va.rationale}</div>
														</div>
													{:else}
														<div class="assess-row assess-validity sev-broken">
															<span class="assess-label">Konkludenz</span>
															<span class="assess-value">nicht konkludent <span class="assess-fallacy" title={va.fallacy.type}>· {va.fallacy.type} @ {va.fallacy.target_premise}</span></span>
															<div class="assess-rationale">{va.rationale}</div>
														</div>
													{/if}
												{/if}
											</div>
										</div>
									{/each}
								</div>
							{/if}
							{#if analysis.edges.length > 0}
								<div class="analysis-block">
									<div class="memo-label analysis-label">Beziehungen ({analysis.edges.length})</div>
									<ul class="edges-list">
										{#each analysis.edges as e}
											<li class="edge edge-{e.kind}" class:edge-incoming={e.direction === 'incoming'}>
												<span class="edge-self">{e.selfArgLocalId}</span>
												<span class="edge-verb">{e.direction === 'outgoing' ? KIND_VERB[e.kind].out : KIND_VERB[e.kind].in}</span>
												<span class="edge-target">{formatEdgeTarget(e)}</span>
												<span class="edge-snippet">{e.other.claimSnippet}</span>
											</li>
										{/each}
									</ul>
								</div>
							{/if}
							{#if analysis.scaffolding.length > 0}
								<div class="analysis-block">
									<div class="memo-label analysis-label">Stützstrukturen ({analysis.scaffolding.length})</div>
									{#each analysis.scaffolding as s (s.id)}
										<div class="sc-block">
											<div class="sc-head">
												<span class="sc-id">{s.elementLocalId}</span>
												<span class="sc-fn sc-fn-{s.functionType}">{s.functionType}</span>
												{#if s.anchoredTo.length > 0}
													<span class="sc-anchored">→ {s.anchoredTo.join(', ')}</span>
												{/if}
											</div>
											<div class="sc-desc">{s.functionDescription}</div>
											<div class="sc-assess"><span class="sc-assess-label">Beurteilung:</span> {s.assessment}</div>
										</div>
									{/each}
								</div>
							{/if}
						{/if}
					</aside>
				{/if}
			</article>
		{/if}
	{/each}
</div>

<style>
	.doc-reader { display: flex; flex-direction: column; gap: 1.5rem; }
	.doc-section { padding-top: 1rem; }
	.doc-heading {
		font-size: 1.1rem; font-weight: 600; color: #e1e4e8;
		margin: 0 0 0.6rem; padding-bottom: 0.4rem;
		border-bottom: 1px solid #2a2d3a;
	}
	.synthesis {
		background: rgba(110, 231, 183, 0.05);
		border-left: 3px solid rgba(110, 231, 183, 0.5);
		padding: 0.8rem 1rem; border-radius: 0 4px 4px 0;
		margin-bottom: 1rem;
	}
	.synth-label {
		font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em;
		color: #6ee7b7; margin-bottom: 0.4rem; font-weight: 600;
	}
	.synth-content { color: #c9cdd5; line-height: 1.55; font-size: 0.92rem; }

	.doc-paragraph {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
		gap: 1.2rem;
		padding: 0.6rem 0;
		border-top: 1px solid rgba(42,45,58,0.4);
		transition: background 0.4s;
	}
	.doc-paragraph.flash { background: rgba(251, 191, 36, 0.10); }
	.doc-paragraph.no-memo { grid-template-columns: 1fr; opacity: 0.7; }
	.para-text {
		color: #c9cdd5; line-height: 1.6; font-size: 0.95rem;
		position: relative; padding-left: 2.2rem;
	}
	.para-num {
		position: absolute; left: 0; top: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.72rem; color: #4b5563;
		padding-top: 0.3rem;
	}

	.memo-pane {
		display: flex; flex-direction: column; gap: 0.5rem;
		font-size: 0.85rem;
	}
	.memo {
		padding: 0.55rem 0.7rem;
		border-radius: 4px;
		border-left: 2px solid transparent;
	}
	.memo-label {
		font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em;
		color: #6b7280; margin-bottom: 0.25rem; font-weight: 600;
	}
	.memo-content { color: #c9cdd5; line-height: 1.5; }
	.memo-formulierend {
		background: rgba(251, 191, 36, 0.04);
		border-left-color: rgba(251, 191, 36, 0.4);
	}
	.memo-formulierend .memo-label { color: #fbbf24; }
	.memo-interpretierend {
		background: rgba(165, 180, 252, 0.05);
		border-left-color: rgba(165, 180, 252, 0.5);
	}
	.memo-interpretierend .memo-label { color: #a5b4fc; }

	.codes { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.2rem; }
	.code-chip {
		font-size: 0.72rem; padding: 0.18rem 0.5rem;
		background: rgba(244, 114, 182, 0.06);
		color: #f9a8d4;
		border: 1px solid rgba(244, 114, 182, 0.25);
		border-radius: 999px;
		font-style: italic;
	}

	.analysis-block {
		display: flex; flex-direction: column;
		gap: 0.4rem;
		padding: 0.5rem 0.7rem;
		border-left: 2px solid rgba(165, 180, 252, 0.35);
		background: rgba(165, 180, 252, 0.03);
		border-radius: 0 4px 4px 0;
	}
	.analysis-label { color: #a5b4fc !important; }

	.arg-block {
		padding: 0.5rem 0.6rem;
		border-radius: 4px;
		background: rgba(255,255,255,0.025);
		display: flex; flex-direction: column; gap: 0.35rem;
		transition: background 0.4s, box-shadow 0.4s;
	}
	.arg-block.arg-target {
		background: rgba(251, 191, 36, 0.08);
		box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.4);
	}
	.arg-block.arg-flash {
		background: rgba(251, 191, 36, 0.18);
		box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.6);
	}
	.arg-head { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
	.arg-id {
		font-family: 'JetBrains Mono', monospace; font-weight: 600;
		color: #c7d2fe; font-size: 0.8rem;
	}
	.arg-pos { font-size: 0.7rem; color: #6b7280; }
	/* ref-chip = Pipeline-Klassifikator des Belegtyps; neutral, trägt KEIN Reviewer-Signal */
	.ref-chip {
		font-size: 0.62rem;
		padding: 1px 6px;
		border-radius: 3px;
		text-transform: lowercase;
		letter-spacing: 0.02em;
		font-weight: 500;
		margin-left: auto;
		background: rgba(255, 255, 255, 0.04);
		color: #8b8fa3;
	}
	/* Bewertungs-Block am Argument-Ende: zwei orthogonale Reviewer-Achsen
	   (Bodenkontakt = a1/c, Konkludenz = a2) direkt untereinander, nicht
	   visuell getrennt durch Premissen-Liste o. ä. — sonst entsteht der
	   irreführende Eindruck "oben gelb / unten grün als Gesamtbewertung". */
	.assessment {
		margin-top: 0.4rem;
		display: flex; flex-direction: column;
		gap: 0.2rem;
	}
	.assess-row {
		padding: 0.35rem 0.55rem;
		border-radius: 4px;
		border-left: 2px solid transparent;
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 0.5rem;
		row-gap: 0.2rem;
		font-size: 0.78rem;
		line-height: 1.4;
	}
	.assess-label {
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 600;
		opacity: 0.75;
		align-self: baseline;
	}
	.assess-value { color: #e1e4e8; }
	.assess-form { color: #8b8fa3; font-weight: 400; }
	.assess-fallacy {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem; color: #fca5a5;
	}
	.assess-rationale {
		grid-column: 2;
		color: #c9cdd5;
		font-size: 0.76rem;
		line-height: 1.4;
	}
	/* Reviewer-Signal-Klassen — drei und nur drei. */
	.sev-rooted {
		background: rgba(110, 231, 183, 0.06);
		border-left-color: rgba(110, 231, 183, 0.5);
	}
	.sev-rooted .assess-label { color: #6ee7b7; }
	.sev-partial {
		background: rgba(251, 191, 36, 0.06);
		border-left-color: rgba(251, 191, 36, 0.5);
	}
	.sev-partial .assess-label { color: #fbbf24; }
	.sev-broken {
		background: rgba(248, 113, 113, 0.06);
		border-left-color: rgba(248, 113, 113, 0.55);
	}
	.sev-broken .assess-label { color: #f87171; }
	.arg-claim { color: #e1e4e8; line-height: 1.5; font-size: 0.86rem; }
	.arg-anchor {
		margin: 0;
		padding: 0.3rem 0.55rem;
		border-left: 2px solid rgba(165, 180, 252, 0.35);
		background: rgba(255,255,255,0.02);
		font-style: italic; font-size: 0.78rem;
		color: #b8bccc; line-height: 1.4;
	}
	.premises {
		margin: 0; padding: 0; list-style: none;
		display: flex; flex-direction: column; gap: 0.25rem;
	}
	.premises li {
		display: flex; gap: 0.4rem; align-items: flex-start;
		font-size: 0.78rem; line-height: 1.4;
	}
	.premises li.prem-target {
		background: rgba(248, 113, 113, 0.06);
		box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.35);
		border-radius: 3px;
		padding: 2px 4px;
		margin: 0 -4px;
	}
	.prem-id {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		color: #6b7280;
		font-weight: 600;
		min-width: 1.6rem;
	}
	.premises li.prem-target .prem-id {
		color: #fca5a5;
	}
	.prem-type {
		flex-shrink: 0;
		padding: 1px 6px;
		border-radius: 3px;
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 500;
	}
	/* prem-stated/carried = neutrale Klassifikation der Premissen-Herkunft;
	   prem-background bleibt gelb, weil der AG-Pass-Prompt selbst sagt:
	   "background-Premissen zählen nicht als Grounding" → echtes Sichten-Signal. */
	.prem-stated     { background: rgba(255, 255, 255, 0.04); color: #8b8fa3; }
	.prem-carried    { background: rgba(255, 255, 255, 0.04); color: #8b8fa3; }
	.prem-background { background: rgba(251, 191, 36, 0.14); color: #fbbf24; }
	.prem-text { flex: 1; color: #c9cdd5; }

	.edges-list {
		margin: 0; padding: 0; list-style: none;
		display: flex; flex-direction: column; gap: 0.3rem;
	}
	.edge {
		display: grid;
		grid-template-columns: auto auto auto 1fr;
		gap: 0.4rem; align-items: baseline;
		font-size: 0.78rem; line-height: 1.35;
	}
	.edge-self {
		font-family: 'JetBrains Mono', monospace; font-weight: 600;
		color: #c7d2fe;
	}
	/* Edge-Verben sind reine Klassifikatoren (stützt/präzisiert/widerspricht/setzt voraus).
	   Sie tragen KEIN Reviewer-Signal — auch "widerspricht" ist nur die inhaltliche
	   Beziehung, nicht ein Inkonsistenz-Befund. Daher alle Verben einheitlich neutral. */
	.edge-verb { color: #8b8fa3; font-style: italic; white-space: nowrap; }
	.edge-target {
		font-family: 'JetBrains Mono', monospace; font-weight: 600;
		color: #c7d2fe;
	}
	.edge-snippet { color: #b8bccc; font-size: 0.74rem; }
	.edge-incoming .edge-self { color: #8b8fa3; }

	.sc-block {
		padding: 0.4rem 0.6rem;
		border-radius: 4px;
		background: rgba(255,255,255,0.02);
		display: flex; flex-direction: column; gap: 0.3rem;
	}
	.sc-head { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: baseline; }
	/* S-IDs = Identifikatoren wie A-IDs; gleiche Farb-Konvention für IDs.
	   Rosa als ID-Farbe wäre inkonsistent zu .arg-id (indigo). */
	.sc-id {
		font-family: 'JetBrains Mono', monospace; font-weight: 600;
		color: #c7d2fe; font-size: 0.78rem;
	}
	/* Stützstruktur-Funktion = Klassifikator (textorg./didakt./kontext./rhetor.);
	   neutral, kein Reviewer-Signal. "rhetorisch" ist nicht "problematisch". */
	.sc-fn {
		font-size: 0.66rem;
		text-transform: lowercase;
		letter-spacing: 0.02em;
		padding: 1px 6px;
		border-radius: 3px;
		font-weight: 500;
		background: rgba(255, 255, 255, 0.04);
		color: #8b8fa3;
	}
	.sc-anchored {
		font-family: 'JetBrains Mono', monospace; font-size: 0.72rem;
		color: #8b8fa3;
	}
	.sc-desc { color: #c9cdd5; font-size: 0.78rem; line-height: 1.4; }
	.sc-assess { color: #b8bccc; font-size: 0.76rem; line-height: 1.4; }
	.sc-assess-label {
		font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.04em;
		color: #6b7280;
	}
</style>
