# RR-001 — Upstream Baseline and Architecture Audit

**Status:** In progress — recommendation proposed (pending full-corpus benchmarks) · **Author:** Chestnut Labs
**Date:** 2026-07-22 · **Owning Epic:** E0 (#1) · **Informs:** E1 DD gate (DD-001 #—, DD-002 #—), baseline selection
**Consolidates:** #11 (ancestry/mapping), #12 (baseline build/test), #13 (architecture audit), #14 (benchmarks),
#15 (reference comparison), #16 (license inventory), #17 (fixture manifest). Branch mapping is recorded in
[`../UPSTREAM_PROVENANCE.md`](../UPSTREAM_PROVENANCE.md).

## 1. Question & the decision it informs
Which upstream branch/commit should Chestnut Labs treat as its **product baseline**, and what inherited
state must E1 design around? This gates E1 (ToolpathIR & package contracts) and the `main` release readiness.

## 2. Candidates / versions / commits tested
| ID | Ref | Commit | Version | Notes |
|---|---|---|---|---|
| **A** | `develop` (fork default) | `15375e56` | `3.0.0-alpha.4` | Current v3 integration line. **Inherited default.** |
| B | `develop` last-green | `940483720d` | `3.0.0-alpha.4` | Commit before the vitest-4 bump broke tests (vitest 3.2.4). |
| C | `releases` = tag `v2.18.0` | `4bba22de` | `2.18.0` | Latest **stable** release; older v2 architecture. |
| D | `alpha` = tag `v3.0.0.alpha.4` | `ef617c4c` | `3.0.0-alpha.x` | v3 next-gen tagged prerelease. |

All candidates are MIT (upstream `xyz-tools/gcode-preview`, identity `remcoder/gcode-preview`).

## 3. Environment & reproducible procedure
- **Local:** Windows 11, Node **v24.16.0**, npm 11.13.0. (Deviation: upstream `.nvmrc`/CI use Node **22.x** —
  documented; does not change the findings below.)
- **Procedure (on candidate A):** `npm ci` → `npm run build` → `npm run test` → `npm run typeCheck` →
  `npm run lint` → `npm run demo` (live-server). Line endings normalized to LF (`.gitattributes`) to match
  Ubuntu CI + Prettier `endOfLine:lf`.

## 4. Fixture / corpus manifest
- The upstream `demo/` default G-code was used as a smoke sample (parsed **97,574** move commands, ~3.6 MB).
- The tiered **10 / 100 / 250 MB** benchmark corpus is **not yet assembled** (redistributable fixtures
  pending — see §7). No private corpus data appears in this record (PROJECT_SETUP §1).

## 5. Measurements & results

### 5.1 Baseline health (candidate A, `develop` @ `15375e56`)
| Gate | Result | Classification |
|---|---|---|
| `npm ci` | PASS — 489 pkgs; **19 audit vulns** (1 low / 8 mod / 8 high / 2 crit) | Inherited |
| `npm run build` (rollup) | PASS — `dist/*.es.js/.js/.d.ts`; benign lil-gui globals warning | Inherited-clean |
| `npm run typeCheck` (tsc) | PASS | Inherited-clean |
| `npm run test` (vitest) | **FAIL — 34/155**, all in `src/__tests__/gcode-preview.ts` | **Inherited defect** |
| `npm run lint` | PASS on LF (failed locally only from Windows CRLF) | Environment (fixed) |
| demo (`live-server`) | PASS — parsed 97,574 commands, rendered | Inherited-clean |

**Test-failure root cause:** candidate A *is* the dependabot **vitest 3.2.4 → 4.1.0** merge (PR #330). Vitest 4
breaks `vi.mocked(Interpreter).mockImplementation(() => mockInterpreter)`, so `new Interpreter()`
(`src/gcode-preview.ts:51`) throws “() => mockInterpreter is not a constructor”. **Upstream's own
`run-tests` CI concluded `failure` for `15375e56`** (prior commit `9404837` = success) — confirming an
inherited, environment-independent breakage, not a Chestnut regression. Fix is a scoped test-harness update
(migrate the mock pattern to vitest-4 semantics); it is **not** product code and **not** modernization.

### 5.2 Architecture audit (inherited)
- **Language/build:** TypeScript; rollup (ESM + UMD + `.d.ts`); vitest + happy-dom; typedoc → `demo/docs`;
  eslint 8 + prettier; npm workspace-less single package; Firebase-hosted demo.
- **Module map (`src/`):** `gcode-parser.ts`, `interpreter.ts`, `state.ts` (machine-state parsing);
  `job.ts`/`layer.ts`/`path.ts` (inherited toolpath structures ≈ proto-IR); `scene-manager.ts` +
  `extrusion-geometry.ts` + `helpers/*` (Three.js rendering, **tube geometry**); `thumbnail.ts`,
  `build-volume.ts`, `bounding-box.ts`, `indexers.ts`, `dev-gui.ts` (lil-gui).
- **KEY FINDING — no Web Worker.** Grep of `src/` finds **no** `Worker`/`postMessage`/`OffscreenCanvas`:
  the parser runs **on the main thread**. This validates the Master Plan's worker-first requirement and is a
  primary motivation for **E2 (Worker Parser & Large-File Pipeline)**.
- **Capabilities present:** G2/G3 arcs, multi-color/multi-tool, tube geometry, PrusaSlicer thumbnail parsing,
  build-volume rendering (per upstream README + parser).
- **No normalized public `ToolpathIR`** or capability/warning model — the inherited structures are
  render-oriented, motivating **E1 (DD-001)**. Renderer and parser are coupled through these structures,
  motivating the IR replacement seam.
- **Runtime deps:** `three@0.178.0` (MIT), `lil-gui@^0.20.0` (MIT).

### 5.3 Stable vs. development divergence
- `v2.18.0` (C) → `develop` (A): **33 files changed, +4,821 / −1,555** in `src/`; `three` `^0.159.0` →
  `0.178.0`; version `2.18.0` → `3.0.0-alpha.4`. The v3 line is a substantial rework (tube geometry,
  render pipeline, deps) and is the architecture aligned with Chestnut's goals.
- `alpha` (D) tracks the tagged v3 prereleases; `develop` (A) is its integration line and is the fork default.

## 6. License / provenance concerns
- Inherited code MIT; upstream `LICENSE` preserved; `NOTICE.md` + `THIRD_PARTY_NOTICES.md` added.
- 19 inherited npm-audit vulnerabilities (dev-tooling dependency tree) recorded; **not** remediated in E0
  (would be modernization). To be triaged in E0.7/E7 with a generated dependency-license + audit report.
- `demo/` sample assets: redistribution rights to be reviewed before any promotion into the tracked fixture
  corpus (E0.7/E0.8).

## 7. Limitations & accepted unknowns
- **Full 10/100/250 MB benchmarks not yet run** — requires the redistributable corpus (E0.5/E0.8). Only a
  single ~3.6 MB smoke sample is measured so far.
- **Reference-viewer behavioral comparison** (Sindarius/Mainsail, Fluidd) is not yet performed at depth
  (E0.6).
- **`alpha` vs `develop` divergence** not diffed in detail (both are the v3 line; assumed close).
- Local Node is 24.x vs CI 22.x; build/typeCheck/lint(LF) pass on both, and the test failure is
  vitest-version-caused (reproduced on upstream CI's Node 22.x).

## 8. Recommendation & rejected alternatives

**Recommended baseline: Candidate A — `develop` @ `15375e56`** (the inherited fork default), with a **scoped
follow-up issue to repair the inherited vitest-4 test-harness breakage** so that `dev`/`main` reach green
before protected-branch **required status checks** are enabled.

**Rationale:** A is the most current v3 architecture (tube geometry, latest `three`, active integration
line) and matches Chestnut's worker-based cross-vendor goals. Its only failing gate is an isolated,
confirmed-inherited **test-harness** issue with a small, well-scoped fix — not a product regression and not
dependency modernization. Basing on A avoids reverting legitimate upstream dependency updates.

**Rejected alternatives:**
- **C (v2.18.0 stable):** older v2 architecture; would discard the v3 rework the project intends to build on.
- **B (last-green `9404837`):** green, but pins vitest 3.2.4 and effectively reverts an upstream update we
  would re-adopt anyway; keep as a **fallback** only if the vitest-4 test repair proves unexpectedly large.
- **D (`alpha` tag):** a tagged snapshot of the same v3 line; `develop` (A) is the appropriate *integration*
  base and is already the fork default.

**Next gate:** on acceptance, open **DD-001 (ToolpathIR & Capability Model)** and **DD-002 (Package
Boundaries & Public API Versioning)** under E1 (#2), and file the scoped vitest-4 test-repair issue under E0.
