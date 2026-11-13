---
'@chestnutlabs/gcode-preview-core': patch
'@chestnutlabs/gcode-parser': patch
---

A parse whose input throws now keeps the parse event contract (every `parse-started` is followed by exactly one
terminal event, then `parsing: false`).

- **Core:** `controller.parse(null)` (or `undefined`, or a primitive) used to throw before any event and leave
  `state.parsing` `true` for good. It now emits `parse-started` (0 bytes) and `parse-error` with code `E_UNKNOWN`
  (`parse input must be a Uint8Array, ArrayBuffer or File (got null)`), resolves `{ ok: false, error }` and resets
  `parsing`. An input whose size cannot be read reports `parse-started` with 0 bytes instead of throwing.
- **Parser:** an input whose `getReader` getter throws used to leave `GcodeParseSession` busy, so every later
  `parse()` failed with `E_BUSY` until `dispose()`. It now rejects with `E_POST_FAILED` (as a failed `postMessage`
  does, #453) and the session stays usable.
