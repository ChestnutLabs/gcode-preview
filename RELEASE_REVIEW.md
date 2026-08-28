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

# Release review — v0.18.0

**Review version:** v0.18.0
**Changed-capability inventory diffed against:** `v0.17.0`

This artifact records the per-release **Public Product + Documentation + Visual** reconciliation:
before the `dev` -> `main` promotion, compare the changed capabilities below against the README,
the Pages homepage, the feature gallery, the manual, the demo and examples, the screenshots, and
the coverage matrix ([`docs/VISUAL_FEATURE_COVERAGE.md`](docs/VISUAL_FEATURE_COVERAGE.md)); then set
each disposition. Guidance: CLAUDE.md "Public-docs completion check" and
[`docs/reference/release-process.md`](docs/reference/release-process.md).

> **This review (documentation-systematization pass).** v0.18.0 was already published to npm; this
> pass reconciled its public surface retroactively and stood up the enforcement machinery. The two
> shipped feature arcs — DD-017 RS274NGC parametric programs (parser) and DD-030 renderer/viewer
> interop (non-rectangular bed, per-plate render scope, `capture() → Blob`) — are covered by the
> manual (`concept-parametric-programs.md`, `concept-ir-capabilities.md`, `adapters.md`) and the
> package CHANGELOGs. No user-facing surface misrepresents the shipped build.

## Changed packages (`src/` since the previous release)

| Package | Changed src files | Changelog summary | Disposition |
|---|--:|---|---|
| `@chestnutlabs/gcode-model-renderer` | 5 | feat(renderer): interactive view capture() → Blob + per-plate render scope + non-rect bed (DD-030) | Status: reviewed |
| `@chestnutlabs/gcode-parser` | 6 | feat(parser): RS274NGC parameters + expressions + O-word flow + subroutines (DD-017 P1–3) | Status: reviewed |
| `@chestnutlabs/gcode-preview-core` | 3 | feat: capture()/render-scope plumbed through GcodePreviewControls + staged progress (DD-030) | Status: reviewed |
| `@chestnutlabs/gcode-preview-element` | 1 | feat: Web Component inherits imperative capture() (DD-030 D1) | Status: reviewed |
| `@chestnutlabs/gcode-renderer-three` | 8 | feat(renderer): non-rectangular build-bed geometry + frameBounds precedence (DD-030 D3) | Status: reviewed |

Set each **Disposition** to one of `Status: reviewed` / `Status: no-change-needed` /
`Status: not-applicable` (never `Status: pending`).

## Global dispositions

- **Product review:** resolved — README, Pages homepage, and the DD-017/DD-030 capability descriptions accurately describe the v0.18.0 product; no fabricated capability or validation claim.
- **Docs review:** resolved — the manual (parametric-programs + IR-capabilities + adapters), package READMEs, and quick-start match the shipped API; the parametric-programs concept page is now registered in Pages nav and link-checked.
- **Visual review:** resolved — DD-017 is a parser/semantic capability (no new on-screen surface beyond parsed geometry, disclosed via capabilities); DD-030's non-rect bed / per-plate scope / capture map to existing renderer imagery, tracked in `docs/VISUAL_FEATURE_COVERAGE.md`. No changed capability is left visually undocumented without a matrix entry.

_Resolve each marker above by replacing `pending` with `resolved` once reconciled._
