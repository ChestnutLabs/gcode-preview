<!--
  Minimal source-model viewer (DD-031 §4.7, tier 1 — Prepare side).

  The smallest real integration of @chestnutlabs/gcode-preview-vue/model: bind `:source`
  ({ kind, bytes } — an STL or 3MF) and <ModelViewer> parses + renders. The counterpart to
  Minimal.vue, which does the same for sliced G-code with <GcodePreview>. No design system, no
  demo-kit engine handles — just the published adapter. (The fixtures here are synthetic MIT-clean
  sample models.)
-->
<script setup>
import { ref } from 'vue';
import { ModelViewer } from '@chestnutlabs/gcode-preview-vue/model';
import { MODEL_FIXTURES, MODEL_FIXTURE_BY_ID } from '../../demo-kit/index.js';

const source = ref(null);
const info = ref(null);

function load(event) {
  const fx = MODEL_FIXTURE_BY_ID[event.target.value];
  if (fx) source.value = fx.source(); // { kind, bytes } → ModelViewer parses + renders
}
</script>

<template>
  <header>
    <strong>gcode-preview-vue · minimal model viewer</strong>
    <select @change="load">
      <option value="" selected disabled>Load a model…</option>
      <option v-for="m in MODEL_FIXTURES" :key="m.id" :value="m.id">{{ m.label }}</option>
    </select>
    <span v-if="info" style="font-size: 0.85rem; color: #9fb0c0">
      {{ info.objectCount }} object{{ info.objectCount === 1 ? '' : 's' }} · materials: {{ info.materials }}
    </span>
  </header>
  <main>
    <ModelViewer :source="source" background="#6d7176" @ready="info = $event" />
  </main>
</template>
