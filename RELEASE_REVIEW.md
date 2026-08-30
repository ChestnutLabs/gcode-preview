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

# Release review — v0.20.0

**Review version:** v0.20.0
**Changed-capability inventory diffed against:** `v0.19.0`

This artifact records the per-release **Public Product + Documentation + Visual** reconciliation:
before the `dev` -> `main` promotion, compare the changed capabilities below against the README,
the Pages homepage, the feature gallery, the manual, the demo and examples, the screenshots, and
the coverage matrix ([`docs/VISUAL_FEATURE_COVERAGE.md`](docs/VISUAL_FEATURE_COVERAGE.md)); then set
each disposition. Guidance: CLAUDE.md "Public-docs completion check" and
[`docs/reference/release-process.md`](docs/reference/release-process.md).

## Changed packages (`src/` since the previous release)

| Package | Changed src files | Changelog summary | Disposition |
|---|--:|---|---|
| `@chestnutlabs/gcode-model-renderer` | 4 | Make interactive **source-model viewing** (STL / 3MF) a first-class, declarative half of the SDK — | Status: reviewed |
| `@chestnutlabs/gcode-preview-core` | 4 | Close the dark-capability gaps so no shipped capability is reachable only through the | Status: reviewed |
| `@chestnutlabs/gcode-preview-element` | 6 | Close the dark-capability gaps so no shipped capability is reachable only through the | Status: reviewed |
| `@chestnutlabs/gcode-preview-react` | 7 | Close the dark-capability gaps so no shipped capability is reachable only through the | Status: reviewed |
| `@chestnutlabs/gcode-preview-svelte` | 6 | Close the dark-capability gaps so no shipped capability is reachable only through the | Status: reviewed |
| `@chestnutlabs/gcode-preview-vue` | 6 | Close the dark-capability gaps so no shipped capability is reachable only through the | Status: reviewed |
| `@chestnutlabs/gcode-renderer-three` | 3 | `CaptureOptions` gains `includeBuildVolume?: boolean` (default `true`). Set it to `false` to exclude | Status: reviewed |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** resolved — README / Pages homepage / feature gallery still describe the product accurately for this release.
- **Docs review:** resolved — manual, package READMEs, examples, and quick-start match the shipped API.
- **Visual review:** resolved — every changed user-facing capability is visually documented, or the coverage matrix records why not.

_Resolve each marker above by replacing `pending` with `resolved` once reconciled._

## Reconciliation notes (v0.20.0)

All seven changed packages are the DD-031 consumer-UX / framework-parity pass, reconciled together:

- **Product:** the whole point of this release is consumer-facing surface. `docs/README.md`
  "Current state" leads with v0.20.0; the two-viewer (Preview + Prepare) story is accurate. The root
  README and Pages homepage remain accurate (they describe the toolpath viewer + source-model
  rendering; the new framework model adapters are additive API documented in the canonical adapter
  docs). No existing product copy misrepresents the shipped software.
- **Docs:** `docs/manual/adapters.md` gained "Two viewers: Preview and Prepare" + a per-framework
  import table; all four adapter READMEs gained a "Model viewing (Prepare side)" section; the
  `gcode-model-renderer` README documents `createModelPreviewController` + the `/testing` suite;
  `CLAUDE.md`'s parity check now covers both viewer surfaces. `npm run docs:links` passes.
- **Visual:** the interactive model viewer is now demonstrated in the Feature Lab + all four
  showcases (Preview/Prepare toggle) and a minimal model page per framework; the coverage matrix
  (`docs/VISUAL_FEATURE_COVERAGE.md` §6/§10) records this. Dark **app-UI** screenshots of Prepare
  mode were captured for review but are **not yet canonical `docs/media`** — the manifest harness
  emits the mid-grey capability presentation, not app chrome; that gap is explicitly recorded and
  carried to the next Visual Review. No shipped capability's existing media is now stale.
- **Framework parity:** every new controller/model capability is exposed across Vue, React, Svelte,
  and the Web Component (declaratively where it belongs; the `<gcode-model-viewer>` tag and the
  `/model` subpath are documented intentional differences), exercised by the portable behavioral
  suites with controls/state completeness parity guards for both the toolpath and model surfaces.
