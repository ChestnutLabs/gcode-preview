---
'@chestnutlabs/gcode-parser': patch
---

Canned drilling cycles now honour their `L` repeat count.

- **`L` repeats the hole.** `G81`/`G82`/`G83` with `L3` drill three holes instead of one, on a `G81 ... L3` line and on a bare `X`/`Y` repeat line alike. Under `G91` each repeat steps by the `X`/`Y` increment, giving a row of holes; under `G90` the same hole is drilled again in place. A start height below the `R` plane still rises to `R` only once.
- **A bad `L` draws the cycle once and says so.** `L0`, a negative `L`, a fraction such as `L1.5` and a non-number raise the new `canned-cycle-bad-repeat` warning. A fraction used to be cut down silently.
- **A huge `L` is bounded.** An `L` above `maxProgramIterations` (default 1,000,000) repeats that many times and raises `canned-cycle-repeat-limit`, so a hostile file cannot spin the parser.
