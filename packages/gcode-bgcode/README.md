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
| Adversarial corpus + §7.3 security review + benchmark | ⏳ phase 5 |

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
(`bed_shape`) and whitelisted slicer settings surfaced as container metadata. Thumbnails are decoded and
available on `openBgcodeContainer(bytes).thumbnails`.

Every failure — bad magic/version, CRC mismatch, truncation, unknown/unsupported codec, or a
decompression bomb — is a structured, bounded `ContainerError` (never a crash or an unbounded read).
