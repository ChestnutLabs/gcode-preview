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
A container can hold several plates; select one with `parseOptions.plate`.

## Object exclusion & multi-tool

Object-exclusion markers (`M486` / `EXCLUDE_OBJECT`) and multi-tool metadata are parsed where the
dialect provides them, so a preview can reflect per-object and per-tool structure.

## Motion coverage

Which position-affecting G/M-codes are honored — and the remaining gaps — is tracked in the
[G-code motion coverage matrix](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/compatibility/gcode-motion-coverage.md).
The modeling itself is described in [Live progress & motion model](concept-progress-motion.md).
