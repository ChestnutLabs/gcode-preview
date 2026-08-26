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
3. **Promotion PR (`dev` → `main`):** a deliberate PR carrying the versioned state to `main`,
   merged only with the required checks green — including the **`Docs release gate`**
   (`npm run docs:release-check`), which fails the promotion if any version surface, the
   `docs/README` current-state lead, or the release-history list disagrees with the version being
   cut, or if `RELEASE_NOTES_DRAFT.md` is still present. It also prints a screenshots/guides review
   reminder (the judgment call from CLAUDE.md's *Public-docs completion check*; confirmed via the
   promotion PR-template checkbox, not hard-failed). The first promotion (`v0.1.0`) ended the
   founding-baseline freeze on `main`.
4. **Tag + GitHub Release:** tag `vX.Y.Z` on `main` and publish a GitHub Release for it. This —
   and nothing else — triggers publication.
5. **`Release / publish` workflow:** verifies the tag is on `main`, fresh `npm ci`, then the full
   repository gate (build, root + package suites, typeCheck, lint, license, docs links, consumer
   fixture, pack-check, sync-check) before a dependency-ordered `npm publish` ×14 with **npm
   provenance**. The orchestrator (`tools/release/publish.mjs`) refuses real publishes outside the
   workflow; `npm run release:dry-run` is the local rehearsal (it exercises the full pack +
   validation path without uploading).
6. **Post-publish verification (phase 6/7):** registry-mode consumer fixture + fresh smoke install
   per the README quick-start; then the release notes are announced.

## Auth (DD-008 D3 as amended)

- **Intended:** npm **trusted publishing** (OIDC) — no long-lived token. Configured on npmjs
  against the **user-owned `@chestnutlabs` scope** for this repository + the
  `release-publish.yml` workflow (org conversion is deferred and not a `v0.1.0` blocker).
- **Recorded fallback:** a granular automation token scoped to the published packages, stored as the
  `NPM_TOKEN` secret (the workflow already wires it). If the registry cannot create *new* packages
  via OIDC at first publish, `v0.1.0` uses the token and later releases switch to OIDC.
- **Token must bypass 2FA** (learned cutting `v0.1.0`): with 2FA-on-publish set, a plain token gets
  `E403 "Two-factor authentication or granular access token with bypass 2fa enabled is required"`.
  Use a **classic _Automation_ token** (bypasses 2FA by design) or a **Granular** token with
  **"Bypass 2FA" enabled** + read/write on the packages.
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
| `main` | required check `build` (existing, kept name-stable); **add `node-24` as required** at the rehearsal; no direct pushes; release PRs (promotion) only |
| tags `v*` | created only on `main` (the publish workflow independently verifies tag ∈ `main` and refuses otherwise) |

## Failure behavior (DD-008 §6)

Publication is dependency-ordered; a mid-sequence failure stops the run loudly. Recovery is a
rerun (npm allows re-publishing a name@version only if that name@version never uploaded) or a
patch release — never `npm unpublish` as a workflow. A red post-publish verification blocks the
announcement and triggers an immediate patch; a genuinely broken published line is deprecated on
npm, not unpublished.
