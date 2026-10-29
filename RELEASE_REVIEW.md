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

# Release review — v0.21.0

**Review version:** v0.21.0
**Changed-capability inventory diffed against:** `v0.20.1`

This artifact records the per-release **Public Product + Documentation + Visual** reconciliation:
before the `dev` -> `main` promotion, compare the changed capabilities below against the README,
the Pages homepage, the feature gallery, the manual, the demo and examples, the screenshots, and
the coverage matrix ([`docs/VISUAL_FEATURE_COVERAGE.md`](docs/VISUAL_FEATURE_COVERAGE.md)); then set
each disposition. Guidance: CLAUDE.md "Public-docs completion check" and
[`docs/reference/release-process.md`](docs/reference/release-process.md).

## Changed packages (`src/` since the previous release)

| Package | Changed src files | Changelog summary | Disposition |
|---|--:|---|---|
| `@chestnutlabs/gcode-model-renderer` | 5 | Model viewer framing and STL lighting fixes (AnyBridge Customizer): | Status: reviewed |
| `@chestnutlabs/gcode-renderer-three` | 2 | Model viewer framing and STL lighting fixes (AnyBridge Customizer): | Status: reviewed |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** resolved — the change makes the existing interactive model viewer frame and size correctly. README / Pages homepage / feature gallery describe the model viewer at the capability level and stay accurate; `docs/README.md` "Current state" leads with v0.21.0.
- **Docs review:** resolved — the `gcode-model-renderer` README "Interactive viewer" section documents the fit, re-frame-on-resize, `autoFrameOnResize`, and that `camera-changed` fires only for user gestures. The only API additions are the optional `autoFrameOnResize` option and the `InteractiveStage` `fitBox`/`viewDirection`/`onInteractionStart` members; quick-start and examples need no change (adapters inherit the behaviour). Parity (DD-031): fixed once in `createModelPreviewController`, so React/Vue/Svelte/Web Component `/model` all inherit canvas sizing, fit and re-frame; no new control/state field, so the parity guard lists are unchanged.
- **Visual review:** resolved — no documentation image changes. The capability renders use `renderModelStill`, whose framing is unchanged. The Feature Lab Prepare viewport (`docs/media/app-prepare.png`) now frames the model somewhat tighter, but the UI and the shown capability are the same, so the screenshot still represents the software. Verified in a real browser: zero-normal STL renders shaded, wide/square/narrow canvases fit and centre, and the React `/model` example's canvas buffer now tracks its CSS box.

_Resolve each marker above by replacing `pending` with `resolved` once reconciled._
