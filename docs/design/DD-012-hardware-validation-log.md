# DD-012 — Hardware validation log (#189)

**Purpose.** DD-012 D6/D8 make every non-extrusion dialect ship **`experimental`** (claims reported
`inferred`) until its classification is confirmed on a real machine, at which point it is promoted to
**`validated`** (claims report `known`, the `cnc-dialect-experimental` warning drops). This file is the
**acceptance evidence** behind each promotion: one entry per hardware run, recording what was observed
against what the physical machine did. A tier flip in
[`packages/gcode-dialects/src/cnc.ts`](../../packages/gcode-dialects/src/cnc.ts) must cite an entry here.

**Provenance.** We record the run's *observations* (move counts, power range, verdicts) and the file
**name only** — never the user's design file or its geometry (RR-004 §6 governance). The files are the
maintainer's own jobs on the maintainer's own hardware.

**What a pass validates.** The `experimental` tier downgrades exactly three capabilities — `cutMoves`,
`toolPower`, `cannedCycles`. A run validates a controller by confirming, against the physical result,
the claims the file actually exercises: machine-class detection, the Cut-vs-rapid split, the `toolPower`
(`S`) channel, and (where present) canned-cycle geometry. The check is performed with the in-repo
**validation harness** (`tools/demo/validate.html`), which lists each claim for ✓/✗ marking and exports
the report pasted below.

---

## Runs

### grbl-laser — VALIDATED — 2026-07-29

- **Controller / dialect:** GRBL / LightBurn → `grbl-laser` (machine class **laser**)
- **Machine:** maintainer's diode laser
- **File:** `laser-diode-test1.gc` (name only; not committed)
- **Tool:** [`tools/demo/validate.html`](../../tools/demo/validate.html) harness export

| Observed | Value |
| --- | --- |
| Moves | 5822 cut · 339 rapid · 6161 total |
| Tool power (`S`) | 0–1000 over the 5822 cutting moves (full ramp; exercises the `toolPower` channel end to end) |
| Envelope | 356.0 × 566.0 × 0.0 mm (planar) |
| Geometry | fill + offset-fill patterns |

**Findings (maintainer, against the physical cut):**

| Claim | Verdict | Note |
| --- | --- | --- |
| Machine class correct | ✓ matches | detected `laser` |
| Cut-vs-rapid split correct | ✓ matches | holds across fill + offset-fill |
| Tool-power ramp correct | ✓ matches | 0–1000 `S` tracked real laser behavior |
| Work envelope matches part | ✓ matches | off-bed by design (placed off-bed in the source software) |
| Overall path shape matches | ✓ matches | — |
| Canned/drilling cycles | n/a | a laser has no `G81`–`G83` |

**Decision:** all exercised claims ✓ against real hardware → **`grbl-laser` promoted
`experimental` → `validated`** ([`cnc.ts`](../../packages/gcode-dialects/src/cnc.ts)). Scope is
per-controller: this run validates GRBL/LightBurn **laser** classification only. `grbl-mill` and
`linuxcnc` remain `experimental` pending a run on the partner CNC.

---

## Pending

| Dialect | Tier | Needs |
| --- | --- | --- |
| `grbl-mill` | experimental | a real GRBL-mill / router run (spindle `M3`, Z-plunge, ideally a `G81` drill) |
| `linuxcnc` | experimental | a real LinuxCNC run (canned-cycle geometry + `toolPower` against the machine) |
