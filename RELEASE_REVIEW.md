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
| `@chestnutlabs/gcode-parser` | 2 | Fix a parse-session hang on a double `cancel()`. A second `cancel()` while a cancel was already pending (e.g. the controller cancelling befo | Status: reviewed |
| `@chestnutlabs/gcode-preview-element` | 2 | Fix `<gcode-preview>` connect/disconnect defects: the initial `view` attribute (and a `cameraState` set before connect) are now applied on c | Status: reviewed |
| `@chestnutlabs/gcode-preview-react` | 2 | Fix `<ModelViewer>` / `useModelViewer` (React) leaking its controller on unmount. The hook now disposes the model-preview controller when th | Status: reviewed |
| `@chestnutlabs/gcode-renderer-three` | 4 | Fix `capture()` returning too-dark (linear colour-space) pixels. The interactive capture path rendered into a render target without sRGB out | Status: reviewed |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** resolved — v0.20.1 is a correctness patch with **no API or product-surface change**. README / Pages homepage / feature gallery remain accurate; the `docs/README.md` "Current state" now leads with the v0.20.1 patch and its five fixes.
- **Docs review:** resolved — no public API changed, so the manual, package READMEs, examples, and quick-start still match the shipped API. Each fix carries a changeset → per-package CHANGELOG entry, and the deferred/related findings are tracked in issues #430–#435.
- **Visual review:** resolved — no UI/visual change. The app-UI screenshots and capability renders still show the current UI (the demo screenshot harness copies the live sRGB-correct canvas, so it was never affected by the `capture()` colour-space bug this patch fixes), and the live demos build/run on the published SDK. The `capture()` fix is verified in-browser (a `#6d7176` scene round-trips through `capture()` as `#6d7176`, not the previous linear `#272a2e`).

_All markers resolved: this patch changes behaviour (bug fixes) with no product/docs/visual surface change; the capture colour fix was validated in a real browser._
