# RR-005 — 3MF `paint_color` facet-paint format (Bambu/Orca production multicolor)

**Status:** Complete
**Author(s):** Nathaniel Chestnut
**Date:** 2026-08-24
**Owning work:** ModelRenderer production-3MF material decoding (DD-018 follow-up) · **Informs:** the
`paint_color` decoder in `@chestnutlabs/gcode-model-renderer`

## 1. Question & the decision it informs

Rich, designer-authored multicolor 3MF (Bambu Studio / OrcaSlicer, the MakerWorld default) is a normal
real-world workload — especially for print-farm software. A **source** model (un-sliced) stores its
per-region color not as standard 3MF `<basematerials>`/`<m:colorgroup>`, but as a proprietary
**`paint_color`** attribute on each painted `<triangle>`. Before `@chestnutlabs/gcode-model-renderer`
can render such a file with real colors (instead of the honest-but-blank neutral default), this record
must answer:

1. **Where does the palette live**, and where does the geometry→color mapping live?
2. **What exactly is the `paint_color` encoding**, precisely enough to implement a decoder?
3. **Is decoding legally clean for an MIT project** (the reference slicers are GPL)?

Decision it informs: *the decoder, the palette source, and the capability-honesty tiers.*

## 2. Legal provenance (clean-room)

| Artifact | Source | License | Bearing |
|---|---|---|---|
| OrcaSlicer / PrusaSlicer `TriangleSelector` (the reference encoder/decoder) | `SoftFever/OrcaSlicer`, `prusa3d/PrusaSlicer` (C++) | **AGPL-3.0 / GPL** | **Must NOT copy / port / read to reproduce** |
| The `paint_color` bit layout | Derived **only** from observed bytes in a real file (below) | facts, not code | Clean-roomed here |
| 3MF core (`<vertices>/<triangles>`, production extension) | 3MF Consortium spec | permissive | Already parsed |

The format below was reverse-engineered **solely from the observed data** of one real file — no GPL
source was read or transcribed. This mirrors the clean-room posture taken for MeatPack in
[RR-003](RR-003-bgcode-licensing-and-format-audit.md).

## 3. Reference file (observed)

`Cinderwing3D-Lunarwing-4-Color.3mf` (Bambu Studio 01.09.03.50, MakerWorld). Licensed content — used
**locally only** as an acceptance oracle, never committed (cf. the DD-012 hardware-validation log).

- Production extension: a 1.5 KB `3D/3dmodel.model` whose `<component p:path>` references a 73 MB
  `3D/Objects/object_2.model` (858,071 triangles). Already followed by the existing parser.
- **Palette:** `Metadata/project_settings.config` → `"filament_colour": ["#8080FF","#000000","#FFFFFF","#808080"]`
  (periwinkle / black / white / grey; all PLA). **Not** in the model XML — zero `<basematerials>`.
- **Default extruder:** `Metadata/model_settings.config` → `<metadata key="extruder" value="1">`.
- **Geometry→color:** 156,122 `<triangle … paint_color="…">` attributes. Distinct values: `1C`
  (117,913), `0C` (36,401), `4` (1,748), `8` (53), plus 7 longer (subdivided) strings.

## 4. The `paint_color` encoding (result)

Each attribute encodes **one** source triangle's recursive split-tree as a **little-endian stream of
4-bit nibble tokens** (reverse the hex string; each hex char is one token). Decode a node:

```
token       = next nibble
split_sides = token & 0b11
  if split_sides == 0:            # leaf
      s2 = token >> 2
      state = (s2 == 3) ? 3 + next_nibble()   # escape for states ≥ 3
                        : s2
  else:                           # split into (split_sides + 1) children (2/3/4)
      (token >> 2 = which side — irrelevant to color); decode that many children depth-first
```

Trailing nibbles are zero padding. **State semantics:** `state 0` = the object's **default extruder**
(unpainted); `state s ≥ 1` = **filament index `s − 1`** into the `filament_colour` palette.

**Verified:** all 9 distinct codes in the reference file parse to completion; the whole-triangle leaves
decode `4→1, 8→2, 0C→3, 1C→4`. Mapping states→palette and measuring painted **surface area** gives
periwinkle 90.8% / white 4.9% / grey 4.3% / black ~0% — which **matches the file's own `top_1.png`
render** (a periwinkle dragon body with white highlights, grey wing membranes, and trace black
details). Palette colors are sRGB `#RRGGBB` → linear RGB.

## 5. Subdivided facets & honesty

Only **7 of 858,071** facets (< 0.001%) are subdivided (a triangle painted with more than one color).
v1 flattens each to its dominant sub-state and reports the scene's `materials` capability as
**`approximated`** (DD-001: "derived with known error") rather than `known`. Proper geometric
subdivision of these facets is a possible future refinement that would restore `known`. When no palette
is present (or no `paint_color` at all), `materials` stays **`unavailable`** — neutral render, never a
fabricated color.

## 6. Decision

- Decode `paint_color` in the **source-3MF mesh layer** (`@chestnutlabs/gcode-model-renderer`) — the
  only layer that reads these `<triangle>` elements. No other component decodes it (AnyBridge does not;
  the slicer delegates to Orca at slice time), so there is no duplication to avoid, only a gap to fill.
- Read the palette **self-contained** from `project_settings.config filament_colour`, reusing the
  key-semantics helper `filamentColoursFromSettings` exported from `@chestnutlabs/gcode-containers`
  (one implementation of "which key is the palette", shared with the toolpath side).
- Capability tiers: `known` (palette + whole-triangle paint), `approximated` (subdivided facets
  flattened), `unavailable` (no palette or no paint).
