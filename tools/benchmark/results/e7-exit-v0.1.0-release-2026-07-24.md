# E7 exit — `v0.1.0` published (2026-07-24, #134)

The first stable `@chestnutlabs/*` line is live on npm. E7 (Release, Documentation & Ecosystem) is
complete.

## Published (npm, provenance, lockstep `0.1.0`)

All nine resolved from the registry at `0.1.0`:

`@chestnutlabs/toolpath-core` · `gcode-dialects` · `gcode-containers` · `gcode-parser` ·
`gcode-renderer-three` · `gcode-preview-core` · `gcode-preview-vue` · `gcode-preview-react` ·
`gcode-preview-svelte`

Published in dependency order by `release-publish.yml` from the `v0.1.0` tag on `main`
(commit `d954cb8`), with `--provenance`.

## §15 release gates

- **Framework-integration parity ×3** — the shared behavioral suite runs against Vue/React/Svelte
  on every CI run; green on the release commit.
- **Registry-mode consumer verification** — `npm run verify:registry -- 0.1.0` installed the
  published packages from npm into a scratch app and passed the contract tests (component +
  real-worker parse), asserting registry (not local) resolution. Passed. *(The in-workflow run of
  this step hit npm read-API propagation lag on two first-publish packages and was completed
  locally once propagation settled; the step is now `continue-on-error` with a 15-minute window so
  propagation lag can't red-fail a completed publish — a defect there would still fail the install.)*

## The cut (sequence)

1. Version PR #142 merged → `dev` at lockstep `0.1.0` (CI on the bot-pushed version branch was
   triggered with an empty commit — Changesets bot pushes don't fire workflows).
2. Promotion PR #164 merged `dev` → `main` — **ended the founding-baseline freeze** on `main`.
3. **Bug caught + fixed:** the nine manifests still had `private: true`; the publish refuses private
   packages, and the phase-6 dry-run had masked it (dry-run strips `private` to simulate). Removed
   (#165), re-promoted (#166).
4. **Token fix (maintainer):** first publish attempt got `E403` — 2FA-on-publish requires a token
   that bypasses it (classic _Automation_ or granular with "Bypass 2FA"). Secret updated; recorded
   in the release-process doc.
5. `v0.1.0` tag + GitHub Release on `main` → publish ×9 succeeded.

## Consumers

AnyBridge can migrate from tarball `file:` links to registry ranges: interactive viewer (#783) and
the headless `renderStill` thumbnail path (#791). Switch notes posted there.

## Known limitation shipped (documented)

Inherited interpreter gaps in some position-affecting G-codes — notably **M82 absolute extrusion**
— per [`docs/compatibility/gcode-motion-coverage.md`](../../docs/compatibility/gcode-motion-coverage.md);
fixes tracked in #155–#158 (a separate motion-model DD).
