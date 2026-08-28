/**
 * DD-004 phase 3 demo (issue #58): the full pipeline — GcodeParseSession
 * (worker parse, off-thread, zero-copy transfer) → ToolpathRenderer (incremental
 * upload, draw-range clipping/scrub, capability-honest coloring) — over the
 * inherited MIT demo corpus or any local G-code file.
 */
import { GcodeParseSession, CancelledError } from '@chestnutlabs/gcode-parser';
import { ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';
import { createProgressMapper, computeToolpathTime, segmentsCompletedAtTime } from '@chestnutlabs/toolpath-core';
import { downloadToolpathStl } from './stl-export.js';

// Inherited MIT demo corpus (see test-data/manifest.json), served by Vite's publicDir.
const CORPUS = [
  ['gcodes/3DBenchy.gcode', '3DBenchy (3.7 MB)'],
  ['gcodes/calicat.gcode', 'Calicat (635 KB)'],
  ['gcodes/vase.gcode', 'Vase (spiral mode)'],
  ['gcodes/screw.gcode', 'Screw'],
  ['gcodes/plant-sign.gcode', 'Plant sign'],
  ['gcodes/easel.gcode', 'Easel (19 KB)'],
  ['gcodes/mach3.gcode', 'Mach3 (CNC-style)'],
  ['fixtures/parametric/bolt-circle.ngc', 'Parametric bolt-circle (RS274NGC)'],
  ['fixtures/containers/mini-project.gcode.3mf', 'mini-project.gcode.3mf (container)'],
  ['fixtures/annotations/wipe-brackets.gcode', 'Wipe brackets (#182 demo)'],
  ['fixtures/annotations/variable-layers.gcode', 'Variable layer height (#179 demo)']
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

// Color-by-layer-height ramp (#179): thin → thick as blue → green → yellow → red.
const HEIGHT_RAMP = [
  [0.15, 0.4, 0.9],
  [0.2, 0.85, 0.45],
  [0.95, 0.85, 0.2],
  [0.9, 0.3, 0.2]
];
// Color-by-speed ramp (#177): slow → fast as blue → yellow → red.
const SPEED_RAMP = [
  [0.12, 0.36, 0.95],
  [0.97, 0.86, 0.2],
  [0.92, 0.22, 0.15]
];
const OBJECT_PALETTE = [
  [0.35, 0.7, 0.95],
  [0.95, 0.55, 0.3],
  [0.5, 0.88, 0.5],
  [0.9, 0.42, 0.72]
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
  exportStl: $('exportStl'),
  timeScrub: $('timeScrub'),
  timeScrubVal: $('timeScrubVal'),
  printTimeNote: $('printTimeNote'),
  saveView: $('saveView'),
  restoreView: $('restoreView'),
  disclosure: $('disclosure'),
  stats: $('stats'),
  progressTier: $('progressTier'),
  progressPlay: $('progressPlay'),
  progressNote: $('progressNote'),
  progressive: $('progressive'),
  capturePng: $('capturePng'),
  showStats: $('showStats'),
  renderStats: $('renderStats'),
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
  if (kind === 'layerHeight') return { mode: 'layerHeight', ramp: HEIGHT_RAMP, fallback: [0.6, 0.6, 0.6] };
  if (kind === 'feedrate') return { mode: 'feedrate', ramp: SPEED_RAMP, fallback: [0.55, 0.6, 0.62] };
  if (kind === 'object') return { mode: 'object', palette: OBJECT_PALETTE, fallback: [0.55, 0.55, 0.55] };
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

// #276: kinematic time axis backs the time-scrub; the slicer estimate (when present) is the
// displayed total. The provenance (slicer vs kinematic) is shown honestly.
let timeAxis = null;
let savedCameraState = null;

function fmtTime(ms) {
  const min = ms / 60000;
  return min >= 1 ? `${min.toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`;
}

function setupTimeScrub(ir, metadata) {
  timeAxis = computeToolpathTime(ir);
  const slicerSeconds = metadata?.printEstimate?.seconds;
  const totalMs = slicerSeconds !== undefined ? slicerSeconds * 1000 : timeAxis.totalMs;
  const source = slicerSeconds !== undefined ? 'slicer' : 'kinematic';
  els.timeScrub.max = String(Math.max(1, Math.round(timeAxis.totalMs)));
  els.timeScrub.value = els.timeScrub.max;
  els.timeScrub.disabled = false;
  els.timeScrubVal.textContent = 'all';
  const caveat =
    source === 'slicer'
      ? ' (slicer estimate)'
      : ` (kinematic — constant-velocity approximation${
          timeAxis.hasUnknownFeedrate ? ', lower bound: some feedrates unknown' : ''
        })`;
  els.printTimeNote.textContent = `Estimated print time: ${fmtTime(totalMs)}${caveat}`;
}

function applyTimeScrub() {
  if (timeAxis === null) return;
  const ms = Number(els.timeScrub.value);
  const all = ms >= Number(els.timeScrub.max);
  renderer.setScrubPosition(all ? null : segmentsCompletedAtTime(timeAxis.cumulativeMs, ms));
  els.timeScrubVal.textContent = all ? 'all' : fmtTime(ms);
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
  for (const el of [els.startLayer, els.endLayer, els.scrub, els.colorMode, els.frame, els.exportStl, els.saveView])
    el.disabled = false;
  for (const btn of document.querySelectorAll('.view-btn')) btn.disabled = false;

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
  // Layer-height coloring (#179): only meaningful with a real planar layer table.
  const lhOpt = els.colorMode.querySelector('option[value="layerHeight"]');
  const lhOk = renderer.isColorModeAvailable('layerHeight');
  lhOpt.disabled = !lhOk;
  lhOpt.textContent = lhOk
    ? 'By layer height'
    : `By layer height (unavailable: layers = ${ir.header.capabilities.layers ?? 'unknown'})`;
  if (!lhOk && els.colorMode.value === 'layerHeight') {
    els.colorMode.value = 'single';
  }
  // Speed/feedrate coloring (#177): offered when the file carries feedrates.
  const spOpt = els.colorMode.querySelector('option[value="feedrate"]');
  const spOk = renderer.isColorModeAvailable('feedrate');
  spOpt.disabled = !spOk;
  spOpt.textContent = spOk
    ? 'By speed'
    : `By speed (unavailable: feedrate = ${ir.header.capabilities.feedrate ?? 'unknown'})`;
  if (!spOk && els.colorMode.value === 'feedrate') els.colorMode.value = 'single';
  // Object coloring (#178): only when the dialect resolved per-object membership.
  const objOpt = els.colorMode.querySelector('option[value="object"]');
  const objOk = renderer.isColorModeAvailable('object');
  objOpt.disabled = !objOk;
  objOpt.textContent = objOk
    ? 'By object'
    : `By object (unavailable: objects = ${ir.header.capabilities.objects ?? 'unknown'})`;
  if (!objOk && els.colorMode.value === 'object') els.colorMode.value = 'single';
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
    els.capturePng.disabled = false;
    els.showStats.disabled = false;
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
    setupTimeScrub(ir, result.metadata);
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
els.timeScrub.addEventListener('input', applyTimeScrub);
// #276: preset views + save/restore camera state (exercises setView / get+setCameraState).
for (const btn of document.querySelectorAll('.view-btn')) {
  btn.addEventListener('click', () => renderer.setView(btn.dataset.view));
}
els.saveView.addEventListener('click', () => {
  savedCameraState = renderer.getCameraState();
  els.restoreView.disabled = false;
});
els.restoreView.addEventListener('click', () => {
  if (savedCameraState !== null) renderer.setCameraState(savedCameraState);
});
els.exportStl.addEventListener('click', () => {
  const ir = renderer.ir;
  if (!ir) return;
  const { segments, emitted, triangles } = downloadToolpathStl(ir, 'toolpath.stl');
  const note =
    emitted < segments
      ? `Exported STL: ${triangles.toLocaleString()} triangles from ${emitted.toLocaleString()} of ${segments.toLocaleString()} productive segments (strided to the triangle budget).`
      : `Exported STL: ${triangles.toLocaleString()} triangles from ${segments.toLocaleString()} productive segments.`;
  setStatus(note);
});
// Progressive preview (#60, DD-029): how a large file is revealed while parsing.
els.progressive.addEventListener('change', () => renderer.setProgressivePreview(els.progressive.value));
// Capture the current view as a PNG via the generic renderer.capture() (DD-030 D1).
els.capturePng.addEventListener('click', async () => {
  try {
    const blob = await renderer.capture({ format: 'png' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gcode-preview.png';
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Captured ${(blob.size / 1024).toFixed(0)} KB PNG.`);
  } catch (err) {
    setStatus(`Capture failed: ${err && err.message ? err.message : err}`, true);
  }
});
// Render diagnostics (DD-027): read renderer.getRenderStats() and show it — backend,
// hardware-vs-software GPU, geometry mode, counts, and timings, never fabricated.
els.showStats.addEventListener('click', () => {
  const s = renderer.getRenderStats();
  if (!s) {
    els.renderStats.textContent = 'No render stats yet — render a file first.';
    return;
  }
  const ms = (v) => (v == null ? '—' : `${Math.round(v)} ms`);
  els.renderStats.textContent = [
    `backend:      ${s.backend} (WebGL ${s.webglVersion ?? '?'})`,
    `capability:   ${s.capability}${s.gpuRenderer ? ` — ${s.gpuRenderer}` : ''}`,
    `geometry:     ${s.geometryMode} · parallelism ${s.buildParallelism}${s.workerCount ? ` (${s.workerCount} workers)` : ''}`,
    `segments:     ${(s.renderedSegmentCount ?? 0).toLocaleString()} / ${(s.sourceSegmentCount ?? 0).toLocaleString()}${s.decimationApplied ? ' (decimated)' : ''}`,
    `draw calls:   ${s.drawCalls ?? '—'} · vertices ${s.vertexCount?.toLocaleString() ?? '—'}`,
    `tube bytes:   ${s.tubeBytes ? (s.tubeBytes / 1e6).toFixed(1) + ' MB' : '—'} / budget ${s.tubeByteBudget ? (s.tubeByteBudget / 1e6).toFixed(0) + ' MB' : '—'}`,
    `timings:      parse ${ms(s.parseMs)} · build ${ms(s.geometryBuildMs)} · first frame ${ms(s.firstRenderMs)} · ready ${ms(s.totalReadyMs)}`,
    s.disclosures?.length ? `disclosures:  ${s.disclosures.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
});

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
