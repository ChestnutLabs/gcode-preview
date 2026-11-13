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

In an app, you usually reach this view through the controller, which keeps the bundle three-free (about 35 KB at
startup) and loads the 3D renderer only if a 3D view binds:

```ts
import { createPreviewController } from '@chestnutlabs/gcode-preview-core';

const preview = createPreviewController({ renderer: { mode: '2d' } });
```

On the components it is `renderer="2d"`. To drive the view yourself:

```ts
import { LayerView2D } from '@chestnutlabs/gcode-renderer-2d';

const view = new LayerView2D(canvas, { colorMode: { mode: 'feature', palette, fallback: [0.7, 0.7, 0.7] } });
view.setToolpath(ir); // a ToolpathIR from the worker parser
view.setLayer(12);
view.render(); // clears + redraws the active layer
```

The constructor and `setColorMode` throw a `RangeError` for a colour mode whose options have no
meaning (for example an inverted `range`), and the previous mode stays in effect. To validate a mode
built from user input first, call `checkColorMode(mode)`, re-exported here from
[`@chestnutlabs/gcode-colors`](../gcode-colors/README.md).

`setLayer(n)` floors a fractional index, and an index past the last layer (`Infinity` included) shows
the top layer, so "show everything" never blanks the view. `NaN` is ignored. The constructor also
throws a `RangeError` for `adjacentLayers: NaN`, a `ghostOpacity` outside `[0, 1]`, a `lineWidth`
that isn't a finite number above 0, or a `padding` that isn't a finite number of at least 0.
`setAdjacentLayers(NaN)` throws too. A negative `adjacentLayers` still draws no ghost layers.

CNC and laser files draw too: their Cut moves (the tool engaged in the material) are drawn with the
extrusion, in file order, coloured by the same colour mode. `cut: false` in the options, or `setCut(false)`,
hides them, and the draw result counts them in `cutDrawn`. A move that is both an extrusion and a cut
counts once, as an extrusion. On `GcodePreview` with `renderer="2d"`, the `'cut'` move-kind toggle
(`showCut` on the framework components, `show-cut` on `<gcode-preview>`) maps to `setCut`.

The drawing core is also exposed as pure functions — `drawLayer(ctx, ir, opts)`, `computeLayerFit`,
`layerBounds2D`, `rgbToCss` — which take a minimal Canvas-2D-context interface and are fully
testable in Node with a recording mock.

## Honesty

A flat per-layer 2D view cannot represent non-XY/CNC toolpaths or 3D-only options. A missing or
out-of-range layer passed to `drawLayer`/`drawLayers` draws nothing and reports `drawn: false` rather
than fabricating geometry.
A segment with an `Infinity` or `NaN` X/Y coordinate (possible in a toolpath you build yourself) is
skipped: it is not drawn, it does not affect the view frame, and the draw result counts it in
`skippedNonFinite`, for the layers it drew. `summarize2DDrawable(ir)` gives the count for the whole toolpath.
`GcodePreview` with `renderer="2d"` and the framework adapters report that whole-toolpath count in their
`disclosure` text, for example `3 segments with a non-finite coordinate were not drawn.` Color modes that read an optional IR channel (`feature`, `object`, `feedrate`) must be
capability-gated by the caller. The full capability-honesty UX for non-XY / `layers: unavailable`
inputs arrives with the phase-4 work (#215).

## License

MIT © Chestnut Labs. See the [repository](https://github.com/ChestnutLabs/gcode-preview) for provenance and the full support policy.
