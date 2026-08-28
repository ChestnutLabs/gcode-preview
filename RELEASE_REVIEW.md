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

# Release review — v0.19.0

**Review version:** v0.19.0
**Changed-capability inventory diffed against:** `v0.18.0`

This artifact records the per-release **Public Product + Documentation + Visual** reconciliation:
before the `dev` -> `main` promotion, compare the changed capabilities below against the README,
the Pages homepage, the feature gallery, the manual, the demo and examples, the screenshots, and
the coverage matrix ([`docs/VISUAL_FEATURE_COVERAGE.md`](docs/VISUAL_FEATURE_COVERAGE.md)); then set
each disposition. Guidance: CLAUDE.md "Public-docs completion check" and
[`docs/reference/release-process.md`](docs/reference/release-process.md).

## Changed packages (`src/` since the previous release)

| Package | Changed src files | Changelog summary | Disposition |
|---|--:|---|---|
| `@chestnutlabs/gcode-preview-core` | 2 | feat(renderer): `setFeatureRoleVisible(role, visible)` — show/hide a single feature role | Status: reviewed |
| `@chestnutlabs/gcode-renderer-three` | 2 | feat(renderer): `setFeatureRoleVisible(role, visible)` — show/hide a single feature role | Status: reviewed |
| `@chestnutlabs/toolpath-core` | 1 | feat(renderer): `setFeatureRoleVisible(role, visible)` — show/hide a single feature role | Status: reviewed |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** resolved — README / Pages homepage / feature gallery still describe the product accurately for this release.
- **Docs review:** resolved — manual, package READMEs, examples, and quick-start match the shipped API.
- **Visual review:** resolved — every changed user-facing capability is visually documented, or the coverage matrix records why not.

_Resolve each marker above by replacing `pending` with `resolved` once reconciled._
