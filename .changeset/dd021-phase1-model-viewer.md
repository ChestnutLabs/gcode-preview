---
'@chestnutlabs/gcode-model-renderer': minor
---

feat(model-renderer): add `createModelViewer` — the interactive source-model viewer (DD-021 Phase 1)

Adds `createModelViewer(canvas, options?)` → `ModelViewer`, the **interactive** analogue of
`renderModelStill`: orbit / zoom / pan a source model (STL / 3MF, including production `paint_color`
multicolor) in the browser. It composes the pieces that already exist rather than duplicating a renderer —
the shared `InteractiveStage` (GL + dual camera + orbit/zoom/pan + context-loss recovery + DD-020
interaction quality) from `@chestnutlabs/gcode-renderer-three`, the shared `ModelContent` scene core, and
the open-`kind` loader registry.

Handle: `setSource` (async parse→build→frame, last-wins on overlap), `setView`, `get/setCameraState`,
`setBackground`, `setInteractionQuality`, `resize`, `frame`, `onEvent`, `dispose`. Events: `ready`
(`objectCount` / `materials` tier / `bounds`), `camera-changed`, `error` (structured code — e.g.
`E_MODEL_UNSUPPORTED_KIND`), `renderer-unsupported` (WebGL missing → the consumer can fall back to a
`renderModelStill` image), and `context-lost` / `context-restored`.

Capability honesty is passed through from the parsed `ModelScene`, never recomputed (neutral render +
`materials:'unavailable'` when the source carries no colour). It is a **distinct surface** from
`ToolpathRenderer` / `<GcodePreview>` — no toolpath concepts (layers/travel/scrub/IR). `renderModelStill`
is unchanged. New source formats become viewable by registering a `ModelLoader`, with no change to the
`ModelViewer` / `createModelViewer` signatures.
