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

# Release review — v0.22.0

**Review version:** v0.22.0
**Changed-capability inventory diffed against:** `v0.21.2`

This artifact records the per-release **Public Product + Documentation + Visual** reconciliation:
before the `dev` -> `main` promotion, compare the changed capabilities below against the README,
the Pages homepage, the feature gallery, the manual, the demo and examples, the screenshots, and
the coverage matrix ([`docs/VISUAL_FEATURE_COVERAGE.md`](docs/VISUAL_FEATURE_COVERAGE.md)); then set
each disposition. Guidance: CLAUDE.md "Public-docs completion check" and
[`docs/reference/release-process.md`](docs/reference/release-process.md).

## Changed packages (`src/` since the previous release)

| Package | Changed src files | Changelog summary | Disposition |
|---|--:|---|---|
| `@chestnutlabs/gcode-bgcode` | 1 | Prusa `.bgcode` thumbnails now reach the parse result. A `.bgcode` file stores its preview images as | Status: reviewed |
| `@chestnutlabs/gcode-colors` | 2 | Files with a number too large for the toolpath's 32-bit channels (for example `G1 X10 F` followed by a 40-digit value) no longer break color | Status: reviewed |
| `@chestnutlabs/gcode-containers` | 4 | `.gcode.3mf` plate thumbnails now reach the parse result. Bambu Studio and OrcaSlicer store each plate's | Status: reviewed |
| `@chestnutlabs/gcode-dialects` | 6 | Toolpath and metadata fixes found by a mutation-testing sweep: | Status: reviewed |
| `@chestnutlabs/gcode-model-renderer` | 20 | The source-model viewer can draw a build plate. It is opt-in: with no `buildVolume` the viewer and | Status: reviewed |
| `@chestnutlabs/gcode-parser` | 5 | `.gcode.3mf` plate thumbnails now reach the parse result. Bambu Studio and OrcaSlicer store each plate's | Status: reviewed |
| `@chestnutlabs/gcode-preview-core` | 12 | The toolpath viewer now draws the Studio look and has a camera lens control. With no theme set | Status: reviewed |
| `@chestnutlabs/gcode-preview-element` | 7 | The source-model viewer can draw a build plate. It is opt-in: with no `buildVolume` the viewer and | Status: reviewed |
| `@chestnutlabs/gcode-preview-react` | 9 | The source-model viewer can draw a build plate. It is opt-in: with no `buildVolume` the viewer and | Status: reviewed |
| `@chestnutlabs/gcode-preview-svelte` | 6 | The source-model viewer can draw a build plate. It is opt-in: with no `buildVolume` the viewer and | Status: reviewed |
| `@chestnutlabs/gcode-preview-vue` | 6 | The source-model viewer can draw a build plate. It is opt-in: with no `buildVolume` the viewer and | Status: reviewed |
| `@chestnutlabs/gcode-renderer-three` | 18 | New renderer primitives for the Studio viewport look (DD-032). They are opt-in, and a scene with no theme | Status: reviewed |
| `@chestnutlabs/toolpath-core` | 4 | Files with a number too large for the toolpath's 32-bit channels (for example `G1 X10 F` followed by a 40-digit value) no longer break color | Status: reviewed |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** resolved — README / Pages homepage / feature gallery still describe the product accurately for this release.
- **Docs review:** resolved — manual, package READMEs, examples, and quick-start match the shipped API.
- **Visual review:** resolved — every changed user-facing capability is visually documented, or the coverage matrix records why not. **UI parity:** if the app/controls/adapters changed, the app-UI screenshots (`docs/media/app-*.png`, regenerate with `npm run docs:shots:app`) and the capability renders (`npm run docs:shots`) show the CURRENT UI — the README must not lead with a screenshot from an older layout — and the live demos (`npm run docs:demos` → Pages `/demos/`) build and run on the published SDK.

_Resolve each marker above by replacing `pending` with `resolved` once reconciled._

## Reconciliation notes (v0.22.0)

- **Product:** the README, Pages homepage and gallery describe the Studio look as opt-in; the default look is unchanged, so the existing capability renders still show the shipped default. The Prepare/Preview pairing and the plate thumbnails are described accurately.
- **Docs:** DD-032 Lanes D1 (#492) and D2 (#503) updated the manual (looks/lens/plate guide, recipes, adapters), the package READMEs (pixelRatio, cage, lens, 2D disclosures) and the Feature Lab controls. The #506 parser fixes (helical/negative-R arcs, print-time formats, `number-out-of-range`) are behaviour corrections with no API change; they are covered by the changelogs. Fixed in this fill: the recipes page named the wrong package for `renderStill` (it is exported from `gcode-preview-core`), and the still-render reference gained an Errors section for the new `RenderStillError` rejection.
- **Visual:** the app-UI shots (`docs/media/app-*.png`) were recaptured from the current build in #503, including the Studio look. The capability renders were not regenerated because `tools/screenshots/capture.mjs` is stale against the current Feature Lab (tracked as #504, P2). They still show the default look accurately, because the default look did not change in this release.
- **Framework parity:** pixelRatio, lens, theme and cage are reachable on core + Vue/React/Svelte/WC (markup getters fixed pre-release for `<gcode-model-viewer>`); the 2D renderer records a `renderer-unsupported` disclosure for lens and pixelRatio. The parity-guard hardening (#509) lands after this release.
