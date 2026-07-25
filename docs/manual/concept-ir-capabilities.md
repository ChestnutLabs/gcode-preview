---
title: ToolpathIR & the capability model
group: Concepts
category: Concepts
---

# ToolpathIR & the capability model

## ToolpathIR — the neutral seam

Everything downstream of parsing speaks **`ToolpathIR`** (`@chestnutlabs/toolpath-core`): a
**versioned, structure-of-arrays** representation of a toolpath — geometry (per-segment start/end
positions, extrusion, feedrate, `moveKind`, layer, tool) held in parallel typed arrays, plus header
metadata and a source index that maps segments back to byte offsets in the original file.

Structure-of-arrays (SoA) rather than an array of objects is deliberate: it keeps large files
compact and cache-friendly, lets the renderer upload contiguous buffers, and makes draw-range
operations (layer clip, scrub) index math rather than object walks.

`ToolpathIR` is the **contract between parsing and everything else** — the renderer, the progress
mapper, and any consumer read the IR, never the raw G-code. It carries a schema version so consumers
can evolve safely.

## The capability model — honest, never fabricated

The stack's defining rule: **it discloses what it knows and refuses to fabricate what it doesn't.**
Every derived claim is tagged with a confidence level:

| Confidence | Meaning |
|---|---|
| `known` | Observed directly from the source (a command or field was present). |
| `inferred` | Not stated, but resolved from a defensible default (disclosed as a default, not asserted). |
| `approximated` | Derived with known error (e.g. a position between two sparse signals). |
| `unavailable` | Cannot be determined from this input. |

These live in the IR header's `capabilities` map — for example `extrusionMode`, `positioningMode`,
`layers`, `sourcePositions`. A consumer reads them to decide what UI to show: feature coloring only
when the feature was disclosed, a layer slider only when layers are `known`, an uncertainty band
when a position is `approximated`.

This is why the preview never silently lies: if a dialect didn't emit feature annotations, the
stack says so rather than inventing them; if the extruder mode wasn't stated, it defaults *and tells
you it defaulted*. See [Live progress & motion model](concept-progress-motion.md) for the model in
action across firmware differences.
