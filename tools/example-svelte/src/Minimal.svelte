<!--
  Minimal getting-started example (DD-031 §4.7, tier 1).

  The smallest real integration of @chestnutlabs/gcode-preview-svelte: bind `source` (bytes/File)
  and <GcodePreview> parses + renders. Everything else — the fixture picker and layer slider — is
  ordinary Svelte reactive state driving declarative props. No design system, no demo-kit, no raw
  renderer. Copy this component to start. Note the deliberate `.svelte` subpath import (the compiled
  component ships alongside the JS entry).
-->
<script>
  import GcodePreview from '@chestnutlabs/gcode-preview-svelte/GcodePreview.svelte';

  const FIXTURES = ['3DBenchy.gcode', 'calicat.gcode', 'vase.gcode', 'mach3.gcode'];

  let source = null;
  let layers = 0;
  let topLayer = 0;

  async function load(event) {
    const name = event.target.value;
    if (!name) return;
    const res = await fetch(`./gcodes/${name}`);
    source = new Uint8Array(await res.arrayBuffer()); // new source → re-parse
  }

  function onReady(event) {
    layers = event.detail.layers;
    topLayer = Math.max(0, event.detail.layers - 1);
  }
</script>

<header>
  <strong>gcode-preview-svelte · minimal</strong>
  <select on:change={load}>
    <option value="" selected disabled>Load a fixture…</option>
    {#each FIXTURES as f}
      <option value={f}>{f}</option>
    {/each}
  </select>
  {#if layers > 0}
    <label>
      Layer {topLayer} / {layers - 1}
      <input type="range" min="0" max={Math.max(0, layers - 1)} bind:value={topLayer} />
    </label>
  {/if}
</header>
<main>
  <GcodePreview {source} layerRange={layers > 0 ? [0, topLayer] : null} showTravel={false} theme={{ background: '#6d7176' }} on:ready={onReady} />
</main>
