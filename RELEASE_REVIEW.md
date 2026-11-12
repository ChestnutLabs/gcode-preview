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
| `@chestnutlabs/gcode-bgcode` | 5 | `.bgcode` files with corrupt streams or impossible values are now handled safely. | Status: reviewed — package README already lists `E_BGCODE_BOMB` (1,000,000 blocks), `E_BGCODE_MEATPACK`, `bgcode-bed-unparsed` / `bgcode-metadata-invalid`; no demo/media impact. |
| `@chestnutlabs/gcode-colors` | 3 | Colour modes now reject options that have no meaning, and a hostile file can no longer distort or break colouring. | Status: reviewed — README already documents the `RangeError` rules and `checkColorMode`; added `checkColorMode` to the speed-scale recipe (docs/manual/recipes.md). No doc claimed palette wrap. |
| `@chestnutlabs/gcode-containers` | 4 | A `.gcode.3mf` with impossible machine settings no longer gives an infinite bed or a zero or negative | Status: no-change-needed — README does not document project_settings machine values; dropped values surface as `container-metadata-invalid` warnings, no API change. |
| `@chestnutlabs/gcode-dialects` | 5 | Slicer comments with impossible numbers no longer put `NaN` or `Infinity` into the parse metadata. | Status: reviewed — README already documents `dialect-metadata-invalid` / `dialect-bed-unparsed`; compatibility tables make no NaN/Infinity claims. |
| `@chestnutlabs/gcode-model-renderer` | 12 | Hostile 3MF files can no longer hang the parser, and model `limits` are now validated and enforced. | Status: reviewed — README limits table already lists `E_MODEL_OPTION`, `E_MODEL_TOO_MANY_OBJECTS`, `E_MODEL_TOO_MANY_INSTANCES`, `E_MODEL_CYCLE`; demo passes no limits. |
| `@chestnutlabs/gcode-parser` | 16 | A G2/G3 arc whose points lie beyond the float32 range no longer hangs the parser. Segments dropped for an out-of-range stored position now c | Status: reviewed — README has `E_PARSE_OPTION`; added limit validation to concept-workers.md and the per-test/argument/text RS274 charge to gcode-motion-coverage.md (ROUND row already current). Arc fixes: see Visual. |
| `@chestnutlabs/gcode-preview-core` | 10 | Segments skipped for an `Infinity` or `NaN` coordinate are now disclosed, in 2D and 3D ([#518](https://github.com/ChestnutLabs/gcode-preview | Status: reviewed — adapters.md already covers the non-finite disclosure, 2D `build-complete`, newest-parse-wins; still-render.md has `qualityMode`. Testing-only exports need no consumer doc. |
| `@chestnutlabs/gcode-preview-element` | 1 | _(version bump only — no src changelog summary)_ | Status: not-applicable — dependency bump only; behaviour comes from core (covered there). |
| `@chestnutlabs/gcode-preview-react` | 2 | _(version bump only — no src changelog summary)_ | Status: not-applicable — dependency bump only; behaviour comes from core (covered there). |
| `@chestnutlabs/gcode-preview-vue` | 1 | _(version bump only — no src changelog summary)_ | Status: not-applicable — dependency bump only; behaviour comes from core (covered there). |
| `@chestnutlabs/gcode-renderer-2d` | 3 | Colour modes now reject options that have no meaning, and a hostile file can no longer distort or break colouring. | Status: reviewed — README already has `skippedNonFinite` / `summarize2DDrawable`; added the colour-mode `RangeError` + re-exported `checkColorMode` note. |
| `@chestnutlabs/gcode-renderer-three` | 16 | Segments skipped for an `Infinity` or `NaN` coordinate are now disclosed, in 2D and 3D ([#518](https://github.com/ChestnutLabs/gcode-preview | Status: reviewed — README already had non-finite skip, build-volume `RangeError`, `machine-geometry-invalid`, `decimation`; added the tube/budget/`geometryConcurrency`/`qualityMode` validation rules (#537). |
| `@chestnutlabs/toolpath-core` | 4 | `ToolpathIRBuilder` and `createProgressMapper` now reject out-of-range input instead of storing a different value. | Status: no-change-needed — progress-signal-contract.md already documents the `createProgressMapper` `RangeError`; the README does not document builder field ranges. |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** resolved — README / Pages homepage / feature gallery still describe the product accurately for this release. Hardening release: no new capability to advertise; the version line already reads v0.23.0, and the docs/README current state + history now name v0.23.0.
- **Docs review:** resolved — manual, package READMEs, examples, and quick-start match the shipped API. The feature PRs updated most package READMEs; this fill added the missing `checkColorMode`, parse-limit validation, RS274 work-charge and renderer-three option-validation notes. Demo and `tools/example-*` pass none of the newly rejected values.
- **Visual review:** resolved — every changed user-facing capability is visually documented, or the coverage matrix records why not. **UI parity:** if the app/controls/adapters changed, the app-UI screenshots (`docs/media/app-*.png`, regenerate with `npm run docs:shots:app`) and the capability renders (`npm run docs:shots`) show the CURRENT UI — the README must not lead with a screenshot from an older layout — and the live demos (`npm run docs:demos` → Pages `/demos/`) build and run on the published SDK. **Finding:** no app/controls/adapter UI changed, so the app-UI shots stand. No published image renders `plant-sign` or `screw` (they appear only in the maintainer VR baselines `test-data/visual-baselines/{plant-sign,screw}.gcode_{lines,tubes}.png`, which were not regenerated; every negative-E arc in both files sits inside a `;WIPE_START`…`;WIPE_END` block, mean ~1.4 mm / ~0.9 mm, retracing the perimeter just printed, so dropping them from the extrusion draw should not be visible at that scale; reasoned from the G-code, not re-rendered). 3DBenchy media (`viewer-benchy-tubes`, `layer-clip-benchy`, `camera-top/front/iso`, `scrub-sweep.webm`, `layer-buildup.webm`, the six benchy `app-*` shots) were captured before #524 but stay accurate: the 3 changed arcs are internal infill (Z 9.4, 16.6, 17.0 mm), each a ~0.6-0.7 mm chord whose arc bulges only ~0.07 mm, buried under later layers and sub-pixel at 1920 px. No coverage-matrix change: no new user-facing visual capability.

_Resolve each marker above by replacing `pending` with `resolved` once reconciled._
