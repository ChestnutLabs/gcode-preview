<!--
  RELEASE_REVIEW.md — Public Product + Docs + Visual review for the version being cut.
  Auto-seeded by tools/release/stamp-release-docs.mjs (inside `npm run version`), then
  RESOLVED by hand before promotion. The release gate (`npm run docs:release-check`) blocks
  the dev -> main promotion until this file:
    * declares the version being cut on the "Review version:" line;
    * carries NO `Status: pending` row — every changed package must be one of
      reviewed / no-change-needed / not-applicable;
    * marks all three global dispositions "resolved":
      "Product review: resolved", "Docs review: resolved", "Visual review: resolved".
  Keep the greppable tokens ("Review version:", "Status:", "<X> review:") intact — the gate
  parses them literally. Delete rows only for packages that did not change.
-->

# Release review — v0.23.0

**Review version:** v0.23.0
**Changed-capability inventory diffed against:** `v0.22.0`

This artifact records the per-release **Public Product + Documentation + Visual** reconciliation:
before the `dev` -> `main` promotion, compare the changed capabilities below against the README,
the Pages homepage, the feature gallery, the manual, the demo and examples, the screenshots, and
the coverage matrix ([`docs/VISUAL_FEATURE_COVERAGE.md`](docs/VISUAL_FEATURE_COVERAGE.md)); then set
each disposition. Guidance: CLAUDE.md "Public-docs completion check" and
[`docs/reference/release-process.md`](docs/reference/release-process.md).

## Changed packages (`src/` since the previous release)

| Package | Changed src files | Changelog summary | Disposition |
|---|--:|---|---|
| `@chestnutlabs/gcode-bgcode` | 5 | `.bgcode` files with corrupt streams or impossible values are now handled safely. | Status: pending |
| `@chestnutlabs/gcode-colors` | 3 | Colour modes now reject options that have no meaning, and a hostile file can no longer distort or break colouring. | Status: pending |
| `@chestnutlabs/gcode-containers` | 4 | A `.gcode.3mf` with impossible machine settings no longer gives an infinite bed or a zero or negative | Status: pending |
| `@chestnutlabs/gcode-dialects` | 5 | Slicer comments with impossible numbers no longer put `NaN` or `Infinity` into the parse metadata. | Status: pending |
| `@chestnutlabs/gcode-model-renderer` | 12 | Hostile 3MF files can no longer hang the parser, and model `limits` are now validated and enforced. | Status: pending |
| `@chestnutlabs/gcode-parser` | 16 | A G2/G3 arc whose points lie beyond the float32 range no longer hangs the parser. Segments dropped for an out-of-range stored position now c | Status: pending |
| `@chestnutlabs/gcode-preview-core` | 10 | Segments skipped for an `Infinity` or `NaN` coordinate are now disclosed, in 2D and 3D ([#518](https://github.com/ChestnutLabs/gcode-preview | Status: pending |
| `@chestnutlabs/gcode-preview-element` | 1 | _(version bump only — no src changelog summary)_ | Status: pending |
| `@chestnutlabs/gcode-preview-react` | 2 | _(version bump only — no src changelog summary)_ | Status: pending |
| `@chestnutlabs/gcode-preview-vue` | 1 | _(version bump only — no src changelog summary)_ | Status: pending |
| `@chestnutlabs/gcode-renderer-2d` | 3 | Colour modes now reject options that have no meaning, and a hostile file can no longer distort or break colouring. | Status: pending |
| `@chestnutlabs/gcode-renderer-three` | 16 | Segments skipped for an `Infinity` or `NaN` coordinate are now disclosed, in 2D and 3D ([#518](https://github.com/ChestnutLabs/gcode-preview | Status: pending |
| `@chestnutlabs/toolpath-core` | 4 | `ToolpathIRBuilder` and `createProgressMapper` now reject out-of-range input instead of storing a different value. | Status: pending |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** pending — README / Pages homepage / feature gallery still describe the product accurately for this release.
- **Docs review:** pending — manual, package READMEs, examples, and quick-start match the shipped API.
- **Visual review:** pending — every changed user-facing capability is visually documented, or the coverage matrix records why not. **UI parity:** if the app/controls/adapters changed, the app-UI screenshots (`docs/media/app-*.png`, regenerate with `npm run docs:shots:app`) and the capability renders (`npm run docs:shots`) show the CURRENT UI — the README must not lead with a screenshot from an older layout — and the live demos (`npm run docs:demos` → Pages `/demos/`) build and run on the published SDK.

_Resolve each marker above by replacing `pending` with `resolved` once reconciled._
