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
| `@chestnutlabs/gcode-bgcode` | 3 | `heatshrinkDecode` and `meatpackDecode` now reject out-of-range parameters instead of misbehaving silently. | Status: reviewed — decoder parameter checks; bgcode README + hostile-input notes unchanged in meaning |
| `@chestnutlabs/gcode-colors` | 4 | `fallback: null` now means "use the default" instead of throwing. In `tool` and `filament` colour modes, a | Status: reviewed — colour-mode validation/`fallback: null`; colour-mode guide and package README already state it |
| `@chestnutlabs/gcode-containers` | 1 | _(version bump only — no src changelog summary)_ | Status: no-change-needed — version bump only, no user-facing change |
| `@chestnutlabs/gcode-dialects` | 15 | Dialect annotation now reports every value it drops, accepts 8-digit filament colours, and a custom | Status: reviewed — annotation drop reporting, 8-digit filament colours; compatibility matrix covers it |
| `@chestnutlabs/gcode-model-renderer` | 22 | Portable behavioural suites: new parity guards every adapter inherits. | Status: reviewed — model viewer fixes, render-scope and theme validation, parity guards; package README + adapters.md current |
| `@chestnutlabs/gcode-parser` | 20 | Canned drilling cycles now honour their `L` repeat count. | Status: reviewed — G20 to mm, L repeat, new warnings, paren comments; motion-coverage, concept-ir-capabilities and package README updated (#586/#603) |
| `@chestnutlabs/gcode-preview-core` | 23 | A bad viewer option now throws at once, not after the 3D renderer loads. Until now, a typo such as | Status: reviewed — Cut move kind, early option validation (null/undefined = default), pixelRatio start fix, error `cause`, E_RENDERER_LOAD reason; core README + adapters.md current |
| `@chestnutlabs/gcode-preview-element` | 18 | The toolpath components now tell you when the renderer can't honour a setting ([#520](https://github.com/ChestnutLabs/gcode-preview/issues/5 | Status: reviewed — rendererunsupported, attribute validation, showCut, /define kept in production bundles (#609, adapters.md updated); element README current |
| `@chestnutlabs/gcode-preview-react` | 19 | The toolpath components now tell you when the renderer can't honour a setting ([#520](https://github.com/ChestnutLabs/gcode-preview/issues/5 | Status: reviewed — onRendererUnsupported, showCut, scrub props, no-null prop types (adapters.md deliberate-difference note added); mutation sweep #606 has no behaviour change |
| `@chestnutlabs/gcode-preview-svelte` | 10 | The toolpath components now tell you when the renderer can't honour a setting ([#520](https://github.com/ChestnutLabs/gcode-preview/issues/5 | Status: reviewed — on:rendererunsupported, showCut, same-source no re-parse; Svelte README current |
| `@chestnutlabs/gcode-preview-vue` | 13 | The toolpath components now tell you when the renderer can't honour a setting ([#520](https://github.com/ChestnutLabs/gcode-preview/issues/5 | Status: reviewed — @renderer-unsupported, show-cut; Vue README current |
| `@chestnutlabs/gcode-renderer-2d` | 2 | The 2D view now draws CNC and laser Cut moves. A CNC file used to show nothing in 2D with travel hidden. | Status: reviewed — 2D now draws Cut moves (`cut` toggle, `cutDrawn`), layer-range fix, option checks; 2D renderer README current |
| `@chestnutlabs/gcode-renderer-three` | 33 | A bad viewer option now throws at once, not after the 3D renderer loads. Until now, a typo such as | Status: reviewed — Cut chunk kind, auto-decimation for cuts, early option checks, pixelRatio start fix, decimation notice wording, three-free /lite entry; renderer-three README + adapters.md current |
| `@chestnutlabs/toolpath-core` | 5 | Inch files (`G20`) now draw at their real size. **IR coordinates are always mm; `header.units` is the file's | Status: reviewed — Cut moves count toward bounds, mm-always IR; concept-ir-capabilities updated |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** resolved — README / Pages homepage / feature gallery still describe the product accurately for this release.
- **Docs review:** resolved — manual, package READMEs, examples, and quick-start match the shipped API.
- **Visual review:** resolved — every changed user-facing capability is visually documented, or the coverage matrix records why not. **UI parity:** if the app/controls/adapters changed, the app-UI screenshots (`docs/media/app-*.png`, regenerate with `npm run docs:shots:app`) and the capability renders (`npm run docs:shots`) show the CURRENT UI — the README must not lead with a screenshot from an older layout — and the live demos (`npm run docs:demos` → Pages `/demos/`) build and run on the published SDK.

**Parity (DD-031):** resolved — `showCut` / `setKindVisible('cut')` and `renderer-unsupported` reach core and all four adapters (Vue `show-cut` / `@renderer-unsupported`, React `showCut` / `onRendererUnsupported`, Svelte `showCut` / `on:rendererunsupported`, Web Component attribute / event); parity guards extended in `testing.ts`.

Reconciliation notes: README, docs/README, manual (adapters, concept-ir-capabilities, guide-looks-lens-plate, recipes), package READMEs and gcode-motion-coverage were reconciled by #586 and #603. VISUAL_FEATURE_COVERAGE records the CNC cut-framing shot and the non-visual `renderer-unsupported` row. 2D Cut drawing (#604) is documented in the renderer-2d README and the manual; a 2D CNC screenshot is not added (the CNC cut-framing shot covers the capability). Screenshots unchanged by this cut.
