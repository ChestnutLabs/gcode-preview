<!--
  Minimal getting-started example (DD-031 §4.7, tier 1).

  The smallest real integration of @chestnutlabs/gcode-preview-vue: bind `:source` (bytes/File)
  and <GcodePreview> parses + renders. Everything else — the fixture picker and layer slider — is
  ordinary Vue reactive state driving declarative props/bindings. No design system, no demo-kit, no
  raw renderer. Copy this component to start.
-->
<script setup>
import { ref } from 'vue';
import { GcodePreview } from '@chestnutlabs/gcode-preview-vue';

const FIXTURES = ['3DBenchy.gcode', 'calicat.gcode', 'vase.gcode', 'mach3.gcode'];

const source = ref(null);
const layers = ref(0);
const topLayer = ref(0);

async function load(event) {
  const name = event.target.value;
  if (!name) return;
  const res = await fetch(`./gcodes/${name}`);
  source.value = new Uint8Array(await res.arrayBuffer()); // new source → re-parse
}

function onReady(summary) {
  layers.value = summary.layers;
  topLayer.value = Math.max(0, summary.layers - 1);
}
</script>

<template>
  <header>
    <strong>gcode-preview-vue · minimal</strong>
    <select @change="load">
      <option value="" selected disabled>Load a fixture…</option>
      <option v-for="f in FIXTURES" :key="f" :value="f">{{ f }}</option>
    </select>
    <label v-if="layers > 0">
      Layer {{ topLayer }} / {{ layers - 1 }}
      <input type="range" :min="0" :max="layers - 1" v-model.number="topLayer" />
    </label>
  </header>
  <main>
    <GcodePreview
      :source="source"
      :layer-range="layers > 0 ? [0, topLayer] : null"
      :show-travel="false"
      :theme="{ background: '#6d7176' }"
      @ready="onReady"
    />
  </main>
</template>
