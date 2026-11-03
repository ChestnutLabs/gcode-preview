---
'@chestnutlabs/gcode-bgcode': patch
---

`.bgcode` metadata and thumbnail blocks are now bounded: together they share a fixed 32 MiB budget,
separate from `maxOutputBytes`. Before, each block could decode up to the full `maxOutputBytes`
(512 MiB by default) and none of it was counted, so a small crafted file with many such blocks could
make memory grow without limit. A real PrusaSlicer 2.9 file carries about 125 KB of metadata and
thumbnails, and PrusaSlicer caps each thumbnail below 1000×1000, so real files are unaffected. A file over the budget fails with `E_BGCODE_BOMB`.

**Behaviour change:** `openBgcode`'s `maxOutputBytes` must now be a non-negative integer. `NaN` and
`Infinity` previously disabled every output cap without warning; they now throw `E_BGCODE_OPTION`, as
do `-1`, `1.5`, and non-numbers such as `'100'`. `0` and `undefined` (the 512 MiB default) are still
accepted. If you passed `Infinity` to mean "uncapped", pass a large finite value instead.
