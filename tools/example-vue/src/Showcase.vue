<!--
  Full showcase example (DD-031 §4.7, tier 2).

  Demonstrates BOTH halves of the SDK in one app, like a slicer's two modes:
   - Preview  → sliced G-code / toolpath via <GcodePreview> (@chestnutlabs/gcode-preview-vue)
   - Prepare  → source model (STL / 3MF) via <ModelViewer> (@chestnutlabs/gcode-preview-vue/model)

  Both are the real published adapters (no raw renderer) and mirror the Feature Lab's capability-aware,
  honest UX in Vue idiom: toolpath color modes gate on the file's capabilities with a plain-language
  reason, feature-role hiding is a declarative binding, and diagnostics/picking come through the
  component ref's handle (`viewer.preview.controls`); the model side surfaces the material-colour
  capability tier and object/instance counts (`modelViewer.viewer`). Chrome (light/dark) is separate
  from the renderer's neutral viewport. Styling is the shared workspace-internal demo-kit — not a
  published UI kit and not a library default. Still the real package: no raw renderer imports.
-->
<script setup>
import { computed, ref, watchEffect } from 'vue';
import { GcodePreview } from '@chestnutlabs/gcode-preview-vue';
import { ModelViewer } from '@chestnutlabs/gcode-preview-vue/model';
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

const ADHESION_ROLES = [FeatureRole.Skirt, FeatureRole.Brim];
const CAM_VIEWS = [
  ['iso', 'Iso'],
  ['top', 'Top'],
  ['front', 'Front']
];
const CAP_KEYS = ['featureRoles', 'objects', 'feedrate', 'colorChanges'];

const viewer = ref(null); // toolpath handle (exposes { preview })
const modelViewer = ref(null); // model handle (exposes { viewer })
const chrome = ref('dark');
const mode = ref('preview'); // 'preview' (toolpath) | 'prepare' (model)
const view = ref('iso');

// Preview (toolpath) state
const fixtureId = ref('skirt-brim');
const source = ref(null);

// Reactive UI state, mirrored from the component's events (parallel to the other adapters' showcases;
// note that Vue's `viewer.preview.state` is itself reactive, so binding to it directly also works).
const caps = ref({});
const layers = ref(0);
const segments = ref(0);
const topLayer = ref(0);
const disclosure = ref('');
const hasRetractions = ref(false);
const time = ref({ ms: null, src: null });
const stats = ref(null);
const picked = ref(null);

// Declarative control state.
const colorModeId = ref('feature');
const hideAdhesion = ref(false);
const showTravel = ref(false);
const showRetractions = ref(false);

// Prepare (model) state
const modelFixtureId = ref('colored-3mf');
const modelSource = ref(null);
const modelInfo = ref(null);

watchEffect(() => {
  document.documentElement.dataset.chrome = chrome.value;
});

const prepare = computed(() => mode.value === 'prepare');
const colorModeItem = computed(() => COLOR_MODE_BY_ID[colorModeId.value]);
const modeReason = computed(() => colorModeReason(colorModeId.value, caps.value));
const colorMode = computed(() => (modeReason.value === '' ? colorModeItem.value.build() : undefined));
const legend = computed(() => colorModeItem.value.legend ?? null);
const featureRolesKnown = computed(() => caps.value.featureRoles === 'known' || caps.value.featureRoles === 'inferred');
const hiddenRoles = computed(() => (hideAdhesion.value ? ADHESION_ROLES : undefined));
const fixture = computed(() => FIXTURE_BY_ID[fixtureId.value]);
const modelFixture = computed(() => MODEL_FIXTURE_BY_ID[modelFixtureId.value]);

async function load(id) {
  const fx = FIXTURE_BY_ID[id ?? fixtureId.value];
  if (!fx) return;
  fixtureId.value = fx.id;
  const res = await fetch(`./${fx.path}`);
  source.value = new Uint8Array(await res.arrayBuffer());
  stats.value = null;
  picked.value = null;
}

function loadModel(id) {
  const fx = MODEL_FIXTURE_BY_ID[id ?? modelFixtureId.value];
  if (!fx) return;
  modelFixtureId.value = fx.id;
  modelSource.value = fx.source(); // { kind, bytes } — no fetch, synthetic MIT-clean fixture
  modelInfo.value = null;
}

function onReady(summary) {
  caps.value = summary.capabilities;
  layers.value = summary.layers;
  segments.value = summary.segments;
  topLayer.value = Math.max(0, summary.layers - 1);
  if (typeof window !== 'undefined') window.gcodePreview = viewer.value?.preview; // for devtools/inspection
  const st = viewer.value?.preview?.state;
  if (st) {
    hasRetractions.value = st.hasRetractions;
    time.value = { ms: st.totalTimeMs, src: st.timeEstimateSource };
    if (!st.availableColorModes.includes(colorModeId.value) && colorModeReason(colorModeId.value, summary.capabilities) !== '') {
      colorModeId.value = 'single';
    }
  }
}

function onModelReady(info) {
  modelInfo.value = info;
}

function refreshStats() {
  stats.value = viewer.value?.preview?.controls.getRenderStats() ?? null;
}

function onCanvasClick(e) {
  if (prepare.value) return;
  const c = e.currentTarget.querySelector('canvas');
  if (!c || layers.value === 0) return;
  const r = c.getBoundingClientRect();
  const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
  // pickSegment returns the IR segment index, or null if the ray missed.
  picked.value = viewer.value?.preview?.controls.pickSegment(ndcX, ndcY) ?? null;
}

function modeDisabled(id) {
  return colorModeReason(id, caps.value) !== '';
}
</script>

<template>
  <header class="sc-header">
    <div class="sc-brand">
      <span class="gp-title">G-code Preview · Vue</span>
      <span class="gp-eyebrow">Showcase</span>
    </div>
    <!-- Preview (toolpath) vs Prepare (source model) — the two halves of the SDK. -->
    <div class="gp-segment" role="group" aria-label="Workflow">
      <button :class="!prepare ? 'gp-on' : ''" @click="mode = 'preview'">Preview</button>
      <button :class="prepare ? 'gp-on' : ''" @click="mode = 'prepare'">Prepare</button>
    </div>
    <select
      v-if="!prepare"
      class="gp-input"
      style="width: 220px"
      :value="fixtureId"
      @change="load($event.target.value)"
    >
      <optgroup v-for="g in FIXTURE_GROUPS" :key="g.group" :label="g.group">
        <option v-for="i in g.items" :key="i.id" :value="i.id">{{ i.label }}</option>
      </optgroup>
    </select>
    <select v-else class="gp-input" style="width: 220px" :value="modelFixtureId" @change="loadModel($event.target.value)">
      <option v-for="m in MODEL_FIXTURES" :key="m.id" :value="m.id">{{ m.label }}</option>
    </select>
    <button class="gp-btn gp-primary" @click="prepare ? loadModel() : load()">Load</button>
    <div class="sc-spacer" />
    <div class="gp-segment" role="group" aria-label="Chrome theme">
      <button :class="chrome === 'dark' ? 'gp-on' : ''" @click="chrome = 'dark'">Dark</button>
      <button :class="chrome === 'light' ? 'gp-on' : ''" @click="chrome = 'light'">Light</button>
    </div>
  </header>

  <div class="sc-main">
    <div class="sc-viewport" @click="onCanvasClick">
      <GcodePreview
        v-if="!prepare"
        ref="viewer"
        :source="source"
        :color-mode="colorMode"
        :layer-range="layers > 0 ? [0, topLayer] : null"
        :hidden-feature-roles="hiddenRoles"
        :show-travel="showTravel"
        :show-retractions="showRetractions"
        :view="view"
        frame-content="object"
        quality="auto"
        @ready="onReady"
        @build-complete="refreshStats"
        @disclosure="disclosure = $event ?? ''"
        @parse-error="disclosure = `Parse error: ${$event.code} — ${$event.message}`"
      />
      <ModelViewer
        v-else
        ref="modelViewer"
        :source="modelSource"
        :view="view"
        background="transparent"
        @ready="onModelReady"
        @error="disclosure = `Model error: ${$event.code} — ${$event.message}`"
      />

      <div v-if="!prepare && legend" class="sc-legend-card">
        <span class="gp-eyebrow">{{ colorModeItem.label }}</span>
        <div class="gp-legend">
          <span v-for="[label, rgb] in legend" :key="label" class="gp-legend-item">
            <span class="gp-swatch" :style="{ background: rgbCss(rgb) }" />
            {{ label }}
          </span>
        </div>
      </div>
      <div class="sc-cam">
        <button
          v-for="[v, label] in CAM_VIEWS"
          :key="v"
          class="gp-icon-btn"
          :class="view === v ? 'gp-on' : ''"
          :title="`${label} view`"
          @click="view = v"
        >
          {{ label[0] }}
        </button>
      </div>
      <div v-if="!prepare && segments > 0" class="sc-count">
        {{ formatCount(segments) }} segments · {{ layers }} layers
        <template v-if="time.ms !== null"> · {{ formatDuration(time.ms) }}</template>
      </div>
      <div v-if="prepare && modelInfo" class="sc-count">
        {{ formatCount(modelInfo.objectCount) }} object{{ modelInfo.objectCount === 1 ? '' : 's' }}
        <template v-if="modelInfo.instancedCount > modelInfo.objectCount">
          · {{ formatCount(modelInfo.instancedCount) }} placements
        </template>
      </div>
    </div>

    <aside class="sc-rail">
      <div class="gp-scroll">
        <template v-if="!prepare">
          <section class="gp-panel">
            <h3>Appearance</h3>
            <div class="gp-field">
              <label for="mode">Color by</label>
              <select id="mode" class="gp-input" v-model="colorModeId">
                <option v-for="m in COLOR_MODES" :key="m.id" :value="m.id" :disabled="modeDisabled(m.id)">
                  {{ m.label }}{{ modeDisabled(m.id) ? ' — unavailable' : '' }}
                </option>
              </select>
              <span v-if="modeReason !== ''" class="gp-reason">{{ modeReason }}</span>
            </div>
          </section>

          <section class="gp-panel">
            <h3>Filter</h3>
            <div v-if="layers > 0" class="gp-field">
              <label>Top layer <span class="gp-value">{{ topLayer }} / {{ Math.max(0, layers - 1) }}</span></label>
              <input class="gp-range" type="range" :min="0" :max="Math.max(0, layers - 1)" v-model.number="topLayer" />
            </div>
            <label class="gp-toggle" :class="featureRolesKnown ? '' : 'gp-disabled'">
              <span>
                Hide skirt &amp; brim
                <span v-if="!featureRolesKnown" class="gp-reason"> — file has no feature roles</span>
              </span>
              <input type="checkbox" v-model="hideAdhesion" :disabled="!featureRolesKnown" />
            </label>
            <label class="gp-toggle">
              <span>Show travel moves</span>
              <input type="checkbox" v-model="showTravel" />
            </label>
            <label class="gp-toggle" :class="hasRetractions ? '' : 'gp-disabled'">
              <span>
                Show retractions
                <span v-if="!hasRetractions" class="gp-reason"> — none in this file</span>
              </span>
              <input type="checkbox" v-model="showRetractions" :disabled="!hasRetractions" />
            </label>
          </section>

          <section class="gp-panel">
            <h3>Diagnostics</h3>
            <button class="gp-btn" @click="refreshStats" :disabled="segments === 0">Read render stats</button>
            <div v-if="stats" class="gp-mono" style="margin-top: var(--gp-space-3)">
              <div>backend: {{ stats.backend }} ({{ stats.capability }})</div>
              <div>geometry: {{ stats.geometryMode }}</div>
              <div>segments: {{ formatCount(stats.renderedSegmentCount ?? 0) }}</div>
              <div>draw calls: {{ stats.drawCalls ?? '—' }}</div>
              <div v-if="stats.gpuRenderer" style="color: var(--gp-text-faint)">{{ stats.gpuRenderer }}</div>
            </div>
            <p v-if="picked !== null" class="gp-reason" style="margin-top: var(--gp-space-2)">
              Picked IR segment #{{ picked }}
            </p>
            <p v-else-if="segments > 0" class="gp-reason" style="margin-top: var(--gp-space-2)">
              Click the model to identify a segment.
            </p>
          </section>
        </template>

        <section v-else class="gp-panel">
          <h3>Source model</h3>
          <p class="gp-reason" style="margin-bottom: var(--gp-space-3)">{{ modelFixture ? modelFixture.blurb : '' }}</p>
          <div v-if="modelInfo" class="gp-mono">
            <div>objects: {{ formatCount(modelInfo.objectCount) }}</div>
            <div>placements: {{ formatCount(modelInfo.instancedCount) }}</div>
            <div>
              materials:
              <span class="gp-badge" :class="confidenceTier(modelInfo.materials).cls">
                {{ confidenceTier(modelInfo.materials).label }}
              </span>
            </div>
            <div v-if="modelInfo.plates">plates: {{ modelInfo.plates.list.length }}</div>
          </div>
          <p v-else class="gp-reason">Press Load to view a source model.</p>
        </section>
      </div>
    </aside>
  </div>

  <footer class="sc-status">
    <div class="sc-caps">
      <template v-if="!prepare">
        <span
          v-for="k in CAP_KEYS"
          :key="k"
          class="gp-badge"
          :class="confidenceTier(caps[k]).cls"
          :title="`${k}: ${confidenceTier(caps[k]).label}`"
        >
          {{ k }} · {{ confidenceTier(caps[k]).label }}
        </span>
      </template>
      <span v-else-if="modelInfo" class="gp-badge" :class="confidenceTier(modelInfo.materials).cls">
        materials · {{ confidenceTier(modelInfo.materials).label }}
      </span>
    </div>
    <div class="sc-spacer" />
    <span>{{
      disclosure ||
      (prepare
        ? 'Prepare: view the source model before slicing.'
        : fixture
          ? fixture.blurb
          : 'Pick a fixture to begin.')
    }}</span>
  </footer>
</template>
