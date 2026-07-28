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
