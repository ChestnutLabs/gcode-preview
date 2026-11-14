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

# Release review — v0.24.0

**Review version:** v0.24.0
**Changed-capability inventory diffed against:** `v0.23.0`

This artifact records the per-release **Public Product + Documentation + Visual** reconciliation:
before the `dev` -> `main` promotion, compare the changed capabilities below against the README,
the Pages homepage, the feature gallery, the manual, the demo and examples, the screenshots, and
the coverage matrix ([`docs/VISUAL_FEATURE_COVERAGE.md`](docs/VISUAL_FEATURE_COVERAGE.md)); then set
each disposition. Guidance: CLAUDE.md "Public-docs completion check" and
[`docs/reference/release-process.md`](docs/reference/release-process.md).

## Changed packages (`src/` since the previous release)

| Package | Changed src files | Changelog summary | Disposition |
|---|--:|---|---|
| `@chestnutlabs/gcode-bgcode` | 3 | `heatshrinkDecode` and `meatpackDecode` now reject out-of-range parameters instead of misbehaving silently. | Status: pending |
| `@chestnutlabs/gcode-colors` | 4 | `fallback: null` now means "use the default" instead of throwing. In `tool` and `filament` colour modes, a | Status: pending |
| `@chestnutlabs/gcode-containers` | 1 | _(version bump only — no src changelog summary)_ | Status: pending |
| `@chestnutlabs/gcode-dialects` | 15 | Dialect annotation now reports every value it drops, accepts 8-digit filament colours, and a custom | Status: pending |
| `@chestnutlabs/gcode-model-renderer` | 22 | Portable behavioural suites: new parity guards every adapter inherits. | Status: pending |
| `@chestnutlabs/gcode-parser` | 20 | Canned drilling cycles now honour their `L` repeat count. | Status: pending |
| `@chestnutlabs/gcode-preview-core` | 23 | A bad viewer option now throws at once, not after the 3D renderer loads. Until now, a typo such as | Status: pending |
| `@chestnutlabs/gcode-preview-element` | 18 | The toolpath components now tell you when the renderer can't honour a setting ([#520](https://github.com/ChestnutLabs/gcode-preview/issues/5 | Status: pending |
| `@chestnutlabs/gcode-preview-react` | 19 | The toolpath components now tell you when the renderer can't honour a setting ([#520](https://github.com/ChestnutLabs/gcode-preview/issues/5 | Status: pending |
| `@chestnutlabs/gcode-preview-svelte` | 10 | The toolpath components now tell you when the renderer can't honour a setting ([#520](https://github.com/ChestnutLabs/gcode-preview/issues/5 | Status: pending |
| `@chestnutlabs/gcode-preview-vue` | 13 | The toolpath components now tell you when the renderer can't honour a setting ([#520](https://github.com/ChestnutLabs/gcode-preview/issues/5 | Status: pending |
| `@chestnutlabs/gcode-renderer-2d` | 2 | The 2D view now draws CNC and laser Cut moves. A CNC file used to show nothing in 2D with travel hidden. | Status: pending |
| `@chestnutlabs/gcode-renderer-three` | 33 | A bad viewer option now throws at once, not after the 3D renderer loads. Until now, a typo such as | Status: pending |
| `@chestnutlabs/toolpath-core` | 5 | Inch files (`G20`) now draw at their real size. **IR coordinates are always mm; `header.units` is the file's | Status: pending |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** pending — README / Pages homepage / feature gallery still describe the product accurately for this release.
- **Docs review:** pending — manual, package READMEs, examples, and quick-start match the shipped API.
- **Visual review:** pending — every changed user-facing capability is visually documented, or the coverage matrix records why not. **UI parity:** if the app/controls/adapters changed, the app-UI screenshots (`docs/media/app-*.png`, regenerate with `npm run docs:shots:app`) and the capability renders (`npm run docs:shots`) show the CURRENT UI — the README must not lead with a screenshot from an older layout — and the live demos (`npm run docs:demos` → Pages `/demos/`) build and run on the published SDK.

_Resolve each marker above by replacing `pending` with `resolved` once reconciled._
