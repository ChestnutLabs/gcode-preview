# Chestnut Labs G-code Preview — Project Setup

**Status:** Project setup guide · **Version:** 0.1  
**Prepared:** 2026-07-22  
**Target repository:** `chestnutlabs/gcode-preview`  
**Upstream:** `xyz-tools/gcode-preview`  
**Process authority:** `docs/01_GITHUB_WORKFLOW_PROJECT_GOVERNANCE_AND_DEVELOPMENT_PROCESS.md`

This document adapts the established AnyBridge development environment and source-handling model
for the Chestnut Labs G-code Preview project. It is intentionally safe to commit to the public
fork: private infrastructure details, credentials, and non-redistributable corpus files remain
outside tracked source.

---

## 1. Sensitive source handling — `/ProjectSource` (gitignored)

Create a directory named `ProjectSource` at the repository root:

```text
gcode-preview/
└── ProjectSource/             # local-only; never committed
```

`/ProjectSource` is the protected local workspace for material that may be useful during research,
compatibility work, or benchmarking but is not approved for public redistribution.

Store the following there:

- private or customer-supplied `.gcode`, `.gcode.3mf`, `.bgcode`, model, and project files;
- large benchmark files that are not approved for redistribution;
- files with embedded thumbnails, user names, directory paths, network identifiers, printer
  identifiers, or other private metadata;
- unknown-provenance samples awaiting license and redistribution review;
- private research packets, captured logs, and security-sensitive parser cases;
- the private workhorse endpoint/account notes described in section 4.

Do **not** copy private corpus data, credentials, infrastructure details, or raw `ProjectSource`
contents into tracked code, documentation, issues, PRs, Actions logs, benchmark reports, or demo
URLs.

Add or confirm this root `.gitignore` entry during bootstrap:

```gitignore
# Private project data and local environment — never published
/ProjectSource/
.env
.env.local
.env.*.local
```

Do not ignore `.env.example`; it may contain documented variable names with blank or safe example
values.

### 1.1 Private corpus is not the public fixture corpus

The repository's tracked `test-data/fixtures/` directory may contain only small, legal,
redistributable fixtures with the manifest fields required by project governance. A private file
does not become safe to publish merely because it is useful for testing or has been renamed.

To promote a case from `ProjectSource` into the public corpus:

1. confirm its origin and redistribution rights;
2. minimize it to the smallest useful reproduction;
3. remove private model geometry, thumbnails, paths, identifiers, and unrelated metadata;
4. assign a stable fixture ID and complete the fixture manifest;
5. review the resulting diff and generated artifacts through a normal issue/PR;
6. retain the original only in `ProjectSource` when it cannot legally or safely be published.

CI must never silently depend on a maintainer's private corpus.

---

## 2. Repository, remotes, visibility, and license

- **GitHub operations:** use `gh`; run `gh auth status` before repository mutations and confirm the
  active account is authorized to act for Chestnut Labs.
- **Repository:** `chestnutlabs/gcode-preview`.
- **Visibility:** public GitHub fork of `xyz-tools/gcode-preview`.
- **Package scope:** planned `@chestnutlabs/*`, subject to the bootstrap availability check.
- **License:** MIT for the inherited fork and Chestnut additions, unless a later explicit
  governance/legal decision changes an independently separable new package.

The normal local remote model is:

```text
origin    -> chestnutlabs/gcode-preview
upstream  -> xyz-tools/gcode-preview
```

- Push Chestnut work only to `origin`.
- Treat `upstream` as fetch-only during normal development.
- Record the exact upstream commit/tag selected as the Chestnut baseline.
- Do not use GitHub's Sync Fork action or `gh repo sync` as a blind update after Chestnut begins to
  diverge. Upstream adoption follows the reviewed process in the fork/license policy.

The repository must retain the upstream MIT `LICENSE` and copyright notice. Add Chestnut notices
without removing upstream attribution, and preserve required notices for incorporated third-party
code and dependencies. See
`docs/03_UPSTREAM_FORK_LICENSE_AND_CONTRIBUTION_POLICY.md` for the complete policy.

This differs from AnyBridge's GPL-3.0 project license: AnyBridge may consume these MIT packages,
but its license does not change or erase the viewer packages' MIT notice obligations.

---

## 3. Local and remote working locations

Use the same Linux workhorse pattern established for the wider Chestnut Labs projects.

- **Local/repository checkout:** the active `chestnutlabs/gcode-preview` clone.
- **Remote workhorse project directory:** `~/tzmp/gcode-preview/`.
- **Remote privileges:** use `sudo` only when the task actually requires it.
- **Programmatic SSH:** Paramiko is acceptable when a runtime password must be supplied.

Do not publish the workhorse hostname, custom port, login name, or authentication details in this
public tracked document. Load them at runtime from the following environment variables:

```text
GCODE_PREVIEW_SSH_HOST
GCODE_PREVIEW_SSH_PORT
GCODE_PREVIEW_SSH_USER
GCODE_PREVIEW_SSH_PASSWORD
GCODE_PREVIEW_REMOTE_DIR       # optional; defaults conceptually to ~/tzmp/gcode-preview/
```

The variable names may appear in tracked files; their real values may not.

---

## 4. Private environment companion

Keep non-secret connection metadata in:

```text
ProjectSource/ENVIRONMENT_PRIVATE.md
```

That local-only companion may record the approved workhorse hostname, port, username, project
directory, host-key fingerprint, and operational notes. Prefer a session environment, OS keychain,
or secret manager for the password. If the project owner supplies a password for a session, do not
write it into tracked files, shell history, logs, issues, or PRs.

Before first programmatic use, verify the server host-key fingerprint through a trusted channel and
install it in the operator's known-hosts store. Reusable scripts must reject unknown host keys; do
not use `AutoAddPolicy`.

Example with values supplied only at runtime:

```python
import os
import paramiko

client = paramiko.SSHClient()
client.load_system_host_keys()
client.set_missing_host_key_policy(paramiko.RejectPolicy())
client.connect(
    os.environ["GCODE_PREVIEW_SSH_HOST"],
    port=int(os.environ["GCODE_PREVIEW_SSH_PORT"]),
    username=os.environ["GCODE_PREVIEW_SSH_USER"],
    password=os.environ["GCODE_PREVIEW_SSH_PASSWORD"],
    allow_agent=False,
    look_for_keys=False,
)
```

This example deliberately omits endpoint values and host-key enrollment. Those are operator setup
steps, not application defaults.

---

## 5. Suggested private workspace shape

```text
ProjectSource/
├── ENVIRONMENT_PRIVATE.md     # endpoint/account/fingerprint notes; no tracked secrets
├── corpus/
│   ├── private/               # usable but non-redistributable samples
│   └── quarantine/            # provenance or safety not yet established
├── benchmark/
│   └── private-results/       # results that expose private filenames/paths or source data
└── research/
    └── private/               # non-public packets, captures, and investigation notes
```

This shape is a local convention, not a committed dependency. Tools and CI must accept explicit
inputs and must not hard-code a maintainer's private directory layout.

---

## 6. Project conventions

- **GitHub issues, PRs, releases, labels, and project state:** use `gh` where supported.
- **Remote Linux work:** use the approved SSH configuration and work under
  `~/tzmp/gcode-preview/`.
- **Sensitive data:** use only the gitignored root `ProjectSource/` directory.
- **Branches, commits, reviews, and DD gates:** follow the governance document.
- **Upstream changes:** fetch and evaluate through an issue/RR and reviewed PR; never blind-sync
  protected Chestnut branches.
- **Fixtures:** commit only manifest-backed, redistributable, sanitized cases.
- **Dependencies:** during E0, use the upstream-supported toolchain and lockfile first. Do not switch
  package manager, framework, renderer, or build system before the unchanged baseline is recorded
  and the applicable DD approves the change.
- **Documentation:** setup, compatibility, fixture provenance, and operational changes are part of
  feature completion.

---

## 7. First-session setup checklist

- [ ] Run `gh auth status` and confirm the active account is authorized for Chestnut Labs.
- [ ] Confirm GitHub shows `chestnutlabs/gcode-preview` as a public fork of
  `xyz-tools/gcode-preview`.
- [ ] Clone the Chestnut fork and verify `origin` and `upstream` point to the intended repositories.
- [ ] Record the exact current branch, commit hashes, tags, and inherited toolchain before edits.
- [ ] Add or verify the `/ProjectSource/` and local-environment `.gitignore` rules.
- [ ] Create `ProjectSource/ENVIRONMENT_PRIVATE.md` locally and record the verified workhorse
  endpoint, account, remote directory, and host-key fingerprint without committing it.
- [ ] Load authentication through the approved runtime secret method and verify the workhorse
  connection.
- [ ] Create or verify `~/tzmp/gcode-preview/` on the workhorse.
- [ ] Install and run the inherited upstream build/test/demo flow unchanged.
- [ ] Keep baseline failures separate from modernization or architecture work.
- [ ] Continue with E0 and `RR-001 — Upstream Baseline and Architecture Audit`.

---

## 8. Related project documents

- `docs/00_PROJECT_MASTER_PLAN.md`
- `docs/01_GITHUB_WORKFLOW_PROJECT_GOVERNANCE_AND_DEVELOPMENT_PROCESS.md`
- `docs/02_ARCHITECTURE_AND_PACKAGE_BOUNDARIES.md`
- `docs/03_UPSTREAM_FORK_LICENSE_AND_CONTRIBUTION_POLICY.md`
- `docs/04_GITHUB_BOOTSTRAP_EPICS_MILESTONES_AND_NEXT_STEPS.md`

