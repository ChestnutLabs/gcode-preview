---
'@chestnutlabs/gcode-model-renderer': patch
---

Hostile-input hardening, no behaviour change (#468 follow-up). The 3MF model-XML tokenizer was quadratic
three ways: a lazy tag body re-scanned to the end of the input from every `<` with no terminating `>` (120 KB
of `<a ` froze the load for 12 s), a long tag name backtracked (one 20k-character name took 1 s), and the
attribute reader restarted inside every word without an `=` (one 80 KB word took 8.6 s). Both are now linear
(each of those inputs takes a few milliseconds). The new tokenizer returns exactly what the old regex did,
including for garbled and truncated files; this is verified differentially against the old implementation
(corpus 3MFs, hand cases and a million seeded random strings).
