---
title: Dialects & containers
group: Concepts
category: Concepts
---

# Dialects & containers

## Cross-vendor dialects

Slicers and firmware annotate G-code differently. **`@chestnutlabs/gcode-dialects`** provides
annotators for **PrusaSlicer, OrcaSlicer/Bambu Studio, Cura, Klipper, Marlin, and RepRap-flavor**
output — surfacing features, objects, bed geometry, thumbnails, and multi-tool metadata.

Crucially, each claim is **capability-tagged** (`known | inferred | approximated | unavailable`, see
[the capability model](concept-ir-capabilities.md)) — the stack annotates only what a given dialect
actually disclosed, and says so when it can't. The evidence-dated
[compatibility matrix](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/compatibility/dialects-and-containers.md)
records exactly what each dialect supports.

Dialects are a **plugin layer**: the batteries worker bundles them all; a slim custom worker can
include only the ones you need (see [Workers](concept-workers.md)).

## Containers — `.gcode.3mf`

**`@chestnutlabs/gcode-containers`** reads `.gcode.3mf` — a sliced-plate ZIP container — with
**zero dependencies** and **bounded, hardened** extraction (defended against adversarial archives).
A container can hold several plates; select one with `parseOptions.plate`. The selected plate's preview
images (`plate_N.png`, then `plate_N_small.png`) arrive in `metadata.thumbnails`; `top_` and `pick_`
images are not included.

## Containers — `.bgcode` (Prusa binary)

**`@chestnutlabs/gcode-bgcode`** decodes Prusa's block-structured binary G-code container
(`.bgcode`, with heatshrink / DEFLATE / MeatPack codecs) into plain G-code that flows through the
same pipeline — a decoded `.bgcode` yields the same `ToolpathIR` as the equivalent `.gcode`. It
registers as a container adapter alongside `.gcode.3mf`, is discovered automatically by magic
sniff, and enforces per-block CRC32 integrity with bounded, output-capped decompression.

## Object exclusion & multi-tool

Object-exclusion markers (`M486` / `EXCLUDE_OBJECT`) and multi-tool metadata are parsed where the
dialect provides them, so a preview can reflect per-object and per-tool structure.

## Motion coverage

Which position-affecting G/M-codes are honored — and the remaining gaps — is tracked in the
[G-code motion coverage matrix](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/compatibility/gcode-motion-coverage.md).
The modeling itself is described in [Live progress & motion model](concept-progress-motion.md).

## Non-extrusion — CNC / laser / plotter (experimental)

Beyond FDM, the stack understands **non-extrusion** toolpaths. Where there is no extrusion `E` to key
on, a move made while a tool is engaged (spindle/laser on via `M3`/`M4`) is classified `MoveKind.Cut`
rather than `Travel`; the modal `S` value rides an opt-in **`toolPower`** channel
(`parseOptions.modalChannels: ['toolPower']`), colorable with the `power` mode; and canned drilling
cycles (`G81`/`G82`/`G83`, incl. `G83` peck) expand to real geometry. Controllers (GRBL laser/mill,
LinuxCNC) are recognized as dialects.

**Framing.** A cut counts toward the toolpath's `bounds`, so the 3D viewer and `renderStill` fit the camera to the
cut, not to the bed, and a labelled cut counts toward `objectBounds` too (`frameContent: 'object'` frames a labelled
cut-only file). Travel and retract moves still don't count. `modelBounds` and `nonModelClassification` still look at
extrusion only, so a cut-only file reports `nonModelClassification: 'unavailable'`. A pen plotter that never sends
`M3`/`M4` has no `Cut` moves, so its `bounds` stays empty and the viewer frames the bed.

**Canned cycles.** A `G81`/`G82`/`G83` cycle that starts below its `R` plane first rapids straight up to `R` at the old
XY and only then moves to the hole, as LinuxCNC does, so the drawn travel doesn't cross the part at the low Z. Under
`G91`, a cycle's `R` and `Z` are sticky, like the other cycle words. A `( … )` comment that is never closed, or is
nested, raises one `unbalanced-paren-comment` warning per file; see the
[motion coverage matrix](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/compatibility/gcode-motion-coverage.md).

This is honesty-**tiered** (DD-012): until a controller is confirmed on real hardware, its
non-extrusion classification is reported **`inferred`** (experimental), never `known`, with a
disclosure warning. Geometry always parses regardless. See the
[compatibility matrix](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/compatibility/dialects-and-containers.md)
for the per-controller tier.
