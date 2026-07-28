# `.bgcode` decode benchmark (DD-011 §8, #188 phase 5)

**Date:** 2026-07-27 · **Package:** `@chestnutlabs/gcode-bgcode` (built dist) · **Runtime:** Node (dev
workstation). Decode = `openBgcode(bytes, { metadata: true })` (block walk + per-block CRC32 +
decompress + decode + concatenate). TTFP = decode **+** `parseGcodeToIR` on the decoded G-code.

## Method

Two real PrusaSlicer 2.9.x `.bgcode` files, each the full Prusa codec stack (heatshrink-12 compression
+ MeatPack comments/no-spaces encoding for the GCode blocks; DEFLATE INI metadata; thumbnails; per-block
CRC32). Median of N warm runs. Both are the same files used by the golden-equivalence and real-file
validation (the cube is committed at `test-data/fixtures/bgcode/prim-cube.bgcode`; the 21 MB XL file is
the maintainer-supplied validation file, not committed).

## Results

| File | Input | Decoded G-code | Segments | Decode (median) | Out throughput | TTFP (decode+parse) |
|---|---|---|---|---|---|---|
| Prusa cube | 0.16 MB | 0.38 MB | 11,417 | **15.7 ms** (n=20) | ~25 MB/s | 131 ms |
| Prusa XL ColorMix (18h59m print) | 21.21 MB | 51.43 MB | 1,499,730 | **3.27 s** (n=5) | ~16 MB/s | 9.61 s |

## Reading

- Decode is a **single linear pass**; output throughput is ~16–25 MB/s (heatshrink + MeatPack dominate;
  DEFLATE metadata is a rounding error). A `.bgcode` is decoded **once** into the plain-G-code the rest
  of the pipeline already handles — the 3.3 s to expand a 21 MB / 18h59m ColorMix print (2.4× smaller on
  disk than its 51 MB plain form) is a one-time cost, not per-frame.
- **TTFP is parse-dominated, not decode-dominated:** for the XL file the 9.6 s is ~3.3 s decode + ~6.3 s
  parsing 51 MB / 1.5 M segments — i.e. `.bgcode` adds a bounded constant on top of the plain-G-code
  parse it would have done anyway, exactly as DD-011 §8 targeted.
- Memory is bounded throughout (the §7 decompression-bomb caps); no per-segment allocation beyond the
  G-code buffer the parser already consumes.

## Correctness cross-check (not a perf number, but the reason the above is meaningful)

Both files decode correctly: the XL file's **856 blocks all pass CRC32**, and the cube's decoded IR is
**byte-identical** to the plain `.gcode` IR (the committed `golden-equivalence.test.ts`). So these are
throughput numbers for a **verified-correct** decode, not a fast-but-wrong one.
