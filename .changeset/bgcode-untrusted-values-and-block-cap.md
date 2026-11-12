---
'@chestnutlabs/gcode-bgcode': patch
---

`.bgcode` files with corrupt streams or impossible values are now handled safely.

- **Now throws: a file with more than 1,000,000 blocks.** `openBgcode` throws `E_BGCODE_BOMB`
  (`file has more than 1000000 blocks`). It fails before reading the extra block. A real
  PrusaSlicer file has about 8,000 blocks even at the 512 MiB output cap. Before, every block cost
  about 90 bytes of memory, so a file of empty blocks used about 9 times its own size.
- **Now throws: a MeatPack G-code block that ends mid-token.** Two cases throw `E_BGCODE_MEATPACK`
  (`MeatPack stream ends mid-token (state …)`):
  - the stream ends with a full-width byte still due;
  - the stream ends inside a `0xFF` signal.
  Before, the first case left a NUL byte in the decoded G-code, and the second dropped a character
  without notice.
- **Now absent: a bed with an unreadable point.** A `bed_shape` point too long to be a finite
  number (for example 400 digits) gives no `metadata.machine`, the same as a missing bed. The
  container adds one `bgcode-bed-unparsed` warning. This applies to any `bed_shape` that is present
  but unreadable, malformed points included. Before, the bed edge was `Infinity`, which drew an
  infinite build volume.
- **Now absent: a height that is not a positive number.** A `max_print_height` /
  `printable_height` of zero, below zero, `Infinity` or text leaves `machine.heightMm` undefined.
  The bed itself is kept.
- **Now dropped: a thumbnail block with zero width or height.** It no longer appears in
  `thumbnails` or `metadata.thumbnails`. Its bytes still count against the 32 MiB
  metadata/thumbnail budget.
