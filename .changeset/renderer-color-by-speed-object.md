---
'@chestnutlabs/gcode-renderer-three': minor
---

Two additive color modes (#177, #178) over channels the IR already parses, following the DD-009
capability-gated `colors.ts` pattern:

- **color-by-speed** (`{ mode: 'feedrate'; ramp; range?; fallback }`, #177): maps each segment's
  `feedrate` onto a color ramp — auto-ranged from the IR (pass `range` to keep the scale stable across
  files). NaN feedrate (before the first `F`) → fallback. Exposes `feedrateRange(ir)`. Gated on the
  `feedrate` capability.
- **color-by-object** (`{ mode: 'object'; palette; fallback; only? }`, #178): shades by `seg.object`
  (1-based; 0 = none → fallback) from the E4 `M486`/`EXCLUDE_OBJECT` work; `only` isolates one object
  (others dimmed to fallback). Gated on the `objects` capability.

Both degrade honestly to the fallback rather than fabricating a color, and are reachable through the
existing `colorMode` prop on every adapter with no API change.
