# Chestnut Labs G-code Preview — GitHub Bootstrap, Epics, Milestones & Next Steps

**Status:** Execution plan · **Version:** 0.1  
**Prepared:** 2026-07-22

This is the handoff for creating the separate Chestnut Labs project. It creates the repository and
planning hierarchy but stops before feature implementation.

---

## 1. Bootstrap outcome

At the end of bootstrap:

- `chestnutlabs/gcode-preview` exists as the public GitHub fork of
  `xyz-tools/gcode-preview`;
- the inherited project builds/tests unchanged;
- the exact upstream baseline is recorded;
- `main` and `dev` workflow is established without losing ancestry;
- founding documents are committed;
- protections, CI baseline, labels, milestones, templates, and project board exist;
- E0 is active and later Epics are created with dependencies;
- no architecture-sensitive implementation has begun without a DD.

---

## 2. Repository bootstrap checklist

### 2.1 Create and inspect

- [ ] Confirm the target GitHub organization/account name and package scope availability.
- [ ] Fork `xyz-tools/gcode-preview` as `chestnutlabs/gcode-preview`.
- [ ] Confirm the fork is public and GitHub shows `forked from xyz-tools/gcode-preview`.
- [ ] Clone the Chestnut fork.
- [ ] Inspect actual default branch, tags, releases, Actions, package scripts, tests, open dependency
  state, and upstream branch layout.
- [ ] Configure and verify `origin` and `upstream` remotes.
- [ ] Record exact current hashes before modifying repository structure.

### 2.2 Establish Chestnut workflow

- [ ] Decide and document how inherited default/development branches map to Chestnut `main` and
  `dev`.
- [ ] Create/protect `main` and `dev` without rewriting inherited public history.
- [ ] Disable direct pushes and force pushes.
- [ ] Configure required checks after the baseline CI is known to pass.
- [ ] Add CODEOWNERS for public API, licenses/notices, security, and fixtures.

### 2.3 Adopt founding documentation

- [ ] Add this planning set under `docs/` using the repository's final naming convention.
- [ ] Add `PROJECT_SETUP.md` at the repository root and confirm it contains no private endpoint,
  account, credential, or corpus data.
- [ ] Add or verify the root `.gitignore` rules for `/ProjectSource/` and local environment files;
  create `ProjectSource/ENVIRONMENT_PRIVATE.md` only in the local checkout.
- [ ] Add a root README section that clearly identifies the Chestnut fork, upstream, license, and
  project direction.
- [ ] Add/update `LICENSE`, `NOTICE.md`, `THIRD_PARTY_NOTICES.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, and `SECURITY.md` as required.
- [ ] Add DD, ADR, RR, Epic, issue, and PR templates.

### 2.4 Prove unchanged baseline

- [ ] Install with the upstream-supported toolchain.
- [ ] Run build, test, type-check, and lint commands unchanged.
- [ ] Run the upstream demo.
- [ ] Record failures separately; do not mix broad modernization into bootstrap.
- [ ] Capture dependency and license inventory.
- [ ] Tag or otherwise record a recoverable Chestnut founding baseline after review.

### 2.5 Create GitHub planning hierarchy

- [ ] Create labels in section 5.
- [ ] Create milestones in section 3.
- [ ] Create Epics in section 4.
- [ ] Create the E0 child issues in section 6.
- [ ] Link AnyBridge `#593` and `#581` from the relevant Epic/integration record.
- [ ] Create a GitHub Project view grouped by milestone/Epic/status.

---

## 3. Proposed milestones

Milestone numbering can follow repository convention after inspection.

| Milestone | Outcome | Exit condition |
|---|---|---|
| M0 — Fork Foundation & Evidence Baseline | Reproducible inherited baseline, governance, upstream audit, corpus start | RR-001 approved; build/tests/benchmarks recorded |
| M1 — Toolpath Core Contracts | `ToolpathIR`, capability model, package/API boundaries | DD-001/DD-002 accepted; contract tests pass |
| M2 — Worker Parser & 3D Viewer MVP | Responsive parser and usable independent 3D viewer | Supported corpus meets approved correctness/resource gates |
| M3 — Cross-Vendor Containers & Dialects | Evidence-backed Orca/Bambu/Prusa/Cura/Klipper/Marlin coverage | Compatibility matrix accepted; partial cases degrade honestly |
| M4 — Live Progress & AnyBridge Integration | Versioned progress mapping and consumable Vue package | Linked AnyBridge integration works without boundary violations |
| M5 — Stable Public Packages | Documented stable package line and support policy | Release gates pass; packages and migration docs published |
| Future — Low-Resource & Advanced Rendering | Optional 2D/advanced engines | Separately scoped DD/Epic |

Avoid assigning calendar dates until E0 measures inherited complexity and maintainer capacity.

---

## 4. Proposed Epics

### E0 — Fork Foundation & Upstream Audit

**Milestone:** M0  
**Outcome:** Create a governed, reproducible Chestnut fork and decide its exact technical baseline.

Scope:

- fork/remotes/branches/protections;
- founding docs/templates/labels/milestones;
- unchanged build/test/demo;
- license/provenance inventory;
- upstream stable/development architecture comparison;
- reference implementation comparison;
- initial corpus and benchmark baseline.

Non-goals: monorepo restructuring, new parser, AnyBridge UI.

Gate: `RR-001 — Upstream Baseline and Architecture Audit`.

### E1 — ToolpathIR & Package Contracts

**Milestone:** M1  
**Depends on:** E0

Scope:

- neutral `ToolpathIR`;
- capabilities/warnings/confidence/source positions;
- package dependency map;
- public facade/versioning;
- compatibility adapter for inherited xyz structures.

Gate: DD-001 and DD-002.

### E2 — Worker Parser & Large-File Pipeline

**Milestone:** M2  
**Depends on:** E1

Scope:

- worker lifecycle/protocol;
- incremental/chunked parsing;
- compact transfer;
- cancellation/limits/failure recovery;
- source indexes;
- parser correctness and performance suite.

Gate: DD-003.

### E3 — Three.js Renderer & Viewer MVP

**Milestone:** M2  
**Depends on:** E1; coordinates with E2

Scope:

- IR-driven 3D renderer;
- full/layer/range views;
- camera/build volume;
- tools/materials/travel/features;
- scrubber and quality modes;
- demo and visual regression.

Gate: DD-004.

### E4 — Dialect & Container Compatibility

**Milestone:** M3  
**Depends on:** E1/E2

Scope:

- adapter contract;
- safe `.gcode.3mf`;
- prioritized slicer/firmware metadata;
- multi-tool/material/object/arc coverage;
- compatibility evidence and support tiers.

Gate: DD-005 plus safe-container security review.

### E5 — Live Progress Mapping

**Milestone:** M4  
**Depends on:** E1/E2/E3

Scope:

- normalized exact/derived/approximate observation contract;
- source/layer/percent mapping;
- stale/disconnected/mismatch behavior;
- renderer overlay.

Gate: DD-006 and real AnyBridge telemetry evidence.

### E6 — Vue Package & AnyBridge Consumer Integration

**Milestone:** M4  
**Depends on:** E3/E4/E5

Scope in viewer repository:

- thin reusable Vue wrapper;
- package build/docs/examples;
- consumer contract test fixture.

Scope in AnyBridge linked Epic/issue:

- file/job acquisition;
- telemetry normalization;
- VueKit UI/application workflow;
- feature/permission behavior.

Gate: DD-007 and a linked AnyBridge DD/issue where required.

### E7 — Release, Documentation & Ecosystem

**Milestone:** M5  
**Depends on:** E1–E6 for stable scope

Scope:

- semver/release automation;
- API docs/examples;
- support/deprecation/migration policy;
- package size/security review;
- stable package publication.

Gate: DD-008.

### E8 — Low-Resource Layer Mode

**Milestone:** Future  
**Depends on:** Stable IR and real need evidence

Scope:

- 2D current/adjacent layer renderer over the same IR;
- low-GPU/low-memory selection and UX;
- no second raw-G-code parser.

Gate: separate DD. Keep deferred until 3D MVP evidence identifies supported-device need.

---

## 5. Initial labels

### Type

- `type:epic`
- `type:feature`
- `type:defect`
- `type:docs`
- `type:research`
- `type:maintenance`

### Area

- `area:ir`
- `area:parser`
- `area:worker`
- `area:renderer`
- `area:dialect`
- `area:container`
- `area:vue`
- `area:demo`
- `area:benchmark`
- `area:release`
- `area:upstream`
- `area:governance`

### Status/risk

- `status:needs-dd`
- `status:needs-research`
- `status:blocked`
- `status:ready`
- `status:deferred`
- `risk:architecture`
- `risk:performance`
- `risk:security`
- `risk:compatibility`
- `risk:licensing`

### Consumer/community

- `consumer:anybridge`
- `breaking-change`
- `good-first-issue`
- `help-wanted`

---

## 6. E0 initial issue hierarchy

Create E0 first, then these children in order. Numbers are intentionally omitted until GitHub
assigns them.

1. **Docs: Adopt project master plan and governance**
   - Commit founding documents.
   - Resolve repository-specific names/branches without changing their intent silently.

2. **Foundation: Record fork ancestry, remotes, and branch mapping**
   - Exact hashes, `origin`/`upstream`, default branch, tags, proposed `main`/`dev` mapping.

3. **Research: Build and test the inherited baseline unchanged**
   - Commands, environment, pass/fail evidence, demo output.

4. **Research: Audit upstream stable versus current development architecture**
   - APIs, parser, renderer, streaming/worker support, tests, dependencies, release maturity.

5. **Research: Benchmark xyz-tools against the reference corpus**
   - 10/100/250 MB when available; parse, memory, first render, scrub, cancellation.

6. **Research: Behavioral comparison with Sindarius/Mainsail and Fluidd**
   - Same requirements/corpus where feasible; separate engine behavior from surrounding UI.

7. **Legal: Inventory inherited and third-party licenses/notices**
   - Upstream MIT, dependencies, borrowed/adapted code, demo assets.

8. **Test infrastructure: Define fixture manifest and seed legal corpus**
   - Provenance, permission, versions, expected features/capabilities, sanitization.

9. **RR-001: Upstream Baseline and Architecture Audit**
   - Consolidate issues 2–8; select exact Chestnut baseline; define accepted unknowns.

10. **Foundation: Configure protections, templates, and baseline CI**
    - Protect only checks known to pass or deliberately fix bootstrap failures in scoped issues.

11. **Planning: Create E1 and DD-001/DD-002 child issues**
    - E0 exit work; no implementation inside this issue.

---

## 7. E1 first child issues

After RR-001 is accepted:

1. `DD-001: ToolpathIR and Capability Model`
2. `DD-002: Package Boundaries and Public API Versioning`
3. `Test: Define IR golden fixtures and compatibility assertions`
4. `Migration: Map inherited xyz-tools structures to proposed contracts`
5. Implementation issues created only after DD-001/DD-002 are accepted.

---

## 8. GitHub Project views

Recommended fields:

- Status: Backlog, Research, DD Draft, DD Review, Ready, In Progress, Review, Blocked, Done
- Milestone
- Epic
- Area
- Risk
- Consumer
- Target package

Recommended views:

- Roadmap by milestone/Epic
- DD and research gates
- Current milestone board
- Compatibility/dialect matrix work
- AnyBridge cross-repository integration
- Deferred/future work

---

## 9. Ready-to-use project creation handoff

Paste this into the new project session after creating/selecting the fork and making these documents
available:

> We are creating `chestnutlabs/gcode-preview` as a separate Chestnut Labs project and GitHub fork
> of `xyz-tools/gcode-preview`. Before making changes, read all founding documents in order,
> especially the master plan and the authoritative governance/process document.
>
> This session is planning/bootstrap only. Inspect the actual fork, upstream branches, tags,
> package scripts, tests, licenses, and GitHub state. Do not restructure or implement the new
> viewer architecture yet. Preserve upstream history and attribution.
>
> Follow the bootstrap checklist. Create the proposed milestones, labels, Epics, E0 child issues,
> templates, and project views using proper GitHub hierarchy. Establish the `main`/`dev` workflow
> only after mapping it safely to the inherited branch structure. Build/test the inherited project
> unchanged and create RR-001 with exact commit/version evidence.
>
> Architecture-sensitive implementation is blocked until the owning Epic's DD is authored,
> reviewed, and merged. AnyBridge is the first consumer, but the reusable packages must never
> depend on AnyBridge. At the end, report what was created, the exact upstream baseline, any
> bootstrap failures, and the next DD gate. Do not begin E1 implementation.

---

## 10. What to do in AnyBridge now

1. Keep `#593` focused on bounded header/classification/dispatch safety work.
2. Remove layer/toolpath viewer implementation from `#593` acceptance criteria if still present.
3. Link `#593` and `#581` to a deferred viewer integration record.
4. Create either:
   - a small tracking issue now: “Integrate Chestnut Labs G-code Preview when its consumer contract
     is available”; or
   - a deferred note in the appropriate Epic if the main session should not create an empty issue.
5. Do not build a temporary 2D viewer in AnyBridge.
6. Continue AnyBridge work to `#594` or the next planned issue.

The exact ready-to-paste response is in `05_ANYBRIDGE_HANDOFF.md`.
