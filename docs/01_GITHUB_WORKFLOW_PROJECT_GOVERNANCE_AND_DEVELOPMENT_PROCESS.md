# Chestnut Labs G-code Preview — GitHub Workflow, Project Governance & Development Process

**Status:** Proposed authoritative process · **Version:** 0.2  
**Prepared:** 2026-07-22

This document defines **how** Chestnut Labs G-code Preview is planned, changed, tested, reviewed,
released, and synchronized with upstream. It is the process companion to
`00_PROJECT_MASTER_PLAN.md`.

Where the master plan and this document conflict on process, this document wins. Where an Epic DD
conflicts with either document outside the DD's approved scope, the founding documents win until
an explicit governance change is approved.

---

## 1. Governance principles

1. **Documentation before architecture-sensitive implementation.**
2. **Stable contracts before polished consumer UI.**
3. **Every implementation issue belongs to exactly one Epic and one milestone.**
4. **Research findings are recorded, not left only in chat or PR comments.**
5. **No direct work on protected branches.**
6. **Upstream changes are adopted deliberately through review, never automatically.**
7. **Tests and redistributable fixtures are required for parser/render behavior changes.**
8. **Performance and memory changes require measurements proportional to risk.**
9. **Public APIs, file formats, and package boundaries require explicit compatibility review.**
10. **AnyBridge is a consumer, not the owner of neutral toolpath architecture.**
11. **Documentation is part of the feature, not optional follow-up work.**
12. **Technical debt is identified, recorded, prioritized, and retired deliberately.**

---

## 2. Artifact hierarchy

| Artifact | Purpose | Location |
|---|---|---|
| Master Plan | Strategic direction, scope, phases, and long-term intent | `docs/00_PROJECT_MASTER_PLAN.md` |
| Governance | Authoritative development process | This document |
| Architecture Boundary | Cross-project ownership and dependency direction | `docs/02_ARCHITECTURE_AND_PACKAGE_BOUNDARIES.md` |
| Milestone | Release-aligned, measurable increment | GitHub Milestone |
| Epic | One major system/delivery area | GitHub Issue labeled `type:epic` |
| Design Document (DD) | Approved implementation architecture for one Epic/system boundary | `docs/design/DD-NNN-*.md` |
| Architecture Decision Record (ADR) | One durable decision and its consequences | `docs/adr/ADR-NNN-*.md` |
| Research Record (RR) | Reproducible evidence, comparison, or experiment | `docs/research/RR-NNN-*.md` |
| Issue | Concrete, reviewable work item under one Epic | GitHub Issue |
| Pull Request | Implementation or documentation change satisfying issues | GitHub PR |
| Release | Versioned package set with notes and compatibility claims | Git tag/GitHub Release/npm |

### 2.1 Artifact rules

- An Epic describes outcomes, boundaries, dependencies, phases, and acceptance criteria. It is not
  a dumping ground for unrelated tasks.
- A milestone groups work that can be completed and evaluated as one increment.
- An implementation issue must be small enough for one focused PR unless the issue explicitly
  justifies multiple PRs.
- A checklist item that grows architecture, new public API, or several independent deliverables is
  promoted to its own issue or Epic after a scope review.
- Chat transcripts, agent plans, and PR descriptions may support decisions but do not replace DDs,
  ADRs, RRs, or issues.

---

## 3. Required planning sequence

For new work, follow this order:

1. Identify the user/problem outcome.
2. Check the master plan, open Epics, milestones, DDs, ADRs, and related issues.
3. Decide whether the work belongs in an existing issue, a new child issue, or a new Epic.
4. Identify dependencies and cross-repository impact.
5. Assign one milestone.
6. Define tests, fixtures, measurements, documentation, and acceptance criteria.
7. If architecture-sensitive, create and approve the required DD/ADR first.
8. Only then begin implementation.

When uncertain, pause at step 3 and produce a scoped planning comment or Research Record. Do not
hide an architectural decision inside an implementation PR.

### 3.1 Contract/core-first implementation order

When work spans multiple layers, implementation proceeds from the neutral contract and core
behavior outward to renderers, framework bindings, and consumer UI:

1. define or confirm the data contract, semantics, errors, capability states, and compatibility
   expectations;
2. add contract tests, fixtures, and acceptance examples;
3. implement the neutral core behavior, such as parsing, normalization, worker messaging, or
   rendering primitives;
4. expose the behavior through the public package API;
5. integrate framework bindings, the reusable viewer surface, and consumer applications;
6. complete the user-facing workflow and its documentation.

Wireframes, mocks, and exploratory UI may be created earlier to validate requirements. They must
not establish a conflicting private contract or force AnyBridge-specific behavior into neutral
packages. Final consumer integration does not begin until the required shared contract is accepted
and testable, unless an approved DD explicitly defines a different sequence.

---

## 4. Design Document gate

### 4.1 Work that requires a DD

A DD is required before implementation if work changes or creates any of the following:

- `ToolpathIR` or another cross-package data contract;
- parser state model, worker protocol, streaming, or buffer layout;
- public package API or package boundaries;
- dialect/container plugin contracts;
- rendering geometry, clipping, GPU resource lifecycle, or quality strategy;
- live progress mapping semantics;
- compatibility/support-level definitions;
- release/versioning/deprecation policy;
- security/resource-limit model;
- AnyBridge/toolpath project ownership boundary.

### 4.2 DD lifecycle

1. Create the Epic.
2. Create the first child issue: `DD: <decision/system>`.
3. Draft the DD in `docs/design/` through a documentation PR.
4. Link alternatives, Research Records, prototypes, and benchmark evidence.
5. Review scope, data/API contracts, lifecycle, errors, security, performance, tests, migration,
   and phased delivery.
6. Resolve blocking review comments.
7. Merge the DD.
8. Mark the DD gate satisfied in the Epic.
9. Begin implementation issues.

### 4.3 DD status

Each DD header must include:

- status: Draft, Proposed, Accepted, Superseded, or Rejected;
- authors/owners;
- date and last revision;
- owning Epic and milestone;
- superseded/superseding records where applicable.

Accepted DDs may change only through a reviewable documentation PR. A major reversal should be an
ADR or superseding DD, not a silent edit that erases the original decision.

---

## 5. Research and prototype rules

Research and spikes may precede a DD, but they do not bypass it.

### 5.1 Research Record requirements

An RR must state:

- question and decision it informs;
- candidates/versions/commits tested;
- environment and reproducible procedure;
- fixture/corpus manifest used;
- measurements and observable results;
- license/provenance concerns;
- limitations and unknowns;
- recommendation and rejected alternatives.

### 5.2 Spike code

- Spike branches use `spike/<issue>-<slug>`.
- Spike code is not production code by default.
- A spike may be merged only into a clearly marked experimental area or when it independently
  meets production standards and the DD gate has been satisfied.
- Results must survive the branch in an RR, fixture, benchmark output, or approved DD.

---

## 6. GitHub branches and repository flow

### 6.1 Long-lived branches

- `main` — stable/releasable Chestnut Labs line; protected.
- `dev` — integration branch for the next release; protected.

If the inherited upstream repository uses another default branch, E0 must document how Chestnut's
`main` and `dev` are established without losing upstream history.

### 6.2 Short-lived branch prefixes

- `feature/<issue>-<slug>`
- `fix/<issue>-<slug>`
- `docs/<issue>-<slug>`
- `test/<issue>-<slug>`
- `refactor/<issue>-<slug>`
- `chore/<issue>-<slug>`
- `spike/<issue>-<slug>`
- `upstream/<date-or-version>-<slug>`
- `release/<version>`
- `hotfix/<issue>-<slug>`

### 6.3 Merge direction

- Normal PRs target `dev`.
- Release PRs target `main` from `release/<version>` or reviewed `dev`, according to the release DD.
- After release, `main` is merged back into `dev` if needed.
- Hotfixes target `main`, then are merged/cherry-picked back to `dev` through a PR.
- Upstream adoption branches target `dev`, never `main` directly.

### 6.4 Protected branch rules

At minimum:

- no direct pushes;
- pull request required;
- required CI checks;
- branch must be current or explicitly conflict-reviewed;
- unresolved review conversations block merge;
- force pushes and deletion disabled;
- one approving review when more than one maintainer is available;
- CODEOWNERS review for public API, license, security, and fixture-manifest changes.

Solo-maintainer reality may require self-merge, but the PR, checks, linked issue, and written review
record still apply.

### 6.5 Commit conventions

- Commits use the Conventional Commits structure: `<type>(optional-scope): <description>`.
- Standard types include `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`,
  and `revert`.
- Breaking changes use `!` and/or a `BREAKING CHANGE:` footer and must satisfy the project's
  breaking-change review and migration rules.
- Commit subjects are imperative, specific, and describe one coherent change.
- Issue, upstream commit, and provenance references belong in the commit body or footer when they
  materially aid traceability.
- Temporary checkpoint commits are cleaned up before merge unless preserving them provides useful
  review or provenance history.

---

## 7. Issue and Epic structure

### 7.1 Epic template requirements

Every Epic includes:

- problem/outcome;
- scope and non-goals;
- dependencies and related repositories/issues;
- DD/RR/ADR gate;
- phased child-issue plan;
- test/fixture/benchmark expectations;
- documentation expectations;
- acceptance and exit criteria;
- risks and deferred work.

### 7.2 Issue template requirements

Every implementation issue includes:

- owning Epic and milestone;
- problem and bounded scope;
- exclusions;
- required inputs/fixtures;
- proposed surface or files when known;
- acceptance criteria;
- tests and measurements;
- documentation/update requirements;
- dependencies/blockers;
- security, licensing, and compatibility impact where applicable.

### 7.3 Parentage

- Every implementation issue belongs to exactly one Epic.
- Cross-cutting relationships use `relates to`, `depends on`, or `blocks`; they do not create two
  parents.
- Cross-repository work has a primary issue in the owning repository and a linked integration issue
  in the consumer repository.

Example: the progress contract belongs to the viewer project; the AnyBridge UI and protocol
translation belong to AnyBridge.

### 7.4 Technical debt management

- Known technical debt must be recorded in an issue, DD, ADR, or explicit PR follow-up; it must not
  survive only as chat context, an unexplained `TODO`, or a review comment.
- A technical-debt issue states the affected area, cause, current consequence, risk of delay,
  intended end state, and a concrete trigger or milestone for repayment.
- Accepted architectural debt is documented in the governing DD or ADR and linked to its repayment
  issue.
- Debt work uses `type:maintenance` plus the relevant `area:*` and risk labels. It still has one
  owning Epic and milestone under the normal parentage rules.
- A PR that introduces debt must explain why it is acceptable, link the follow-up, and avoid
  presenting the temporary state as the final architecture.
- Milestone and release review includes open debt that affects correctness, security, performance,
  public compatibility, maintainability, or the next planned phase.

---

## 8. Labels and milestones

Use structured label prefixes:

- `type:epic`, `type:feature`, `type:defect`, `type:docs`, `type:research`, `type:maintenance`
- `area:ir`, `area:parser`, `area:worker`, `area:renderer`, `area:dialect`, `area:container`,
  `area:vue`, `area:demo`, `area:benchmark`, `area:release`, `area:upstream`
- `status:needs-dd`, `status:needs-research`, `status:blocked`, `status:ready`, `status:deferred`
- `risk:architecture`, `risk:performance`, `risk:security`, `risk:compatibility`, `risk:licensing`
- `consumer:anybridge`
- `good-first-issue`, `help-wanted`, `breaking-change`

Each issue receives one `type:*`, at least one `area:*`, and one milestone. Risk/status labels are
applied only when meaningful.

---

## 9. Pull Request requirements

Every PR must:

- link its issue with `Closes #...` or explain why it is non-closing;
- identify the owning Epic and DD/ADR/RR when applicable;
- summarize the user/architecture outcome;
- list material behavior and API changes;
- identify inherited/upstream code or commits incorporated;
- include tests and fixture/benchmark changes;
- include before/after measurements for performance-sensitive work;
- include visual evidence for rendering/UI changes;
- update documentation and compatibility claims;
- state security, licensing, migration, and breaking-change impact;
- avoid unrelated cleanup.

Draft PRs are encouraged for early visibility but do not satisfy a missing DD gate.

### 9.1 Documentation is part of the feature

- Documentation changes are planned and estimated with the implementation, not after it.
- A behavior, public API, package, supported dialect/container, configuration option, warning, or
  migration is incomplete until its user-facing and maintainer-facing documentation is accurate.
- Documentation normally ships in the same PR. If separation is necessary, the implementation PR
  must link a bounded documentation issue, explain the sequencing, and must not close the parent
  issue until the required documentation is merged.
- Examples, support matrices, API references, migration notes, and architecture records are tested
  or validated where practical so they do not drift from released behavior.
- Documentation-only improvements use `docs/<issue>-<slug>` and remain subject to review and link
  requirements.

### 9.2 Review checklist

Reviewers verify:

- approved scope and dependency direction;
- parser/renderer correctness and honest capability states;
- worker lifecycle, cancellation, and failure behavior;
- memory/GPU/resource cleanup;
- malformed/untrusted input handling;
- cross-browser/Electron impact;
- public API compatibility;
- license/provenance and fixture redistribution;
- tests that would fail before the fix;
- documentation and migration clarity.

---

## 10. Testing and CI policy

### 10.1 Required PR checks

The exact commands are established in E0, but the protected-branch suite must cover:

- formatting/lint;
- type checking;
- unit tests;
- parser/IR fixture tests;
- package build;
- public API/export validation;
- license/notice and fixture-manifest checks;
- small visual/integration smoke tests.

### 10.2 Scheduled and release checks

- medium/large corpus benchmarks;
- memory trend checks;
- controlled visual regression suite;
- browser matrix and Electron-relevant smoke tests;
- dependency/security review;
- package-size trend;
- malformed/adversarial corpus.

Performance tests that are too noisy for a hard PR gate should publish trend artifacts and become a
release gate when a statistically meaningful regression threshold is defined.

### 10.3 Defect rule

A parser, source-mapping, geometry, or compatibility defect requires the smallest legal,
redistributable reproduction possible and a regression test. If the original file cannot be
committed, create a sanitized/minimized fixture and record the transformation/provenance.

---

## 11. Corpus and fixture governance

Every committed fixture must have a manifest record containing:

- stable fixture ID;
- filename/hash;
- origin and contributor;
- redistribution permission/license;
- sanitized fields;
- slicer and version;
- target firmware/printer family where relevant;
- features exercised;
- expected support/capabilities;
- size tier;
- known limitations.

Do not commit proprietary models, customer production files, private directory paths, network
identifiers, user names, or embedded thumbnails without permission and sanitization.

Large fixtures may be stored outside the Git history only through an approved, reproducible corpus
process. CI must never silently depend on a maintainer's private files.

---

## 12. Upstream adoption process

No automatic synchronization is allowed once Chestnut Labs begins to diverge.

For each upstream adoption batch:

1. Open an issue or RR identifying upstream range/commits and motivation.
2. Fetch `upstream`; do not rewrite protected Chestnut branches.
3. Create `upstream/<date-or-version>-<slug>` from the appropriate Chestnut base.
4. Review commit-by-commit for architecture, tests, license, API, and behavior impact.
5. Prefer cherry-picking or manually adapting discrete fixes after major divergence.
6. Run the complete relevant corpus and benchmarks.
7. Open a PR to `dev` with an adoption ledger.
8. Record accepted, adapted, deferred, and rejected upstream changes.

Contributions back upstream are optional. They use a focused branch/PR and must not expose
Chestnut-only plans, credentials, private fixtures, or unreleased consumer details.

---

## 13. Public API and compatibility governance

- Packages use semantic versioning once published.
- Pre-1.0 releases may change, but each breaking change still requires a migration note.
- Public exports are explicit; deep imports are unsupported unless documented.
- `ToolpathIR` includes a schema/API version separate from package version when serialized or
  persisted.
- Parser output must expose capability/warning states instead of silently changing semantics.
- Support matrices name tested slicer/format/version families and evidence dates.
- Deprecations remain for at least one documented minor release unless a security issue requires
  immediate removal.
- Breaking changes require the `breaking-change` label, DD/ADR review, release notes, and an
  AnyBridge impact check.

---

## 14. Release process

The release DD may refine tooling, but each release must:

1. Define package/version scope and milestone contents.
2. Close or deliberately defer every milestone issue.
3. Pass required CI, compatibility, and release benchmark gates.
4. Update changelog, API docs, support matrix, notices, and migration guidance.
5. Test packages as packed artifacts in the demo and designated consumer fixture.
6. Create a release PR to `main`.
7. Tag the exact released commit.
8. Publish from protected CI with provenance where supported.
9. Create GitHub Release notes.
10. Verify install/import of the published artifacts.

Packages are not published manually from an unreviewed workstation once CI publication exists.

---

## 15. Security response

- Security-sensitive reports should use GitHub private vulnerability reporting when enabled.
- Do not require public proof-of-concept files for exploitable archive/parser failures.
- Resource-exhaustion and malformed-container defects are treated as security/reliability work.
- Secrets must never appear in fixtures, Actions logs, demo URLs, or benchmark reports.
- Dependency changes with parsing/archive/WebGL impact require license and security review.

---

## 16. Contribution and maintainer model

The initial project is Chestnut Labs maintainer-led.

- Maintainers approve roadmap, DDs, public APIs, releases, and upstream adoption.
- External contributions follow the same issue, test, license, and review gates.
- No Contributor License Agreement is required initially unless later legal/governance review
  establishes one.
- Contributors certify they may submit their work and retain required attribution. A DCO/sign-off
  workflow may be enabled before accepting significant external contributions.
- Conduct expectations are documented in `CODE_OF_CONDUCT.md` before broad community promotion.

---

## 17. Cross-repository coordination with AnyBridge

- Neutral capability belongs in `chestnutlabs/gcode-preview`.
- AnyBridge integration belongs in AnyBridge.
- A shared contract change begins in the owning viewer Epic/DD.
- The AnyBridge integration issue pins the compatible package/contract range and links the viewer
  issue/release.
- AnyBridge must not copy/fork internal parser code into its own repository.
- Temporary package linking during coordinated development is allowed, but committed AnyBridge
  builds must resolve reproducibly.

---

## 18. Definition of Ready

An implementation issue is ready when:

- it has one Epic and milestone;
- scope/non-goals and acceptance criteria are concrete;
- dependencies are resolved or explicit;
- required DD/ADR is accepted;
- fixtures/data and redistribution status are known;
- test and measurement plan is defined;
- cross-repository and breaking-change impact is identified;
- it carries `status:ready`.

## 19. Definition of Done

An issue is done when:

- acceptance criteria pass;
- tests/fixtures and measurements are committed;
- required docs, support matrix, and migration notes are updated;
- license/provenance is correct;
- CI is green;
- PR review is resolved and merged through the correct branch;
- linked follow-ups/deferred work are filed rather than hidden in comments;
- the Epic checklist reflects the outcome.

---

## 20. Governance changes

Changes to this document require:

- a dedicated governance issue;
- rationale and affected workflows;
- compatibility/migration impact for open work;
- a documentation PR;
- explicit maintainer approval;
- version/date update.

Routine wording corrections may use a documentation issue, but process changes must not be bundled
with implementation PRs.
