# `.bgcode` adversarial fixtures

Tiny, deliberately malformed `.bgcode` files, one per decoder guard. Each must FAIL with the structured
`ContainerError` listed below and never crash. Regenerate with
`node tools/fixtures/make-bgcode-adversarial.mjs`. Exercised by
`packages/gcode-bgcode/src/__tests__/adversarial-fixtures.test.ts`.

| File | What it breaks | Expected error |
|---|---|---|
| `deflate-over-declared.bgcode` | DEFLATE block inflates to 100 bytes but declares 99 | `E_BGCODE_BOMB` |
| `checksum-type-2.bgcode` | header checksum type 2 (only 0 and 1 exist) | `E_BGCODE_CHECKSUM` |
| `truncated-crc.bgcode` | last 2 bytes of the block CRC32 cut off | `E_BGCODE_TRUNCATED` |
| `meatpack-bad-cmd.bgcode` | MeatPack stream with an unknown command (`FF FF 00`) | `E_BGCODE_MEATPACK` |
| `aggregate-over-cap.bgcode` | two 60-byte G-code blocks; 120 bytes total, over a 100-byte `maxOutputBytes` | `E_BGCODE_BOMB` |
| `unknown-encoding.bgcode` | G-code block encoding id 3 (only 0–2 exist) | `E_BGCODE_UNSUPPORTED_ENCODING` |

The `deflate-over-declared.bgcode` bytes come from Node's zlib (generated on Node 24.16.0); another Node/zlib version may emit different bytes, so treat the committed file as canonical.
