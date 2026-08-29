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
import '../../demo-kit/tokens.css';

const ADHESION_ROLES = [FeatureRole.Skirt, FeatureRole.Brim];
const CAP_KEYS = ['featureRoles', 'objects', 'feedrate', 'colorChanges'];
const $ = (id) => document.getElementById(id);

const view = $('view');
let caps = {};
let layers = 0;
let segments = 0;
let colorModeId = 'feature';

// ---- populate the pickers from the shared demo-kit ----
$('fixture').innerHTML = FIXTURE_GROUPS.map(
  (g) => `<optgroup label="${g.group}">${g.items.map((i) => `<option value="${i.id}">${i.label}</option>`).join('')}</optgroup>`
).join('');
$('fixture').value = 'skirt-brim';

$('mode').innerHTML = COLOR_MODES.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
$('mode').value = colorModeId;

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
  const fx = FIXTURE_BY_ID[$('fixture').value];
  if (!fx) return;
  const res = await fetch(`./${fx.path}`);
  view.source = new Uint8Array(await res.arrayBuffer()); // property (object)
  $('statsOut').textContent = '';
  $('pickOut').textContent = '';
  $('disclosure').textContent = fx.blurb;
}
$('load').addEventListener('click', load);
$('fixture').addEventListener('change', load);

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
      .map(([label, rgb]) => `<span class="gp-legend-item"><span class="gp-swatch" style="background:${rgbCss(rgb)}"></span>${label}</span>`)
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

// ---- camera ----
for (const btn of document.querySelectorAll('.sc-cam button')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sc-cam button').forEach((b) => b.classList.remove('gp-on'));
    btn.classList.add('gp-on');
    view.setAttribute('view', btn.dataset.view); // primitive → attribute
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
  const c = view.querySelector('canvas') ?? view.shadowRoot?.querySelector('canvas');
  if (!c || layers === 0) return;
  const r = c.getBoundingClientRect();
  const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
  // pickSegment returns the IR segment index, or null if the ray missed.
  const hit = view.controls.pickSegment(ndcX, ndcY);
  $('pickOut').textContent = hit !== null ? `Picked IR segment #${hit}` : 'Click the model to identify a segment.';
});

// ---- capability badges ----
function renderCaps() {
  $('caps').innerHTML = CAP_KEYS.map((k) => {
    const t = confidenceTier(caps[k]);
    return `<span class="gp-badge ${t.cls}" title="${k}: ${t.label}">${k} · ${t.label}</span>`;
  }).join('');
}
renderCaps();

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
  $('count').hidden = segments === 0;
  $('count').textContent = `${formatCount(segments)} segments · ${layers} layers${timeStr}`;

  $('stats').disabled = segments === 0;
});
view.addEventListener('build-complete', readStats);
view.addEventListener('disclosure', (e) => {
  if (e.detail?.text) $('disclosure').textContent = e.detail.text; // WC wraps disclosure as { text }
});
view.addEventListener('parse-error', (e) => {
  $('disclosure').textContent = `Parse error: ${e.detail.code} — ${e.detail.message}`;
});
