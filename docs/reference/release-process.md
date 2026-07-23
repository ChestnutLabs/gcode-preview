# Release Process (`@chestnutlabs/*`)

**Status:** Live (DD-008 D1/D2/D3, #130) · applies from `v0.1.0`.

All nine packages release in **lockstep** (one version line, one tag). Publication happens **only**
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
3. **Promotion PR (`dev` → `main`):** a deliberate PR carrying the versioned state to `main`,
   merged only with the required checks green. The first one (`v0.1.0`) ends the founding-baseline
   freeze on `main`.
4. **Tag + GitHub Release:** tag `vX.Y.Z` on `main` and publish a GitHub Release for it. This —
   and nothing else — triggers publication.
5. **`Release / publish` workflow:** verifies the tag is on `main`, fresh `npm ci`, then the full
   repository gate (build, root + package suites, typeCheck, lint, license, docs links, consumer
   fixture, pack-check, sync-check) before a dependency-ordered `npm publish` ×9 with **npm
   provenance**. The orchestrator (`tools/release/publish.mjs`) refuses real publishes outside the
   workflow; `npm run release:dry-run` is the local rehearsal (it exercises the full pack +
   validation path without uploading).
6. **Post-publish verification (phase 6/7):** registry-mode consumer fixture + fresh smoke install
   per the README quick-start; then the release notes are announced.

## Auth (DD-008 D3 as amended)

- **Intended:** npm **trusted publishing** (OIDC) — no long-lived token. Configured on npmjs
  against the **user-owned `@chestnutlabs` scope** for this repository + the
  `release-publish.yml` workflow (org conversion is deferred and not a `v0.1.0` blocker).
- **Recorded fallback:** a granular automation token scoped to the nine packages, stored as the
  `NPM_TOKEN` secret (the workflow already wires it). If the registry cannot create *new* packages
  via OIDC at first publish, `v0.1.0` uses the token and later releases switch to OIDC.
- 2FA-on-publish set on the owning account. These are **maintainer prerequisites** for phase 7,
  confirmed during the phase-6 rehearsal.

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
