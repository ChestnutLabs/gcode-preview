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

# Release review — v0.21.1

**Review version:** v0.21.1
**Changed-capability inventory diffed against:** `v0.21.0`

This artifact records the per-release **Public Product + Documentation + Visual** reconciliation:
before the `dev` -> `main` promotion, compare the changed capabilities below against the README,
the Pages homepage, the feature gallery, the manual, the demo and examples, the screenshots, and
the coverage matrix ([`docs/VISUAL_FEATURE_COVERAGE.md`](docs/VISUAL_FEATURE_COVERAGE.md)); then set
each disposition. Guidance: CLAUDE.md "Public-docs completion check" and
[`docs/reference/release-process.md`](docs/reference/release-process.md).

## Changed packages (`src/` since the previous release)

| Package | Changed src files | Changelog summary | Disposition |
|---|--:|---|---|
| `@chestnutlabs/gcode-bgcode` | 7 | A hostile `.bgcode` whose DEFLATE block inflates past the output cap (or past its own declared size) now | Status: pending |
| `@chestnutlabs/gcode-containers` | 10 | Fix a hostile `.gcode.3mf` / 3MF file freezing the load instead of failing with an error. When a compressed entry's headers claimed a small  | Status: pending |
| `@chestnutlabs/gcode-dialects` | 2 | _(version bump only — no src changelog summary)_ | Status: pending |
| `@chestnutlabs/gcode-model-renderer` | 2 | The archive-wide expanded-size cap (`maxExpandedBytesTotal`, default 1 GiB) is now enforced. It was | Status: pending |
| `@chestnutlabs/gcode-parser` | 2 | Fix the preview getting stuck after re-parsing the same bytes. Parsing a `Uint8Array` hands its buffer to the worker, which leaves it empty. | Status: pending |
| `@chestnutlabs/gcode-preview-core` | 1 | _(version bump only — no src changelog summary)_ | Status: pending |
| `@chestnutlabs/gcode-preview-vue` | 2 | _(version bump only — no src changelog summary)_ | Status: pending |
| `@chestnutlabs/gcode-renderer-three` | 1 | _(version bump only — no src changelog summary)_ | Status: pending |
| `@chestnutlabs/toolpath-core` | 1 | _(version bump only — no src changelog summary)_ | Status: pending |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** pending — README / Pages homepage / feature gallery still describe the product accurately for this release.
- **Docs review:** pending — manual, package READMEs, examples, and quick-start match the shipped API.
- **Visual review:** pending — every changed user-facing capability is visually documented, or the coverage matrix records why not. **UI parity:** if the app/controls/adapters changed, the app-UI screenshots (`docs/media/app-*.png`, regenerate with `npm run docs:shots:app`) and the capability renders (`npm run docs:shots`) show the CURRENT UI — the README must not lead with a screenshot from an older layout — and the live demos (`npm run docs:demos` → Pages `/demos/`) build and run on the published SDK.

_Resolve each marker above by replacing `pending` with `resolved` once reconciled._
