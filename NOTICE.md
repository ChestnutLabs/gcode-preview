# NOTICE — Attribution & Provenance

This file summarizes attribution and provenance for **ChestnutLabs/gcode-preview**. It complements,
and does not replace, the [`LICENSE`](LICENSE) file and the full
[Upstream, Fork, License & Contribution Policy](docs/03_UPSTREAM_FORK_LICENSE_AND_CONTRIBUTION_POLICY.md).

## Upstream origin

- **This repository is a public GitHub fork of** [`xyz-tools/gcode-preview`](https://github.com/xyz-tools/gcode-preview)
  (project identity `remcoder/gcode-preview`; npm package `gcode-preview`).
- **Chestnut founding baseline:** branch `develop` at commit
  `15375e56129f5a57aebc099ed7bfb5a092dcfb9e` (2026-06-08).
- The inherited Git history and the upstream fork relationship are preserved. Chestnut Labs maintains
  its own roadmap, governance, release cadence, and package APIs.

## Copyright

- Inherited code: **Copyright (c) 2017–2025 Remco Veldkamp** and the `xyz-tools/gcode-preview`
  contributors, licensed under the MIT License (see [`LICENSE`](LICENSE)).
- Chestnut Labs additions and modifications: **Copyright (c) 2026 Chestnut Labs**, also under the MIT
  License.

The upstream copyright notice and MIT permission notice are retained in [`LICENSE`](LICENSE) and must
not be removed. Chestnut notices are added **alongside** — never in place of — upstream notices.

## License

MIT for both the inherited fork and Chestnut Labs additions, unless a later, explicit
legal/governance decision changes the license for an independently separable new package. See the
fork/license policy for the full rationale, including how an MIT package may be consumed by a
GPL-3.0 application (e.g., AnyBridge) without altering the package's MIT notice obligations.

## Derived vs. independently replaced code

Chestnut Labs does **not** claim a clean-room implementation. Subsystem provenance (inherited /
modified / replaced / original) is tracked in
[`docs/UPSTREAM_PROVENANCE.md`](docs/UPSTREAM_PROVENANCE.md). Replacing every line of an inherited
file does not by itself establish clean-room status; the ledger exists for honesty, maintenance, and
license review.

## Third-party code

Bundled and dependency notices are tracked in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
Reference implementations studied for behavior (Sindarius/Mainsail, Fluidd, PrusaSlicer/libvgcode,
BambuBuddy, and others) are **not** incorporated as source unless their license is compatible and the
incorporation is recorded per policy.
