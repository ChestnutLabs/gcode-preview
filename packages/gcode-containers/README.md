# @chestnutlabs/gcode-containers

Safe, bounded, **zero-dependency container extraction** for sliced G-code archives —
`.gcode.3mf` (sliced-plate export) and plain ZIP — for the Chestnut Labs G-code Preview stack
(design: DD-005, security review DD-005 §7.3).

- In-memory ZIP reader with strict resource limits (entry counts, sizes, name policies)
- `.gcode.3mf` plate discovery and selection (multi-plate via the wire `plate` option)
- Hardened against adversarial archives — a manifest-tracked adversarial corpus rides in CI, and
  coverage-guided fuzzing over `readDirectory`/`streamEntry` is part of the release gate

This package is bundled into the parser's default *batteries* worker — most applications never
import it directly. Import it to build a custom worker or to consume containers outside the
parse pipeline.

Part of [Chestnut Labs G-code Preview](../../README.md) · MIT
