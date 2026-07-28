---
'@chestnutlabs/gcode-bgcode': patch
---

`.bgcode` security hardening (DD-011 §7 + phase 5, #188): a deterministic **adversarial fuzz corpus**
(`adversarial.test.ts`) — ~1600 inputs across pure-random bytes, `GCDE`-prefixed random, bit-flip
mutations of a real file, and garbage payloads through every codec — asserting that only bounded,
structured `ContainerError`s ever escape (never a crash, unbounded allocation, or hang). Plus edge
cases: an oversized declared size can't balloon memory, and unknown block types are walked past.

Adds the **§7 security-review record** (`docs/design/SECURITY-REVIEW-DD-011-bgcode.md`, prepared for
maintainer sign-off) and a **decode benchmark** (`tools/benchmark/results/`) with real numbers (cube:
15.7 ms; 21 MB Prusa XL ColorMix: 3.3 s decode → 51 MB, all 856 CRC32s verified). Tests + docs only.
