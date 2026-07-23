/**
 * DD-004 phase 3 demo (issue #58): the full pipeline — GcodeParseSession
 * (worker parse, off-thread, zero-copy transfer) → ToolpathRenderer (incremental
 * upload, draw-range clipping/scrub, capability-honest coloring) — over the
 * inherited MIT demo corpus or any local G-code file.
 */
import { GcodeParseSession, CancelledError } from '@chestnutlabs/gcode-parser';
import { ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';

// Inherited MIT demo corpus (see test-data/manifest.json), served by Vite's publicDir.
const CORPUS = [
  ['3DBenchy.gcode', '3DBenchy (3.7 MB)'],
  ['calicat.gcode', 'Calicat (635 KB)'],
  ['vase.gcode', 'Vase (spiral mode)'],
  ['screw.gcode', 'Screw'],
  ['plant-sign.gcode', 'Plant sign'],
  ['easel.gcode', 'Easel (19 KB)'],
  ['mach3.gcode', 'Mach3 (CNC-style)']
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
  colorMode: $('colorMode'),
  frame: $('frame'),
  disclosure: $('disclosure'),
  stats: $('stats'),
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
  buildVolume: { x: 220, y: 220, z: 250 }
});

let parsing = false;
let travelAvailable = false;

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}

function colorModeFor(kind) {
  if (kind === 'tool') return { mode: 'tool', palette: TOOL_PALETTE, fallback: [0.7, 0.7, 0.7] };
  if (kind === 'feature') return { mode: 'feature', palette: FEATURE_PALETTE, fallback: [0.55, 0.55, 0.55] };
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
  renderer.setColorMode(colorModeFor(els.colorMode.value));
}

renderer.onEvent((e) => {
  if (e.type === 'buildComplete') {
    travelAvailable = !e.travelHidden;
    els.travel.disabled = !travelAvailable;
    els.travel.checked = travelAvailable ? els.travel.checked : false;
    els.disclosure.textContent =
      e.decimationApplied > 1
        ? `Decimation active: showing every ${e.decimationApplied}th extrusion segment ` +
          `(layer boundaries kept); travel hidden. ${e.segments.toLocaleString()} segments drawn.`
        : '';
  } else if (e.type === 'error') {
    setStatus(`Renderer: ${e.code} — ${e.message}`, true);
  }
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

els.parse.addEventListener('click', () => void parseAndRender());
els.cancel.addEventListener('click', () => session.cancel());
els.startLayer.addEventListener('input', applyLayerRange);
els.endLayer.addEventListener('input', applyLayerRange);
els.scrub.addEventListener('input', applyScrub);
els.travel.addEventListener('change', () => renderer.setKindVisible('travel', els.travel.checked));
els.colorMode.addEventListener('change', () => {
  if (!renderer.setColorMode(colorModeFor(els.colorMode.value))) {
    els.colorMode.value = 'single';
    renderer.setColorMode(colorModeFor('single'));
  }
});
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
  else return;
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
window.viewer = { renderer, session };
