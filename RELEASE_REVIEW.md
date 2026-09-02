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

# Release review — v0.20.1

**Review version:** v0.20.1
**Changed-capability inventory diffed against:** `v0.20.0`

This artifact records the per-release **Public Product + Documentation + Visual** reconciliation:
before the `dev` -> `main` promotion, compare the changed capabilities below against the README,
the Pages homepage, the feature gallery, the manual, the demo and examples, the screenshots, and
the coverage matrix ([`docs/VISUAL_FEATURE_COVERAGE.md`](docs/VISUAL_FEATURE_COVERAGE.md)); then set
each disposition. Guidance: CLAUDE.md "Public-docs completion check" and
[`docs/reference/release-process.md`](docs/reference/release-process.md).

## Changed packages (`src/` since the previous release)

| Package | Changed src files | Changelog summary | Disposition |
|---|--:|---|---|
| `@chestnutlabs/gcode-parser` | 2 | Fix a parse-session hang on a double `cancel()`. A second `cancel()` while a cancel was already pending (e.g. the controller cancelling befo | Status: pending |
| `@chestnutlabs/gcode-preview-element` | 2 | Fix `<gcode-preview>` connect/disconnect defects: the initial `view` attribute (and a `cameraState` set before connect) are now applied on c | Status: pending |
| `@chestnutlabs/gcode-preview-react` | 2 | Fix `<ModelViewer>` / `useModelViewer` (React) leaking its controller on unmount. The hook now disposes the model-preview controller when th | Status: pending |
| `@chestnutlabs/gcode-renderer-three` | 4 | Fix `capture()` returning too-dark (linear colour-space) pixels. The interactive capture path rendered into a render target without sRGB out | Status: pending |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** pending — README / Pages homepage / feature gallery still describe the product accurately for this release.
- **Docs review:** pending — manual, package READMEs, examples, and quick-start match the shipped API.
- **Visual review:** pending — every changed user-facing capability is visually documented, or the coverage matrix records why not. **UI parity:** if the app/controls/adapters changed, the app-UI screenshots (`docs/media/app-*.png`, regenerate with `npm run docs:shots:app`) and the capability renders (`npm run docs:shots`) show the CURRENT UI — the README must not lead with a screenshot from an older layout — and the live demos (`npm run docs:demos` → Pages `/demos/`) build and run on the published SDK.

_Resolve each marker above by replacing `pending` with `resolved` once reconciled._
