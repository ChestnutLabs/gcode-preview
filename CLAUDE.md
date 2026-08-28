# CLAUDE.md

Project instructions for Claude Code and other agents working in this repository.

## What this project is

A browser G-code / toolpath toolkit: parse `.gcode`, `.gcode.3mf`, and Prusa `.bgcode` off the main
thread into a neutral intermediate representation (`ToolpathIR`) and render it with Three.js or a
Canvas 2D fallback. It ships as 14 lockstep-versioned `@chestnutlabs/*` packages plus Vue, React,
Svelte, and Web Component adapters over one shared engine. It began as a fork of
`xyz-tools/gcode-preview` — attribution and provenance are load-bearing (see `NOTICE.md`).

## Documentation standard (mandatory)

**When you create or modify any user-facing documentation, follow
[`docs/USER_FACING_DOCS_STYLE.md`](docs/USER_FACING_DOCS_STYLE.md).** This is not optional.

User-facing documentation includes:

- the root `README.md`
- package READMEs meant for consumers (`packages/*/README.md`)
- getting-started docs, the manual (`docs/manual/`), feature guides, and tutorials
- public examples (`tools/example-*`, `tools/demo`)
- any other page a library consumer reads

The short version of the standard: audience first, product before implementation, progressive
disclosure, evidence over adjectives, real screenshots from the current build, and preserve the
project's honesty model (`known` / `inferred` / `approximated` / `unavailable`, and accurate
hardware-validation claims). Do not open user-facing pages with internal architecture terms, epic
status, or governance vocabulary.

**Do not** apply this tone to maintainer/internal docs — Design Documents (`docs/design/`), Research
Records (`docs/research/`), ADRs (`docs/adr/`), the founding planning set (`docs/0*_*.md`),
compatibility audits, security reviews, and release/governance records have a different job and
their own conventions. Leave their precision and process vocabulary intact.

## Public-docs completion check

Treat documentation as part of finishing user-visible work. When a change adds or materially
changes a user-visible capability, deliberately answer (a screenshot is not required every time —
deliberate consideration is):

1. Does the root README need to change?
2. Does a package README or user guide need to change?
3. Does an existing screenshot now misrepresent the software?
4. Would one new screenshot make this feature substantially easier to understand?
5. Do the quick-start and example code still show the recommended API?

If visible behavior changed, regenerate the affected media with
[`tools/screenshots/`](tools/screenshots/README.md) rather than leaving a stale image in place.
Every user-facing feature is **visually documented somewhere** unless the visual coverage matrix
([`docs/VISUAL_FEATURE_COVERAGE.md`](docs/VISUAL_FEATURE_COVERAGE.md)) records why not — see the
visual standard in [`docs/USER_FACING_DOCS_STYLE.md`](docs/USER_FACING_DOCS_STYLE.md) §6/§8.

**Docs freshness is enforced at release time, not left as post-release cleanup.** The `version`
script auto-stamps the deterministic "vX.Y.Z is on npm" strings into the generated Version PR,
drops a `RELEASE_NOTES_DRAFT.md` to seed the `docs/README` "Current state" narrative + history
(fold it in, then delete it), and generates `RELEASE_REVIEW.md` — a **per-release Public Product +
Documentation + Visual review** seeded from the changed-capability inventory (every package whose
`src/` changed since the previous tag). The `Docs release gate` (`npm run docs:release-check`) then
**blocks the `dev` → `main` promotion** until every version surface names the version being cut,
`RELEASE_NOTES_DRAFT.md` is gone, **and** `RELEASE_REVIEW.md` is present with every disposition
resolved (each changed package `reviewed` / `no-change-needed` / `not-applicable`, and the Product /
Docs / Visual markers `resolved`). This is enforcement, not a checkbox: reconcile the README, Pages
homepage, feature gallery, manual, demo/examples, screenshots, and the coverage matrix against the
inventory, then resolve the review. Surfaces live in `tools/release/doc-surfaces.mjs`; the flow is
documented in [`docs/reference/release-process.md`](docs/reference/release-process.md).

## Framework parity completion check (mandatory)

**A public capability is not "done" until it has a deliberate parity decision across every framework
adapter** (DD-031). When a change adds or materially changes a consumer-meaningful capability on the
core controller or a renderer, answer each — "not applicable" is a valid, explicit answer, but it
must be a decision, not an omission:

1. Does **core** (`GcodePreviewControls` / `GcodePreviewState` / `PreviewEvent`) expose it correctly?
2. Do **Vue**, **React**, **Svelte**, and the **Web Component** expose it — declaratively where it
   logically belongs, imperatively via `controls` otherwise?
3. Are the **lower-level APIs** (`useGcodePreview` / `createGcodePreview` / `element`) covered?
4. Are **events/callbacks** equivalent (allowing each framework's naming idiom)?
5. Is it exercised by the **portable behavioral suite** (`gcode-preview-core/src/testing.ts`)? The
   controls-completeness **parity guard** there fails CI if a `GcodePreviewControls` method isn't
   reachable through an adapter — add new controls methods to its required list.
6. Does the **Feature Lab demo** expose it, and do the **framework showcase examples** demonstrate it
   where useful?
7. Is it **documented** consistently across the adapter READMEs + `docs/manual/adapters.md`, and does
   **visual coverage** (`docs/VISUAL_FEATURE_COVERAGE.md`) need updating?

Deliberate per-framework differences (e.g. the Web Component's property-vs-attribute split, Svelte's
`.svelte` subpath) are fine — but they must be **documented as intentional**, never accidental drift.
No capability should be reachable only through the `raw.renderer()` escape hatch for lack of a public
surface. The release review (`RELEASE_REVIEW.md`) carries a parity line so this is checked before a cut.

## Repo orientation

- `packages/*` — the 14 published packages (foundation → parse → color → render → adapters). Build
  in dependency order; each package builds itself (`npm run build -w @chestnutlabs/<pkg>`).
- `docs/` — user manual (`manual/`), consumer references (`reference/`, `compatibility/`), and the
  maintainer planning/design/research set.
- `tools/demo` — the showcase app that drives the whole pipeline; `tools/example-{react,svelte}` are
  standalone consumer apps.
- `tools/screenshots` — the documentation-media capture harness.
- `test-data/` — the inherited MIT demo corpus, goldens, and visual baselines.

## Working conventions

- Node ≥ 22. `npm ci` at the root, then build packages in dependency order before running the demo.
- Verify docs links with `npm run docs:links`.
- Match the tone and precision of the file you are editing (see the split above).
- Preserve upstream attribution, `NOTICE.md`, and MIT license terms in any docs change.
