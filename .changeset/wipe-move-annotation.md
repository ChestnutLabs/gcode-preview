---
'@chestnutlabs/gcode-parser': minor
'@chestnutlabs/gcode-dialects': minor
---

Populate the `MoveKind.Wipe` bit from slicer wipe brackets (DD-016 phase 1, #182).

The `Wipe`/`Seam` kind bits were reserved but never set. Wipe's only reliable signal is a
slicer comment (`;WIPE_START`/`;WIPE_END`), which the DD-005 sink invariant bars the annotation
layer from turning into `kind`. DD-016 resolves this with a **narrow, additive** sink amendment:

- `AnnotationSink.addMoveKind(segStart, segEnd, kindBits)` — allow-listed to `Wipe`/`Seam` only,
  additive (ORs the bit, never clears or reclassifies a move); non-allow-listed bits are dropped
  with a bounded warning.
- The PrusaSlicer and Orca/Bambu adapters detect `;WIPE_START`/`;WIPE_END` and mark the bracketed
  segments as `Wipe`.
- New capabilities: `wipeMoves` (`known` when a bracket was parsed, else `unavailable` — never
  fabricated) and `seamMoves` (always `unavailable`; seam has no per-move G-code signal).

Golden-safe: the base Extrude/Travel classification is unchanged, so the golden-equivalence gate
(kind masked to `Extrude|Travel`) is byte-identical; only the additive `wipeMoves`/`seamMoves`
capability lines were regenerated in the native goldens. No IR schema change, no new dependency.
Renderer visibility for wipe moves lands in phase 2.
