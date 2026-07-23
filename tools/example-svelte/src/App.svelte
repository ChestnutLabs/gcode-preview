<script>
  /**
   * DD-007 phase 7 example app (issue #114): the packaged SVELTE component drives the
   * whole pipeline — corpus select, layer/scrub props, simulated DD-006 progress — with
   * the D2 default (batteries) worker path under real Vite. No raw session imports.
   */
  import GcodePreview from '@chestnutlabs/gcode-preview-svelte/GcodePreview.svelte';

  const CORPUS = ['easel.gcode', 'calicat.gcode', '3DBenchy.gcode', 'vase.gcode', 'screw.gcode'];

  let fixture = CORPUS[0];
  let source = null;
  let layerCount = 0;
  let segmentCount = 0;
  let lastLayer = 0;
  let scrubValue = 0;
  let progressObs = null;
  let log = 'Pick a fixture and press Load.';
  let simTimer = null;

  $: scrub = segmentCount > 0 && scrubValue < segmentCount ? scrubValue : null;

  const append = (s) => {
    log = `${s}\n${log}`.split('\n').slice(0, 14).join('\n');
  };

  async function load() {
    stopSim();
    const res = await fetch(`./${fixture}`);
    source = new Uint8Array(await res.arrayBuffer()); // prop change → component re-parses
  }

  function stopSim() {
    if (simTimer !== null) clearInterval(simTimer);
    simTimer = null;
    progressObs = null;
  }

  function playSim() {
    if (simTimer !== null) {
      stopSim();
      return;
    }
    let fraction = 0;
    simTimer = setInterval(() => {
      fraction = Math.min(1, fraction + 0.01);
      progressObs = {
        v: 1,
        timestampMs: Date.now(),
        state: fraction >= 1 ? 'complete' : 'printing',
        position: { percent: fraction, percentBasis: 'bytes' }
      };
      if (fraction >= 1) stopSim();
    }, 100);
  }

  function onReady(e) {
    const s = e.detail;
    layerCount = s.layers;
    segmentCount = s.segments;
    lastLayer = Math.max(0, s.layers - 1);
    scrubValue = s.segments;
    append(`ready: ${s.segments.toLocaleString()} segments, ${s.layers} layers`);
  }
</script>

<aside>
  <h2>Svelte component example</h2>
  <label>
    Fixture
    <select bind:value={fixture}>
      {#each CORPUS as f}
        <option value={f}>{f}</option>
      {/each}
    </select>
  </label>
  <button on:click={load}>Load</button>
  <label>
    Last layer: {lastLayer} / {Math.max(0, layerCount - 1)}
    <input type="range" min="0" max={Math.max(0, layerCount - 1)} bind:value={lastLayer} />
  </label>
  <label>
    Scrub: {scrub === null ? 'all' : `${scrub} / ${segmentCount}`}
    <input type="range" min="0" max={segmentCount} bind:value={scrubValue} />
  </label>
  <button on:click={playSim}>{simTimer === null ? 'Play simulated progress' : 'Stop'}</button>
  <pre id="log">{log}</pre>
</aside>
<main>
  <GcodePreview
    {source}
    layerRange={layerCount > 0 ? [0, lastLayer] : null}
    {scrub}
    progress={progressObs}
    quality="auto"
    on:ready={onReady}
    on:parseerror={(e) => append(`parse-error: ${e.detail.code} ${e.detail.message}`)}
    on:buildcomplete={(e) => append(`build-complete: ${e.detail.quality}`)}
    on:qualityfallback={(e) => append(`quality-fallback: ${e.detail.from} -> ${e.detail.to}`)}
    on:progresspresentationchanged={(e) => append(`progress shown as: ${e.detail.mode}${e.detail.reason ? ` (${e.detail.reason})` : ''}`)}
    on:disclosure={(e) => e.detail && append(`disclosure: ${e.detail}`)}
    on:error={(e) => append(`error: ${e.detail.code}`)}
  />
</main>
