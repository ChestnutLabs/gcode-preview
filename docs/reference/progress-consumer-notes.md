# Live Progress — Consumer Integration Notes (AnyBridge-facing)

How a host wires its telemetry into the DD-006 progress surface. The contract itself is in
[progress-signal-contract.md](progress-signal-contract.md); this page is the "what do I feed it
from *my* printer data" side, written against AnyBridge's normalized `JobProgress`
(`src/anybridge/model/telemetry.py`) as surveyed in DD-006 §1.1 — but nothing here imports or
depends on AnyBridge.

## Mapping `JobProgress` → `ProgressObservation`

| AnyBridge field | Observation field | Notes |
|---|---|---|
| `progress` (0..1) | `position.percent` | Set `percentBasis` per dialect: **Klipper** `virtual_sdcard.progress` is a byte fraction → `'bytes'`; **Bambu** `mc_percent` is job progress → `'job'`; Anycubic-family print-report `progress` → `'job'` (or `'unknown'`). |
| `current_layer` / `total_layers` | `position.layer` / `position.totalLayers` | Pass both — `totalLayers` powers the count-mismatch honesty rule. Klipper populates these only when the file/macros emit `SET_PRINT_STATS_INFO`; omit when absent. |
| *(future)* Moonraker `virtual_sdcard.file_position` | `position.byte` | The additive byte-exact upgrade: one nullable field on `JobProgress`, and Klipper printers get an exact marker. Byte offsets refer to the file Klipper prints — the same bytes the viewer parsed when the host feeds both from one source. |
| `file_name` + file metadata | `file.name` / `file.sizeBytes` / `file.sha256` | Strongly recommended: size (and hash when the host has it, e.g. from its file library) powers wrong-file detection. |
| lifecycle (`PrintState`/`JobState`) | `state` | `printing`/`paused` map directly; job completed → `'complete'` (maps to the final segment); cancelled → `'cancelled'`. |
| — | `timestampMs` | The host's receive time (`Date.now()`). Drives staleness. |

`elapsed_s`/`remaining_s` have no observation field by design — the viewer does not do time-based
position estimation (DD-006 non-goal, consistent with AnyBridge's TIMING-NORMALIZATION rule).

## Wiring pattern

```ts
// once per opened file (the same bytes fed to the parser):
const mapper = createProgressMapper(result.ir, { fileSizeBytes: bytes.byteLength });

// per telemetry push:
onJobProgress((jp, printerState) => {
  renderer.setProgress(mapper.observe(toObservation(jp, printerState, Date.now())));
});

// staleness sweep (1 Hz is plenty; harmless when idle):
setInterval(() => renderer.setProgress(mapper.tick(Date.now())), 1000);

// job end / different file selected:
mapper.reset();
renderer.setProgress(null);
```

Listen for `progress-presentation-changed` to surface *why* an overlay degraded ("position hidden:
file-mismatch") instead of leaving users guessing.

## Containers (`.gcode.3mf`)

`position.byte` and percent-of-bytes refer to the **extracted plate payload** the parser consumed
— which matches Klipper-style hosts printing plain G-code. Bambu printers execute the container
plate; their surface reports percent+layer (no byte offsets), so the byte-domain question does not
arise there in practice. If a byte-reporting surface ever executes a *different* byte stream than
the parsed one, the identity fields catch it (size demotes, hash hides).

## Honest-degradation checklist for hosts

- Pass every fact you have (percent **and** layer **and** totals): cross-checks make the band
  honest; withholding facts only loses precision.
- Never synthesize a byte offset from a percent yourself — pass `percentBasis: 'bytes'` and let
  the mapper promote (it keeps the `approximated` label and band).
- Do not re-map or clamp `MappedProgress` before `setProgress` — the presentation rules (marker
  vs. band vs. hidden) are the contract's honesty guarantees.
- Replay the pinned fixtures in `test-data/fixtures/progress/` against your producer: each file's
  `steps[].obs` are the shapes your `toObservation` should emit for that dialect family.
