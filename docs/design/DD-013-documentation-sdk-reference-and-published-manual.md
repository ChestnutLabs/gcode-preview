# DD-013 — Documentation, SDK Reference & Published Manual

**Status:** **Proposed** <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Chestnut Labs
**Date:** 2026-07-25 · **Last revised:** 2026-07-25
**Owning Epic:** **E11 — Documentation, SDK Reference & Published Manual** (proposed; post-`v0.2.0`) · **Milestone:** Future *(assignment is a maintainer decision — see D-open)*
**Supersedes / Superseded by:** none
**Related:** DD-002 (package boundaries & **public API versioning** — the API reference documents exactly the public export surface DD-002 governs, and docs versioning tracks the lockstep SemVer), DD-007 (Vue/consumer boundary — the AnyBridge-specific integration guide stays out of scope, §3), DD-008 (release/publication/versioning/support — E7 shipped the README/public-docs rewrite #129 but **not** a generated API-reference site; this DD completes that epic's "Documentation & Ecosystem" ambit and hooks the docs build into the release flow), DD-001 (capability model — a first-class *concept* page the manual must present honestly), DD-005/DD-006/DD-009/DD-010 (their reference docs — dialect matrix, progress contract, still-render, motion coverage — become manual sections). Sibling reserved DDs: `.bgcode` (#188 → DD-011), CNC/laser (#189 → DD-012). Depends on the repo-hygiene refresh (PR #195) that corrected the public README + motion-coverage matrix and removed the dead `PUBLISHING.md`.

---

> **Why now.** All ten `@chestnutlabs/*` packages are public on npm at `v0.2.0`, but there is **no
> generated, browsable, versioned API reference and no published SDK manual**. Documentation today is
> three disconnected layers: (a) ten per-package READMEs (the adapters solid — Vue 104 lines, Element
> 74, Svelte 67, React 60 — the core libs thin — containers 16, dialects 19); (b) six curated reference
> docs under `docs/reference/`; and (c) **good inline TSDoc that nothing surfaces** — `toolpath-core`
> 94 comment blocks, `gcode-parser` 95, `gcode-renderer-three` 121, `gcode-preview-core` 53. The
> ingredients for a real SDK site exist; they are simply not assembled or published. Meanwhile the one
> tool that *could* generate an API reference — the inherited `typedoc` config — is aimed at the wrong
> target: `entryPoints: ["src/*.ts", "src/helpers/*.ts"]` documents the **private inherited engine**
> (the golden-equivalence oracle, not a public package), outputs to a git-ignored `docs-api/`, is run by
> no CI job, and carries an upstream `navigationLinks: { "Demo": "/" }`. It is dormant, not published —
> so nothing wrong is *live* — but it documents the wrong surface and produces nothing consumers can use.

> **This is a proposal awaiting maintainer acceptance.** No implementation, no config changes, and no
> new epic/issues are created until D1–D7 are decided. Per the docs-first rule, the deliberately-kept
> `typedoc`/`rollup` tooling (repo-hygiene decision, PR #195 — kept as harmless vestiges) is **not**
> touched until this DD is accepted.

---

## 1. Problem

The stack is published but under-documented as a *product*. A consumer who installs
`@chestnutlabs/gcode-preview-react` today gets: a decent package README on npm, and — for anything
past the `<GcodePreview>` prop table — nothing. There is no place to browse the full public API
(every exported type, option, event, and capability), no conceptual manual (what `ToolpathIR` is, how
the capability model works, how workers are wired, how live progress maps), and no hosted home that
ties the READMEs, the `docs/reference/` contracts, and the API surface into one navigable, versioned
SDK site.

Three concrete deficiencies:

1. **No generated API reference.** The public export surface DD-002 versions (`src/index.ts` in each
   of the ten packages — all present, each with its own `tsconfig.json`) is documented only by
   whatever inline TSDoc happens to exist, invisible to consumers. TSDoc coverage is *good on the core*
   but uneven and unenforced.
2. **No published manual / SDK home.** The curated prose (`docs/reference/` + per-package READMEs)
   is real but scattered across the repo and npm pages, with no getting-started path, no concepts
   section, no cross-package navigation, and no hosting.
3. **Stale generation tooling.** `typedoc.json` + `typedoc.css` + the `typedoc`/`typedoc:watch`
   scripts point at the inherited `src/` engine, not the packages — latent wrong-surface output.

This is the natural completion of **E7 (Release, Documentation & Ecosystem)**: E7's #129 rewrote the
public README and showcase, but a generated API site + SDK manual was never in E7's scope. It is
architecture-adjacent (it decides a published surface, a toolchain, a hosting/versioning contract, and
a CI accuracy gate that touches every package's public API), so it takes a DD.

## 2. Scope

The **documentation product** for the published packages, end to end:

| Concern | Decision |
|---|---|
| Generation toolchain (API reference + guides) | **D1** |
| Information architecture + single-source rule (READMEs ↔ site ↔ `docs/reference/`) | **D2** |
| Hosting & publish mechanism | **D3** |
| Docs versioning (latest / next / per-release) | **D4** |
| TSDoc **accuracy & completeness** standard + CI enforcement | **D5** |
| Stale-`typedoc` disposition, private-oracle exclusion, governance/CI integration | **D6** |
| Phasing | **D7** |

All within the public packages under `packages/*` and the repo's `docs/` tree. The output is a
published, versioned SDK site (API reference + manual) plus the CI + governance to keep it accurate.

## 3. Non-goals

- **Documenting the inherited `src/` engine.** It is the private golden-equivalence oracle (repo-hygiene
  decision, PR #195), `"private": true` on the workspace root, published to nobody. The API reference
  documents the ten public packages only; the oracle is explicitly excluded.
- **AnyBridge-specific integration docs.** The consumer boundary is DD-007's; AnyBridge's own
  integration recipe lives in AnyBridge (#783), not in this public SDK site. The generic
  "consume in Vue/React/Svelte/vanilla" guides *are* in scope; the AnyBridge-specific wiring is not.
- **A hosted interactive playground / live demo.** `tools/demo` (+ `tools/example-*`) is a separate
  showcase; deploying it is an optional future add-on (noted under D3), not part of this DD's core.
- **Internationalization / translated docs.** English only; i18n is a future DD if ever demanded.
- **Marketing site, videos, blog.** Out of scope — this is developer/SDK documentation.
- **Re-documenting private/internal symbols.** `@internal`-tagged and non-exported API stay excluded
  from the published reference (typedoc `excludeInternal`), same posture as the current config.

> **Privacy invariant (carried from the repo's standing rules).** The docs build must never publish
> `ProjectSource/` (git-ignored private data), `.env*` secrets, or AnyBridge internals. The generator's
> entry points are the packages' public `src/index.ts` surfaces only; the publish job's artifact is the
> built site, never the repo tree.

## 4. Decisions

Marked **D1–D7**, each with options and a recommendation. Two are load-bearing for cost/UX: the
toolchain (D1) and hosting (D3).

### 4.1 D1 — Generation toolchain (API reference + guides)

The API reference should be **generated from TSDoc** (single source of truth = the code), not
hand-maintained. The question is what generates it and whether a site framework wraps it.

- **Option A: `typedoc` monorepo mode only.** Repoint `typedoc` with
  `entryPointStrategy: "packages"` across the ten packages → one unified, searchable, per-package API
  site straight from the existing TSDoc. typedoc 0.28 (already a devDep, installed) supports this
  natively; each package has `src/index.ts` + a `tsconfig.json`, which is exactly what packages-mode
  consumes. Guides (getting-started, concepts) are added as typedoc "documents" (Markdown pages typedoc
  renders alongside the API). Lowest new-dependency cost; one toolchain.
- **Option B (recommended): `typedoc` for the API reference + a static-site framework for the manual.**
  Generate the API reference with typedoc (Option A), and wrap it in a lightweight docs framework
  (**Starlight/Astro** or **VitePress**) that owns the getting-started path, concepts, per-framework
  guides, and navigation, embedding or cross-linking the typedoc output. Best reading experience and
  the clearest split between *hand-written manual* and *generated reference*; the cost is one site
  framework in `tools/docs/` (isolated, never a package dependency).
- **Option C: API Extractor + api-documenter (Microsoft).** Produces an API report + Markdown model.
  Stronger API-review/change-tracking story (an `.api.md` diff per package), but heavier setup, a
  Markdown-only reference, and it duplicates versioning we already get from Changesets. Its best idea —
  a reviewable public-API snapshot — is folded into **D5** instead (typedoc-based), without adopting
  the whole toolchain.
- **Option D: hand-written docs only.** Rejected — unmaintainable across ten packages and it guarantees
  drift between prose and the real exports; the whole point is to generate from TSDoc.

**Recommendation: Option B**, with **Option A as the phase-1 core** (get a correct generated API
reference first; add the site framework in a later phase). Keep the docs site tooling under
`tools/docs/` so it is never confused with a shippable package (boundary lint already forbids packages
depending on tooling).

### 4.2 D2 — Information architecture & the single-source rule

Define the canonical structure and, critically, **where each fact lives once**:

```
Home / Getting started      ── install, the 60-second <GcodePreview>, pick-your-framework
Concepts (the manual)       ── ToolpathIR (SoA), the capability model (DD-001: known/inferred/
                               approximated/unavailable), the worker pipeline, dialects & containers,
                               live progress (DD-006), motion model (DD-010), theming/renderer options
Framework guides            ── Vue · React · Svelte · Web Component · framework-neutral core
Recipes                     ── custom worker, .gcode.3mf multi-plate, headless still render,
                               live printer telemetry, multi-gcode mounting
Reference (curated)         ── the existing docs/reference/* (progress contract, support policy,
                               still-render, dialect/motion compatibility matrices) — moved/linked in
API reference (generated)   ── typedoc: every public export of all ten packages
Migration & changelog       ── SemVer/lockstep notes, per-release changesets, upstream provenance
```

- **Single-source rule (recommended):** the **package READMEs remain the npm front door** and the
  canonical short intro for each package; the site **references/embeds** them rather than paraphrasing,
  so there is exactly one source per fact. The `docs/reference/*` files are the canonical contract
  docs; the site includes them, it does not fork them. Concept/guide prose that today lives nowhere is
  authored **once** in the manual. No fact is maintained in two places.
- **Rejected:** duplicating README content into bespoke site pages (guarantees drift), or moving
  content out of the repo into the site tool (breaks in-repo review + the `docs:links` gate).

**Recommendation:** adopt the structure above and the single-source rule; keep all authored docs in
`docs/` (reviewable, link-checked) and let the site tool consume them.

### 4.3 D3 — Hosting & publish mechanism

- **Option A (recommended): GitHub Pages project site**, deployed by a GitHub Actions workflow
  (`actions/deploy-pages`) that builds the docs and publishes to
  `https://chestnutlabs.github.io/gcode-preview/`. Zero hosting cost, native to the repo, and it can be
  gated to releases (see D4). Set this as the GitHub **About homepage** (superseding the current npm
  link from PR #195) once live.
- **Option B: GitHub Pages + a custom domain** (e.g. `gcode.chestnutlabs.dev`). Same mechanism, nicer
  URL; needs DNS the maintainer controls. Recommended *only if* a domain is available — a decision to
  defer, not block on.
- **Option C: npm README only (status quo).** Rejected as the end state — it is exactly the gap this DD
  exists to close — but it *is* the honest interim until phase 2 ships.

Publish trigger (recommended): build on every PR (verify it compiles, no deploy), and **deploy on
release** (a published GitHub Release / tag), so the live site always matches the latest published
version, with an optional `next` build from `dev`. This mirrors DD-008's release-gated publication.

> **Optional add-on (not core):** the `tools/demo` showcase could be built and deployed to a
> `/demo` path on the same Pages site, giving the docs a live playground. Flagged as a future
> enhancement under E11, not a phase-1 commitment.

### 4.4 D4 — Docs versioning

- **Option A (recommended): "latest" + "next" now; full per-version archive deferred.** Publish one
  live site tracking the latest release (`v0.2.0` → `0.3.0` …), plus an optional `next` preview from
  `dev`. typedoc's `includeVersion` stamps the version; the site header shows it. This matches how a
  fast-moving pre-1.0 lockstep line is actually consumed — everyone is on latest.
- **Option B: full versioned docs** (browsable `v0.1.0` / `v0.2.0` / … archives, à la Docusaurus
  versioning). More faithful but real maintenance overhead (snapshot per release, storage, nav), and of
  low value while the whole line is < 1.0 and lockstep. **Deferred**, revisited at `1.0`.
- **Option C: unversioned.** Rejected — a consumer must know which release a doc describes.

**Recommendation: Option A**, aligned to the DD-008 release flow; reconsider Option B at the `1.0`
milestone.

### 4.5 D5 — TSDoc accuracy & completeness standard + CI enforcement

Generated docs are only as accurate as the TSDoc they come from — this is the decision that makes
"full accurate documentation" enforceable rather than aspirational.

- **Coverage standard (recommended):** **every public export** (each symbol reachable from a package's
  `src/index.ts`) carries a TSDoc summary; public functions/methods document their params, return, and
  thrown/■error behavior; capability-bearing types cross-reference the DD-001 model. `@internal` and
  non-exported symbols are exempt (and excluded from output).
- **Enforcement (recommended, phased):** run typedoc in CI with `--treatWarningsAsErrors` (typedoc
  warns on undocumented/broken-`@link` public symbols) and add **`eslint-plugin-tsdoc`** to validate
  TSDoc *syntax* under the existing `lint` gate. Introduce as **warn-only first** (baseline the current
  gaps), then flip to **error** once the core packages reach 100% public-surface coverage, so the gate
  never lands red on day one.
- **Accuracy (not just presence):** a phase-4 human pass reconciles each package README's claims and
  each `docs/reference/*` contract against the generated reference, so prose and types agree (the same
  discipline that just caught the stale `M82` claim in the README/motion-coverage docs).
- **Rejected:** shipping generated docs with no coverage gate (drift/omissions creep straight back in),
  or a hard 100%-or-fail gate from the outset (blocks progress on the thinly-documented adapters).

**Recommendation:** adopt the coverage standard + phased warn→error enforcement + a phase-4 accuracy
pass. This is the concrete guarantee behind the maintainer's "full accurate documentation" ask.

### 4.6 D6 — Stale-`typedoc` disposition, private-oracle exclusion, governance/CI integration

- **Repoint, don't reinvent (recommended):** replace the inherited `typedoc.json`
  (`entryPoints: src/*.ts`, `navigationLinks: {Demo:"/"}`, `out: docs-api`) with a packages-mode config
  targeting the ten public `src/index.ts` surfaces, dropping the upstream Demo nav, and outputting to
  the docs-site build dir. The inherited `src/` engine is **explicitly not an entry point** (§3). Keep
  `typedoc.css` only if the chosen theme uses it; otherwise retire it with the old config.
- **CI integration:** add a `docs:build` job (non-required at first) that generates the API reference +
  builds the site and fails on typedoc errors (D5). Keep the existing `docs:links` gate; extend it to
  the moved reference docs. The required `build` check is unchanged.
- **Root-script hygiene:** the root `typedoc`/`typedoc:watch` scripts are replaced by the new docs
  build (likely `npm run docs:api` / `docs:site` under `tools/docs/`). The rollup/`build` inherited-
  engine tooling (PR #195, kept) is untouched — orthogonal to docs.
- **Rejected:** a from-scratch generator (throws away working typedoc + existing TSDoc), or leaving the
  stale config in place (latent wrong-surface output).

**Recommendation:** repoint typedoc to the packages, exclude the oracle, wire a non-required
`docs:build` CI job, and route the docs site through `tools/docs/`.

### 4.7 D7 — Phasing

- **Phase 1 — API-reference foundation.** Repoint `typedoc` → the ten packages (monorepo mode), drop
  the Demo/`src/` config, and generate a correct unified API reference; build it in CI (`docs:build`,
  non-required) with `--treatWarningsAsErrors` baselined to warn. **Immediately removes the latent
  wrong-surface problem and yields a real API reference** — no hosting decision required yet.
- **Phase 2 — Publish.** GitHub Actions → GitHub Pages deploy of the API reference (latest), gated per
  D3/D4; set the About homepage to the Pages URL.
- **Phase 3 — Manual/site.** Introduce the site framework (D1-B) under `tools/docs/`; author
  getting-started + concepts + per-framework guides + recipes; fold in `docs/reference/*`; apply the
  single-source rule (D2). Deploy the combined site.
- **Phase 4 — Accuracy gate + versioning.** Flip the TSDoc coverage gate warn→error once core coverage
  is met (D5); reconcile prose vs. generated reference (accuracy pass); add `next` + version stamping
  (D4-A); optional `tools/demo` playground deploy (D3 add-on).

**Rejected:** a single big-bang "docs site" PR — un-reviewable, couples the safe typedoc repoint to
hosting + framework + content-authoring all at once.

## 5. Lifecycle

On acceptance: open **E11 — Documentation, SDK Reference & Published Manual** (milestone per D-open)
owning the four phased implementation issues from §14 (plus a tracking issue to retire/repoint the
stale typedoc config). Each phase is an independently reviewable PR to `dev` with its build/CI wiring,
and — for phases that add a package-facing accuracy gate — a Changeset only if package files change
(docs-tooling-only PRs carry no changeset, matching the `changeset-check` posture that already lets
docs PRs through, e.g. #194/#195). Docs deploys are release-gated (D3), not on every merge.

## 6. Errors & failure behavior

- **Docs build is fail-closed on accuracy, fail-open on deploy.** A typedoc error (broken `@link`,
  undocumented public symbol once the gate is `error`) fails the `docs:build` job so inaccurate docs
  never publish. A *deploy* failure (Pages outage) never blocks package CI — `docs:build` is a separate,
  initially non-required job.
- **No half-published state.** `actions/deploy-pages` publishes an atomic artifact; a failed build
  leaves the previously-deployed site live.
- **Broken internal links** are caught pre-deploy by extending the existing `docs:links` gate to the
  relocated reference docs.

## 7. Security & resource limits

- **Static output, no runtime, no untrusted input.** The published site is static HTML/JS; it accepts
  no user input and executes no G-code. No parser/worker surface is involved.
- **Privacy invariant (§3):** entry points are the public `src/index.ts` surfaces only; the publish
  artifact is the built site, never the repo tree — `ProjectSource/`, `.env*`, and AnyBridge internals
  cannot leak. The deploy workflow uses `GITHUB_TOKEN` with `pages: write` scope only.
- **Supply chain:** a site framework (D1-B) adds devDependencies confined to `tools/docs/`; it is never
  a runtime or package dependency, so it cannot reach consumers. Covered by the existing license gate.

## 8. Performance

Not a runtime-performance decision. The only budget is **docs build time** in CI (typedoc over ten
small packages + a static site build — expected well under a couple of minutes) and the deploy job,
both off the critical `build` path. No consumer-facing perf impact; the SoA/worker budgets (DD-003) are
untouched.

## 9. Testing

- **Build-as-test:** `docs:build` must succeed with zero typedoc errors (D5) — that *is* the API-doc
  regression test. TSDoc syntax validated by `eslint-plugin-tsdoc` under `lint`.
- **Link integrity:** the extended `docs:links` gate over authored docs + relocated reference docs.
- **Coverage report:** typedoc's undocumented-symbol warnings, tracked toward the 100%-core target that
  flips the gate to `error` (D5).
- **Accuracy reconciliation (phase 4):** a checklist pass confirming each README + `docs/reference/*`
  claim matches the generated reference (no repeat of the stale-`M82` class of drift).
- **Deploy smoke:** after phase 2, a link-check against the live Pages URL for the top nav + one API
  page per package.

## 10. Migration

- **Consumer-facing:** additive only — a new docs site + a repointed homepage; no package, API, or IR
  change. Existing README/npm pages keep working (single-source, D2).
- **Repo-facing:** `docs/reference/*` may move under the site's information architecture; redirects/link
  updates handled by the `docs:links` gate. The stale `typedoc.json`/`typedoc.css`/scripts are replaced
  (D6), a documented one-time swap.
- **Governance:** `docs/README.md` (the epic-status index) and the founding-plan docs gain an E11 row;
  DD-008's documentation section is cross-referenced (E11 completes it).

## 11. Observability / diagnostics

- The **generated API reference is itself the primary diagnostic surface** for consumers: every public
  export, its types, and its capability semantics in one browsable place.
- CI surfaces docs health: typedoc warning/error counts (coverage trend), `docs:links` results, and the
  deploy job status. No telemetry is collected from the published site (privacy-preserving; static, no
  analytics unless a later DD adds privacy-reviewed analytics).

## 12. Alternatives considered

- **Do nothing (npm READMEs only).** Rejected as the end state — it is the gap itself (D3-C); accepted
  only as the honest interim before phase 2.
- **Adopt a heavyweight docs platform (full Docusaurus with versioning) up front.** Rejected for now —
  cost/maintenance unjustified pre-1.0 (D4-B); its versioning is deferred, not adopted.
- **API Extractor toolchain.** Rejected as the generator (D1-C); its reviewable public-API-snapshot
  idea is folded into the D5 gate instead.
- **Hand-written API docs.** Rejected — drift-guaranteed across ten packages (D1-D).

## 13. Risks

| Risk | Mitigation |
|---|---|
| Generated reference is sparse where TSDoc is thin (adapters: React/Svelte/Element) | D5 phased warn→error gate + a coverage target; phase-1 baseline makes the gaps visible before the gate bites |
| Docs drift from code over time | Generate from TSDoc (single source, D1); build-as-test (D9); phase-4 accuracy reconciliation |
| README ↔ site content divergence | D2 single-source rule — READMEs referenced/embedded, never paraphrased |
| Publishing leaks private/internal material | §3/§7 privacy invariant — public `src/index.ts` entry points + built-site-only artifact; `ProjectSource/`/`.env*` never in scope |
| Hosting/deploy is flaky or blocks package CI | D6 — `docs:build` is a separate, initially non-required job; deploy failure leaves the prior site live |
| Scope creep (playground, i18n, videos, full versioning) into phase 1 | §3 non-goals + D7 phasing — phase 1 is *only* the typedoc repoint; extras are explicit later/optional |
| Site-framework devDeps expand the supply chain | Confined to `tools/docs/`, never a package/runtime dep; license gate covers it |

## 14. Phased delivery (proposed, foundation-first)

1. **API-reference foundation** — repoint `typedoc` to the ten packages (monorepo mode), exclude the
   `src/` oracle, drop the Demo/`src/` config; generate a unified reference; add a non-required
   `docs:build` CI job (typedoc warnings baselined). *Deliverable: a correct, browsable API reference,
   local + CI. Closes the latent wrong-surface problem.*
2. **Publish** — GitHub Pages deploy workflow (release-gated, D3/D4); homepage → Pages URL.
3. **Manual/site** — site framework under `tools/docs/`; getting-started + concepts + per-framework
   guides + recipes; fold in `docs/reference/*`; single-source READMEs; deploy the combined site.
4. **Accuracy gate + versioning** — flip the TSDoc coverage gate warn→error; prose/reference accuracy
   reconciliation; `next` + version stamping; optional `tools/demo` playground deploy.

## 15. Acceptance criteria

- [ ] D1–D7 decided by the maintainer and recorded verbatim; DD marked **Accepted**; milestone assigned (D-open)
- [ ] **E11 — Documentation, SDK Reference & Published Manual** opened owning the §14 phased issues + a typedoc-repoint tracking issue
- [ ] Phase 1: `typedoc` generates a unified API reference for all **ten** public packages (not the `src/` oracle); `docs:build` runs in CI; the upstream Demo/`src/` config is gone
- [ ] Phase 2: the API reference is live on GitHub Pages, release-gated; the About homepage points at it
- [ ] Phase 3: a published SDK manual (getting-started + concepts + per-framework guides + recipes) with `docs/reference/*` folded in under the single-source rule
- [ ] Phase 4: TSDoc coverage gate enforced (`error`) for the core public surface; prose reconciled against the generated reference; docs version-stamped
- [ ] Privacy invariant upheld — no `ProjectSource/`/`.env*`/AnyBridge-internal content in any published artifact
- [ ] No package public-API, IR, or renderer change; no core package depends on AnyBridge

## Decision log

| Date | Decision | By |
|---|---|---|
| 2026-07-25 | DD-013 drafted as **Proposed**; D1–D7 open. Motivated by the `v0.2.0` publish + the repo-hygiene audit (PR #195) that found `typedoc` aimed at the private `src/` oracle, output git-ignored and unpublished, and good-but-unsurfaced TSDoc across the packages. Proposes **E11 — Documentation, SDK Reference & Published Manual** completing E7/DD-008's "Documentation & Ecosystem" ambit. Numbered DD-013 because **DD-011** (`.bgcode`, #188) and **DD-012** (CNC/laser, #189) are reserved (DD-010 sibling triage) | Chestnut Labs |
| _pending_ | Awaiting maintainer decision on D1–D7, on the milestone, and on opening E11 | Maintainer |
