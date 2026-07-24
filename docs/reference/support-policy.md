# Support & Deprecation Policy (`@chestnutlabs/*`)

**Status:** Live (DD-008 §4.6, D6 as amended) · **First applies to:** `v0.1.0`
**Refreshed:** per release — the dated pins below are re-audited and re-stamped in every release's
notes. Anything listed as **tested** maps to a CI job or a recorded verification; everything else
is worded as *expected to work*.

## Runtime & environment matrix

| Surface | Supported | Evidence class |
|---|---|---|
| Node.js | **≥ 22** (`engines.node >= 22`) — the active **22 LTS** and **24 LTS** lines. SSR-import safety only; headless *rendering* has its own row below. | **Tested** — CI runs the full gate on 22.x and repeats build + suites + the consumer fixture on 24.x |
| Browsers | **Auditable rolling window**: the **current and previous major** of Chromium, Firefox, and Safari at the time of each release, requiring `module` workers + WebGL2 (DD-003/DD-004 assumptions). **Pins as of 2026-07-23:** Chromium/Chrome **151/150** (Edge 150 tracks Chromium), Firefox **153/152**, Safari **26.x / 18.x**. | Chromium-class **tested** (example apps + visual-regression harness run on Chromium); Firefox/Safari *expected to work* within the window |
| AnyBridge Electron baseline | **Reserved, not yet pinned.** AnyBridge is browser-first today; its ADR-0005 records Electron as the likely future desktop wrapper without a chosen version. When AnyBridge designates its Electron baseline, this row pins that Electron's Chromium major and it joins the tested set. | *Reserved* (dated 2026-07-23) |
| Headless / still-render environments | Chromium-class contexts only: Electron hidden window, worker `OffscreenCanvas`, headless Chromium (DD-008 §4.8). **Pure-Node GPU-less rendering is out of scope** (deferred E8-class roadmap item). | **Tested** from `v0.1.0` via the `renderStill` determinism CI check |
| Bundlers | **Vite** (dev + build) with the default batteries worker. Webpack-5-class bundlers via the documented `createWorker` escape hatch. | Vite **tested** (three example apps + the tarball consumer fixture in CI); others *expected to work* via `createWorker` |

## Framework adapter ranges

| Adapter | Peer range | Notes |
|---|---|---|
| `@chestnutlabs/gcode-preview-vue` | `vue ^3.4` | Reference adapter |
| `@chestnutlabs/gcode-preview-react` | `react ^18 \|\| ^19` | StrictMode-safe (dispose/recreate + canvas rebind are test-locked) |
| `@chestnutlabs/gcode-preview-svelte` | `svelte ^4 \|\| ^5` | The component ships as **raw `.svelte`** under the `"svelte"` export condition — the consumer's Svelte compiler is authoritative |
| `@chestnutlabs/gcode-preview-element` | none (framework-free custom element) | Registers `<gcode-preview>` via `defineGcodePreview()` / the `./define` entry; passes the same shared behavioral suite |

All three adapters are thin reactivity bridges over `@chestnutlabs/gcode-preview-core` and expose
equivalent capabilities (DD-007 D1 amendment); the shared behavioral suite runs against all three
in CI and is a release gate.

## `three` dependency posture (D6, amended)

`three` is a **peerDependency of `@chestnutlabs/gcode-renderer-three`** with a deliberately narrow
supported range — initially **`^0.178.0`** — because three's 0.x minors are breaking by
convention. Consumers install `three` themselves (npm ≥ 7 auto-installs peers); the workspace pins
the exact known-good version (`0.178.0`) as a dev/test dependency, so every CI run, example app,
and benchmark tests one `three`. Widening the range is a per-release, evidence-backed decision
recorded in the changelog.

## Versioning & deprecation (DD-002 §8 + DD-008 D1/D2)

- **Lockstep versioning**: all nine packages share one version line (first line `0.1.0`).
  Independent per-package versioning is re-evaluated before `1.0.0`.
- **Pre-1.0 semantics:** a minor may contain breaking changes; every breaking change ships a
  migration note, carries the `breaking-change` label, and gets an AnyBridge impact check.
  Patches are fixes only.
- **Deprecation window:** a deprecated API keeps working for **at least one minor** with a console
  warning, a changelog entry, and a migration note before removal.
- Releases are cut with Changesets (fixed group) and published only from protected CI with npm
  provenance — never from a workstation.

## Supported formats & capabilities

See the living references (each with its own evidence):

- Dialects & containers matrix: [`docs/compatibility/dialects-and-containers.md`](../compatibility/dialects-and-containers.md)
- Live-progress signal contract: [`docs/reference/progress-signal-contract.md`](progress-signal-contract.md)
- Progress consumer notes: [`docs/reference/progress-consumer-notes.md`](progress-consumer-notes.md)

## How this document changes

The window definitions are policy (DD-008-gated); the **dated pins** are audit data, refreshed at
each release by re-checking the vendors' current stable majors and re-stamping this file + the
release notes. A support claim is never widened silently — widening (new framework major, wider
`three` range, new environment) requires evidence recorded in the release PR.
