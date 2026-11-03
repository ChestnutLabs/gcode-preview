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
| `@chestnutlabs/gcode-bgcode` | 7 | A hostile `.bgcode` whose DEFLATE block inflates past the output cap (or past its own declared size) now | Status: reviewed |
| `@chestnutlabs/gcode-containers` | 10 | Fix a hostile `.gcode.3mf` / 3MF file freezing the load instead of failing with an error. When a compressed entry's headers claimed a small  | Status: reviewed |
| `@chestnutlabs/gcode-dialects` | 2 | _(version bump only — no src changelog summary)_ | Status: no-change-needed |
| `@chestnutlabs/gcode-model-renderer` | 2 | The archive-wide expanded-size cap (`maxExpandedBytesTotal`, default 1 GiB) is now enforced. It was | Status: reviewed |
| `@chestnutlabs/gcode-parser` | 2 | Fix the preview getting stuck after re-parsing the same bytes. Parsing a `Uint8Array` hands its buffer to the worker, which leaves it empty. | Status: reviewed |
| `@chestnutlabs/gcode-preview-core` | 1 | _(version bump only — no src changelog summary)_ | Status: no-change-needed |
| `@chestnutlabs/gcode-preview-vue` | 2 | _(version bump only — no src changelog summary)_ | Status: no-change-needed |
| `@chestnutlabs/gcode-renderer-three` | 1 | _(version bump only — no src changelog summary)_ | Status: no-change-needed |
| `@chestnutlabs/toolpath-core` | 1 | _(version bump only — no src changelog summary)_ | Status: no-change-needed |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** resolved — all four changed capabilities are hostile-input hardening fixes (inflate-past-cap no longer freezes the load; `.bgcode` metadata/thumbnail budget; archive-wide expanded-size cap enforced + limit validation; clean `E_POST_FAILED` on re-parsing transferred bytes). No new or changed user-facing *capability*, so the README, Pages homepage, and feature gallery still describe the product accurately. The `docs/README` "Current state" lead is updated to lead with v0.21.1.
- **Docs review:** resolved — one gap found and closed: the parser re-parse fix (#455/#453) changes re-parse semantics, and the manual's `.gcode.3mf` multi-plate recipe only showed initial plate selection, so [`docs/manual/recipes.md`](docs/manual/recipes.md) now documents how to *switch* plates at runtime (start a fresh parse; `Uint8Array` buffers are transferred, so pass `bytes.slice()`). `docs/manual/adapters.md` makes no false re-parse claim on `dev`; its fuller caveat lands in the in-flight parser worker/session PR (adapters.md is that lane's file). Package READMEs and the quick-start are unaffected — no public API was added or changed. The new error codes (`E_CONTAINER_LIMIT_EXPANDED`, `E_CONTAINER_OPTION`, `E_POST_FAILED`) and the `ContainerLimits`/`cap` validation (NaN/Infinity now throw, so `Infinity`-as-uncapped no longer works) are captured in the package CHANGELOGs; no user-facing doc claimed the old behaviour.
- **Visual review:** resolved — the four fixes are error-path / security hardening with no visual surface: no new UI, controls, adapter props, or rendered output. The app-UI screenshots, capability renders, live demos, and the Visual Feature Coverage Matrix need no change (failure-on-hostile-input is not a visually documented capability). README leads with no stale screenshot — the layout is unchanged since v0.21.0.

_All markers reconciled for v0.21.1 (hostile-file hardening patch)._
