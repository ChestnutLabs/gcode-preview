# E7 phase 6 — release rehearsal (2026-07-23, #133)

A full end-to-end dry run of the `v0.1.0` release, exercising every step
`release-publish.yml` runs, with nothing published.

## Gate chain (identical to the publish workflow, run on `dev`)

| Step | Result |
|---|---|
| `npm run build` | ✅ |
| `npm run test` (root) | ✅ |
| `npm run test:packages` | ✅ |
| `npm run typeCheck` | ✅ |
| `npm run lint` | ✅ |
| `npm run license:check` | ✅ |
| `npm run docs:links` | ✅ |
| `npm run test:consumer-vue` (tarball fixture) | ✅ |
| `npm run pack:check` (snapshots + publint + attw) | ✅ |
| `npm run release:sync-check` | ✅ |
| `npm run release:dry-run` (publish ×9, no upload) | ✅ 9/9 |

## Version step (`npm run version`, with a GITHUB_TOKEN as CI provides)

All nine packages bump **lockstep to `0.1.0`** (single distinct version), per-package
`CHANGELOG.md`s generate with PR links + attribution, internal `@chestnutlabs/*` ranges sync to
the exact `0.1.0`, and all three pending changesets are consumed. The bump was reverted locally —
it belongs to the generated **Version Packages PR #142** (merged deliberately at release time).

## Dry-run publish manifest (exact internal ranges; `preserveDrawingBuffer`/`renderStill` present)

`release:dry-run` strips and restores the pre-release `private` flag and runs
`npm publish --dry-run --provenance --access public` for every package in dependency order:

- `toolpath-core` (23 files) · `gcode-dialects` (29) · `gcode-containers` (11) ·
  `gcode-parser` (29) · `gcode-renderer-three` (23) · `gcode-preview-core` (14 — now includes
  `renderStill`) · `gcode-preview-vue` (11) · `gcode-preview-react` (11) · `gcode-preview-svelte` (9).
- Every internal dependency is pinned to the exact workspace version (no `*` wildcard).

## Registry-mode consumer verification (§15 release gate — READY, runs post-publish)

`tools/consumer-vue/run-registry.mjs` (`npm run verify:registry [version]`) installs the
**published** `@chestnutlabs/*` versions from the npm registry into a scratch app and runs the same
contract tests (component + real-worker parse) as the tarball fixture, asserting every dep resolved
from `https://` (the registry), never a local link. It cannot pass before publication by
construction, so it is **not** in the PR CI; `release-publish.yml` runs it after the publish step
(with a short propagation retry). This is the explicit §15 registry-mode release gate.

## Framework-integration parity (§15 release gate — already enforced)

The shared behavioral suite (`@chestnutlabs/gcode-preview-core/testing`) runs against Vue, React,
and Svelte on every CI run (`test:packages`); it is green on this rehearsal. That is the §15
parity gate — the three adapters expose equivalent capabilities over one engine.

## Conclusion

Every mechanical step of the release works end to end. The remaining blockers are **maintainer
prerequisites only** (npm auth, the org Actions PR toggle) — see the release-process doc and the
#133 report. No code or automation changes are required to publish `v0.1.0`.
