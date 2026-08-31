/*
 * G-code Preview — Feature Lab (DD-031). A viewport-dominant, capability-aware showcase built on the
 * PUBLISHED framework-neutral controller (`@chestnutlabs/gcode-preview-core`) — the same contract an
 * external consumer uses, so this demo dogfoods the real adapter surface rather than the raw renderer.
 * Shared control metadata / palettes / fixtures / tokens come from the workspace-internal demo-kit.
 */
import '../../demo-kit/tokens.css';
import { createPreviewController } from '@chestnutlabs/gcode-preview-core';
// DD-031: the Prepare-side controller for source-model (STL/3MF) viewing — the counterpart to the
// toolpath controller above. The flagship demonstrates both halves of the SDK.
import { createModelPreviewController } from '@chestnutlabs/gcode-model-renderer';
import { FeatureRole } from '@chestnutlabs/toolpath-core';
import {
  COLOR_MODES,
  COLOR_MODE_BY_ID,
  colorModeReason,
  confidenceTier,
  rgbCss,
  FIXTURE_GROUPS,
  FIXTURE_BY_ID,
  MODEL_FIXTURES,
  MODEL_FIXTURE_BY_ID,
  count,
  duration,
  timeSourceNote
} from '../../demo-kit/index.js';
import { downloadToolpathStl } from './stl-export.js';

const els = {};
for (const el of document.querySelectorAll('[id]')) els[el.id] = el;

// Named scene themes (#153, DD-009 D4) — bounded declarative Theme objects; unspecified fields keep defaults.
const THEMES = {
  default: {},
  // The canonical neutral mid-grey documentation workspace (matches the screenshot harness).
  docgrey: { background: '#6d7176', gridColor: '#565a60', bedColor: '#565a60', hemisphereIntensity: 2.1 },
  blueprint: { background: '#0d1b2a', gridColor: '#1b9aaa', bedColor: '#415a77', hemisphereIntensity: 2.2 },
  light: {
    background: '#eef1f5',
    gridColor: '#9fb3c8',
    bedColor: '#bcccdc',
    hemisphereIntensity: 2.4,
    directionalIntensity: 1.4
  },
  bedplate: {
    background: '#10141b',
    gridColor: '#3a4658',
    bedColor: '#556173',
    bedSurface: { mode: 'solid', color: '#20242c', opacity: 1 }
  }
};
const themeFor = () => ({ ...(THEMES[els.theme.value] ?? {}), materialPreset: els.material.value });

// ---- controller (the published core, 3D by default) ----
const preview = createPreviewController({
  renderer: { quality: 'auto', qualityMode: 'adaptive', progressivePreview: 'auto', interactionQuality: 'off' }
});
preview.bindCanvas(els.view);

// mutable view state
let fileBytes = 0;
let capabilities = {};
let savedCamera = null;
let ready = false;

// ---- Prepare (source-model) mode: the second half of the SDK, lazily created on first use ----
let mode = 'preview'; // 'preview' (toolpath) | 'prepare' (source model)
let modelController = null;
let modelInfo = null;

function ensureModel() {
  if (modelController !== null) return modelController;
  modelController = createModelPreviewController({ background: 'transparent', interactionQuality: 'auto' });
  modelController.bindCanvas(els.modelView);
  modelController.onEvent((e) => {
    if (e.type === 'ready') {
      modelInfo = e.info;
      renderModelInfo();
    } else if (e.type === 'error') {
      els.status.textContent = `Model error: ${e.code} — ${e.message}`;
    }
  });
  return modelController;
}

function renderModelInfo() {
  if (modelInfo === null) {
    els.modelInfo.textContent = '—';
    return;
  }
  const t = confidenceTier(modelInfo.materials);
  const plates = modelInfo.plates ? `\nplates: ${modelInfo.plates.list.length}` : '';
  els.modelInfo.innerHTML =
    `objects: ${count(modelInfo.objectCount)}\n` +
    `placements: ${count(modelInfo.instancedCount)}\n` +
    `materials: <span class="gp-badge ${t.cls}">${t.label}</span>${plates}`;
}

function populateFixtures(prepare) {
  els.fixture.innerHTML = '';
  if (prepare) {
    for (const m of MODEL_FIXTURES) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.label;
      els.fixture.appendChild(o);
    }
    els.fixture.value = 'colored-3mf';
  } else {
    for (const g of FIXTURE_GROUPS) {
      const og = document.createElement('optgroup');
      og.label = g.group;
      for (const it of g.items) {
        const o = document.createElement('option');
        o.value = it.id;
        o.textContent = it.label;
        og.appendChild(o);
      }
      els.fixture.appendChild(og);
    }
    els.fixture.value = 'skirt-brim';
  }
}

function setMode(next) {
  if (next === mode) return;
  mode = next;
  const prepare = next === 'prepare';
  for (const b of els.modeSeg.children) b.classList.toggle('gp-on', b.dataset.mode === next);
  els.view.hidden = prepare;
  els.modelView.hidden = !prepare;
  // Toolpath tabs are irrelevant in Prepare; show only the Prepare tab and select it (and vice-versa).
  for (const t of els.tabs.querySelectorAll('.gp-tab')) {
    if (t.dataset.tab !== 'prepare') t.hidden = prepare;
  }
  document.querySelector('[data-tab="prepare"]').hidden = !prepare;
  selectTab(prepare ? 'prepare' : 'inspect');
  populateFixtures(prepare);
  els.legendCard.hidden = true;
  els.countPill.hidden = true;
  // The bottom scrub strip (layers/segments/time) is toolpath-only — hide it in Prepare.
  els.scrubStrip.hidden = prepare;
  if (prepare) ensureModel();
  loadSelected();
}

// ============ fixture picker ============
for (const g of FIXTURE_GROUPS) {
  const og = document.createElement('optgroup');
  og.label = g.group;
  for (const it of g.items) {
    const o = document.createElement('option');
    o.value = it.id;
    o.textContent = it.label;
    og.appendChild(o);
  }
  els.fixture.appendChild(og);
}
els.fixture.value = 'skirt-brim';

// ============ color mode select ============
for (const m of COLOR_MODES) {
  const o = document.createElement('option');
  o.value = m.id;
  o.textContent = m.label;
  els.colorMode.appendChild(o);
}

function refreshColorModes(state) {
  const modes = state.availableColorModes ?? [];
  for (const opt of els.colorMode.options) {
    const m = COLOR_MODE_BY_ID[opt.value];
    const ok = m.always || modes.includes(opt.value);
    opt.disabled = !ok;
    opt.textContent = ok ? m.label : `${m.label} — unavailable`;
  }
  updateColorReason();
  renderLegend();
}

function updateColorReason() {
  const reason = colorModeReason(els.colorMode.value, capabilities);
  els.colorModeReason.textContent = reason ? `Not available: ${reason}.` : '';
}

function applyColorMode() {
  const m = COLOR_MODE_BY_ID[els.colorMode.value];
  preview.controls.setColorMode(m.build());
  updateColorReason();
  renderLegend();
}

function renderLegend() {
  const m = COLOR_MODE_BY_ID[els.colorMode.value];
  const items = [];
  if (m.legend) for (const [label, rgb] of m.legend) items.push([label, rgbCss(rgb)]);
  else if (m.ramp) {
    const grad = `linear-gradient(90deg, ${m.ramp.map(rgbCss).join(',')})`;
    els.legendTitle.textContent = m.label;
    els.legend.innerHTML = `<div style="display:flex;align-items:center;gap:8px;width:100%">
      <span class="gp-muted" style="font-size:11px">${m.rampLabel?.[0] ?? ''}</span>
      <span style="flex:1;height:10px;border-radius:5px;background:${grad}"></span>
      <span class="gp-muted" style="font-size:11px">${m.rampLabel?.[1] ?? ''}</span></div>`;
    els.legendCard.hidden = false;
    return;
  }
  if (items.length === 0) {
    els.legendCard.hidden = true;
    return;
  }
  els.legendTitle.textContent = m.label;
  els.legend.innerHTML = items
    .map(
      ([label, css]) =>
        `<span class="gp-legend-item"><span class="gp-swatch" style="background:${css}"></span>${label}</span>`
    )
    .join('');
  els.legendCard.hidden = false;
}

// ============ parse / load ============
async function loadSelected() {
  if (mode === 'prepare') return loadSelectedModel();
  const fx = FIXTURE_BY_ID[els.fixture.value];
  if (!fx) return;
  els.status.textContent = `Fetching ${fx.label}…`;
  try {
    const res = await fetch(fx.path);
    if (!res.ok) throw new Error(`${res.status}`);
    await parseInput(new Uint8Array(await res.arrayBuffer()), fx.label);
  } catch (err) {
    els.status.textContent = `Could not fetch ${fx.label}: ${err.message}`;
  }
}

// Prepare: hand the model controller a synthetic MIT-clean source model (no fetch). Its `ready` event
// (wired in ensureModel) populates the Source-model panel with the honest capability tier + counts.
function loadSelectedModel() {
  const fx = MODEL_FIXTURE_BY_ID[els.fixture.value];
  if (!fx) return;
  modelInfo = null;
  renderModelInfo();
  els.status.textContent = `${fx.label} — ${fx.blurb}`;
  els.modelBlurb.textContent = fx.blurb;
  ensureModel().controls.setSource(fx.source());
}

async function parseInput(input, label) {
  setParsing(true);
  els.stage.hidden = false;
  els.stageLabel.textContent = 'Parsing…';
  const outcome = await preview.parse(input);
  setParsing(false);
  if (!outcome.ok) {
    els.stage.hidden = true;
    if (!outcome.cancelled) els.status.textContent = `Parse failed: ${outcome.error.message}`;
    return;
  }
  els.status.textContent = `Loaded ${label ?? 'file'} — ${count(outcome.result.ir.segments.count)} segments.`;
}

function setParsing(on) {
  els.parse.disabled = on;
  els.cancel.hidden = !on;
  els.progress.hidden = !on;
  if (on) els.progress.value = 0;
}

// ============ controller events ============
preview.onEvent((e) => {
  switch (e.type) {
    case 'parse-started':
      fileBytes = e.bytes;
      break;
    case 'parse-progress':
      els.progress.value = e.progress.totalBytes ? e.progress.bytesProcessed / e.progress.totalBytes : 0;
      break;
    case 'stage':
      els.stageLabel.textContent = stageLabel(e);
      if (e.stage === 'ready') els.stage.hidden = true;
      break;
    case 'buildComplete':
      els.stage.hidden = true;
      onReady(e);
      break;
    case 'parse-complete':
      capabilities = e.capabilities ?? {};
      applyContext();
      break;
    case 'machine-geometry-discovered':
      showMachine(e.machine);
      break;
    case 'error':
      els.status.textContent = `Error (${e.code}): ${e.message}`;
      break;
    default:
      break;
  }
});

function stageLabel(e) {
  const map = {
    parsing: 'Parsing G-code…',
    classifying: 'Classifying moves…',
    'building-geometry': 'Building geometry…',
    'preparing-gpu': 'Preparing GPU…',
    ready: 'Ready'
  };
  let s = map[e.stage] ?? e.stage;
  if (e.stage === 'building-geometry' && e.detail) s += ` (${count(e.detail.built)}/${count(e.detail.total)})`;
  return s;
}

function onReady() {
  ready = true;
  els.countPill.hidden = false;
  enableControls(true);
  // scrub ranges
  const state = preview.getState();
  els.segCount.textContent = count(state.segmentCount);
  els.layerCountLbl.textContent = count(state.layerCount);
  els.scrub.max = state.segmentCount;
  els.scrub.value = state.segmentCount;
  els.startLayer.max = Math.max(0, state.layerCount - 1);
  els.endLayer.max = Math.max(0, state.layerCount - 1);
  els.startLayer.value = 0;
  els.endLayer.value = Math.max(0, state.layerCount - 1);
  updateLayerLabel();
  // re-apply appearance the user had chosen
  applyColorMode();
  preview.controls.setTheme(themeFor());
}

// ============ reactive state ============
preview.onStateChange((state) => {
  refreshColorModes(state);
  // retraction gating (contextual + honest)
  els.retractions.disabled = !state.hasRetractions && ready;
  els.retractRow.classList.toggle('gp-disabled', ready && !state.hasRetractions);
  els.retractRow.querySelector('span').textContent =
    ready && !state.hasRetractions ? 'Retraction markers — none in this file' : 'Retraction markers';
  // disclosure + time
  els.disclosure.textContent = state.disclosure ?? '';
  if (state.totalTimeMs != null) {
    els.timePill.hidden = false;
    els.timeLbl.textContent = duration(state.totalTimeMs);
    els.timeLbl.title = `Estimate: ${timeSourceNote(state.timeEstimateSource)}`;
    els.timeScrub.max = Math.round(state.totalTimeMs);
    els.timeScrub.value = Math.round(state.totalTimeMs);
    els.timeScrubLbl.textContent = duration(state.totalTimeMs);
  }
});

// ============ contextual behavior ============
function applyContext() {
  // Capability badges (diagnostics)
  els.capBadges.innerHTML = Object.entries(capabilities)
    .map(([k, v]) => {
      const t = confidenceTier(v);
      return `<span class="gp-badge ${t.cls}" title="${k}: ${t.label}">${k}</span>`;
    })
    .join('');
  // Adhesion toggle: only when feature roles are identified.
  const hasFeatures = capabilities.featureRoles && capabilities.featureRoles !== 'unavailable';
  toggleContext('adhesion', hasFeatures);
  // CNC tab: only when the file exposes tool power (a CNC/laser signal).
  const isCam = preview.controls.isColorModeAvailable('power') || capabilities.toolPower !== undefined;
  toggleContext('cam', isCam);
}

function toggleContext(ctx, on) {
  for (const el of document.querySelectorAll(`[data-context="${ctx}"]`)) el.hidden = !on;
}

function showMachine(machine) {
  if (!machine) return;
  const bed = machine.bed;
  els.machineNote.textContent = `Discovered from the file (confidence: ${machine.confidence}).`;
  els.machineInfo.textContent =
    bed?.kind === 'rect'
      ? `Rect bed ${bed.max.x - bed.min.x}×${bed.max.y - bed.min.y} mm, height ${machine.heightMm} mm`
      : `${bed?.kind ?? 'unknown'} bed`;
}

// ============ enable/disable ============
const RUNTIME_CONTROLS = [
  'startLayer',
  'endLayer',
  'scrub',
  'timeScrub',
  'travel',
  'wipe',
  'retractions',
  'hideAdhesion',
  'colorMode',
  'quality',
  'qualityMode',
  'progressive',
  'interactionQuality',
  'saveView',
  'frame',
  'progressPlay',
  'showStats',
  'capture'
];
function enableControls(on) {
  for (const id of RUNTIME_CONTROLS) if (els[id]) els[id].disabled = !on;
}

// ============ wiring: header ============
els.parse.addEventListener('click', loadSelected);
els.fixture.addEventListener('change', loadSelected);
els.open.addEventListener('click', () => els.file.click());
els.file.addEventListener('change', async () => {
  const f = els.file.files?.[0];
  if (f) await parseInput(f, f.name);
});
els.cancel.addEventListener('click', () => preview.cancel());
els.chromeToggle.addEventListener('click', () => {
  const root = document.documentElement;
  root.dataset.chrome = root.dataset.chrome === 'light' ? 'dark' : 'light';
});
els.capture.addEventListener('click', async () => {
  try {
    const blob = await preview.controls.capture({ format: 'image/png' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gcode-preview.png';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    els.status.textContent = `Capture unavailable: ${err.message}`;
  }
});

// ============ wiring: tabs + rail ============
function selectTab(name) {
  for (const t of els.tabs.querySelectorAll('.gp-tab')) t.classList.toggle('gp-on', t.dataset.tab === name);
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== name;
}
els.tabs.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-tab]');
  if (!btn) return;
  selectTab(btn.dataset.tab);
});
els.modeSeg.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-mode]');
  if (b) setMode(b.dataset.mode);
});
els.railToggle.addEventListener('click', () => els.main.classList.toggle('gp-rail-collapsed'));

// ============ wiring: inspect ============
els.travel.addEventListener('change', () => preview.controls.setKindVisible('travel', els.travel.checked));
els.wipe.addEventListener('change', () => preview.controls.setKindVisible('wipe', els.wipe.checked));
els.retractions.addEventListener('change', () => preview.controls.setShowRetractions(els.retractions.checked));
// Apply the initial move-visibility state — the renderer's defaults otherwise disagree with the
// unchecked/checked boxes (e.g. travel would render though "Travel moves" is off). Queued until the
// renderer resolves, then replayed.
preview.controls.setKindVisible('travel', els.travel.checked);
preview.controls.setKindVisible('wipe', els.wipe.checked);
preview.controls.setShowRetractions(els.retractions.checked);
els.hideAdhesion.addEventListener('change', () => {
  const visible = !els.hideAdhesion.checked;
  preview.controls.setFeatureRoleVisible(FeatureRole.Skirt, visible);
  preview.controls.setFeatureRoleVisible(FeatureRole.Brim, visible);
});

// segment picking (source mapping) via the public controls.pickSegment
els.view.addEventListener('click', (ev) => {
  if (!ready) return;
  const r = els.view.getBoundingClientRect();
  const ndcX = ((ev.clientX - r.left) / r.width) * 2 - 1;
  const ndcY = -(((ev.clientY - r.top) / r.height) * 2 - 1);
  const seg = preview.controls.pickSegment(ndcX, ndcY);
  els.pickResult.textContent =
    seg == null ? 'No segment under cursor' : `Segment #${count(seg)} of ${count(preview.getState().segmentCount)}`;
});

// ============ wiring: appearance ============
els.colorMode.addEventListener('change', applyColorMode);
els.theme.addEventListener('change', () => preview.controls.setTheme(themeFor()));
els.material.addEventListener('change', () => preview.controls.setTheme(themeFor()));

// ============ wiring: view ============
els.projSeg.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-proj]');
  if (!b) return;
  for (const x of els.projSeg.children) x.classList.toggle('gp-on', x === b);
  preview.controls.setCameraMode(b.dataset.proj);
});
els.projToggle.addEventListener('click', () => {
  const cur = preview.getState();
  const next = els.projSeg.querySelector('.gp-on').dataset.proj === 'perspective' ? 'orthographic' : 'perspective';
  for (const x of els.projSeg.children) x.classList.toggle('gp-on', x.dataset.proj === next);
  preview.controls.setCameraMode(next);
  void cur;
});
// Camera presets + frame route to whichever viewer is active (toolpath or source model).
const activeControls = () =>
  mode === 'prepare' && modelController !== null ? modelController.controls : preview.controls;
document
  .querySelectorAll('[data-view]')
  .forEach((b) => b.addEventListener('click', () => activeControls().setView(b.dataset.view)));
els.frame.addEventListener('click', () => activeControls().frame());
els.frameSeg.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-frame]');
  if (!b) return;
  for (const x of els.frameSeg.children) x.classList.toggle('gp-on', x === b);
  preview.controls.setFrameContent(b.dataset.frame);
});
els.cage.addEventListener('change', () => preview.controls.setBuildVolumeCage(els.cage.checked));
els.saveView.addEventListener('click', () => {
  savedCamera = preview.controls.getCameraState();
  els.restoreView.disabled = savedCamera == null;
});
els.restoreView.addEventListener('click', () => savedCamera && preview.controls.setCameraState(savedCamera));

// ============ wiring: rendering ============
els.quality.addEventListener('change', () => preview.controls.setQuality(els.quality.value));
els.qualityMode.addEventListener('change', () => preview.controls.setQualityMode(els.qualityMode.value));
els.progressive.addEventListener('change', () => preview.controls.setProgressivePreview(els.progressive.value));
els.interactionQuality.addEventListener('change', () =>
  preview.controls.setInteractionQuality(els.interactionQuality.checked ? 'auto' : 'off')
);

// ============ wiring: diagnostics ============
els.showStats.addEventListener('click', () => {
  const s = preview.controls.getRenderStats();
  els.renderStats.textContent = s
    ? JSON.stringify(s, null, 2)
    : 'No render stats available (e.g. the 2D renderer produces none).';
});

// ============ wiring: scrub strip ============
els.scrubMode.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-scrub]');
  if (!b) return;
  for (const x of els.scrubMode.children) x.classList.toggle('gp-on', x === b);
  for (const t of document.querySelectorAll('.gp-scrub .track')) t.hidden = t.dataset.track !== b.dataset.scrub;
});
function updateLayerLabel() {
  const a = Math.min(+els.startLayer.value, +els.endLayer.value);
  const b = Math.max(+els.startLayer.value, +els.endLayer.value);
  els.layerRangeLbl.textContent = `${a}–${b}`;
  preview.controls.setLayerRange(a, b);
}
els.startLayer.addEventListener('input', updateLayerLabel);
els.endLayer.addEventListener('input', updateLayerLabel);
els.scrub.addEventListener('input', () => {
  const v = +els.scrub.value;
  els.scrubLbl.textContent = count(v);
  preview.controls.setScrubPosition(v >= +els.scrub.max ? null : v);
});
els.timeScrub.addEventListener('input', () => {
  const ms = +els.timeScrub.value;
  els.timeScrubLbl.textContent = duration(ms);
  preview.controls.setScrubTime(ms >= +els.timeScrub.max ? null : ms);
});
els.scrubReset.addEventListener('click', () => {
  els.scrub.value = els.scrub.max;
  els.timeScrub.value = els.timeScrub.max;
  els.startLayer.value = 0;
  els.endLayer.value = els.endLayer.max;
  preview.controls.setScrubPosition(null);
  preview.controls.setScrubTime(null);
  updateLayerLabel();
});

// ============ wiring: simulated live progress ============
let simTimer = null;
let simT = 0;
els.progressPlay.addEventListener('click', () => {
  if (simTimer) {
    stopSim();
    return;
  }
  els.progressPlay.textContent = 'Stop';
  simT = 0;
  const tier = els.progressTier.value;
  const layers = preview.getState().layerCount;
  simTimer = setInterval(() => {
    simT += 0.02;
    if (simT >= 1) {
      if (tier === 'mismatch') {
        preview.tickProgress(performance.now()); // stop observing → goes stale
        reportProgress();
        return;
      }
      simT = 1;
    }
    const now = performance.now();
    if (tier === 'byte')
      preview.observeProgress({ v: 1, timestampMs: now, position: { byte: Math.round(simT * fileBytes) } });
    else if (tier === 'layer')
      preview.observeProgress({ v: 1, timestampMs: now, position: { layer: Math.round(simT * (layers - 1)) } });
    else preview.observeProgress({ v: 1, timestampMs: now, position: { percent: simT } });
    reportProgress();
    if (simT >= 1 && tier !== 'mismatch') stopSim();
  }, 60);
});
function stopSim() {
  clearInterval(simTimer);
  simTimer = null;
  els.progressPlay.textContent = 'Play';
}
function reportProgress() {
  const s = preview.getState();
  els.progressNote.textContent = `Presentation: ${s.presentation} · ${Math.round(simT * 100)}%`;
}

// ============ keyboard shortcuts (accessibility preserved) ============
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'f') preview.controls.frame();
  else if (e.key === 'o') els.projToggle.click();
  else if (e.key === '[') {
    els.endLayer.value = Math.max(0, +els.endLayer.value - 1);
    updateLayerLabel();
  } else if (e.key === ']') {
    els.endLayer.value = Math.min(+els.endLayer.max, +els.endLayer.value + 1);
    updateLayerLabel();
  }
});

// ============ canvas auto-fit ============
new ResizeObserver(() => {
  const r = preview.raw.renderer();
  if (r) r.resize(els.view.clientWidth, els.view.clientHeight);
}).observe(els.view);
new ResizeObserver(() => {
  if (modelController !== null) modelController.controls.resize(els.modelView.clientWidth, els.modelView.clientHeight);
}).observe(els.modelView);

// expose for automated verification (kept minimal — the flagship path is the controller)
window.viewer = { preview, model: () => modelController };

// STL export lives on a header-adjacent action only when useful; keep the util imported (used by tests).
void downloadToolpathStl;

// initial load
loadSelected();
