# Release Process (`@chestnutlabs/*`)

**Status:** Live (DD-008 D1/D2/D3, #130) · applies from `v0.1.0`.

All fourteen packages release in **lockstep** (one version line, one tag). Publication happens **only**
from the protected `Release / publish` workflow on a tag from `main` — never from a workstation.

## Flow

1. **During development (on `dev`):** every behavior-changing PR carries a human-written changeset
   (`npx changeset`; enforced by the *Changeset presence* check; docs/test/tooling PRs exempt, or
   label `no-changeset-needed` with justification). Pre-1.0 semantics per the
   [support policy](support-policy.md): minor may break (with `breaking-change` label + migration
   note + AnyBridge impact check), patch = fixes.
2. **Version PR (generated):** the `Release / version PR` workflow maintains a
   `release: version packages (lockstep)` PR against `dev` — lockstep bumps, per-package
   `CHANGELOG.md`s, internal `@chestnutlabs/*` ranges pinned to the exact new version
   (`tools/release/sync-internal-ranges.mjs` — the dev-time `*` wildcard never reaches a tarball;
   `release:sync-check` guards it in the publish gate), and a refreshed lockfile. **Never
   hand-edit versions or changelogs.** Merging it versions `dev`.
   - **Docs land with the release, not after it** (`tools/release/stamp-release-docs.mjs`, run in
     the `version` script so its edits ride *this same PR*): the deterministic "vX.Y.Z is on npm"
     strings — the root `README` lockstep-version note, the manual's published-status line, and the
     `docs/README` published-to-npm line — are **stamped automatically**. The curated
     `docs/README` **"Current state" narrative + release-history list are kept human-written**: the
     stamper drops a `RELEASE_NOTES_DRAFT.md` (proposed lead + history line + deduped changelog
     points) into the PR for the author to fold in, then delete. The single source of truth for
     these surfaces is `tools/release/doc-surfaces.mjs`.
   - **The Public Product + Docs + Visual review is seeded here too.** The same stamper generates
     `RELEASE_REVIEW.md` from a **changed-capability inventory** — every package whose `src/` changed
     since the previous `vX.Y.Z` tag (`changedCapabilityInventory()`), with its changed files and
     changelog summary — each disposition pre-filled `Status: pending`, plus three global markers
     (Product / Docs / Visual) pre-filled `pending`. It is the *inverse* of the notes draft: the
     draft must be **absent** to promote, this review must be **present and fully resolved**. See the
     dedicated review step below.
2a. **Public Product + Documentation + Visual review (required, before promotion):** open
   `RELEASE_REVIEW.md` and reconcile the changed-capability inventory against the whole public
   surface — the root `README`, the Pages homepage, the feature gallery, the manual (`docs/manual/`),
   the demo and `tools/example-*` apps, the screenshots, and the visual coverage matrix
   (`docs/VISUAL_FEATURE_COVERAGE.md`). For each changed package set its disposition to
   `Status: reviewed` / `no-change-needed` / `not-applicable` (never `pending`), regenerating any
   media the change invalidated (`tools/screenshots/`). Then resolve the three global markers by
   replacing `pending` with `resolved`. `npm run docs:release-check` (the `Docs release gate`) reads
   this file and **blocks the promotion PR** until the version matches and every disposition is
   resolved — so the review is enforced, not a reminder.
3. **Promotion PR (`dev` → `main`):** a deliberate PR carrying the versioned state to `main`,
   merged only with the required checks green — including the **`Docs release gate`**
   (`npm run docs:release-check`), which fails the promotion if any version surface, the
   `docs/README` current-state lead, or the release-history list disagrees with the version being
   cut, if `RELEASE_NOTES_DRAFT.md` is still present, or if `RELEASE_REVIEW.md` is missing, names a
   different version, or still carries an unresolved disposition (a `Status: pending` row or a
   Product/Docs/Visual marker not `resolved`). The Public Product + Docs + Visual review (step 2a) is
   thus **enforced by the gate**, not left to a checkbox. The first promotion (`v0.1.0`) ended the
   founding-baseline freeze on `main`.
4. **Tag + GitHub Release:** tag `vX.Y.Z` on `main` and publish a GitHub Release for it. This —
   and nothing else — triggers publication.
5. **`Release / publish` workflow:** verifies the tag is on `main`, fresh `npm ci`, then the full
   repository gate (build, root + package suites, typeCheck, lint, license, docs links, consumer
   fixture, pack-check, sync-check, and `pack:license-check`, which fails if any tarball would ship
   without `LICENSE` and `NOTICE.md`) before a dependency-ordered `npm publish` ×14 with **npm
   provenance**. The orchestrator (`tools/release/publish.mjs`) refuses real publishes outside the
   workflow; `npm run release:dry-run` is the local rehearsal (it exercises the full pack +
   validation path without uploading).
6. **Post-publish verification (phase 6/7):** registry-mode consumer fixture + fresh smoke install
   per the README quick-start; then the release notes are announced.

## Auth (DD-008 D3 as amended)

- **Primary mechanism (from `v0.22.0`, owner decision 2026-11-11, #460):** npm **trusted
  publishing** (OIDC) — no long-lived token, no expiry. Configured on npmjs (an owner step, see the
  checklist below) per package against the **user-owned `@chestnutlabs` scope, this repository and
  the `release-publish.yml` workflow (org conversion is deferred). It needs npm CLI **≥ 11.5.1** and
  Node **≥ 22.14.0**; Node 22.x bundles npm 10, so the workflow's `Install npm for trusted
  publishing` step installs an exact npm 11 pin and fails if either floor is not met. The job
  already grants `id-token: write`. Provenance is generated automatically under trusted publishing;
  `tools/release/publish.mjs` keeps passing `--provenance`, which is redundant there but harmless
  (and still required on the token path). Direct publish with a granular token is itself being
  retired by npm in January 2027, so OIDC is required before then.
- **Auth order:** the npm CLI detects the GitHub Actions OIDC environment and tries trusted
  publishing **first**, falling back to the token in `NODE_AUTH_TOKEN` when OIDC is unavailable or the
  token exchange fails (e.g. no trusted publisher configured for that package) — per
  [docs.npmjs.com/trusted-publishers](https://docs.npmjs.com/trusted-publishers) ("automatically
  detects OIDC environments and uses them for authentication before falling back to traditional
  tokens"). A failed exchange is logged at `verbose` level only, so a run that silently fell back
  to the token looks like a normal publish.
- **Fallback (`v0.22.0` only, until one clean trusted publish):** a **granular access token** stored
  as the `NPM_TOKEN` repo secret (the workflow wires it as `NODE_AUTH_TOKEN`). npm removed classic
  tokens (including the old "Automation" type) in Nov–Dec 2025; granular tokens are the only kind.
  The token must have **all** of:
  - **Read and write** permission on the `@chestnutlabs` packages/scope;
  - **Direct publish** — *not* stage-only (a stage-only token fails with
    `E403 E_STAGE_REQUIRED "This token can only publish to a staging area"`);
  - **Bypass 2FA** enabled (otherwise
    `E403 "Two-factor authentication or granular access token with bypass 2fa enabled is required"`).
  Granular tokens expire (npm caps the lifetime); an expired token surfaces as a misleading
  `E404 '<pkg>@<version>' is not in this registry`. Note the expiry date when rotating.
- **Pre-publish probe:** the `Probe npm publish auth` step in `release-publish.yml` runs before the
  gate and fails only when **neither** path can work:

  | `NPM_TOKEN` | OIDC request env (`ACTIONS_ID_TOKEN_REQUEST_URL` + `_TOKEN`) | Result |
  |---|---|---|
  | set, `npm whoami` accepts it | any | pass (token fallback live) |
  | missing, or rejected by `npm whoami` | present | `::warning::`, pass — publish relies on OIDC |
  | missing, or rejected by `npm whoami` | absent | `::error::`, fail in seconds |

  The runner only exposes the OIDC request env when the job has `id-token: write`, so the check
  proves an id-token *can* be minted, **not** that a trusted publisher is configured on npmjs.com — a
  missing or mistyped trusted publisher with no working token still surfaces at the publish step
  (`ENEEDAUTH` / `E404`). On the token path the probe also **cannot** verify read/write vs
  read-only, stage-only, or Bypass 2FA: there is no non-publishing registry call that proves write
  access (`npm publish --dry-run` does not authenticate, and `npm access list packages` reports the
  owner account's rights, not the token's). Those three are token-creation properties — verify them
  when the token is made.
- **Owner checklist — trusted publishers (before the `v0.22.0` tag).** On npmjs.com, for **each**
  of the 14 packages: *package → Settings → Trusted Publisher → GitHub Actions*, then
  - **Organization or user:** `ChestnutLabs`
  - **Repository:** `gcode-preview`
  - **Workflow filename:** `release-publish.yml` (filename only, not the path)
  - **Environment name:** leave empty (the job uses no GitHub environment)
  - **Allowed actions:** tick **direct `npm publish`**. Configurations created after 2026-09-03
    default to `npm stage publish` only, which this workflow does not use.

  **Timing:** create the configurations within the **2 days before the tag**. npm expires a new
  trusted-publisher configuration that has not completed its first successful publish within 2 days,
  and an expired one can no longer be used or edited (delete and recreate it).

  Packages (from `packages/*/package.json`):
  `@chestnutlabs/toolpath-core`, `@chestnutlabs/gcode-colors`, `@chestnutlabs/gcode-dialects`,
  `@chestnutlabs/gcode-containers`, `@chestnutlabs/gcode-bgcode`, `@chestnutlabs/gcode-parser`,
  `@chestnutlabs/gcode-renderer-three`, `@chestnutlabs/gcode-model-renderer`,
  `@chestnutlabs/gcode-renderer-2d`, `@chestnutlabs/gcode-preview-core`,
  `@chestnutlabs/gcode-preview-vue`, `@chestnutlabs/gcode-preview-react`,
  `@chestnutlabs/gcode-preview-svelte`, `@chestnutlabs/gcode-preview-element`.
- **Follow-up after one clean trusted publish:** per package, *Settings → Publishing access →*
  **Require two-factor authentication and disallow tokens**, then delete the `NPM_TOKEN` repo
  secret. Caution: at the default log level a silent fallback to the token looks identical to an
  OIDC publish (provenance is attached on both paths), so "clean trusted publish" must be confirmed
  deliberately — not inferred from a green run — before the fallback is removed.
- 2FA-on-publish set on the owning account. These are **maintainer prerequisites** for phase 7,
  confirmed during the phase-6 rehearsal.
- **GitHub Actions PR creation** (discovered at the first #130 run): the org-level setting
  *Allow GitHub Actions to create and approve pull requests* (ChestnutLabs → Settings → Actions →
  General), plus the same repo-level toggle, must be enabled for `release-version.yml` to open the
  Version Packages PR itself. Until then the workflow still pushes `changeset-release/dev`
  correctly and the PR is opened manually once — the flow is degraded, not broken.

## Branch-protection plan (documented per #130; applied at the phase-6 rehearsal)

| Branch | Protection |
|---|---|
| `dev` | required check `build` (existing); the *Changeset presence* check runs on every PR |
| `main` | required check `build` (existing, kept name-stable); **add `node-24` as required** at the rehearsal; the **`Docs release gate`** (`docs-release-gate.yml` → `npm run docs:release-check`) runs on every PR to `main` and — since promotion PRs are the only PRs targeting `main` — is the mechanism that enforces both the version surfaces and the resolved `RELEASE_REVIEW.md`; no direct pushes; release PRs (promotion) only |
| tags `v*` | created only on `main` (the publish workflow independently verifies tag ∈ `main` and refuses otherwise) |

## Failure behavior (DD-008 §6)

Publication is dependency-ordered; a mid-sequence failure stops the run loudly. Recovery is a
rerun (npm allows re-publishing a name@version only if that name@version never uploaded) or a
patch release — never `npm unpublish` as a workflow. A red post-publish verification blocks the
announcement and triggers an immediate patch; a genuinely broken published line is deprecated on
npm, not unpublished.
