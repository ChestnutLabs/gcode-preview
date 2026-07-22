# Upstream Provenance, Founding Baseline & Branch Mapping

**Status:** Living record (started at bootstrap; finalized by RR-001) · **Prepared:** 2026-07-22

This record captures the exact inherited baseline, the fork/remote relationship, the `main`/`dev`
branch mapping, and the derived-vs-replaced subsystem ledger required by the
[fork/license policy §6](03_UPSTREAM_FORK_LICENSE_AND_CONTRIBUTION_POLICY.md). It is honesty and
maintenance tooling, **not** a claim of clean-room authorship.

## 1. Fork & remotes

| Role | Repository |
|---|---|
| `origin` | [`ChestnutLabs/gcode-preview`](https://github.com/ChestnutLabs/gcode-preview) (public fork) |
| `upstream` | [`xyz-tools/gcode-preview`](https://github.com/xyz-tools/gcode-preview) — **fetch-only** (push disabled) |

- GitHub confirms `forked from xyz-tools/gcode-preview`. License: MIT. Fork visibility: public.
- Upstream project identity: `remcoder/gcode-preview` (npm package `gcode-preview`).

## 2. Founding baseline (exact)

- **Branch:** `develop` (upstream default) — Chestnut inherited this as the fork default.
- **Commit:** `15375e56129f5a57aebc099ed7bfb5a092dcfb9e`
- **Date/author:** 2026-06-08, Remco Veldkamp
- **Subject:** `Merge pull request #330 … Bump vitest from 3.2.4 to 4.1.0`
- **package.json version at baseline:** `3.0.0-alpha.4` (the `develop` line is the v3 line).

### Upstream branch/tag landscape at fork time

| Ref | Commit | Meaning |
|---|---|---|
| `develop` (default) | `15375e56` | Integration/dev line (v3). |
| `alpha` | `ef617c4c` | = tag `v3.0.0.alpha.4` — v3 next-gen line. |
| `releases` | `4bba22de` | = tag `v2.18.0` — latest **stable** release. |
| last green `develop` | `940483720d` | Commit before the vitest-4 bump broke tests. |

Latest stable release **v2.18.0** (2024-08-12). Latest prerelease **v3.0.0.alpha.4** (2025-07-25).

## 3. `main`/`dev` mapping decision (E0 finding)

**Reality:** upstream has **no `main`/`master`**. Its long-lived branches are `develop` (default),
`alpha` (v3), and `releases` (tracks the latest stable tag).

**Decision (bootstrap):** create Chestnut `main` and `dev` **both at the founding baseline
`15375e56`**, set the fork default branch to **`dev`**, and **preserve** all inherited branches
(`develop`, `alpha`, `releases`, `feature/*`, `dependabot/*`) and tags. No history was rewritten.

**Rationale:** this establishes the governance-required `main`/`dev` workflow without prematurely
choosing a *product* baseline (stable v2 vs. dev/next-gen v3), which is explicitly the output of the
**RR-001** gate. Starting both branches at the same inherited commit avoids an artificial divergence
and keeps full upstream ancestry.

**Caveat (must resolve before treating `main` as releasable):** the founding baseline HEAD ships with
a **failing test suite** inherited from upstream (see §4). `main` therefore inherits a red baseline;
protected-branch **required status checks are deferred** until the suite is green (tracked as E0 work).
Basic protections (require PR, block force-push/deletion) still apply.

## 4. Inherited baseline health (measured; full evidence in RR-001)

| Gate | Result | Classification |
|---|---|---|
| `npm ci` | PASS (489 pkgs; 19 audit vulns: 1 low/8 mod/8 high/2 crit) | Inherited |
| `npm run build` | PASS | Inherited-clean |
| `npm run typeCheck` | PASS | Inherited-clean |
| `npm run test` | **FAIL** — 34/155 fail, all in `src/__tests__/gcode-preview.ts` | **Inherited defect** |
| `npm run lint` | PASS on LF; failed locally only from Windows CRLF | Environment (fixed via `.gitattributes`) |
| demo (`live-server`) | PASS — parsed 97,574 move commands, rendered | Inherited-clean |

**Test failure root cause:** the baseline HEAD *is* the dependabot vitest `3.2.4 → 4.1.0` bump
(PR #330); vitest 4 breaks `vi.mocked(Interpreter).mockImplementation(() => mockInterpreter)` so
`new Interpreter()` throws “() => mockInterpreter is not a constructor”. **Upstream's own CI for
`15375e56` also concluded `failure`** — confirming an inherited, environment-independent breakage,
not a Chestnut regression.

## 5. Derived vs. independently replaced code — ledger

| Subsystem / path | Origin | Chestnut status | Notes |
|---|---|---|---|
| Parser / interpreter (`src/gcode-parser.ts`, `src/interpreter.ts`, `src/state.ts`) | xyz-tools @ `15375e56` | retained (unmodified) | To be evaluated against `ToolpathIR` in E1/E2. |
| Renderer / scene (`src/scene-manager.ts`, `src/extrusion-geometry.ts`, helpers) | xyz-tools @ `15375e56` | retained (unmodified) | Renderer DD is E3. |
| Public facade (`src/gcode-preview.ts`) | xyz-tools @ `15375e56` | retained (unmodified) | Facade contract revisited in E1 (DD-002). |
| `ToolpathIR` (`packages/toolpath-core/`) | Chestnut (new) | **original** | DD-001 Accepted; scaffolded in #32 (PR #33). |
| IR adapter (`src/ir-adapter.ts`) | Chestnut (new) | **original** | DD-001 §9 transitional seam: inherited `Job` → `ToolpathIR` with honest `unavailable` capabilities (#29). |
| Worker protocol | Chestnut (new) | not yet created | Owned by DD-003 (E2). |
| Founding docs, governance, templates, `.gitattributes`, README banner | Chestnut (new) | original | This bootstrap. |
| `.gitignore` `docs` → `/demo/docs/` anchoring | Chestnut (edit) | modified | Frees a tracked `docs/`; keeps generated typedoc output (at `demo/docs`) ignored. |

Update this ledger whenever an inherited subsystem is modified, replaced, or newly authored, linking
the governing DD/PR.
