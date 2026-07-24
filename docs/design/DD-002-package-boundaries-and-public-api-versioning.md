# DD-002 — Package Boundaries and Public API Versioning

**Status:** **Accepted (2026-07-22)** <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Chestnut Labs
**Date:** 2026-07-22 · **Last revised:** 2026-07-22
**Owning Epic:** E1 (#2) · **Milestone:** M1
**Supersedes / Superseded by:** none
**Related:** DD-001 (#26), RR-001 (#18, accepted), architecture doc §4 & §12, governance §13, master plan §10,
issues #27 (this DD), #29 (migration)

> **Accepted 2026-07-22.** Defines boundaries, versioning, and tooling; physical package extraction stays
> phased (§7). **Decision log — §6 workspace/package manager → npm workspaces** (keep the inherited toolchain
> and lockfile; revisit pnpm/Turborepo later only via an ADR). No `@chestnutlabs/*` publish before the release
> DD (E7/DD-008).

---

## 1. Problem
The fork is a **single package** (`gcode-preview`). To let inherited implementation be replaced without
breaking consumers, and to let AnyBridge consume the viewer **through published packages** without the reusable
core ever depending on AnyBridge (master plan §15, architecture §1), we need: a package map + dependency
direction, machine-enforced boundaries, a public-API/versioning policy, and a tooling decision — **before**
extraction churn begins.

## 2. Scope
- The **package map** and **dependency direction** (architecture §3–§4).
- **Dependency guardrails** and how CI enforces them (architecture §12).
- **Public API + versioning** policy (semver, IR schema version, exports, deprecation) (governance §13).
- The **workspace / package-manager** tooling decision (open decision, master plan §18).
- The **phased extraction** sequence (extract only when boundaries prove useful; master plan §10).

## 3. Non-goals
- Physically splitting `src/` into packages now (phased; §7). The near-term deliverable is **module boundaries +
  lint rules inside the single package**, matching the target graph.
- The `ToolpathIR` shape (DD-001).
- Release automation / publish pipeline / deprecation *mechanics* (E7 / DD-008) — DD-002 sets policy; DD-008
  ratifies release tooling.
- Renderer/parser/dialect internals (their Epics/DDs).

## 4. Package map & dependency direction
Target packages (names proposed in architecture §4; the map is the contract, extraction is phased):

| Package | Owns | May depend on | Must NOT import |
|---|---|---|---|
| `@chestnutlabs/toolpath-core` | `ToolpathIR`, capabilities, units/math primitives (DD-001) | — | DOM, `three`, Vue, archive libs, AnyBridge |
| `@chestnutlabs/gcode-parser` | tokenizer, stateful interpretation, worker protocol, IR writer | `toolpath-core`, dialect **contracts** | renderer, `three`, DOM, AnyBridge |
| `@chestnutlabs/gcode-dialects` | slicer/firmware metadata adapters, registry | `toolpath-core` | renderer, UI, AnyBridge |
| `@chestnutlabs/gcode-containers` | input sniffing, safe `.gcode.3mf` extraction | `toolpath-core` | network/printer, AnyBridge |
| `@chestnutlabs/gcode-renderer-three` | Three.js scene/geometry/clip/quality | `toolpath-core`, `three` | parser internals, dialect recognizers, AnyBridge |
| `@chestnutlabs/gcode-preview` | framework-neutral facade (load/cancel/scrub/progress) | all of the above | Vue, AnyBridge |
| `@chestnutlabs/gcode-preview-vue` | thin Vue wrapper/composables | `gcode-preview` (facade) | VueKit, Pinia, AnyBridge stores/adapters |

**Invariants (architecture §1, §12):**
1. Dependencies point **downward**; lower layers never import higher layers.
2. **No reusable package imports AnyBridge or requires an AnyBridge runtime** — the project's core rule.
3. The renderer consumes `ToolpathIR`; it does **not** re-parse G-code or import parser/dialect internals.
4. Public exports are **explicit**; deep imports are unsupported unless documented. Circular package deps fail CI.

## 5. Dependency guardrails (CI-enforced)
Enforced incrementally — first as module-boundary rules within the single package, then across packages:
- **Import-boundary linting** (recommended: `eslint-plugin-import`/`eslint-plugin-boundaries`, or
  `dependency-cruiser`) encoding the table in §4; violations fail lint.
- **No-AnyBridge check:** a rule/test asserting no reusable module imports an AnyBridge path or package.
- **Explicit-exports + no-deep-import** checks; `publint` / `@arethetypeswrong/cli` on packed artifacts once
  packages exist.
- **Circular-dependency** check fails CI.
These land as a bounded implementation issue after acceptance; the *rules* are ratified here.

## 6. Workspace / package manager — DECIDED (npm workspaces)
The inherited repo uses **npm** (`package-lock.json`, `.nvmrc`, npm-based CI). PROJECT_SETUP §6 says use the
upstream-supported toolchain first and not switch build/package tooling before a DD approves it.

| Option | Pros | Cons |
|---|---|---|
| **npm workspaces** *(recommended)* | zero new tooling; keeps inherited lockfile + CI; lowest migration cost | fewer monorepo ergonomics; no built-in task caching |
| pnpm workspaces | fast, strict `node_modules`, good monorepo DX | new tool + CI/lockfile change; contributor onboarding |
| Nx / Turborepo | task orchestration + caching for many packages | heavier; premature for ~7 small packages pre-1.0 |

**Recommendation:** adopt **npm workspaces** for the monorepo, preserving the inherited toolchain and lockfile;
revisit pnpm or Turborepo only if build/release times or dependency strictness demand it, and record any change
as an **ADR**. **Maintainer sign-off requested.**

## 7. Phased extraction (extract only when boundaries prove useful — master plan §10)
1. **Now (this DD):** keep the single `gcode-preview` package; introduce **internal module folders** mirroring
   the target graph and turn on the §5 import-boundary lint. No published-package churn.
2. **After DD-001 Accepted:** extract **`toolpath-core`** first (the IR everyone depends on).
3. Extract `gcode-parser` and `gcode-renderer-three` behind the facade; keep `gcode-preview` as the facade
   package that re-exports the current public surface (compat).
4. `gcode-dialects` / `gcode-containers` extracted as E4 needs them; `gcode-preview-vue` as E6 needs it.
5. **Publish** under the `@chestnutlabs` scope per the release DD (E7 / DD-008) — not before.

## 8. Public API & versioning (governance §13)
- **Semver** once published; **pre-1.0** may break, but **every breaking change ships a migration note** and the
  `breaking-change` label + review.
- **`ToolpathIR` schema/API version is separate** from package version when serialized/persisted (DD-001 §11).
- **Explicit public exports**; deep imports unsupported unless documented. Public-export **snapshot test** guards
  accidental surface changes.
- **Support matrices** name tested slicer/format/firmware families + evidence dates (E4).
- **Deprecations** remain ≥ one documented minor release unless a security issue forces removal.
- **Breaking changes** require DD/ADR review, release notes, and an **AnyBridge impact check** (the consumer
  integration issue pins compatible ranges — governance §17).

## 9. Migration (from the current single package) — see #29
- The current `gcode-preview` npm package becomes the **facade** package; its current public exports are
  preserved through the facade during extraction so existing importers keep working (compat shim where needed).
- Update `docs/UPSTREAM_PROVENANCE.md`: package layout = Chestnut-original; inherited modules = retained/modified
  as they move behind package boundaries.

## 10. Observability / diagnostics
Each package exposes its version; the facade reports the resolved versions of the packages it composes (useful in
bug reports and for the AnyBridge consumer contract test).

## 11. Alternatives considered
- **Boundaries-first vs. monorepo-now:** chose **boundaries-first, extract incrementally** (master plan §10:
  "package extraction occurs only after the boundary DD is approved" and "decides … when it is extracted").
- **Single package forever:** rejected — defeats the reusability goal (a second app consuming without AnyBridge).
- **Package manager:** see §6 [DECISION].

## 12. Risks
| Risk | Mitigation |
|---|---|
| Premature extraction churn | phase it (§7); rules-first, split later |
| AnyBridge/UI concerns leak into core | §5 no-AnyBridge CI guardrail + boundary lint |
| Public API drifts silently | explicit exports + export snapshot test + semver policy |
| Tooling switch disrupts contributors | default to inherited npm; change only via ADR (§6) |

## 13. Phased delivery
1. Ratify the map, guardrails, versioning policy, and package-manager choice (this DD).
2. Implement §5 import-boundary lint within the single package (bounded issue, post-acceptance).
3. Extract `toolpath-core` after DD-001 (coordinated with #29).
4. Subsequent extractions as their Epics require. *No extraction/publish before acceptance.*

## 14. Acceptance criteria
- Package map + dependency direction + the **no-AnyBridge** invariant are ratified and CI-enforceable.
- Public-API/versioning/deprecation policy defined; IR schema version kept separate.
- The **[DECISION]** workspace/package-manager choice is resolved and recorded (ADR if not npm).
- Phased extraction sequence agreed; **no** reusable package depends on AnyBridge.
- No package extraction or `@chestnutlabs/*` publish merged before this DD is **Accepted**.
