# Third-Party Notices

This project incorporates or depends on third-party software. Their licenses and notices are listed
here. This inventory is maintained per the
[Upstream, Fork, License & Contribution Policy](docs/03_UPSTREAM_FORK_LICENSE_AND_CONTRIBUTION_POLICY.md)
§5.2 and is refreshed as part of release preparation. A machine-generated dependency license report
will be added to CI/release artifacts in E0/E7.

> Status at founding baseline (`develop` @ `15375e56`). Versions reflect the inherited
> `package.json` / `package-lock.json` and will be regenerated, not hand-edited, once a license-report
> tool is wired into CI.

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

## Inherited demo assets

The upstream `demo/` directory contains sample G-code and images used by the demonstration app. Their
provenance is reviewed as part of the E0 license/notice inventory
([RR-001](docs/research/)). Any asset whose redistribution rights cannot be confirmed is handled per
the fixture-governance rules and is **not** promoted into the tracked public fixture corpus.

## How to regenerate

Once wired in E0/E7, run the project's dependency-license task (to be defined in the release DD) and
commit the regenerated report. Do not hand-maintain per-package license text where a generated report
is authoritative.
