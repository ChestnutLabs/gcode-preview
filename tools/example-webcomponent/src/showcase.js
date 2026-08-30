/*
 * Full showcase example (DD-031 §4.7, tier 2).
 *
 * Exercises the real surface of the published <gcode-preview> Web Component and mirrors the Feature
 * Lab's capability-aware UX in vanilla JS: color modes gate on the file's capabilities with a
 * plain-language reason, feature-role hiding is a property, and diagnostics/picking come through
 * `element.controls`. This is the adapter where the attribute/property split matters — objects
 * (source, colorMode, hiddenFeatureRoles) are set as PROPERTIES; primitives (layer-range, view) can
 * be set as ATTRIBUTES. Chrome (light/dark) is separate from the renderer's neutral viewport.
 * Styling is the shared workspace-internal demo-kit. Still the real package: no raw renderer imports.
 */
import '@chestnutlabs/gcode-preview-element/define';
// Auto-registers <gcode-model-viewer> (the Prepare-side source-model viewer). Note the tag is
// `gcode-model-viewer`, not the reserved `model-viewer`.
import '@chestnutlabs/gcode-preview-element/model/define';
import { FeatureRole } from '@chestnutlabs/toolpath-core';
import {
  FIXTURE_GROUPS,
  FIXTURE_BY_ID,
  MODEL_FIXTURES,
  MODEL_FIXTURE_BY_ID,
  COLOR_MODES,
  COLOR_MODE_BY_ID,
  colorModeReason,
  confidenceTier,
  rgbCss,
  count as formatCount,
  duration as formatDuration
} from '../../demo-kit/index.js';
import '../../demo-kit/tokens.css';

const ADHESION_ROLES = [FeatureRole.Skirt, FeatureRole.Brim];
const CAP_KEYS = ['featureRoles', 'objects', 'feedrate', 'colorChanges'];
const $ = (id) => document.getElementById(id);

const view = $('view');
const modelView = $('modelView');
let caps = {};
let layers = 0;
let segments = 0;
let colorModeId = 'feature';
let mode = 'preview'; // 'preview' (toolpath) | 'prepare' (source model)
let previewCount = { has: false, text: '' }; // preview count-pill state, restored when switching back
let modelInfo = null; // last ModelReadyInfo (Prepare)

// ---- fixture pickers: one <select>, repopulated per mode from the shared demo-kit ----
function fillPreviewFixtures() {
  $('fixture').innerHTML = FIXTURE_GROUPS.map(
    (g) =>
      `<optgroup label="${g.group}">${g.items.map((i) => `<option value="${i.id}">${i.label}</option>`).join('')}</optgroup>`
  ).join('');
  $('fixture').value = 'skirt-brim';
}
function fillModelFixtures() {
  $('fixture').innerHTML = MODEL_FIXTURES.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
  $('fixture').value = 'colored-3mf';
}
fillPreviewFixtures();

$('mode').innerHTML = COLOR_MODES.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
$('mode').value = colorModeId;

// Apply the initial control state to the element. Unlike the framework wrappers (which bind these
// declaratively and so apply them on mount), the element keeps its own defaults — e.g. showTravel
// defaults to `true` — until we push the UI's initial state, or the unchecked boxes would disagree
// with what's rendered. (Controls set before parse are queued and replayed.)
view.showTravel = $('travel').checked;
view.showRetractions = $('retract').checked;

// ---- chrome (app) theme, separate from the viewport ----
function setChrome(c) {
  document.documentElement.dataset.chrome = c;
  $('chromeDark').classList.toggle('gp-on', c === 'dark');
  $('chromeLight').classList.toggle('gp-on', c === 'light');
}
$('chromeDark').addEventListener('click', () => setChrome('dark'));
$('chromeLight').addEventListener('click', () => setChrome('light'));
setChrome('dark');

// ---- fixtures ----
async function load() {
  if (mode === 'prepare') return loadModel();
  const fx = FIXTURE_BY_ID[$('fixture').value];
  if (!fx) return;
  const res = await fetch(`./${fx.path}`);
  view.source = new Uint8Array(await res.arrayBuffer()); // property (object)
  $('statsOut').textContent = '';
  $('pickOut').textContent = '';
  $('disclosure').textContent = fx.blurb;
}
// Prepare: hand the model viewer a { kind, bytes } ModelSourceInput (property; objects can't be
// attributes). No fetch — the model fixtures are synthetic, MIT-clean, built in the demo-kit.
function loadModel() {
  const fx = MODEL_FIXTURE_BY_ID[$('fixture').value];
  if (!fx) return;
  modelView.source = fx.source(); // property (object) → parse + render
  modelInfo = null;
  renderModelPanel();
  updateCount();
  updateCaps();
}
$('load').addEventListener('click', load);
$('fixture').addEventListener('change', load);

// ---- workflow mode: swap the two viewers, the rail panels, and the fixture list ----
function setMode(m) {
  mode = m;
  const prepare = m === 'prepare';
  $('modePreview').classList.toggle('gp-on', !prepare);
  $('modePrepare').classList.toggle('gp-on', prepare);
  // swap the viewers (CSS restores [hidden] over the display rule)
  view.hidden = prepare;
  modelView.hidden = !prepare;
  // swap the rail panels
  $('previewPanels').hidden = prepare;
  $('modelPanel').hidden = !prepare;
  // the toolpath legend never applies in Prepare
  if (prepare) $('legendCard').hidden = true;
  else applyColorMode();
  // repopulate the fixture picker for this mode
  if (prepare) fillModelFixtures();
  else fillPreviewFixtures();
  if (prepare) renderModelPanel();
  updateCount();
  updateCaps();
  // default footer line; events (disclosure / errors) overwrite it
  $('disclosure').textContent = prepare
    ? 'Prepare: view the source model before slicing.'
    : (FIXTURE_BY_ID[$('fixture').value]?.blurb ?? 'Pick a fixture to begin.');
}
$('modePreview').addEventListener('click', () => setMode('preview'));
$('modePrepare').addEventListener('click', () => setMode('prepare'));

// ---- color mode: reflect availability, set the colorMode PROPERTY ----
function applyColorMode() {
  const mode = COLOR_MODE_BY_ID[colorModeId];
  const reason = colorModeReason(colorModeId, caps);
  $('modeReason').textContent = reason;
  if (reason === '') view.colorMode = mode.build();
  // legend
  const legend = mode.legend ?? null;
  $('legendCard').hidden = legend === null;
  if (legend) {
    $('legendTitle').textContent = mode.label;
    $('legend').innerHTML = legend
      .map(
        ([label, rgb]) =>
          `<span class="gp-legend-item"><span class="gp-swatch" style="background:${rgbCss(rgb)}"></span>${label}</span>`
      )
      .join('');
  }
}
function refreshModeOptions() {
  for (const opt of $('mode').options) {
    const reason = colorModeReason(opt.value, caps);
    opt.disabled = reason !== '';
    const base = COLOR_MODE_BY_ID[opt.value].label;
    opt.textContent = reason !== '' ? `${base} — unavailable` : base;
  }
}
$('mode').addEventListener('change', () => {
  colorModeId = $('mode').value;
  applyColorMode();
});

// ---- filter controls ----
$('layer').addEventListener('input', () => {
  const v = $('layer').value;
  $('layerValue').textContent = `${v} / ${Math.max(0, layers - 1)}`;
  view.setAttribute('layer-range', `0,${v}`); // primitive → attribute
});
$('hide').addEventListener('change', () => {
  view.hiddenFeatureRoles = $('hide').checked ? ADHESION_ROLES : []; // property (array)
});
$('travel').addEventListener('change', () => {
  view.showTravel = $('travel').checked; // boolean property
});
$('retract').addEventListener('change', () => {
  view.showRetractions = $('retract').checked;
});

// ---- camera (shared: drives whichever viewer is active; `view` is a primitive → attribute) ----
for (const btn of document.querySelectorAll('.sc-cam button')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sc-cam button').forEach((b) => b.classList.remove('gp-on'));
    btn.classList.add('gp-on');
    const target = mode === 'prepare' ? modelView : view;
    target.setAttribute('view', btn.dataset.view);
  });
}

// ---- diagnostics: element.controls ----
function readStats() {
  const s = view.controls.getRenderStats();
  // Render nothing until stats exist (they populate a tick after build-complete) — parity with the
  // framework showcases, which also silently no-op a null read rather than showing an error line.
  $('statsOut').textContent = s
    ? [
        `backend: ${s.backend} (${s.capability})`,
        `geometry: ${s.geometryMode}`,
        `segments: ${formatCount(s.renderedSegmentCount ?? 0)}`,
        `draw calls: ${s.drawCalls ?? '—'}`,
        s.gpuRenderer ?? ''
      ]
        .filter(Boolean)
        .join('\n')
    : '';
}
$('stats').addEventListener('click', readStats);
$('viewport').addEventListener('click', (e) => {
  if (mode !== 'preview') return; // picking is a toolpath feature
  const c = view.querySelector('canvas') ?? view.shadowRoot?.querySelector('canvas');
  if (!c || layers === 0) return;
  const r = c.getBoundingClientRect();
  const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
  // pickSegment returns the IR segment index, or null if the ray missed.
  const hit = view.controls.pickSegment(ndcX, ndcY);
  $('pickOut').textContent = hit !== null ? `Picked IR segment #${hit}` : 'Click the model to identify a segment.';
});

// ---- capability badges (Preview: the toolpath's honesty tiers; Prepare: just the material tier) ----
function renderCaps() {
  $('caps').innerHTML = CAP_KEYS.map((k) => {
    const t = confidenceTier(caps[k]);
    return `<span class="gp-badge ${t.cls}" title="${k}: ${t.label}">${k} · ${t.label}</span>`;
  }).join('');
}
function updateCaps() {
  if (mode !== 'prepare') return renderCaps();
  if (modelInfo) {
    const t = confidenceTier(modelInfo.materials);
    $('caps').innerHTML = `<span class="gp-badge ${t.cls}">materials · ${t.label}</span>`;
  } else {
    $('caps').innerHTML = '';
  }
}

// ---- count pill (Preview: segments/layers/time; Prepare: objects/placements) ----
function updateCount() {
  if (mode === 'prepare') {
    if (modelInfo) {
      const oc = modelInfo.objectCount;
      let txt = `${formatCount(oc)} object${oc === 1 ? '' : 's'}`;
      if (modelInfo.instancedCount > oc) txt += ` · ${formatCount(modelInfo.instancedCount)} placements`;
      $('count').hidden = false;
      $('count').textContent = txt;
    } else {
      $('count').hidden = true;
    }
  } else {
    $('count').hidden = !previewCount.has;
    $('count').textContent = previewCount.text;
  }
}

// ---- Prepare rail panel: what the source model exposes ----
function renderModelPanel() {
  const fx = MODEL_FIXTURE_BY_ID[$('fixture').value];
  $('modelBlurb').textContent = fx ? fx.blurb : '';
  if (modelInfo) {
    const tier = confidenceTier(modelInfo.materials);
    $('modelInfo').innerHTML = [
      `<div>objects: ${formatCount(modelInfo.objectCount)}</div>`,
      `<div>placements: ${formatCount(modelInfo.instancedCount)}</div>`,
      `<div>materials: <span class="gp-badge ${tier.cls}">${tier.label}</span></div>`,
      modelInfo.plates ? `<div>plates: ${modelInfo.plates.list.length}</div>` : ''
    ]
      .filter(Boolean)
      .join('');
  } else {
    $('modelInfo').innerHTML = '<p class="gp-reason">Press Load to view a source model.</p>';
  }
}

renderCaps();

// ---- model events (CustomEvent; `ready` detail is a ModelReadyInfo) ----
modelView.addEventListener('ready', (e) => {
  if (typeof window !== 'undefined') window.gcodeModelViewer = modelView; // handle for devtools/inspection
  modelInfo = e.detail;
  renderModelPanel();
  updateCount();
  updateCaps();
});
modelView.addEventListener('error', (e) => {
  $('disclosure').textContent = `Model error: ${e.detail.code} — ${e.detail.message}`;
});

// ---- events from the element (CustomEvent; detail shapes match the adapter contract) ----
view.addEventListener('ready', (e) => {
  if (typeof window !== 'undefined') window.gcodePreview = view; // element handle, for devtools/inspection
  const s = e.detail;
  caps = s.capabilities;
  layers = s.layers;
  segments = s.segments;
  renderCaps();
  refreshModeOptions();

  // read the synchronous state snapshot for the fields `ready` doesn't carry
  const st = view.state;
  // fall back off an unavailable mode
  if (!st.availableColorModes.includes(colorModeId) && colorModeReason(colorModeId, s.capabilities) !== '') {
    colorModeId = 'single';
    $('mode').value = 'single';
  }
  applyColorMode();

  // layer slider
  $('layerField').hidden = layers === 0;
  $('layer').max = String(Math.max(0, layers - 1));
  $('layer').value = $('layer').max;
  $('layerValue').textContent = `${$('layer').value} / ${Math.max(0, layers - 1)}`;

  // feature-role hiding gate
  const featureRolesKnown = caps.featureRoles === 'known' || caps.featureRoles === 'inferred';
  $('hide').disabled = !featureRolesKnown;
  $('hideRow').classList.toggle('gp-disabled', !featureRolesKnown);
  $('hideReason').textContent = featureRolesKnown ? '' : ' — file has no feature roles';

  // retraction gate
  $('retract').disabled = !st.hasRetractions;
  $('retractRow').classList.toggle('gp-disabled', !st.hasRetractions);
  $('retractReason').textContent = st.hasRetractions ? '' : ' — none in this file';

  // count pill
  const timeStr = st.totalTimeMs !== null ? ` · ${formatDuration(st.totalTimeMs)}` : '';
  previewCount = { has: segments > 0, text: `${formatCount(segments)} segments · ${layers} layers${timeStr}` };
  updateCount();

  $('stats').disabled = segments === 0;
});
view.addEventListener('build-complete', readStats);
view.addEventListener('disclosure', (e) => {
  if (e.detail?.text) $('disclosure').textContent = e.detail.text; // WC wraps disclosure as { text }
});
view.addEventListener('parse-error', (e) => {
  $('disclosure').textContent = `Parse error: ${e.detail.code} — ${e.detail.message}`;
});
