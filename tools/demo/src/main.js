/**
 * DD-004 phase 3 demo (issue #58): the full pipeline — GcodeParseSession
 * (worker parse, off-thread, zero-copy transfer) → ToolpathRenderer (incremental
 * upload, draw-range clipping/scrub, capability-honest coloring) — over the
 * inherited MIT demo corpus or any local G-code file.
 */
import { GcodeParseSession, CancelledError } from '@chestnutlabs/gcode-parser';
import { ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';
import { createProgressMapper } from '@chestnutlabs/toolpath-core';

// Inherited MIT demo corpus (see test-data/manifest.json), served by Vite's publicDir.
const CORPUS = [
  ['gcodes/3DBenchy.gcode', '3DBenchy (3.7 MB)'],
  ['gcodes/calicat.gcode', 'Calicat (635 KB)'],
  ['gcodes/vase.gcode', 'Vase (spiral mode)'],
  ['gcodes/screw.gcode', 'Screw'],
  ['gcodes/plant-sign.gcode', 'Plant sign'],
  ['gcodes/easel.gcode', 'Easel (19 KB)'],
  ['gcodes/mach3.gcode', 'Mach3 (CNC-style)'],
  ['fixtures/containers/mini-project.gcode.3mf', 'mini-project.gcode.3mf (container)'],
  ['fixtures/annotations/wipe-brackets.gcode', 'Wipe brackets (#182 demo)']
];

const TOOL_PALETTE = [
  [0.9, 0.4, 0.7],
  [0.35, 0.7, 0.95],
  [0.95, 0.75, 0.3],
  [0.5, 0.9, 0.5]
];
const FEATURE_PALETTE = [
  [0.9, 0.4, 0.7],
  [0.35, 0.7, 0.95],
  [0.95, 0.75, 0.3],
  [0.5, 0.9, 0.5],
  [0.8, 0.5, 0.95]
];

// Named scene themes (#153, DD-009 D4): each is a bounded declarative Theme.
// Unspecified fields fall back to the default look (replace semantics).
const THEMES = {
  default: {},
  blueprint: { background: '#0d1b2a', gridColor: '#1b9aaa', bedColor: '#415a77', hemisphereIntensity: 2.2 },
  light: {
    background: '#eef1f5',
    gridColor: '#9fb3c8',
    bedColor: '#bcccdc',
    hemisphereIntensity: 2.4,
    directionalIntensity: 1.4
  },
  // #185: a filled build-plate surface under the toolpath (off in every other theme).
  bedplate: {
    background: '#10141b',
    gridColor: '#3a4658',
    bedColor: '#556173',
    hemisphereIntensity: 2.0,
    bedSurface: { mode: 'solid', color: '#20242c', opacity: 1 }
  }
};

function themeFor(name, material) {
  return { ...(THEMES[name] ?? THEMES.default), materialPreset: material };
}

const $ = (id) => document.getElementById(id);
const els = {
  fixture: $('fixture'),
  file: $('file'),
  parse: $('parse'),
  cancel: $('cancel'),
  progress: $('progress'),
  status: $('status'),
  startLayer: $('startLayer'),
  endLayer: $('endLayer'),
  scrub: $('scrub'),
  startLayerVal: $('startLayerVal'),
  endLayerVal: $('endLayerVal'),
  scrubVal: $('scrubVal'),
  travel: $('travel'),
  wipe: $('wipe'),
  retractions: $('retractions'),
  colorMode: $('colorMode'),
  quality: $('quality'),
  cameraMode: $('cameraMode'),
  theme: $('theme'),
  material: $('material'),
  qualityNote: $('qualityNote'),
  frame: $('frame'),
  disclosure: $('disclosure'),
  stats: $('stats'),
  progressTier: $('progressTier'),
  progressPlay: $('progressPlay'),
  progressNote: $('progressNote'),
  canvas: $('view')
};

for (const [file, label] of CORPUS) {
  const opt = document.createElement('option');
  opt.value = file;
  opt.textContent = label;
  els.fixture.appendChild(opt);
}

const session = new GcodeParseSession();
const renderer = new ToolpathRenderer({
  canvas: els.canvas,
  buildVolume: { x: 220, y: 220, z: 250 },
  quality: 'auto'
});

let parsing = false;
let travelAvailable = false;
let bedNote = '';

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}

function colorModeFor(kind) {
  if (kind === 'tool') return { mode: 'tool', palette: TOOL_PALETTE, fallback: [0.7, 0.7, 0.7] };
  if (kind === 'feature') return { mode: 'feature', palette: FEATURE_PALETTE, fallback: [0.55, 0.55, 0.55] };
  if (kind === 'colorChange') return { mode: 'colorChange', palette: TOOL_PALETTE, fallback: [0.55, 0.55, 0.55] };
  return { mode: 'single', color: [0.9, 0.4, 0.7] };
}

function applyLayerRange() {
  let start = Number(els.startLayer.value);
  let end = Number(els.endLayer.value);
  if (start > end) {
    // Keep the pair ordered no matter which slider moved.
    if (document.activeElement === els.startLayer) end = start;
    else start = end;
    els.startLayer.value = String(start);
    els.endLayer.value = String(end);
  }
  els.startLayerVal.textContent = String(start);
  els.endLayerVal.textContent = String(end);
  renderer.setLayerRange(start, end);
}

function applyScrub() {
  const v = Number(els.scrub.value);
  const max = Number(els.scrub.max);
  const all = v >= max;
  els.scrubVal.textContent = all ? 'all' : `${v.toLocaleString()} / ${max.toLocaleString()}`;
  renderer.setScrubPosition(all ? null : v);
}

function enableControls(ir) {
  const lastLayer = Math.max(0, renderer.layerCount - 1);
  els.startLayer.max = String(lastLayer);
  els.endLayer.max = String(lastLayer);
  els.startLayer.value = '0';
  els.endLayer.value = String(lastLayer);
  els.startLayerVal.textContent = '0';
  els.endLayerVal.textContent = String(lastLayer);
  els.scrub.max = String(renderer.segmentCount);
  els.scrub.value = String(renderer.segmentCount);
  els.scrubVal.textContent = 'all';
  for (const el of [els.startLayer, els.endLayer, els.scrub, els.colorMode, els.frame]) el.disabled = false;

  // Capability-honest color modes (§4.6): never offer fabricated feature colors.
  const featureOpt = els.colorMode.querySelector('option[value="feature"]');
  const featureOk = renderer.isColorModeAvailable('feature');
  featureOpt.disabled = !featureOk;
  featureOpt.textContent = featureOk
    ? 'By feature role'
    : `By feature role (unavailable: featureRoles = ${ir.header.capabilities.featureRoles ?? 'unknown'})`;
  if (!featureOk && els.colorMode.value === 'feature') {
    els.colorMode.value = 'single';
  }
  // M600 color-change coloring (#147): only offered when the IR actually saw an M600.
  const ccOpt = els.colorMode.querySelector('option[value="colorChange"]');
  const ccOk = renderer.isColorModeAvailable('colorChange');
  ccOpt.disabled = !ccOk;
  ccOpt.textContent = ccOk
    ? 'By color change (M600)'
    : `By color change (unavailable: colorChanges = ${ir.header.capabilities.colorChanges ?? 'unknown'})`;
  if (!ccOk && els.colorMode.value === 'colorChange') {
    els.colorMode.value = 'single';
  }
  renderer.setColorMode(colorModeFor(els.colorMode.value));
}

renderer.onEvent((e) => {
  if (e.type === 'buildComplete') {
    travelAvailable = !e.travelHidden;
    els.travel.disabled = !travelAvailable;
    els.travel.checked = travelAvailable ? els.travel.checked : false;
    // Wipe toggle: enable only when the IR actually carries wipe moves (DD-016, #182) — honest.
    const hasWipe = renderer.ir?.header.capabilities?.wipeMoves === 'known';
    els.wipe.disabled = !hasWipe;
    if (!hasWipe) els.wipe.checked = false;
    // Retraction markers: enable only when the IR actually carries events (#148).
    els.retractions.disabled = !renderer.hasRetractions;
    if (!renderer.hasRetractions) els.retractions.checked = false;
    els.disclosure.textContent =
      e.decimationApplied > 1
        ? `Decimation active: showing every ${e.decimationApplied}th extrusion segment ` +
          `(layer boundaries kept); travel hidden. ${e.segments.toLocaleString()} segments drawn.`
        : '';
    els.qualityNote.textContent = `Rendering as: ${e.quality}${bedNote}`;
  } else if (e.type === 'qualityFallback') {
    els.qualityNote.textContent = `Tubes unavailable — fell back to lines (${e.reason})`;
  } else if (e.type === 'error') {
    setStatus(`Renderer: ${e.code} — ${e.message}`, true);
  }
});

// Progressive preview (#60): stream partial slices straight into the scene for
// large files (worker default: ≥ 25 MB). The final IR replaces the preview.
session.onPartial((slice, cumulativeSegments) => {
  renderer.appendPartial(slice);
  els.qualityNote.textContent = `Preview: ${cumulativeSegments.toLocaleString()} segments streamed…`;
});

session.onProgress((p) => {
  if (p.totalBytes > 0) {
    els.progress.value = p.bytesProcessed / p.totalBytes;
  }
  setStatus(
    p.phase === 'finalizing'
      ? 'Finalizing…'
      : `Parsing… ${(p.bytesProcessed / 1e6).toFixed(1)} / ${(p.totalBytes / 1e6).toFixed(1)} MB`
  );
});

async function loadInput() {
  const file = els.file.files?.[0];
  if (file) return { name: file.name, input: file, bytes: file.size };
  const name = els.fixture.value;
  const res = await fetch(`./${name}`);
  if (!res.ok) throw new Error(`fetch ${name}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return { name, input: new Uint8Array(buf), bytes: buf.byteLength };
}

async function parseAndRender() {
  if (parsing) return;
  parsing = true;
  els.parse.disabled = true;
  els.cancel.disabled = false;
  els.progress.hidden = false;
  els.progress.value = 0;
  els.disclosure.textContent = '';
  try {
    const { name, input, bytes } = await loadInput();
    setStatus(`Loading ${name}…`);
    const t0 = performance.now();
    const result = await session.parse(input, { yieldIntervalMs: 25 });
    const parseMs = performance.now() - t0;
    const ir = result.ir;
    renderer.setIR(ir);
    enableControls(ir);
    enableSim(ir, bytes);
    // DD-005 §4.2: this demo opts into file-discovered bed geometry (arrives
    // with the phase-2/3 adapters); mismatches surface via the renderer event.
    const machine = result.metadata?.machine;
    bedNote = machine ? ` · bed from file: ${machine.printerName ?? 'unknown printer'} (${machine.confidence})` : '';
    if (machine) {
      renderer.setBuildVolume(machine);
    }
    const caps = Object.entries(ir.header.capabilities)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n  ');
    els.stats.textContent =
      `${name} — ${(bytes / 1e6).toFixed(2)} MB\n` +
      `Parsed off-thread in ${parseMs.toFixed(0)} ms\n` +
      `${ir.segments.count.toLocaleString()} segments · ${ir.layers.length.toLocaleString()} layers\n` +
      (ir.header.complete ? '' : `INCOMPLETE: stopped (${result.stats.stopReason ?? 'limit'})\n`) +
      `Capabilities:\n  ${caps}`;
    setStatus(ir.header.complete ? 'Done.' : `Partial result — ${result.stats.stopReason ?? 'limit reached'}.`);
  } catch (err) {
    if (err instanceof CancelledError) {
      setStatus('Cancelled.');
    } else {
      setStatus(`Parse failed: ${err && err.message ? err.message : err}`, true);
    }
  } finally {
    parsing = false;
    els.parse.disabled = false;
    els.cancel.disabled = true;
    els.progress.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Simulated live telemetry (DD-006 phase 3, #92): drive the mapper + overlay
// with observation streams shaped like the real §1.1 surfaces — no printer
// needed to verify exact/band/stale/hidden presentations.
// ---------------------------------------------------------------------------
const sim = { mapper: null, ir: null, fileBytes: 0, timer: null, staleTimer: null, fraction: 0 };

function stopSim(clearOverlay) {
  if (sim.timer !== null) clearInterval(sim.timer);
  if (sim.staleTimer !== null) clearInterval(sim.staleTimer);
  sim.timer = null;
  sim.staleTimer = null;
  els.progressPlay.textContent = 'Play';
  if (clearOverlay && sim.mapper !== null) {
    sim.mapper.reset();
    renderer.setProgress(null);
    els.progressNote.textContent = 'Stopped.';
  }
}

function simObservation(fraction) {
  const tier = els.progressTier.value;
  const base = { v: 1, timestampMs: Date.now(), state: fraction >= 1 ? 'complete' : 'printing' };
  const layerCount = sim.ir.layers.length;
  switch (tier) {
    case 'byte':
      return { ...base, position: { byte: Math.round(fraction * sim.fileBytes) } };
    case 'percent-bytes':
      return { ...base, position: { percent: fraction, percentBasis: 'bytes' } };
    case 'layer':
      return {
        ...base,
        position: { layer: Math.min(layerCount - 1, Math.floor(fraction * layerCount)), totalLayers: layerCount }
      };
    case 'percent-job':
      return { ...base, position: { percent: fraction, percentBasis: 'job' } };
    case 'mismatch':
      return {
        ...base,
        position: { byte: Math.round(fraction * sim.fileBytes) },
        file: { sizeBytes: Math.round(sim.fileBytes * 1.5), name: 'some-other-file.gcode' }
      };
    default:
      return base;
  }
}

function simStep() {
  sim.fraction = Math.min(1, sim.fraction + 0.004);
  const mappedResult = sim.mapper.observe(simObservation(sim.fraction));
  renderer.setProgress(mappedResult);
  const notes = mappedResult.notes.map((n) => n.code).join(', ');
  els.progressNote.textContent =
    `${(sim.fraction * 100).toFixed(1)}% · basis: ${mappedResult.basis} · ` +
    `confidence: ${mappedResult.confidence} · shown as: ${renderer.progressPresentation}` +
    (notes ? ` · notes: ${notes}` : '');
  if (sim.fraction >= 1) stopSim(false);
}

els.progressPlay.addEventListener('click', () => {
  if (sim.timer !== null) {
    // Pause: stop observing but keep ticking the mapper — after staleAfterMs
    // the overlay visibly grays out (honest staleness, not a frozen lie).
    stopSim(false);
    els.progressPlay.textContent = 'Resume';
    els.progressNote.textContent += ' · paused (overlay goes stale in ~10 s)';
    sim.staleTimer = setInterval(() => {
      const ticked = sim.mapper.tick(Date.now());
      renderer.setProgress(ticked);
      if (ticked.stale) {
        els.progressNote.textContent = `Stale — last position held, shown as: ${renderer.progressPresentation}`;
        clearInterval(sim.staleTimer);
        sim.staleTimer = null;
      }
    }, 1000);
    return;
  }
  if (sim.mapper === null) return;
  if (sim.staleTimer !== null) clearInterval(sim.staleTimer);
  sim.staleTimer = null;
  if (sim.fraction >= 1) sim.fraction = 0;
  els.progressPlay.textContent = 'Pause';
  sim.timer = setInterval(simStep, 100);
});

els.progressTier.addEventListener('change', () => {
  if (sim.mapper !== null) {
    sim.mapper.reset();
    sim.fraction = 0;
  }
});

function enableSim(ir, fileBytes) {
  stopSim(false);
  sim.ir = ir;
  sim.fileBytes = fileBytes;
  sim.fraction = 0;
  sim.mapper = createProgressMapper(ir, { fileSizeBytes: fileBytes });
  els.progressTier.disabled = false;
  els.progressPlay.disabled = false;
  els.progressNote.textContent = 'Pick a tier and press Play.';
}

els.parse.addEventListener('click', () => void parseAndRender());
els.cancel.addEventListener('click', () => session.cancel());
els.startLayer.addEventListener('input', applyLayerRange);
els.endLayer.addEventListener('input', applyLayerRange);
els.scrub.addEventListener('input', applyScrub);
els.travel.addEventListener('change', () => renderer.setKindVisible('travel', els.travel.checked));
els.wipe.addEventListener('change', () => renderer.setKindVisible('wipe', els.wipe.checked));
els.retractions.addEventListener('change', () => renderer.setShowRetractions(els.retractions.checked));
els.colorMode.addEventListener('change', () => {
  if (!renderer.setColorMode(colorModeFor(els.colorMode.value))) {
    els.colorMode.value = 'single';
    renderer.setColorMode(colorModeFor('single'));
  }
});
els.quality.addEventListener('change', () => renderer.setQuality(els.quality.value));
els.cameraMode.addEventListener('change', () => renderer.setCameraMode(els.cameraMode.value));
const applyTheme = () => renderer.setTheme(themeFor(els.theme.value, els.material.value));
els.theme.addEventListener('change', applyTheme);
els.material.addEventListener('change', applyTheme);
els.frame.addEventListener('click', () => renderer.frame());

// App-level keyboard shortcuts (master plan §9.5); every control is also plain
// tab-reachable, and the sliders take arrow/page keys natively.
const nudge = (el, delta) => {
  if (el.disabled) return;
  el.value = String(Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) + delta)));
  el.dispatchEvent(new Event('input'));
};
window.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if (t instanceof HTMLElement && (t.tagName === 'SELECT' || t.tagName === 'INPUT')) return;
  const scrubStep = Math.max(1, Math.round(Number(els.scrub.max) / 100));
  if (ev.key === '[') nudge(els.endLayer, -1);
  else if (ev.key === ']') nudge(els.endLayer, 1);
  else if (ev.key === ',') nudge(els.scrub, -scrubStep);
  else if (ev.key === '.') nudge(els.scrub, scrubStep);
  else if (ev.key === 't' && !els.travel.disabled) {
    els.travel.checked = !els.travel.checked;
    els.travel.dispatchEvent(new Event('change'));
  } else if (ev.key === 'f' && !els.frame.disabled) renderer.frame();
  else if (ev.key === 'o') {
    els.cameraMode.value = els.cameraMode.value === 'orthographic' ? 'perspective' : 'orthographic';
    els.cameraMode.dispatchEvent(new Event('change'));
  } else return;
  ev.preventDefault();
});

// Keep the canvas backing store matched to its layout size. Explicit initial fit
// plus a window fallback — some embedded hosts never deliver ResizeObserver entries.
const main = els.canvas.parentElement;
function fitCanvas() {
  const r = main.getBoundingClientRect();
  renderer.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
}
fitCanvas();
window.addEventListener('resize', fitCanvas);
new ResizeObserver(fitCanvas).observe(main);

// Debug/inspection handle (also used by automated demo verification).
window.viewer = { renderer, session, sim };
