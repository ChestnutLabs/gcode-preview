---
'@chestnutlabs/gcode-bgcode': patch
---

`heatshrinkDecode` and `meatpackDecode` now reject out-of-range parameters instead of misbehaving silently.

Only code that calls these two exports directly is affected; opening a `.bgcode` file goes through the same
decoders with fixed, valid values and decodes exactly as before (checked byte-for-byte against a real PrusaSlicer
file).

- `limit` must be a non-negative integer. `NaN` used to return empty output and `Infinity` switched the output cap
  off; both, and any negative, fractional or non-number value, now throw `ContainerError` with code
  `E_BGCODE_OPTION` (the same code `openBgcode` uses for a bad `maxOutputBytes`).
- `heatshrinkDecode`: `windowBits` must be an integer from 4 to 15 and `lookaheadBits` an integer from 3 to
  `windowBits − 1`; anything else throws `E_BGCODE_OPTION`. Before, `windowBits: 30` allocated 1 GiB before any
  limit applied, 31 threw a bare `RangeError`, and 32 or `NaN` silently decoded wrong data.

All checks run before anything is allocated.
