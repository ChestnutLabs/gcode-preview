# @chestnutlabs/gcode-colors

Renderer-agnostic **per-segment color model** for the [Chestnut Labs G-code Preview](https://github.com/ChestnutLabs/gcode-preview) toolpath stack (DD-014 D3).

This package is the single home for the toolpath **color subsystem**: the `ColorMode` union and an
honest, capability-gated mapping from a `ToolpathIR` segment to an `RGB` triple. Both the Three.js
renderer (`@chestnutlabs/gcode-renderer-three`) and the low-resource 2D renderer
(`@chestnutlabs/gcode-renderer-2d`) depend on it, so color and move-kind semantics never drift
between them.

It depends only on `@chestnutlabs/toolpath-core` — **no `three`, no canvas, no framework**.

## Color modes

| Mode | Channel | Honest fallback |
|---|---|---|
| `single` | — | n/a (one color) |
| `tool` | `segments.tool` | `fallback` when no palette |
| `feature` | `segments.feature` (0 = unknown) | `fallback` for unknown / no palette |
| `colorChange` | `colorChanges[]` swap slot (M600, #147) | `fallback` when no changes / no palette |
| `feedrate` | `segments.feedrate` (mm/min; NaN = unknown, #177) | `fallback` for NaN |
| `object` | `segments.object` (1-based; 0 = none, #178) | `fallback` for none / non-`only` |

Every mode degrades to its `fallback` for unknown channel values — it never fabricates a
role/speed/object color. Modes that read an optional channel (`feature`, `object`, `feedrate`) must
be **capability-gated by the caller** before use.

Values that come from the file never throw: a NaN, infinite, or negative feedrate or tool power is
left out of the auto-range and drawn in `fallback`. Options you pass do throw a `RangeError` when they
have no meaning: a `range` that is not two finite numbers `>= 0` in ascending order, or an object
`only` that is not a 1-based integer. For a reversed scale, reverse the `ramp`, not the `range`. A
point range such as `[1500, 1500]` is valid and paints every segment the ramp's first colour. Call
`checkColorMode(mode)` to validate a mode up front, before you store it.

### Colours that throw

Every colour in a mode is checked: `single.color`, each `palette` and `ramp` entry, `moveKind` `cut`
and `travel`, and `fallback`. A colour is an array-like (a plain array, a tuple or a `Float32Array`)
whose first three entries are finite numbers. Extra entries such as an alpha are ignored. Any finite
value is accepted, so a 0-255 colour still draws (over-bright). `NaN`, `±Infinity`, fewer than three
entries or a non-array throw a `RangeError` that names the mode, the field and the index:

```text
tool color mode palette[2] must be [r, g, b] of three finite numbers, got [0.1, NaN, 0.3]
```

| Mode | Must carry |
| --- | --- |
| `tool`, `feature`, `colorChange`, `object` | a `palette` array (it may be empty: every segment then draws in `fallback`) |
| `feedrate`, `layerHeight`, `power` | a `ramp` array (it may be empty) |
| `moveKind` | `cut` and `travel` |
| every mode except `single`, `tool` and `filament` | a `fallback` |

`createSegmentColorer`, `segmentColor`, the Canvas 2D renderer and the preview controller all run this
check, so a bad mode throws when you set it and the previous mode stays in effect.

## Usage

```ts
import { createSegmentColorer } from '@chestnutlabs/gcode-colors';

// Build a colorer once (feedrate auto-range is resolved here), then O(1) per segment.
const colorOf = createSegmentColorer(ir, { mode: 'feedrate', ramp: [[0, 0, 1], [1, 0, 0]], fallback: [0.7, 0.7, 0.7] });
for (let i = 0; i < ir.segments.count; i++) {
  const [r, g, b] = colorOf(i);
  // …map onto your surface (WebGL vertex buffer, Canvas 2D strokeStyle, …)
}
```

## License

MIT © Chestnut Labs. See the [repository](https://github.com/ChestnutLabs/gcode-preview) for provenance and the full support policy.
