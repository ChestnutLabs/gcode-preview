# @chestnutlabs/gcode-parser

## 0.4.0

### Minor Changes

- [#252](https://github.com/ChestnutLabs/gcode-preview/pull/252) [`b2053be`](https://github.com/ChestnutLabs/gcode-preview/commit/b2053be4b8e71250bc6077f60ef996fe601b6f3e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat: canned drilling cycle expansion — G81/G82/G83 (DD-012 phase 2, [#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  CNC canned drilling cycles previously produced **zero geometry** — holes vanished. They now expand to
  explicit sub-moves so the drilling is real, classified toolpath:
  - **G81/G82** (drill / drill-with-dwell): rapid to the hole XY, rapid down to the R plane, **feed to
    depth (`Cut`)**, rapid retract.
  - **G83** (peck): the plunge is a peck loop — feed down by `Q`, rapid-retract to R between pecks, until
    reaching depth; each down-feed is a `Cut`.
  - **G98/G99** set the retract plane (initial Z vs R); **G80** cancels; a `G0`–`G3` motion also cancels.
  - **Modal repeat**: with a cycle active, a bare `X`/`Y` line drills another hole (retaining Z/R/Q and
    the initial plane) — the common CNC hole-pattern form.
  - Rapids are `Travel`, plunges are `Cut`; new capability **`cannedCycles`** (`known` once a cycle is
    seen, else `unavailable`).

  FDM output is unchanged (no canned cycles in FDM); the native-golden corpus gains only the additive
  `cannedCycles` capability, with no geometry change.

- [#253](https://github.com/ChestnutLabs/gcode-preview/pull/253) [`13fd5c6`](https://github.com/ChestnutLabs/gcode-preview/commit/13fd5c61d730428a7f7e73c28cf3cc9c48e68c19) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat: non-extrusion dialect families + validation tiers (DD-012 phase 3, [#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  Adds controller detection and the **validation-tier honesty mechanism** for CNC/laser toolpaths:
  - New dialects (`@chestnutlabs/gcode-dialects`): **GRBL laser** (LightBurn / `$32` laser mode / `M4`+`S`),
    **GRBL mill** and **LinuxCNC** (`M3` spindle, `%`/banner envelopes). Registered in the batteries worker.
  - Each dialect adds provenance (`cnc.controller`, `cnc.machineClass`, `cnc.toolPowerLabel`) and a
    **validation tier** (`cnc.validationTier`). Per DD-012 D6: an **experimental** dialect reports its
    non-extrusion claims (`cutMoves` / `toolPower` / `cannedCycles`) as **`inferred`** (never `known`),
    with a `cnc-dialect-experimental` disclosure — and only for claims the file actually made (an unused
    feature is never fabricated).
  - **All launch dialects ship `experimental`** (synthetic fixtures only). A single `tier: 'validated'`
    flip per controller promotes its claims to `known` once confirmed on real hardware (DD-012 §8/§15).

  Geometry is untouched (dialects only annotate/label). FDM detection is unaffected — CNC dialects do
  not match FDM output.

- [#248](https://github.com/ChestnutLabs/gcode-preview/pull/248) [`1029580`](https://github.com/ChestnutLabs/gcode-preview/commit/10295803839816adaed224c48eba1f74374c0c2a) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat: non-extrusion `Cut` move classification + tool-state modal (DD-012 phase 1, [#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  Non-extrusion toolpaths (CNC / laser / plotter) no longer collapse their productive moves into
  `Travel`. The parser now tracks a tool-engaged modal state — `M3`/`M4` (spindle/laser on, incl. the
  `M03`/`M04` leading-zero form) engage it, `M5` disengages — and classifies a move with **no extrusion
  `E`** while the tool is engaged as the new **`MoveKind.Cut`** bit (a CNC/laser/plotter counterpart to
  `Extrude`, composing with `ArcSegment` like the other kinds).
  - New IR move kind `MoveKind.Cut = 1 << 7` (`@chestnutlabs/toolpath-core`).
  - New capability **`cutMoves`**: `known` once a tool-state modal is seen (a CNC/laser/plotter file),
    `unavailable` for FDM.
  - **FDM is byte-identical**: FDM slices never issue `M3`/`M4`, so `Cut` is never set and every move
    stays `Extrude`/`Travel` exactly as before (verified against the native-golden corpus; the CNC
    fixtures `demo-easel`/`demo-mach3` are documented intentional adapter-divergences).

  Modal tool-state _value_ channels (laser power / spindle RPM via `S`), canned-cycle expansion, and
  dialect families follow in later DD-012 phases.

- [#251](https://github.com/ChestnutLabs/gcode-preview/pull/251) [`11f317d`](https://github.com/ChestnutLabs/gcode-preview/commit/11f317de2d6cb963d2a7fb0c894c89d3d5adc86d) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat: modal motion continuation — bare coordinate lines repeat the last G0–G3 (DD-012 phase 2, [#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  CNC/LinuxCNC-style G-code frequently omits the `G` word on repeated moves (`G1 X0 Y0` then bare
  `X10 Y0` / `X20 Y0`). The parser previously **dropped** those lines entirely — a three-move path
  produced a single segment. It now tracks the active `G0`–`G3` motion mode and treats a line whose
  leading word is a coordinate axis (`X`/`Y`/`Z`, with no `G`/`M`/`T` command) as a continuation of
  that mode, so the full toolpath is emitted and classified/colored consistently (incl. inline `S`
  for `toolPower`).

  FDM output is **byte-identical** — slicers always emit the `G` word, so the continuation path never
  triggers (the native-golden corpus is unchanged). This unblocks canned-cycle repeat (next phase).

- [#250](https://github.com/ChestnutLabs/gcode-preview/pull/250) [`8fec7c3`](https://github.com/ChestnutLabs/gcode-preview/commit/8fec7c3622cd2a6d6d57b43d7866cfea1cb71e09) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat: opt-in modal tool-power channel (DD-012 phase 1 — the `ModalChannel` mechanism, [#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  Adds the shared, opt-in **`ModalChannel`** mechanism DD-012 D3 is built around, and its first channel:
  **`toolPower`** — the modal spindle/laser `S` value while a tool is engaged.
  - `ParseOptions.modalChannels?: readonly string[]` — request per-segment modal channels by id.
    Supported id: `'toolPower'`. Unknown ids are ignored with a `modal-channel-unsupported` warning.
  - `ToolpathSegments.modal?: Readonly<Record<string, Float32Array>>` — one Float32 column per requested
    channel, present **only** when requested. An unset value is `NaN` (an honest "no value here"), never
    a fabricated `0`. `toolPower` is the modal `S` (set on `M3`/`M4` and inline on GRBL-laser motion
    lines) while engaged, `NaN` when the tool is off (`M5`).
  - New capability **`toolPower`**: surfaced only when the channel is requested — `known` once a
    tool-state modal is seen, else `unavailable`.
  - **Default parse pays nothing**: no `modalChannels` ⇒ no `modal` on the IR, no extra columns, FDM
    output unchanged. The budget-aware SoA writer (DD-003) grows the opt-in columns in lockstep and
    accounts their bytes.

  Presentation (Watts vs RPM) is a dialect label, not a separate channel (DD-012 D4); [#180](https://github.com/ChestnutLabs/gcode-preview/issues/180)'s
  fan/temp/accel color channels reuse this same mechanism in a later phase.

- [#256](https://github.com/ChestnutLabs/gcode-preview/pull/256) [`b84bea9`](https://github.com/ChestnutLabs/gcode-preview/commit/b84bea959b7aae24d148e6bcc488a9ed254a54f0) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat: lexer handles multi-command lines, N-word line numbers, and bare S/F ([#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  Real CNC/laser G-code (GRBL, LinuxCNC, TinyG, Mach3, Fanuc) is written very differently from FDM
  slicer output, and the inherited first-word lexer silently dropped most of it. The lexer now:
  - **Reads every G/M/T command word on a line**, not just the first — `G20 G17 G90`, `G91 G81 …`,
    `S3400 M3` now all apply. This was the biggest gap: `M3` spindle-on and `G81` canned cycles were
    being dropped as params, so mills showed no `Cut` moves and drilled holes vanished.
  - **Strips `N`-word line numbers** (`N10 G1 X…`) — Fanuc/Mach/TinyG number every line, which
    previously reduced whole files to zero geometry.
  - **Latches bare `S` / `F` lines** (standalone `S1000` / `F600`) into modal power/feed — common in
    GRBL-laser output.
  - Guards against **letters embedded in extended-command words** (`EXCLUDE_OBJECT … POLYGON=…`): a
    command/param is only taken when a real number follows the letter, so `T` in `M486 T<count>` /
    `M104 T<tool>` stays a parameter (not a tool select), and the `G` in `POLYGON` never becomes a move.

  Validated against real public sample files: a LinuxCNC arc-spiral went from 16 → 5,506 parsed
  segments, a TinyG program from 0 → 344. **FDM output is byte-identical** — slicers emit one clean
  command per line, so the multi-command path never runs for them (the real-G-code native-golden corpus
  is unchanged except for fewer spurious `unsupported-command` warnings; `demo-mach3` and one adversarial
  binary fixture are documented intentional divergences).

### Patch Changes

- [#260](https://github.com/ChestnutLabs/gcode-preview/pull/260) [`879b60a`](https://github.com/ChestnutLabs/gcode-preview/commit/879b60ae0fca87ca8187791603a1bc7f54e61c4c) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - fix: G0 rapids classify as Travel, not Cut, even while the tool is engaged ([#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  The non-extrusion `Cut`/`Travel` classifier keyed only on tool-state (`M3`/`M4` latched), so on a
  router — where the spindle stays on across rapids — every `G0` reposition was counted as a cutting
  move. DD-012 D2 §4.2 already specifies that rapids stay `Travel`; this brings the implementation in
  line: only a **feed** move (`G1`/`G2`/`G3`) with the tool engaged and no `E` delta is `Cut`; a `G0`
  rapid is `Travel` regardless of tool state (a GRBL-laser also gates the beam off during `G0`).

  Surfaced by the CNC/laser validation harness on real files — e.g. the `easel` router fixture went
  from 742 cut / 0 rapids to a correct 737 cut / 5 rapids (its 5 `G0` moves). Geometry is unchanged
  (only the `kind` column shifts); FDM output is byte-identical since `Cut` is never evaluated there.

- Updated dependencies [[`3f06e5b`](https://github.com/ChestnutLabs/gcode-preview/commit/3f06e5b7b6926daaad4290b29c577a380c9e10df), [`13fd5c6`](https://github.com/ChestnutLabs/gcode-preview/commit/13fd5c61d730428a7f7e73c28cf3cc9c48e68c19), [`1029580`](https://github.com/ChestnutLabs/gcode-preview/commit/10295803839816adaed224c48eba1f74374c0c2a), [`8fec7c3`](https://github.com/ChestnutLabs/gcode-preview/commit/8fec7c3622cd2a6d6d57b43d7866cfea1cb71e09), [`3e244ae`](https://github.com/ChestnutLabs/gcode-preview/commit/3e244aee86463f2a8c030b3793d3bb2dd462e3a9)]:
  - @chestnutlabs/gcode-dialects@0.4.0
  - @chestnutlabs/toolpath-core@0.4.0
  - @chestnutlabs/gcode-bgcode@0.4.0
  - @chestnutlabs/gcode-containers@0.4.0

## 0.3.0

### Minor Changes

- [#238](https://github.com/ChestnutLabs/gcode-preview/pull/238) [`75f9f2b`](https://github.com/ChestnutLabs/gcode-preview/commit/75f9f2b2c758ef15b26a4b0f8dd955c89c9c5fb1) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Register `.bgcode` as a **container adapter** so it flows through the existing parser pipeline
  (DD-011 phase 4c, [#188](https://github.com/ChestnutLabs/gcode-preview/issues/188)). A `.bgcode` file now "just works" through `GcodeParseSession` with
  `containers: 'auto'` — sniffed by magic, decoded to plain G-code, and parsed to the same IR as the
  plain `.gcode` (proven by the golden-equivalence test).
  - `gcode-bgcode`: `openBgcodeContainer(bytes)` implements the DD-005 §4.4 `{ id, sniff, open }` shape
    (single plate; `openPlate(0)` streams the decoded G-code). `openBgcode(bytes, { metadata: true })`
    now also decodes the metadata (INI) and thumbnail blocks, so the adapter surfaces **machine geometry
    from `bed_shape`**, whitelisted slicer settings (feeding dialect detection + provenance), and
    thumbnails.
  - `gcode-parser`: the batteries worker registers the `bgcode` adapter beside `gcode-3mf`.

  Verified end-to-end: a real Prusa XL cube `.bgcode` parses through the session to 11,417 segments with
  a 360×360 bed and `printer_model` metadata.

- [#193](https://github.com/ChestnutLabs/gcode-preview/pull/193) [`5f3b16a`](https://github.com/ChestnutLabs/gcode-preview/commit/5f3b16a7aa8dfcce451d74f0cebece5f0eaaecef) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Motion-model correctness — E10 phase 1 ([#156](https://github.com/ChestnutLabs/gcode-preview/issues/156)/[#155](https://github.com/ChestnutLabs/gcode-preview/issues/155), DD-010 D1/D2 + G92 E-datum).

  The interpreter now models the **extruder mode** (`M82`/`M83`) and **positioning mode** (`G90`/`G91`)
  and classifies extrude-vs-travel from the true per-move **E delta**, not the raw E word:
  - **M82 (absolute E)** — an E-unchanged move is now correctly `Travel` (was mis-classified as extrude),
    and `stats.extrusionDistance` is delta-summed (was inflated by the cumulative E). This is the audit's
    highest-impact gap ([#156](https://github.com/ChestnutLabs/gcode-preview/issues/156)).
  - **M83 (relative E)** and the common slicer shape (`G90` + `M83`) are byte-identical to before.
  - **G90/G91** set the XYZ positioning mode; relative moves accumulate. `G92 E<v>` resets the extruder
    datum. `G92 X/Y/Z` is disclosed as unhandled (`g92-xyz-unhandled` warning) — deferred to phase 3.
  - The `G90`/`G91`↔E interaction is **firmware-conditioned** (DD-010 D2): Marlin/Klipper let G90/G91
    steer E; RepRapFirmware keeps E independent. Supplied via the new `parseOptions.extruderFollowsPositioning`
    hint (default `false`); the byte-exact engine never sniffs firmware. When unspecified, the E mode
    defaults to **absolute** (the firmware power-on convention), disclosed `inferred`.
  - New capabilities `extrusionMode` and `positioningMode` (`'known'` when the governing command was seen,
    else `'inferred'`).

  **Output change (documented):** all segment **positions, `kind`, `tool`, `layer`, and `srcByte` are
  byte-identical** across the corpus. Seven hand-crafted dialect fixtures use _absolute_ E without an
  `M82`/`M83`; their per-segment extrusion delta and `extrusionDistance` are now **corrected** (previously
  inflated by the raw-E-as-delta assumption). No renderer/adapter API change.

- [#208](https://github.com/ChestnutLabs/gcode-preview/pull/208) [`dc1c535`](https://github.com/ChestnutLabs/gcode-preview/commit/dc1c5350ce545ae01e13c0782fed30d5d318f010) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Motion-model correctness — E10 phase 2: arc-plane selection ([#157](https://github.com/ChestnutLabs/gcode-preview/issues/157), DD-010 D3).

  Arc flattening (`G2`/`G3`) now runs in the **active plane** selected by `G17` (XY, default), `G18`
  (XZ), or `G19` (YZ), instead of always assuming XY:
  - The arc math is plane-parameterized: the in-plane pair uses the two relevant center offsets
    (`I`/`J` for XY, `I`/`K` for XZ, `J`/`K` for YZ) and the through axis ramps linearly. `G17`
    reproduces the previous XY math **exactly** — the whole XY-arc corpus is byte-identical.
  - `G18`/`G19` arcs (mainly CNC) previously mis-flattened onto XY (I/J interpretation, `K` ignored);
    they now render in the correct plane.
  - The deferred **G91-arc geometry** lands here too: arc endpoints honor the positioning mode
    (`G90` absolute / `G91` relative); `I`/`J`/`K` remain current-relative center offsets in both.
  - New capability `arcPlanes` (`'known'` once a plane word is seen, else `'inferred'` = XY assumed).

  **Output change (documented):** all corpus segment positions/kinds/extrusion stay **byte-identical**
  (the only golden change is the additive `arcPlanes` capability key); non-XY arcs are new output only
  for files that use `G18`/`G19`. No renderer/adapter API change.

- [#208](https://github.com/ChestnutLabs/gcode-preview/pull/208) [`dc1c535`](https://github.com/ChestnutLabs/gcode-preview/commit/dc1c5350ce545ae01e13c0782fed30d5d318f010) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Motion-model correctness — E10 phase 3: coordinate systems + probe-aware datum ([#158](https://github.com/ChestnutLabs/gcode-preview/issues/158), DD-010 D4).

  The interpreter now honors work-coordinate systems and `G92` X/Y/Z, keeping the IR in the logical
  (work) frame so identity-WCS files stay byte-identical:
  - **`G54`–`G59`** select an active work offset (settable via `G10 L2`/`L20`); **`G53`** is a one-shot
    machine-coordinate bypass for the next move.
  - **`G92` X/Y/Z** is a datum **shift** when the current position is known (continuity preserved — e.g.
    `G92 X0` at X50 then `G1 X10` → X60).
  - **Probe awareness (DD-010 D4 amendment):** `G31` reaches its endpoint at runtime, so it marks the
    probed axes uncertain and is disclosed via a new `probe-position-runtime-dependent` warning (never
    advanced to the un-reached commanded value). A `G92` after a probe is a logical **resync** — the
    current logical position is declared to be the given value and a new frame starts at the datum, so no
    fabricated move is drawn across the unknown probe result. The `mach3` fixture's post-probe path now
    renders in its authored logical range instead of a stale-position shift.
  - New capability `coordinateSystem` (`'known'` once any G53/G54–G59/G92-XYZ/G10 is seen, else
    `'inferred'` = identity WCS).

  **Output change (documented):** the identity-WCS corpus stays **byte-identical** (the only golden
  change is the additive `coordinateSystem` key). The `mach3` fixture intentionally diverges from the
  inherited engine (which ignored `G31` and `G92 Z`) — a documented semantic correction, pinned by its
  native golden and excluded from strict adapter-equivalence. No renderer/adapter API change.

- [#228](https://github.com/ChestnutLabs/gcode-preview/pull/228) [`2d2b32b`](https://github.com/ChestnutLabs/gcode-preview/commit/2d2b32b836b296f2fac460073df10a7796596e9f) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Populate the `MoveKind.Wipe` bit from slicer wipe brackets (DD-016 phase 1, [#182](https://github.com/ChestnutLabs/gcode-preview/issues/182)).

  The `Wipe`/`Seam` kind bits were reserved but never set. Wipe's only reliable signal is a
  slicer comment (`;WIPE_START`/`;WIPE_END`), which the DD-005 sink invariant bars the annotation
  layer from turning into `kind`. DD-016 resolves this with a **narrow, additive** sink amendment:
  - `AnnotationSink.addMoveKind(segStart, segEnd, kindBits)` — allow-listed to `Wipe`/`Seam` only,
    additive (ORs the bit, never clears or reclassifies a move); non-allow-listed bits are dropped
    with a bounded warning.
  - The PrusaSlicer and Orca/Bambu adapters detect `;WIPE_START`/`;WIPE_END` and mark the bracketed
    segments as `Wipe`.
  - New capabilities: `wipeMoves` (`known` when a bracket was parsed, else `unavailable` — never
    fabricated) and `seamMoves` (always `unavailable`; seam has no per-move G-code signal).

  Golden-safe: the base Extrude/Travel classification is unchanged, so the golden-equivalence gate
  (kind masked to `Extrude|Travel`) is byte-identical; only the additive `wipeMoves`/`seamMoves`
  capability lines were regenerated in the native goldens. No IR schema change, no new dependency.
  Renderer visibility for wipe moves lands in phase 2.

### Patch Changes

- Updated dependencies [[`75f9f2b`](https://github.com/ChestnutLabs/gcode-preview/commit/75f9f2b2c758ef15b26a4b0f8dd955c89c9c5fb1), [`83f0336`](https://github.com/ChestnutLabs/gcode-preview/commit/83f033676522620ef9d57010a44d044f5f75c99d), [`852db93`](https://github.com/ChestnutLabs/gcode-preview/commit/852db9315ac3983c337508460575b4299ddacdfa), [`f2e79e4`](https://github.com/ChestnutLabs/gcode-preview/commit/f2e79e4da2bff2d6fb8222a94f04669128efc5d8), [`bb3085a`](https://github.com/ChestnutLabs/gcode-preview/commit/bb3085a03a4ce60b12789d0339c5c1a7bb8c7d5a), [`8c0ee6e`](https://github.com/ChestnutLabs/gcode-preview/commit/8c0ee6e2d5aec4d3b9c835ae92aa032ae619da34), [`b0ef69f`](https://github.com/ChestnutLabs/gcode-preview/commit/b0ef69f9ac2184c697f4df04c4c4c22ac709d0ee), [`39348de`](https://github.com/ChestnutLabs/gcode-preview/commit/39348de9ce68717e71516f9acaccd475139983ba), [`d161e80`](https://github.com/ChestnutLabs/gcode-preview/commit/d161e802e36cc87fa27848ceef9d68cd45628760), [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03), [`2d2b32b`](https://github.com/ChestnutLabs/gcode-preview/commit/2d2b32b836b296f2fac460073df10a7796596e9f)]:
  - @chestnutlabs/gcode-bgcode@0.3.0
  - @chestnutlabs/toolpath-core@0.3.0
  - @chestnutlabs/gcode-dialects@0.3.0
  - @chestnutlabs/gcode-containers@0.3.0

## 0.2.0

### Minor Changes

- [#171](https://github.com/ChestnutLabs/gcode-preview/pull/171) [`1c2e5b0`](https://github.com/ChestnutLabs/gcode-preview/commit/1c2e5b031845630a6f82501de51e1ae902d52559) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add M600 filament-swap color-change annotation (E9 phase 3, [#147](https://github.com/ChestnutLabs/gcode-preview/issues/147), DD-009 D2).

  The parser now records a sparse `colorChanges` events channel on `ToolpathIR`
  (`{ x, y, z, segIndex, srcByte, tool }`, capability `colorChanges`) — `M600` is a marker with a
  position but no motion segment, captured in a side channel that leaves segment indices, scrub, and
  layer ranges untouched (mirrors the `retractions` channel from [#148](https://github.com/ChestnutLabs/gcode-preview/issues/148)). Detection lives in the parser
  (where `M600` was previously discarded as `unsupported-command`), so a bare `M600` is honored even
  when no dialect is detected. A new `colorChange` renderer color mode shades segments by **swap slot**
  (the count of color changes at or before a segment) using the existing palette-index path — not the
  `tool` channel — so multi-material prints color by active filament across manual swaps. Capability-
  gated: offered only when the IR actually carries an `M600`. Exposed through the existing `colorMode`
  option, so all adapters and `renderStill` support it with no new prop.

  DD-009 D2 was amended (maintainer-approved) to move detection from the dialect layer to the parser
  and realize the "dedicated color-change channel" as this sparse events channel.

- [#168](https://github.com/ChestnutLabs/gcode-preview/pull/168) [`11c75bd`](https://github.com/ChestnutLabs/gcode-preview/commit/11c75bd540c1490f888ec9ecee64814cafb25156) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add opt-in retraction/deretraction markers (E9 phase 1, [#148](https://github.com/ChestnutLabs/gcode-preview/issues/148), DD-009 D1).

  The parser now records a sparse `retractions` events channel on `ToolpathIR`
  (`{ x, y, z, kind, srcByte, segIndex }`, capability `retractions`) — E-only retraction moves emit no
  segment, so they are captured positionally in a side channel that leaves segment indices, scrub, and
  layer ranges untouched. The renderer draws them as opt-in always-on-top markers (warm = retract, cool
  = unretract) via `setShowRetractions`, clipped by the current layer/scrub window and shown only when
  the IR actually carries events. Exposed as a `showRetractions` prop across the Vue, React, and Svelte
  adapters (default off).

### Patch Changes

- Updated dependencies [[`1c2e5b0`](https://github.com/ChestnutLabs/gcode-preview/commit/1c2e5b031845630a6f82501de51e1ae902d52559), [`11c75bd`](https://github.com/ChestnutLabs/gcode-preview/commit/11c75bd540c1490f888ec9ecee64814cafb25156)]:
  - @chestnutlabs/toolpath-core@0.2.0
  - @chestnutlabs/gcode-containers@0.2.0
  - @chestnutlabs/gcode-dialects@0.2.0

## 0.1.0

### Minor Changes

- [#141](https://github.com/ChestnutLabs/gcode-preview/pull/141) [`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - First published line of the Chestnut Labs G-code Preview stack (`v0.1.0`, DD-008): worker-based
  `.gcode` / `.gcode.3mf` parsing into a versioned `ToolpathIR`, cross-vendor dialect annotation
  (PrusaSlicer, Orca/Bambu, Cura, Klipper, Marlin, RepRap-flavor), a Three.js renderer with layer
  clipping, scrub, tubes, build plates and the honest live-progress overlay, a framework-neutral
  preview controller, and first-class Vue/React/Svelte adapters with capability parity.

### Patch Changes

- Updated dependencies [[`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3), [`b4d91c6`](https://github.com/ChestnutLabs/gcode-preview/commit/b4d91c62b83c3e1ecb00675c229fc69e3102d621)]:
  - @chestnutlabs/toolpath-core@0.1.0
  - @chestnutlabs/gcode-dialects@0.1.0
  - @chestnutlabs/gcode-containers@0.1.0
