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

# Release review — v0.21.2

**Review version:** v0.21.2
**Changed-capability inventory diffed against:** `v0.21.1`

This artifact records the per-release **Public Product + Documentation + Visual** reconciliation:
before the `dev` -> `main` promotion, compare the changed capabilities below against the README,
the Pages homepage, the feature gallery, the manual, the demo and examples, the screenshots, and
the coverage matrix ([`docs/VISUAL_FEATURE_COVERAGE.md`](docs/VISUAL_FEATURE_COVERAGE.md)); then set
each disposition. Guidance: CLAUDE.md "Public-docs completion check" and
[`docs/reference/release-process.md`](docs/reference/release-process.md).

## Changed packages (`src/` since the previous release)

| Package | Changed src files | Changelog summary | Disposition |
|---|--:|---|---|
| `@chestnutlabs/gcode-dialects` | 10 | Hostile-input hardening, second pass. Four more dialect regexes could stall a parse for seconds: | Status: reviewed — no API change. No user doc claims a CRLF limitation or documents object-marker name/id extraction rules; `docs/compatibility/dialects-and-containers.md` OrcaSlicer/Klipper object rows stay accurate (now also on CRLF files). CNC/LinuxCNC detection results are unchanged (O-word + extrusion checks verified equal to the old regexes). Changelog carries the accuracy fixes. |
| `@chestnutlabs/gcode-model-renderer` | 4 | A model 3MF with a single part over the per-entry size cap (`maxExpandedBytesPerEntry`, 512 MiB) is now | Status: reviewed — no API change; tokenizer + config scans byte-identical for well-formed files. The `E_MODEL_PARSE` → `E_MODEL_TOO_LARGE` remap for an oversize single part is not contradicted by any manual/README page (error codes are documented in the typed API); changelog states it. |
| `@chestnutlabs/gcode-renderer-three` | 2 | A consumer image draped on the build plate (`bedSurface.texture`) now renders in its true colours. It | Status: reviewed — `bedSurface.texture` now sRGB. All documentation media use `bedSurface` `none`/`solid` (`tools/screenshots/lib/presentation.mjs`), never a texture, and untextured plates were already correct, so no existing screenshot misrepresents the build. Coverage row "Bed surface / texture themes" unchanged (still "needs screenshot"; DD-032 Lane D adds Studio plate media). |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** resolved — patch release, no new capability; README / Pages homepage / feature gallery need no change.
- **Docs review:** resolved — manual, package READMEs, examples and quick-start unchanged and still match the shipped API; `docs/README.md` Current state + history updated for v0.21.2.
- **Visual review:** resolved — no visible change for any documented render (doc media are untextured); no app/controls/adapters change, so app-UI screenshots and live demos stay current.

_Resolve each marker above by replacing `pending` with `resolved` once reconciled._

**Framework parity (DD-031):** not applicable — no public capability added or changed on core, any adapter, or the model viewer; behavioural suites unchanged.
