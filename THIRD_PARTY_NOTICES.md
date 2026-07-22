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
`prettier`, `typedoc`, `concurrently`, `copyfiles`, and `live-server`. Full, authoritative license
data is produced from the lockfile by the dependency-license report; this section is a human summary,
not the source of truth.

## Inherited demo assets (reviewed 2026-07-22, issue #16)

Third-party material shipped in the inherited `demo/` app:

| Asset | Origin | License | Evidence |
|---|---|---|---|
| `demo/bulma-prefixed.min.css` | [Bulma](https://bulma.io) v1.0.2 | MIT | license header intact in file |
| `demo/js/vue.esm-browser.prod.js` | [Vue](https://vuejs.org) 3 (vendored prod build) | MIT | Vue is MIT-licensed |
| `demo/lib/**` (created at deploy by `copy-deps`) | three.js, lil-gui | MIT | copied from the MIT npm packages above |
| `demo/gcodes/*.gcode` | inherited upstream demo corpus | distributed with the MIT repo | tracked in [`test-data/manifest.json`](test-data/manifest.json) with provenance/limitations |

The demo G-code files' slicer/version provenance was not recorded upstream; this limitation is noted
per-fixture in the manifest. Any future asset whose redistribution rights cannot be confirmed is handled
per the fixture-governance rules and is **not** promoted into the tracked public fixture corpus.

## How to regenerate

Run `node tools/license-report.mjs` (or `npm run license:check` for the CI gate). Do not hand-maintain
per-package license text where the generated report is authoritative.
