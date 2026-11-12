# @chestnutlabs/gcode-bgcode

Binary G-code (`.bgcode`) **decode** for the Chestnut Labs G-code toolpath stack (DD-011, epic #188).

Prusa's `.bgcode` is a *container* of ordinary G-code, not a new toolpath language. This package walks
the binary block structure, verifies per-block CRC32, decompresses, decodes, and concatenates the GCode
blocks into **plain G-code** — which the existing parser / dialect / IR / renderer / progress pipeline
consumes unchanged. **Decode-only** (it never writes `.bgcode`), **in-memory only** (no filesystem, no
network), zero runtime dependencies beyond `@chestnutlabs/toolpath-core` and
`@chestnutlabs/gcode-containers`.

## Licensing (why this is a clean-room decoder)

The reference `libbgcode` and OctoPrint-MeatPack are **AGPL-3.0**; none of their code is used here — the
block walker is written clean-room from the published format spec ([RR-003](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/research/RR-003-bgcode-licensing-and-format-audit.md)).
The **MeatPack** decoder is a faithful port of the **MIT** [`jamesgopsill/meatpack`](https://github.com/jamesgopsill/meatpack)
(© 2025 James Gopsill), and the **heatshrink** decoder is a port of the **ISC**
[`atomicobject/heatshrink`](https://github.com/atomicobject/heatshrink) (© 2013–2015 Scott Vokes) —
both attributions preserved in their source files. This package is MIT.

## Status — phased (DD-011 §14)

| Capability | Status |
|---|---|
| Block walker + CRC32 + `sniff`/`open` | ✅ phase 1 |
| Compression: None, DEFLATE | ✅ phase 1 |
| Encoding: None | ✅ phase 1 |
| Encoding: MeatPack (both variants) | ✅ phase 2 |
| Compression: heatshrink 11/12 | ✅ phase 3 |
| DEFLATE zlib-flavor fix + golden-equivalence killer test (real Prusa files) | ✅ phase 4 |
| Container adapter + batteries-worker registration + metadata/thumbnail surfacing | ✅ phase 4c |
| Adversarial fuzz corpus + §7 security review + decode benchmark | ✅ phase 5 |

## Usage

```ts
import { openBgcode, sniffBgcode } from '@chestnutlabs/gcode-bgcode';

if (sniffBgcode(firstBytes, name)) {
  const { gcode, blocks, checksum } = await openBgcode(bytes, { metadata: true });
  // `gcode` is plain G-code (Uint8Array) → feed the existing parser.
}
```

It also registers as a **container adapter** in the batteries parser worker, so a `.bgcode` file "just
works" through `GcodeParseSession` (`containers: 'auto'`) — decoded to G-code, with the machine geometry
(`bed_shape`) and whitelisted slicer settings surfaced as container metadata. The file's embedded
thumbnails arrive on the parse result as `metadata.thumbnails` (`{ width, height, mime, bytes }`; `mime`
is `image/png`, `image/jpeg` or `image/qoi`), the same list `; thumbnail` comments fill for plain
`.gcode`. Up to 8 are kept, in file order. They are also available directly on
`openBgcodeContainer(bytes).thumbnails`.

Every failure — bad magic/version, CRC mismatch, truncation, unknown/unsupported codec, or a
decompression bomb — is a structured, bounded `ContainerError` (never a crash or an unbounded read).

Fixed limits:

| Limit | Value | When exceeded |
|---|---|---|
| Decoded G-code (`maxOutputBytes`) | 512 MiB by default | `E_BGCODE_BOMB` |
| Metadata + thumbnail blocks, combined | 32 MiB | `E_BGCODE_BOMB` |
| Blocks in one file | 1,000,000 (a real file has about 8,000) | `E_BGCODE_BOMB` |

A MeatPack G-code block that ends mid-token throws `E_BGCODE_MEATPACK`. Values the file declares but
that cannot be true are left out, not passed on. A `bed_shape` point that is not a finite number gives
no machine geometry, with a `bgcode-bed-unparsed` container warning. A height that is not a positive
number gives no `heightMm`, with a `bgcode-metadata-invalid` warning. A thumbnail with a zero width or
height is dropped: `openBgcode` counts these in `droppedThumbnails`, and the container adds one
`bgcode-metadata-invalid` warning with the count.
