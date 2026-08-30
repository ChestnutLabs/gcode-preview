<!--
  Minimal source-model viewer (DD-031 §4.7, tier 1 — Prepare side).

  The smallest real integration of @chestnutlabs/gcode-preview-svelte/model: give <ModelViewer> a
  `source` ({ kind, bytes } — an STL or 3MF) and it parses + renders. The counterpart to Minimal.svelte,
  which does the same for sliced G-code with <GcodePreview>. No design system, no demo-kit engine
  handles — just the published adapter. (The fixtures here are synthetic MIT-clean sample models.)
  Note the deliberate `.svelte` subpath import (the compiled component ships alongside the JS entry).
-->
<script>
  import ModelViewer from '@chestnutlabs/gcode-preview-svelte/model/ModelViewer.svelte';
  import { MODEL_FIXTURES, MODEL_FIXTURE_BY_ID } from '../../demo-kit/index.js';

  let source = null;
  let info = null;

  function load(event) {
    const fx = MODEL_FIXTURE_BY_ID[event.target.value];
    if (fx) source = fx.source(); // { kind, bytes } → ModelViewer parses + renders
  }

  function onReady(event) {
    info = event.detail;
  }
</script>

<header>
  <strong>gcode-preview-svelte · minimal model viewer</strong>
  <select on:change={load}>
    <option value="" selected disabled>Load a model…</option>
    {#each MODEL_FIXTURES as m}
      <option value={m.id}>{m.label}</option>
    {/each}
  </select>
  {#if info}
    <span style="font-size: 0.85rem; color: #9fb0c0">
      {info.objectCount} object{info.objectCount === 1 ? '' : 's'} · materials: {info.materials}
    </span>
  {/if}
</header>
<main>
  <ModelViewer {source} background="transparent" on:ready={onReady} />
</main>
