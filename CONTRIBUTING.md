# Contributing to Chestnut Labs G-code Preview

Thank you for your interest. This project is Chestnut Labs maintainer-led and follows a
**documentation-first, contract-first** process. The authoritative rules live in
[`docs/01_GITHUB_WORKFLOW_PROJECT_GOVERNANCE_AND_DEVELOPMENT_PROCESS.md`](docs/01_GITHUB_WORKFLOW_PROJECT_GOVERNANCE_AND_DEVELOPMENT_PROCESS.md).
This file is a practical summary; where the two differ, the governance document wins.

## Before you start

1. Read the [Master Plan](docs/00_PROJECT_MASTER_PLAN.md), the
   [Governance & Process](docs/01_GITHUB_WORKFLOW_PROJECT_GOVERNANCE_AND_DEVELOPMENT_PROCESS.md),
   and the [Architecture & Package Boundaries](docs/02_ARCHITECTURE_AND_PACKAGE_BOUNDARIES.md).
2. Check open Epics, milestones, Design Documents (DDs), and issues to see where your work belongs.
3. Every implementation issue belongs to **exactly one Epic and one milestone**.

## The Design Document (DD) gate

Architecture-sensitive work **must** have an accepted DD before implementation. This includes changes
to: `ToolpathIR` or any cross-package contract; the parser state model, worker protocol, streaming, or
buffer layout; public package API or package boundaries; dialect/container plugin contracts; rendering
geometry/clipping/GPU lifecycle/quality; live-progress mapping; compatibility/support definitions;
release/versioning/deprecation policy; the security/resource-limit model; or the AnyBridge/toolpath
ownership boundary. If in doubt, open a `Research: …` or `DD: …` issue first — do not hide an
architectural decision inside an implementation PR.

## Branches

- Protected long-lived branches: **`main`** (stable/releasable) and **`dev`** (integration).
- Base your work on `dev`. **Normal PRs target `dev`.** Do not push directly to protected branches.
- Short-lived branch names: `feature/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<issue>-<slug>`,
  `test/<issue>-<slug>`, `refactor/<issue>-<slug>`, `chore/<issue>-<slug>`, `spike/<issue>-<slug>`,
  `upstream/<date-or-version>-<slug>`, `release/<version>`, `hotfix/<issue>-<slug>`.

> Note: upstream (`xyz-tools/gcode-preview`) uses `develop` as its default branch and has no `main`.
> Chestnut established `main`/`dev` from the recorded founding baseline while preserving upstream
> history and branches. See [`docs/UPSTREAM_PROVENANCE.md`](docs/UPSTREAM_PROVENANCE.md).

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `<type>(optional-scope): <description>`.
Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`. Breaking
changes use `!` and/or a `BREAKING CHANGE:` footer and must satisfy the breaking-change review and
migration rules. Reference issues and, when adopting upstream code, the upstream commit/provenance in
the body or footer.

## Local checks (must pass before a PR)

```bash
npm ci
npm run build       # rollup production build
npm run test        # vitest
npm run typeCheck   # tsc --noEmit
npm run lint        # prettier --check + eslint
# or all at once:
npm run check
```

Line endings are normalized to **LF** via `.gitattributes`; keep `core.autocrlf=false` locally so
`prettier --check` stays green on Windows.

## Tests, fixtures, and measurements

- Parser/renderer/compatibility behavior changes require tests. A defect requires the smallest
  **legal, redistributable** reproduction fixture and a regression test.
- Every committed fixture needs a manifest entry (provenance, redistribution permission, slicer/version,
  target firmware, features, expected capabilities, size tier). See governance §11 and
  [`PROJECT_SETUP.md`](PROJECT_SETUP.md).
- **Never commit** private/customer files, embedded thumbnails, private paths, network identifiers, or
  non-redistributable corpus data. Those live only in the gitignored `ProjectSource/` workspace.
- Performance-sensitive work includes before/after measurements proportional to risk.

## Pull requests

Fill in the [PR template](.github/pull_request_template.md). Every PR links its issue (`Closes #…`),
identifies the owning Epic and any DD/ADR/RR, lists behavior/API changes, includes tests and fixture
changes, notes security/licensing/migration/breaking impact, and updates documentation. **Documentation
is part of the feature**, not follow-up work.

## Package boundaries (hard rule)

Reusable packages (`toolpath-core`, `gcode-parser`, `gcode-dialects`, `gcode-containers`,
`gcode-renderer-three`, `gcode-preview`, `gcode-preview-vue`) **must never import AnyBridge or require
an AnyBridge runtime.** Lower layers must not import higher layers. See
[Architecture & Package Boundaries](docs/02_ARCHITECTURE_AND_PACKAGE_BOUNDARIES.md).

## Upstream changes

Do not use GitHub's "Sync fork" or `gh repo sync` to blindly update protected branches. Upstream
adoption goes through an issue/RR and a reviewed PR to `dev` with an adoption ledger (governance §12,
policy §4).

## Licensing & provenance

By contributing you certify you have the right to submit the work and that any copied/adapted code has
compatible licensing and recorded provenance. No CLA is required initially; a DCO/sign-off workflow may
be enabled before accepting significant external contributions.

## Conduct & security

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities per the
[Security Policy](SECURITY.md) — not via public issues.
