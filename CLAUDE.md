# CLAUDE.md

Project instructions for Claude Code and other agents working in this repository.

## What this project is

A browser G-code / toolpath toolkit: parse `.gcode`, `.gcode.3mf`, and Prusa `.bgcode` off the main
thread into a neutral intermediate representation (`ToolpathIR`) and render it with Three.js or a
Canvas 2D fallback. It ships as 13 lockstep-versioned `@chestnutlabs/*` packages plus Vue, React,
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

## Repo orientation

- `packages/*` — the 13 published packages (foundation → parse → color → render → adapters). Build
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
