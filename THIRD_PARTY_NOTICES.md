# Third-Party Notices

This project incorporates or depends on third-party software. Their licenses and notices are listed
here. This inventory is maintained per the
[Upstream, Fork, License & Contribution Policy](docs/03_UPSTREAM_FORK_LICENSE_AND_CONTRIBUTION_POLICY.md)
§5.2.

**Machine-checked in CI:** `npm run license:check` ([`tools/license-report.mjs`](tools/license-report.mjs))
walks the production dependency tree of the root package and every workspace package, reports each
declared license, and **fails CI** if a production dependency carries an unknown or non-permissive
(copyleft) license. Run `node tools/license-report.mjs` for the current generated report.

## Runtime dependencies

| Package | Version (baseline) | License | Notes |
|---|---|---|---|
| [`three`](https://github.com/mrdoob/three.js) | 0.178.0 | MIT | Core WebGL/3D rendering. Copyright © 2010–present three.js authors. |
| [`lil-gui`](https://github.com/georgealways/lil-gui) | ^0.20.0 | MIT | Demo/dev GUI controls. Copyright © George Michael Brower. |

## Development dependencies (build/test/tooling)

Inherited dev tooling is MIT/ISC/Apache-2.0-class open source, including (non-exhaustive): `rollup`
and Rollup plugins, `typescript`, `vitest`, `happy-dom`, `eslint` + `@typescript-eslint/*`,
`prettier`, and `typedoc`. Full, authoritative license data is produced from the lockfile by the
dependency-license report; this section is a human summary, not the source of truth.

## Inherited G-code corpus (reviewed 2026-07-22, issue #16; relocated 2026-07-23, #128)

The inherited upstream `demo/` app and its vendored assets (Bulma CSS, a vendored Vue prod build)
were removed in #128 (DD-008 D4) — the app is superseded by `tools/demo` and the framework example
apps, whose dependencies come from npm and are covered by the lockfile-driven license report.

| Asset | Origin | License | Evidence |
|---|---|---|---|
| `test-data/gcodes/*.gcode` (moved from `demo/gcodes/` in #128) | inherited upstream demo corpus | distributed with the MIT repo | tracked in [`test-data/manifest.json`](test-data/manifest.json) with provenance/limitations |

The G-code files' slicer/version provenance was not recorded upstream; this limitation is noted
per-fixture in the manifest. Any future asset whose redistribution rights cannot be confirmed is handled
per the fixture-governance rules and is **not** promoted into the tracked public fixture corpus.

## How to regenerate

Run `node tools/license-report.mjs` (or `npm run license:check` for the CI gate). Do not hand-maintain
per-package license text where the generated report is authoritative.
