<!--
  Full showcase example (DD-031 §4.7, tier 2).

  Exercises the real declarative surface of @chestnutlabs/gcode-preview-svelte and mirrors the
  Feature Lab's capability-aware UX in Svelte idiom: color modes gate on the file's capabilities with
  a plain-language reason, feature-role hiding is a declarative prop, and diagnostics/picking come
  through the bound handle (`viewer.preview.controls`). Chrome (light/dark) is separate from the
  renderer's neutral viewport. Styling is the shared workspace-internal demo-kit — not a published UI
  kit and not a library default. Still the real package: no raw renderer imports.
-->
<script>
  import GcodePreview from '@chestnutlabs/gcode-preview-svelte/GcodePreview.svelte';
  import { FeatureRole } from '@chestnutlabs/toolpath-core';
  import {
    FIXTURE_GROUPS,
    FIXTURE_BY_ID,
    COLOR_MODES,
    COLOR_MODE_BY_ID,
    colorModeReason,
    confidenceTier,
    rgbCss,
    count as formatCount,
    duration as formatDuration
  } from '../../demo-kit/index.js';

  const ADHESION_ROLES = [FeatureRole.Skirt, FeatureRole.Brim];
  const CAM_VIEWS = [
    ['iso', 'Iso'],
    ['top', 'Top'],
    ['front', 'Front']
  ];
  const CAP_KEYS = ['featureRoles', 'objects', 'feedrate', 'colorChanges'];

  let viewer; // bind:this → viewer.preview is the handle
  let chrome = 'dark';
  let fixtureId = 'skirt-brim';
  let source = null;

  // Reactive UI state, mirrored from the component's events (parallel to the other adapters).
  let caps = {};
  let layers = 0;
  let segments = 0;
  let topLayer = 0;
  let disclosure = '';
  let hasRetractions = false;
  let time = { ms: null, src: null };
  let stats = null;
  let picked = null;

  // Declarative control state.
  let colorModeId = 'feature';
  let hideAdhesion = false;
  let showTravel = false;
  let showRetractions = false;
  let view = 'iso';

  $: if (typeof document !== 'undefined') document.documentElement.dataset.chrome = chrome;

  $: mode = COLOR_MODE_BY_ID[colorModeId];
  $: modeReason = colorModeReason(colorModeId, caps);
  $: colorMode = modeReason === '' ? mode.build() : undefined;
  $: legend = mode.legend ?? null;
  $: featureRolesKnown = caps.featureRoles === 'known' || caps.featureRoles === 'inferred';
  $: hiddenRoles = hideAdhesion ? ADHESION_ROLES : undefined;
  $: fixture = FIXTURE_BY_ID[fixtureId];
  $: countLabel =
    segments > 0
      ? `${formatCount(segments)} segments · ${layers} layers${time.ms !== null ? ` · ${formatDuration(time.ms)}` : ''}`
      : '';

  // The handle's `state` is a Svelte store; read a one-shot snapshot for fields the ready event omits.
  function stateSnapshot() {
    let snap = null;
    const off = viewer?.preview?.state.subscribe((s) => (snap = s));
    if (off) off();
    return snap;
  }

  async function load(id) {
    const fx = FIXTURE_BY_ID[id ?? fixtureId];
    if (!fx) return;
    fixtureId = fx.id;
    const res = await fetch(`./${fx.path}`);
    source = new Uint8Array(await res.arrayBuffer());
    stats = null;
    picked = null;
  }

  function onReady(event) {
    const s = event.detail;
    caps = s.capabilities;
    layers = s.layers;
    segments = s.segments;
    topLayer = Math.max(0, s.layers - 1);
    if (typeof window !== 'undefined') window.gcodePreview = viewer?.preview; // for devtools/inspection
    const st = stateSnapshot();
    if (st) {
      hasRetractions = st.hasRetractions;
      time = { ms: st.totalTimeMs, src: st.timeEstimateSource };
      if (!st.availableColorModes.includes(colorModeId) && colorModeReason(colorModeId, s.capabilities) !== '') {
        colorModeId = 'single';
      }
    }
  }

  function refreshStats() {
    stats = viewer?.preview?.controls.getRenderStats() ?? null;
  }

  function onCanvasClick(e) {
    const c = e.currentTarget.querySelector('canvas');
    if (!c || layers === 0) return;
    const r = c.getBoundingClientRect();
    const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
    // pickSegment returns the IR segment index, or null if the ray missed.
    picked = viewer?.preview?.controls.pickSegment(ndcX, ndcY) ?? null;
  }

  const modeDisabled = (id, c) => colorModeReason(id, c) !== '';
</script>

<header class="sc-header">
  <div class="sc-brand">
    <span class="gp-title">G-code Preview · Svelte</span>
    <span class="gp-eyebrow">Showcase</span>
  </div>
  <select class="gp-input" style="width: 220px" bind:value={fixtureId} on:change={() => load()}>
    {#each FIXTURE_GROUPS as g}
      <optgroup label={g.group}>
        {#each g.items as i}
          <option value={i.id}>{i.label}</option>
        {/each}
      </optgroup>
    {/each}
  </select>
  <button class="gp-btn gp-primary" on:click={() => load()}>Load</button>
  <div class="sc-spacer" />
  <div class="gp-segment" role="group" aria-label="Chrome theme">
    <button class={chrome === 'dark' ? 'gp-on' : ''} on:click={() => (chrome = 'dark')}>Dark</button>
    <button class={chrome === 'light' ? 'gp-on' : ''} on:click={() => (chrome = 'light')}>Light</button>
  </div>
</header>

<div class="sc-main">
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="sc-viewport" on:click={onCanvasClick}>
    <GcodePreview
      bind:this={viewer}
      {source}
      {colorMode}
      layerRange={layers > 0 ? [0, topLayer] : null}
      hiddenFeatureRoles={hiddenRoles}
      {showTravel}
      {showRetractions}
      {view}
      frameContent="object"
      quality="auto"
      on:ready={onReady}
      on:buildcomplete={refreshStats}
      on:disclosure={(e) => (disclosure = e.detail ?? '')}
      on:parseerror={(e) => (disclosure = `Parse error: ${e.detail.code} — ${e.detail.message}`)}
    />
    {#if legend}
      <div class="sc-legend-card">
        <span class="gp-eyebrow">{mode.label}</span>
        <div class="gp-legend">
          {#each legend as [label, rgb]}
            <span class="gp-legend-item">
              <span class="gp-swatch" style="background: {rgbCss(rgb)}" />
              {label}
            </span>
          {/each}
        </div>
      </div>
    {/if}
    <div class="sc-cam">
      {#each CAM_VIEWS as [v, label]}
        <button class="gp-icon-btn {view === v ? 'gp-on' : ''}" title="{label} view" on:click={() => (view = v)}>
          {label[0]}
        </button>
      {/each}
    </div>
    {#if segments > 0}
      <div class="sc-count">{countLabel}</div>
    {/if}
  </div>

  <aside class="sc-rail">
    <div class="gp-scroll">
      <section class="gp-panel">
        <h3>Appearance</h3>
        <div class="gp-field">
          <label for="mode">Color by</label>
          <select id="mode" class="gp-input" bind:value={colorModeId}>
            {#each COLOR_MODES as m}
              <option value={m.id} disabled={modeDisabled(m.id, caps)}>
                {m.label}{modeDisabled(m.id, caps) ? ' — unavailable' : ''}
              </option>
            {/each}
          </select>
          {#if modeReason !== ''}<span class="gp-reason">{modeReason}</span>{/if}
        </div>
      </section>

      <section class="gp-panel">
        <h3>Filter</h3>
        {#if layers > 0}
          <div class="gp-field">
            <label>Top layer <span class="gp-value">{topLayer} / {Math.max(0, layers - 1)}</span></label>
            <input class="gp-range" type="range" min="0" max={Math.max(0, layers - 1)} bind:value={topLayer} />
          </div>
        {/if}
        <label class="gp-toggle {featureRolesKnown ? '' : 'gp-disabled'}">
          <span>
            Hide skirt &amp; brim
            {#if !featureRolesKnown}<span class="gp-reason"> — file has no feature roles</span>{/if}
          </span>
          <input type="checkbox" bind:checked={hideAdhesion} disabled={!featureRolesKnown} />
        </label>
        <label class="gp-toggle">
          <span>Show travel moves</span>
          <input type="checkbox" bind:checked={showTravel} />
        </label>
        <label class="gp-toggle {hasRetractions ? '' : 'gp-disabled'}">
          <span>
            Show retractions
            {#if !hasRetractions}<span class="gp-reason"> — none in this file</span>{/if}
          </span>
          <input type="checkbox" bind:checked={showRetractions} disabled={!hasRetractions} />
        </label>
      </section>

      <section class="gp-panel">
        <h3>Diagnostics</h3>
        <button class="gp-btn" on:click={refreshStats} disabled={segments === 0}>Read render stats</button>
        {#if stats}
          <div class="gp-mono" style="margin-top: var(--gp-space-3)">
            <div>backend: {stats.backend} ({stats.capability})</div>
            <div>geometry: {stats.geometryMode}</div>
            <div>segments: {formatCount(stats.renderedSegmentCount ?? 0)}</div>
            <div>draw calls: {stats.drawCalls ?? '—'}</div>
            {#if stats.gpuRenderer}<div style="color: var(--gp-text-faint)">{stats.gpuRenderer}</div>{/if}
          </div>
        {/if}
        {#if picked !== null}
          <p class="gp-reason" style="margin-top: var(--gp-space-2)">Picked IR segment #{picked}</p>
        {:else if segments > 0}
          <p class="gp-reason" style="margin-top: var(--gp-space-2)">Click the model to identify a segment.</p>
        {/if}
      </section>
    </div>
  </aside>
</div>

<footer class="sc-status">
  <div class="sc-caps">
    {#each CAP_KEYS as k}
      <span class="gp-badge {confidenceTier(caps[k]).cls}" title="{k}: {confidenceTier(caps[k]).label}">
        {k} · {confidenceTier(caps[k]).label}
      </span>
    {/each}
  </div>
  <div class="sc-spacer" />
  <span>{disclosure || (fixture ? fixture.blurb : 'Pick a fixture to begin.')}</span>
</footer>
