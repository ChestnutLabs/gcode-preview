---
'@chestnutlabs/gcode-bgcode': minor
---

Binary G-code decode **phase 2** (DD-011, #188): the **MeatPack** G-code encoding (both variants —
`MeatPack` and `MeatPack (comments preserved)`). A `.bgcode` GCode block encoded with MeatPack now
decodes end-to-end (optionally after DEFLATE) to plain G-code.

The decoder is a faithful TypeScript port of the **MIT** `jamesgopsill/meatpack` unpacker (© 2025
James Gopsill), which is itself derived from the published Prusa spec — attribution preserved, and no
AGPL `libbgcode`/OctoPrint-MeatPack code (RR-003 §8). It is validated against **hand-computed vectors**
(the nibble table applied by hand as an independent oracle: packing, left/right/double full-width
escapes, the newline special case, and the no-spaces + disable-packing commands), plus block-level
integration through `openBgcode`. Output is bounded (decompression-bomb defense) and invalid command
bytes are structured errors. heatshrink compression remains phase 3.
