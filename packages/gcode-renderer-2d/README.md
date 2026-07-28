# @chestnutlabs/gcode-renderer-2d

Low-resource **Canvas 2D layer renderer** for the [Chestnut Labs G-code Preview](https://github.com/ChestnutLabs/gcode-preview) toolpath stack (DD-014 / Epic E8).

An **opt-in** current/adjacent-layer 2D view over the existing `ToolpathIR`, for contexts where the
default Three.js renderer is a poor fit: old / low-end mobile, embedded printer touchscreens
(Fluidd/Mainsail-class UIs), and locked-down or WebGL-blocked browsers. One parse, one IR, a second
lightweight view — **no second parser path, no `three`, no framework**. Per-segment color is
single-sourced with the 3D renderer via `@chestnutlabs/gcode-colors`, so the two never disagree.

The memory ceiling is the point: drawing is bounded to the active (± adjacent, later phases) layer,
never the whole model.

> **Status:** E8 phases 1–3 done. Phase 1 (#212): the Canvas 2D core — draw one layer from the IR,
> honest color, fit-to-canvas. Phase 2 (#213): current-layer **+ adjacent "ghost" layers** (dimmed
> preceding layers, `adjacentLayers` default 1 / floor 0) over one stable model frame. Phase 3 (#214):
> selectable from the viewer via **`<GcodePreview renderer="2d" />`** (the 3D renderer is loaded on
> demand, so a 2D-only bundle never ships Three.js), plus a **live-progress "completed cut"**
> (`setProgress`). Still ahead: the low-resource benchmark + capability-honesty UX (#215).

## Usage

```ts
import { LayerView2D } from '@chestnutlabs/gcode-renderer-2d';

const view = new LayerView2D(canvas, { colorMode: { mode: 'feature', palette, fallback: [0.7, 0.7, 0.7] } });
view.setToolpath(ir); // a ToolpathIR from the worker parser
view.setLayer(12);
view.render(); // clears + redraws the active layer
```

The drawing core is also exposed as pure functions — `drawLayer(ctx, ir, opts)`, `computeLayerFit`,
`layerBounds2D`, `rgbToCss` — which take a minimal Canvas-2D-context interface and are fully
testable in Node with a recording mock.

## Honesty

A flat per-layer 2D view cannot represent non-XY/CNC toolpaths or 3D-only options. A missing or
out-of-range layer draws nothing and reports `drawn: false` rather than fabricating geometry.
Color modes that read an optional IR channel (`feature`, `object`, `feedrate`) must be
capability-gated by the caller. The full capability-honesty UX for non-XY / `layers: unavailable`
inputs arrives with the phase-4 work (#215).

## License

MIT © Chestnut Labs. See the [repository](https://github.com/ChestnutLabs/gcode-preview) for provenance and the full support policy.
