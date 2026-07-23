# DD-008 — Release, Publication Readiness, Versioning & Support Policy

**Status:** **Proposed** <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Chestnut Labs
**Date:** 2026-07-23 · **Last revised:** 2026-07-23
**Owning Epic:** E7 (#8) · **Milestone:** M5
**Supersedes / Superseded by:** none
**Related:** DD-002 (public-API/semver *policy* this DD mechanizes; "no publish before the release
gate" = this gate), DD-005 §7.3 (the container security sign-off that carried the fuzzing item),
DD-007 (D3 mandate: the repository-publication pass; D1 amendment: three publishable framework
adapters), `docs/03_UPSTREAM_FORK_LICENSE_AND_CONTRIBUTION_POLICY.md` + `NOTICE.md` +
`docs/UPSTREAM_PROVENANCE.md` (attribution obligations), issue #109 (publication readiness),
issue #118 (full-chrome proposal), issue #125 (this DD), AnyBridge #783 (first consumer switch)

---

> This is the release gate every prior DD deferred to. It decides how the nine `@chestnutlabs/*`
> packages become real, installable, supported artifacts — and it carries the maintainer's
> non-negotiable precondition from DD-007 D3: **the repository must stand on its own publicly
> before any package is released.**

---

## 1. Problem

E0–E6 produced a complete, consumable stack — `toolpath-core`, `gcode-parser`, `gcode-dialects`,
`gcode-containers`, `gcode-renderer-three`, `gcode-preview-core`, and the Vue/React/Svelte
adapters — proven by CI, benchmarks, and a tarball consumer fixture. But nothing is releasable:

- **The repository still reads as the upstream fork.** The root README leads with a fork banner and
  then reproduces the upstream project's README verbatim. The root `package.json` still carries the
  upstream identity (`gcode-preview@3.0.0-alpha.4`, upstream repository/author). Upstream's release
  machinery is still present and live-shaped: `npm-publish.yml` + `npm-publish-alpha.yml` (publish
  the upstream package on release/alpha-push), `announce-release-in-discord.yml`, and two
  `firebase-hosting-*.yml` workflows targeting upstream's Firebase site, plus the upstream `demo/`
  app they deploy.
- **The packages are unpublishable by construction** (deliberately, per DD-002): all nine are
  `private: true`, version `0.0.0`, with intra-workspace dependencies pinned to `"*"`, and no
  repository/author/keywords metadata.
- **There is no versioning, changelog, release, deprecation, or support machinery** — DD-002 set the
  semver *policy* (pre-1.0 may break, every break ships a migration note + AnyBridge impact check)
  but explicitly deferred the *mechanics* to this DD.
- **`main` still sits at the founding baseline** (`develop` @ `15375e56`); the first promotion flow
  is undefined.
- **One security item is contractually open**: E4's container security review (DD-005 §7.3) signed
  off conditional on coverage-guided fuzzing of `readDirectory`/`streamEntry` landing in E7.
- **#118** (optional full-chrome viewer surface) needs a maintainer decision.

## 2. Scope

1. **Repository publication readiness (#109)** — README rewrite, docs completion for public
   consumption, package metadata for all nine packages, upstream attribution posture, licensing/
   contribution review, removal of stale fork material and upstream release machinery.
2. **Versioning model & changelog automation** for the nine-package workspace.
3. **Release/publish flow** — protected-CI publication, npm scope/provenance, `main` promotion,
   release verification (packaged-artifact tests, install/import checks, export validation,
   package-size trend).
4. **Support & deprecation policy** — supported environments/frameworks/bundlers, dependency
   posture (`three`), deprecation window.
5. **Coverage-guided fuzzing** over `gcode-containers` `readDirectory`/`streamEntry` (E4 §7.3).
6. **#118 decision** — the optional full-chrome surface.

## 3. Non-goals

- New engine/renderer/adapter features (any API addition still needs its own DD/issue).
- Advanced rendering, low-resource modes (E8/Future).
- AnyBridge's own migration from tarballs to registry packages (owned by AnyBridge #783; this DD
  only guarantees the artifacts and documents the switch).
- Upstream contribution/back-porting flows (docs/03 governs; nothing here changes it).
- A documentation *website* (docs stay in-repo Markdown for this epic; a site would be a Future
  item).

## 4. Design & decision points

Decision points are marked **D1–D7**. Each lists options with a recommendation; §14's phase plan
assumes the recommendations and will be adjusted to the actual decisions.

### 4.1 D1 — Versioning model: lockstep vs independent

Nine packages whose contracts move together: the IR is shared, the behavioral suite runs
identically across three adapters (DD-007's anti-drift firewall), and every epic so far changed
several packages at once.

- **Option A (recommended): lockstep ("fixed") versioning.** All nine packages share one version
  line, starting at **`0.1.0`**. A release bumps every package (even unchanged ones — npm dedupes
  cheaply and consumers get a single coherent "stack version"). Intra-workspace dependency ranges
  are rewritten at publish to the exact released version (`"*"` never reaches the registry).
  Compatibility statements collapse to one number — "AnyBridge is on 0.3.x" is meaningful. This is
  the three.js/Babylon model and matches how the suite is actually tested (all-at-one-commit; the
  consumer fixture packs all nine together, never mixed versions).
- **Option B: independent semver per package.** Finer-grained, but forces a nine-way compatibility
  matrix that nothing in CI tests (we never test mixed versions), and the adapters' parity rule
  makes independent adapter versions actively misleading.
- Pre-1.0 semantics per DD-002 §8: minor = may break with migration note + AnyBridge impact check;
  patch = fixes. **1.0.0 criteria** (proposed): AnyBridge consuming the registry packages in
  production, one deprecation cycle exercised, and no breaking change for two consecutive minors.

### 4.2 D2 — Changelog & release automation tooling

- **Option A (recommended): Changesets** (`@changesets/cli`) in **fixed** mode over all nine
  packages. PRs that change published behavior add a changeset file (human-written, reviewable in
  the PR — fits the docs-first culture better than commit-message archaeology); release PRs are
  generated (version bumps + per-package `CHANGELOG.md` + root aggregate), and CI publishes on
  merge+tag. Boring, widely used, workspace-native, no publish-on-every-merge surprises.
- **Option B: semantic-release** — derives releases from conventional commits automatically.
  We *do* write conventional commits, but auto-publish-on-merge removes the deliberate release
  decision the governance model wants, and monorepo support is bolted on.
- **Option C: manual versioning + hand-written changelog** — acceptable at this scale but every
  release becomes a nine-file chore with human error in exactly the place (version/range rewriting)
  automation is safest.

### 4.3 D3 — Publish flow, protected CI, and `main` promotion

The epic's standing risk note: *publishing from an unreviewed workstation is prohibited — require
protected CI publication.* Proposed flow (Option A, recommended):

1. **`main` becomes the release branch.** Promotion = a release PR from `dev` → `main` (generated
   by Changesets: version bumps + changelogs), merged only with green required checks. The first
   such PR is the historic promotion of `main` off the founding baseline — it will carry the entire
   E0–E6 delta and the `v0.1.0` bumps. `main` keeps its protection (required `build` check, no
   direct pushes).
2. **Tag + GitHub Release** on `main` (`v0.1.0`, one tag for the lockstep line) triggers the
   **publish workflow**: fresh `npm ci`, full build/test/lint/license gates, packaged-artifact
   verification (§4.6), then `npm publish` for all nine packages with **npm provenance** (OIDC
   trusted publishing — no long-lived npm token in secrets if the registry setup allows; a
   granular automation token as fallback). Publication runs only from this workflow on `main`.
3. **Post-publish verification**: a registry-mode run of the E6 consumer fixture (install the nine
   released versions from the registry into the fixture app instead of local tarballs; same
   contract tests + real worker parse) plus a fresh-`create-vite` smoke install documented in the
   README quick-start form.
4. **Maintainer prerequisites** (cannot be done by automation, needed before phase 6): the
   `chestnutlabs` npm organization must exist and grant publish rights; trusted-publishing (or a
   granular token) must be configured for the repo; 2FA-on-publish policy set at the org level.
- **Option B**: publish on every `main` merge (no tag step) — rejected: removes the deliberate
  release act. **Option C**: manual workstation publish with `--otp` — rejected by the epic's own
  risk note.

### 4.4 D4 — Repository publication pass (#109): identity, README, and upstream-material disposition

The repo must stand alone publicly. Proposed disposition (Option A, recommended — each bullet is
individually overridable):

- **Root README: full rewrite.** Lead with what the project *is now*: the nine-package worker-based
  cross-vendor toolpath stack; feature/capability overview; install + quick-start for **all three
  frameworks** (component and lower-level surface each); the two worker paths (batteries default /
  `createWorker`); supported formats (`.gcode`, `.gcode.3mf` multi-plate), dialects (link the
  compatibility matrix), build-volume and live-progress support (link the reference docs); package
  table; project status; governance pointer; **a prominent "Origin & attribution" section** linking
  upstream, NOTICE.md, docs/03, and UPSTREAM_PROVENANCE.md. The verbatim upstream README is
  **removed from the root** — it remains fully available in git history, in the upstream repo, and
  its obligations are discharged by LICENSE/NOTICE/docs-03 (MIT requires notice preservation, not
  README preservation). Framework packages keep their own READMEs (exist since E6) — reviewed and
  aligned.
- **Upstream release machinery: removed.** `npm-publish.yml`, `npm-publish-alpha.yml` (they would
  publish the *upstream* package name), `announce-release-in-discord.yml` (upstream's Discord),
  `firebase-hosting-merge.yml` + `firebase-hosting-pull-request.yml` (upstream's Firebase project;
  the secrets don't exist in this repo — the workflows are dead weight that misdescribes the repo).
  Replaced by the D3 release workflow.
- **Upstream `demo/` app: removed.** Superseded by `tools/demo` (the working parity/showcase
  harness), `tools/example-react`, `tools/example-svelte`. Its G-code corpus files that our
  fixtures/manifest reference (if any) move under `test-data/` first — verified by the manifest CI
  gate. (Option B: keep it frozen with a "historical" banner — rejected: it's the single largest
  piece of stale fork material and doesn't build against the new stack.)
- **Root `package.json`: becomes the Chestnut workspace root.** `name` →
  `@chestnutlabs/gcode-preview-workspace` (or similar), `private: true` (the root itself never
  publishes), version decoupled from the upstream `3.0.0-alpha.4` line, repository/author/bugs/
  homepage → ChestnutLabs, upstream author credit preserved in NOTICE (not erased from history).
  `engines.node >= 20` declared (matches CI).
- **Nine package manifests completed**: `private` removed (at phase 6, not before), descriptions/
  keywords/homepage/bugs/`repository` (with `directory:`)/author/license/`sideEffects: false`
  audited, `files` whitelists verified against `npm pack --dry-run` snapshots, `exports` maps
  validated (§4.6 tooling).
- **Contribution/status docs reviewed**: CONTRIBUTING/SECURITY/CODE_OF_CONDUCT are already
  Chestnut-authored (E0) — reviewed and refreshed rather than rewritten; PROJECT_SETUP's
  private-source (`ProjectSource/`) handling stays.

### 4.5 D5 — #118: optional full-chrome viewer surface

- **Option A (recommended): staged.** Now (inside #109's docs work): promote `tools/demo` into the
  **polished showcase** — full control panel, dialect/container/progress demonstrations, linked
  from the README as the living demo. Zero new API commitment. Later: `<GcodePreviewStudio>`
  becomes a *demand-driven* Future item requiring its own DD (because the D1-amendment parity rule
  means a Studio component exists ×3 frameworks or not at all — a real API surface with styling
  ownership questions that shouldn't be decided as a release-epic side effect).
- **Option B**: build `<GcodePreviewStudio>` now (×3 frameworks) — rejected for E7: expands a
  release epic with an unbounded UI surface.
- **Option C**: do nothing — rejected: the showcase is nearly free and the README needs a live
  demo target anyway.

### 4.6 D6 — Support & deprecation policy (published with the release)

Proposed support matrix v1 (documented in `docs/reference/support-policy.md` + README):

| Surface | Supported |
|---|---|
| Browsers | evergreen Chromium/Firefox/Safari with `module` workers + WebGL2 (matches DD-003/DD-004 assumptions) |
| Bundlers | Vite (tested in CI via examples + fixture); webpack 5-class bundlers supported via the documented `createWorker` escape hatch |
| Node | ≥ 20 (SSR-import safety only — no headless rendering claim) |
| Vue | `^3.4` (reference adapter) |
| React | `^18 || ^19` |
| Svelte | `^4 || ^5` (raw-`.svelte` shipping means the consumer's compiler is authoritative) |
| three | pinned exact version, currently `0.178.0` (see below) |

- **`three` dependency posture** — sub-decision: **(a) (recommended)** keep `three` a *regular,
  exact-pinned dependency* of `gcode-renderer-three`: zero-setup DX (adapter consumers never
  install three), no accidental version skew inside the stack; consumers who also use three
  directly can dedupe when versions match and we document the caveat. Revisit as a peerDependency
  only if real consumers report duplication pain (that change is breaking → migration note).
  **(b)** peerDependency `^0.178` — upstream's model, but it pushes an install burden onto every
  adapter consumer and lets skew *into* the stack.
- **Deprecation policy**: a deprecated API keeps working for **≥ 1 minor** with a console warning +
  changelog + migration note before removal (pre-1.0); breaking changes carry the
  `breaking-change` label + migration notes + AnyBridge impact check (DD-002 §8, restated as
  release policy).
- Support statements are **evidence-backed**: anything listed as "tested" must map to a CI job or
  a recorded verification; everything else is worded as "expected to work".

### 4.7 D7 — Coverage-guided fuzzing (E4 §7.3 carried item)

Target: `gcode-containers` `readDirectory`/`streamEntry` (attacker-supplied ZIP/3MF bytes; the
package is zero-dep by design and already carries an adversarial corpus + resource limits).

- **Option A (recommended): Jazzer.js** (libFuzzer for Node, genuinely coverage-guided).
  Harness: fuzz both entry points behind the existing resource-limit config; property = no crash /
  no hang / no unbounded allocation; findings minimized and **committed to the adversarial corpus**
  (regression forever, manifest-tracked). Cadence: **per-PR corpus replay** (fast, deterministic —
  the corpus is just more adversarial fixtures) + a **scheduled (weekly) deep run** (time-boxed,
  e.g. 30 min/entry point) on CI, since long fuzz runs don't belong in the PR path.
- **Option B: property-based only (fast-check)** — structured-mutation value, but not
  coverage-guided; acceptable *fallback* if Jazzer proves unworkable on the CI runners, and worth
  keeping for grammar-aware 3MF mutations even under Option A.
- Fuzzing the *parser* text path is explicitly out of scope here (it consumes attacker-supplied
  text too, but has streaming limits and the E2 adversarial corpus; extending fuzzing there is a
  natural follow-up issue, not a release blocker).

## 5. Lifecycle

Release lifecycle: changesets accumulate on `dev` → release PR (`dev`→`main`, generated) → merge →
tag `vX.Y.Z` + GitHub Release → protected publish workflow (build, full gates, packaged-artifact
verification, publish ×9 with provenance) → post-publish registry-mode fixture + smoke install →
release announcement in the GitHub Release notes (changelog aggregate). Docs and board update per
release. `dev` remains the integration branch; nothing else changes in the working rhythm.

## 6. Errors & failure behavior

- Publish workflow is **all-or-nothing in intent**: it publishes in dependency order; if a publish
  fails mid-sequence, the workflow fails loudly and the recovery is a **patch release** (npm
  unpublish is not a tool we rely on; a partial line is repaired by publishing the remainder at
  the same version via a rerun, which npm allows only for unpublished names — otherwise bump).
- A failed post-publish verification (registry fixture red) blocks the release announcement and
  triggers an immediate patch turn; the released-but-unannounced line is marked deprecated on npm
  if actually broken.
- Fuzzing findings are security-triaged per SECURITY.md before corpus commit (no PoC details in
  public issues until fixed — consistent with the DD-005 §7.3 process).

## 7. Security & resource limits

- No long-lived npm tokens if trusted publishing is available; otherwise a granular token scoped
  to the nine packages, stored as a protected-environment secret, publish restricted to the
  release workflow on `main`.
- npm **provenance** attestations on for all packages.
- The license CI gate (E1) stays a release gate; `npm pack --dry-run` snapshots prevent
  accidentally shipping fixtures/ProjectSource-adjacent files (the `files: ["dist"]` whitelists
  already exist — the snapshot test locks them).
- Fuzzing per §4.7 discharges the E4 §7.3 condition.

## 8. Performance / evidence budgets

- **Package-size trend**: min+gz per package recorded per release (baseline: E6 evidence — core
  1.8 / vue 1.4 / react 1.4 / svelte 0.3 kB); budget: wrapper packages stay ≤ 10 kB min+gz
  (DD-007 §8), engine packages get baselines this epic and a ±10% tripwire thereafter.
- **Export/typings validation**: `publint` + `@arethetypeswrong/cli` clean (or documented
  exceptions) for all nine packages, wired into the packaged-artifact CI step.
- **Packaged-artifact tests**: the E6 consumer fixture remains the tarball gate per PR; the
  registry-mode variant runs post-publish.
- **Fuzzing**: throughput and cumulative corpus size reported per scheduled run; zero open
  crash findings is a release gate.
- Reference-machine measurement list (E3 orbit-fps `perfRun()`, E4 adapter overhead, E5 GPU
  ghost-overdraw) stays open as **non-blocking** release evidence, recorded when run.

## 9. Testing

- All existing suites and gates unchanged and required.
- New: `npm pack --dry-run` content snapshots ×9; publint/attw step; registry-mode consumer
  fixture (post-publish); fuzz corpus replay in the PR path; link-check over the rewritten README
  and public docs (the publication pass must not ship dead links).
- The release PR itself is exercised once end-to-end with a **dry-run publish** (`--dry-run` to a
  local registry or npm's dry-run) before the real `v0.1.0`.

## 10. Migration

- For consumers, nothing to migrate *from* (first release); AnyBridge migrates tarball `file:`
  links → registry ranges (recipe already in #783; this DD adds the "switch note" as a phase-6
  deliverable).
- Root `package.json` identity change may affect local tooling that greps the old name — checked
  against `tools/` scripts in phase 1.

## 11. Observability / diagnostics

- Each package already exposes its version (DD-002 §10); the release workflow prints the
  version/tag/provenance summary into the GitHub Release notes.
- Package-size trend and fuzz-run summaries live in `tools/benchmark/results/` like all prior
  evidence.

## 12. Alternatives considered

Covered inline per decision point (§4.1–§4.7). Cross-cutting alternative: *"publish a single
`@chestnutlabs/gcode-preview` umbrella package instead of nine"* — rejected: erases the DD-002
boundary work, forces every consumer to carry three.js-and-everything, and the adapters' peer
ranges (vue/react/svelte) cannot coexist in one manifest sanely.

## 13. Risks

| Risk | Mitigation |
|---|---|
| npm org/scope not ready when phase 6 arrives | Maintainer prerequisite called out in §4.3; phases 1–5 don't depend on it |
| Upstream-material removal deletes something fixtures reference | Manifest CI gate + phase-1 audit before deletion |
| Lockstep versioning bumps packages with no changes | Accepted cost (documented); changelog says "no changes — version alignment" |
| Trusted publishing unsupported for the setup | Granular-token fallback specified |
| Jazzer.js unstable on CI runners | fast-check fallback (§4.7 Option B), corpus replay works either way |
| README rewrite drifts from reality over time | Link-check in CI; docs updates are already part of the per-epic rhythm |
| First `main` promotion is a giant PR | It's a fast-forward-shaped merge of already-reviewed history; the release PR reviews *the release*, not the delta |

## 14. Phased delivery (proposed)

1. **Phase 1 — Repo identity & upstream-material disposition** (#109 part A): root `package.json`
   identity; remove upstream workflows + `demo/` (after corpus audit); nine package manifests
   completed (still `private`); pack-snapshot + publint/attw CI step.
2. **Phase 2 — README & public docs rewrite** (#109 part B): root README (D4 shape, ×3 framework
   quick-starts, both worker paths, support/attribution sections); support-policy reference doc
   (D6); package READMEs aligned; link-check; CONTRIBUTING/status refresh; showcase promotion of
   `tools/demo` (D5, if accepted).
3. **Phase 3 — Versioning & release automation**: Changesets (fixed group) + baseline changesets;
   release workflow (D3) with dry-run publish proof; branch-protection updates for `main`
   promotion.
4. **Phase 4 — Container fuzzing** (E4 §7.3): Jazzer harness ×2 entry points, corpus replay in PR
   path, scheduled deep run, triage process per SECURITY.md.
5. **Phase 5 — Release rehearsal**: full dry-run from release PR to packaged-artifact verification;
   registry-mode fixture ready; #109 checklist walked and checked off item by item.
6. **Phase 6 — `v0.1.0`**: `main` promotion PR, tag + Release, protected publish ×9 with
   provenance, post-publish registry fixture + smoke install, AnyBridge #783 switch note, E7 exit
   evidence report. **Requires the §4.3 maintainer prerequisites.**

Each phase is a separately reviewable PR train with tests; phases 1–2 may interleave with 3–4;
phase 6 is last and gated on everything green.

## 15. Acceptance criteria

- [ ] D1–D7 decided by the maintainer and recorded verbatim; DD marked Accepted
- [ ] Phased issues opened per §14 (adjusted to decisions), including closing #109 and #118
- [ ] Repository stands alone publicly (all #109 checkboxes) **before** phase 6 runs
- [ ] First stable `@chestnutlabs/*` line published from protected CI with provenance; install/
      import verified from the registry
- [ ] Support/deprecation policy published; changelog automation live
- [ ] E4 §7.3 fuzzing condition discharged with corpus committed
- [ ] `main` promoted; founding-baseline freeze formally ends

## Decision log

| Date | Decision | By |
|---|---|---|
| 2026-07-23 | DD-008 drafted as Proposed; decision menu D1–D7 open | Chestnut Labs |
