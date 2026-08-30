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
| `@chestnutlabs/gcode-model-renderer` | 4 | Make interactive **source-model viewing** (STL / 3MF) a first-class, declarative half of the SDK — | Status: pending |
| `@chestnutlabs/gcode-preview-core` | 4 | Close the dark-capability gaps so no shipped capability is reachable only through the | Status: pending |
| `@chestnutlabs/gcode-preview-element` | 6 | Close the dark-capability gaps so no shipped capability is reachable only through the | Status: pending |
| `@chestnutlabs/gcode-preview-react` | 7 | Close the dark-capability gaps so no shipped capability is reachable only through the | Status: pending |
| `@chestnutlabs/gcode-preview-svelte` | 6 | Close the dark-capability gaps so no shipped capability is reachable only through the | Status: pending |
| `@chestnutlabs/gcode-preview-vue` | 6 | Close the dark-capability gaps so no shipped capability is reachable only through the | Status: pending |
| `@chestnutlabs/gcode-renderer-three` | 3 | `CaptureOptions` gains `includeBuildVolume?: boolean` (default `true`). Set it to `false` to exclude | Status: pending |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** pending — README / Pages homepage / feature gallery still describe the product accurately for this release.
- **Docs review:** pending — manual, package READMEs, examples, and quick-start match the shipped API.
- **Visual review:** pending — every changed user-facing capability is visually documented, or the coverage matrix records why not.

_Resolve each marker above by replacing `pending` with `resolved` once reconciled._
