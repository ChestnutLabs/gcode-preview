---
'@chestnutlabs/gcode-bgcode': minor
---

Binary G-code decode **phase 3** (DD-011, #188): **heatshrink** decompression (windows 11 & 12,
lookahead 4). With this, **all four `.bgcode` compression codecs and all encodings the spec defines
are decoded** — a `.bgcode` GCode block compressed with heatshrink now decodes end-to-end to plain
G-code.

The decoder is a TypeScript port of the LZSS decoder from the **ISC** `atomicobject/heatshrink`
(© 2013–2015 Scott Vokes) — attribution preserved, no AGPL `libbgcode` (RR-003 §8). It is validated
against vectors built by an **independent MSB-first bit-packer** from the wire format (literal, single
and multi-byte back-references, self-referential runs, window 11 & 12, a realistic repeated G-code
fragment) plus block-level integration through `openBgcode`. Output is bounded (decompression-bomb
defense). Container-adapter integration + real PrusaSlicer-file golden-equivalence follow in phase 4.
