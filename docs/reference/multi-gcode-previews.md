# Multiple G-code Previews (compare / overlay / multi-job)

**Status:** Supported workaround (DD-009 §4.6 **D6**, E9 · #151). The single-scene multi-model
renderer (D6 **Option A**) is **deferred** pending real demand — see [When the single-scene
renderer is revisited](#when-the-single-scene-renderer-is-revisited).

To show more than one G-code file at once — a before/after compare, a variant grid, a
multi-job dashboard — **mount one preview instance per file**. Each `<GcodePreview>` component
(or each `createPreviewController()`) is a complete, independent viewer: its own worker parse,
`ToolpathIR`, Three.js scene, camera, and build plate. Lay them out with plain DOM (flex/grid),
one canvas each. This works today with the shipped `v0.1.0` surface — no new API.

## Pattern

### Vue

```vue
<script setup lang="ts">
import { GcodePreview } from '@chestnutlabs/gcode-preview-vue';
import { shallowRef } from 'vue';

const left = shallowRef<File | null>(null);
const right = shallowRef<File | null>(null);
</script>

<template>
  <div style="display: flex; gap: 1rem">
    <div style="flex: 1; height: 60vh"><GcodePreview :source="left" /></div>
    <div style="flex: 1; height: 60vh"><GcodePreview :source="right" /></div>
  </div>
</template>
```

### React

```tsx
import { GcodePreview } from '@chestnutlabs/gcode-preview-react';

function Compare({ a, b }: { a: File | null; b: File | null }) {
  return (
    <div style={{ display: 'flex', gap: '1rem' }}>
      <div style={{ flex: 1, height: '60vh' }}><GcodePreview source={a} /></div>
      <div style={{ flex: 1, height: '60vh' }}><GcodePreview source={b} /></div>
    </div>
  );
}
```

### Svelte

```svelte
<script>
  import GcodePreview from '@chestnutlabs/gcode-preview-svelte/GcodePreview.svelte';
  export let a = null;
  export let b = null;
</script>

<div style="display: flex; gap: 1rem">
  <div style="flex: 1; height: 60vh"><GcodePreview source={a} /></div>
  <div style="flex: 1; height: 60vh"><GcodePreview source={b} /></div>
</div>
```

Each instance takes the full defaulted prop surface independently (`quality`, `colorMode`,
`cameraMode`, `layerRange`, `scrub`, `progress`, …) and emits its own events — so one pane can color
by-tool while another scrubs, or each can track a different live job.

### Core controller (framework-neutral)

One controller per file, one canvas each. Controls and progress are **per controller**:

```ts
import { createPreviewController } from '@chestnutlabs/gcode-preview-core';

// one independent viewer per G-code file
const previews = files.map((bytes, i) => {
  const preview = createPreviewController();
  preview.bindCanvas(canvases[i]); // each owns its renderer + GL context
  void preview.parse(bytes); // each runs its own worker parse
  return preview;
});

// there is no shared timeline — fan a control out yourself to keep panes in step
for (const p of previews) p.controls.setLayerRange(0, 42);

// dispose every controller when done (each holds a worker + WebGL context)
for (const p of previews) p.dispose();
```

## Limitations

Because each preview is a **separate renderer**, this composition is deliberately shallow:

- **Separate scenes, cameras, and beds.** Every instance has its own camera and orbit controls;
  orbiting one pane does not move the others. There is no shared camera or synchronized view.
- **No shared coordinate frame.** Models are not placed in one world space — you cannot overlay
  them in a single 3D view, align them, or lay them out on one common bed. The composition is
  DOM-level (side-by-side / stacked), not scene-level.
- **No unified scrub or layer clip.** `layerRange`, `scrub`, and DD-006 live progress are
  per-instance state. "Scrub all panes to layer N" means driving the control on each instance
  yourself; there is no single timeline and no combined progress overlay.
- **Memory and GPU scale with model count.** Each instance holds its own IR buffers, geometry,
  worker, and live WebGL context. N models ≈ N× the memory and N simultaneous contexts — and
  browsers cap concurrent WebGL contexts (commonly ~8–16), a practical ceiling on how many you
  can mount. Unmount / `dispose()` instances you are no longer showing.

If you need a **true single-scene** experience — one camera, one bed, models sharing a coordinate
frame, one scrub timeline — the mount-multiple pattern is not it; that is the deferred Option A
below.

## When the single-scene renderer is revisited

DD-009 §4.6 also specified **Option A**, a single-scene multi-model renderer: `gcode-renderer-three`
would accept an array of `{ ir, transform?, colorOverride? }` and manage per-model geometry groups
under **one** camera and bed, with layer/scrub applying per-model or globally. That path is
**deferred**, not rejected — it is the one E9 item with a genuinely large blast radius on DD-004
(draw-range, bounds framing, and the progress overlay all become per-model).

It is revisited **on real demand**, via a follow-up DD, when the mount-multiple workaround
provably cannot serve a concrete need — for example a shared coordinate frame for true
overlay/alignment, a unified scrub timeline across models, or more models on one bed than the
per-instance WebGL-context ceiling allows. That DD would pin the open questions Option A leaves
(per-model vs. global layer/scrub semantics, and the multi-model memory budget) rather than
resolving them ad-hoc.

Until then, mount multiple previews.

**Related:** [DD-009 §4.6](../design/DD-009-toolpath-annotations-and-renderer-options.md) (D6) ·
adapter READMEs (`packages/gcode-preview-{vue,react,svelte}`) ·
[`gcode-preview-core`](../../packages/gcode-preview-core/README.md) controller.
