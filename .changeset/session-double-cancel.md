---
"@chestnutlabs/gcode-parser": patch
---

Fix a parse-session hang on a double `cancel()`. A second `cancel()` while a cancel was already pending (e.g. the controller cancelling before a re-parse) overwrote the terminate backstop timer and orphaned the first — which could later terminate an unrelated in-flight parse and wedge the controller at `parsing: true`. `cancel()` is now idempotent while a cancel is already pending.
