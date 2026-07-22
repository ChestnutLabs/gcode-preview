# Chestnut Labs G-code Preview — Upstream Fork, License & Contribution Policy

**Status:** Proposed authoritative policy · **Version:** 0.1  
**Prepared:** 2026-07-22

This policy governs the relationship between:

- **upstream:** `xyz-tools/gcode-preview`
- **Chestnut fork/origin:** `chestnutlabs/gcode-preview`
- **consumer:** AnyBridge and future applications

---

## 1. What the GitHub fork relationship means

The Chestnut repository is a separate public repository in the same GitHub repository network as
upstream. It begins with upstream's Git history and GitHub displays the ancestry relationship.

The relationship does **not** mean:

- Chestnut changes automatically go upstream;
- upstream changes automatically enter Chestnut branches;
- upstream maintainers control Chestnut issues, releases, or roadmap;
- AnyBridge automatically receives either repository's changes;
- a folder inside AnyBridge could carry the same GitHub fork relationship.

GitHub documents a fork as a separate repository with its own branches, issues, PRs, Actions, and
settings. A public upstream produces a public fork whose visibility cannot be changed independently.

---

## 2. Repository and remote model

For a local Chestnut clone:

```text
origin    -> chestnutlabs/gcode-preview
upstream  -> xyz-tools/gcode-preview
```

- Push Chestnut work only to `origin`.
- Treat `upstream` as fetch-only in normal development.
- Record the exact upstream commit/tag used to create the Chestnut baseline.
- Never use force-sync to overwrite protected Chestnut branches.

Suggested setup after the fork is created:

```bash
git remote -v
git remote add upstream https://github.com/xyz-tools/gcode-preview.git
git fetch upstream --tags
```

Commands are illustrative. The bootstrap session must first inspect the fork's actual default
branch and remotes.

---

## 3. Founding baseline policy

The existence of a fork does not decide which upstream line Chestnut should treat as its product
baseline. E0 must compare:

- the latest published stable release/tag;
- the upstream default/development branch;
- any active next-generation branch relevant to the intended architecture.

The result is recorded in `RR-001 — Upstream Baseline and Architecture Audit` with:

- exact commit hashes;
- build/test results;
- API and architecture differences;
- dependency versions/licenses;
- known defects and open upstream work;
- benchmark/corpus behavior;
- selected Chestnut starting commit and rationale.

Do not restructure the fork before an unchanged baseline can be built and measured.

---

## 4. Sync and adoption policy

### 4.1 No automatic upstream merging

Once Chestnut development begins, GitHub's “Sync fork” button or `gh repo sync` must not be used as
a routine blind update to protected branches. Upstream updates enter through the governance
process and a PR.

### 4.2 Adoption methods

Use the least disruptive method appropriate to divergence:

1. **Fast-forward/merge** — acceptable only while the Chestnut branch intentionally tracks the same
   line and has no conflicting unique architecture.
2. **Cherry-pick** — preferred for isolated compatible upstream fixes.
3. **Manual adaptation** — preferred when the same behavior must be reimplemented against Chestnut
   contracts.
4. **Reject/defer** — valid when an upstream change conflicts with Chestnut scope, security,
   architecture, performance, or compatibility.

### 4.3 Adoption ledger

Each adoption PR records:

- upstream commit/range;
- local issue/RR;
- method: merged, cherry-picked, or adapted;
- source files/subsystems affected;
- license/notice impact;
- tests/fixtures/benchmarks run;
- API/breaking impact;
- accepted, altered, deferred, and rejected items.

---

## 5. License policy

The upstream repository states that it is MIT licensed. Chestnut Labs may modify, redistribute,
and publish inherited code subject to the MIT notice requirements.

### 5.1 Founding recommendation

- Keep the fork and Chestnut additions MIT licensed unless a later, explicit legal/governance
  decision changes the license for independently separable new packages.
- Retain the upstream `LICENSE` and copyright notice.
- Add Chestnut copyright notices without removing upstream notices.
- Preserve third-party notices for dependencies or incorporated code.
- Do not relicense upstream-derived files in a way that removes or contradicts their MIT terms.

An MIT toolpath package can be consumed by an application under a stronger copyleft license. The
consumer's license does not erase the package's MIT notice obligations.

### 5.2 Required files

Before the first Chestnut release, maintain:

- `LICENSE`
- `NOTICE.md` or equivalent attribution/provenance summary
- `THIRD_PARTY_NOTICES.md` when bundled/adapted code requires it
- dependency license report in CI/release artifacts
- fixture-manifest license/permission fields

### 5.3 Source headers

Do not mechanically add large headers to every file without review. Preserve existing headers.
For new files, follow the repository's approved concise header policy. Git history and the notice
files remain part of provenance.

---

## 6. Derived versus independently replaced code

Chestnut is not claiming a clean-room implementation.

Track subsystem provenance in a simple ledger, for example:

| Subsystem/path | Origin | Chestnut status | Notes |
|---|---|---|---|
| inherited parser | xyz-tools commit | modified/replaced/retained | link DD/PR |
| renderer geometry | xyz-tools commit | modified/replaced/retained | link benchmarks |
| `ToolpathIR` | Chestnut new work | original | link DD-001 |
| worker protocol | Chestnut new work | original | link DD-003 |

Replacing all lines of an inherited file does not itself establish formal clean-room status. The
ledger exists for honesty, maintenance, and license review, not marketing claims.

---

## 7. Using other reference implementations

The project may study observable behavior and documentation from Sindarius/Mainsail, Fluidd,
OctoPrint/PrettyGCode, BambuBuddy, PrusaSlicer/libvgcode, slicers, and firmware projects.

Before copying or adapting source:

1. Identify the exact repository, commit, file, and license.
2. Determine whether incorporation is compatible with the intended package license/distribution.
3. Prefer behavior specifications and independently authored integration when a license would
   impose unwanted obligations.
4. Record incorporation in the PR and third-party notices.
5. Never paste code into a PR without provenance.

Code being public does not make it MIT or unconditionally reusable.

---

## 8. Contributing to upstream

Chestnut Labs may contribute focused fixes upstream when doing so is useful.

Suitable upstream contributions include:

- isolated correctness fixes;
- small performance improvements not dependent on Chestnut architecture;
- tests/fixtures Chestnut may legally redistribute;
- documentation corrections;
- broadly useful compatibility work.

Before opening an upstream PR:

- confirm the contributor may submit the code;
- remove Chestnut-only or AnyBridge-specific dependencies;
- use upstream's style, branch, test, and contribution requirements;
- link the Chestnut issue/PR when public and useful;
- avoid private roadmap, security, fixture, or consumer information;
- keep the Chestnut branch available until the contribution is resolved.

Chestnut is not obligated to upstream every change, and upstream is not obligated to accept it.

---

## 9. External contributions to Chestnut

Contributors must:

- target the documented Chestnut integration branch;
- link or create a scoped issue;
- follow DD gates and package boundaries;
- include tests and legal fixture provenance;
- disclose copied/adapted code and licenses;
- certify they have the right to submit the work.

Before broad promotion, add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, and a
security-reporting route.

No CLA is required initially. If significant outside contributions begin, Chestnut may adopt a
DCO/sign-off workflow through a governance change.

---

## 10. Detaching the fork

Do not detach the repository merely because Chestnut diverges technically. The fork ancestry is
accurate and useful.

Consider detachment only if:

- GitHub fork-network constraints materially block project operations;
- repository history/identity must be reorganized for a documented reason;
- attribution and license obligations remain preserved;
- a governance issue and ADR approve the change;
- upstream sync/contribution consequences are understood.

Detaching a GitHub fork does not remove derivative-code license obligations or rewrite history.

---

## 11. References

- Upstream project and MIT declaration: <https://github.com/xyz-tools/gcode-preview>
- GitHub fork reference: <https://docs.github.com/en/pull-requests/reference/forks>
- Configure an upstream remote: <https://docs.github.com/en/pull-requests/how-tos/work-with-forks/configuring-a-remote-repository-for-a-fork>
- Syncing a fork: <https://docs.github.com/en/pull-requests/how-tos/work-with-forks/syncing-a-fork>

