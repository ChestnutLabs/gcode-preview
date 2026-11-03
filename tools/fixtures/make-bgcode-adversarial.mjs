/*
 * Fixture generator (Packet 2 sweep, G2): tiny deliberately-malformed `.bgcode` files, one per decoder
 * guard. Deterministic byte-for-byte, so the manifest sha256 entries stay stable. An independent writer
 * (own CRC table, node:zlib) — it does not reuse the decoder or the test assembler.
 *
 * Usage: node tools/fixtures/make-bgcode-adversarial.mjs
 * Output: test-data/fixtures/bgcode/adversarial/  (see its README.md for what each file breaks)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const outDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../test-data/fixtures/bgcode/adversarial'
);
fs.mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

/** File header: "GCDE", version 1, checksum type. */
const header = (checksumType = 1) => [0x47, 0x43, 0x44, 0x45, ...u32(1), ...u16(checksumType)];

/** A GCode block (type 1). `declared` overrides the uncompressed size (for size lies). */
function gcodeBlock({ compression = 0, encoding = 0, stored, declared, crc = true }) {
  const b = [...u16(1), ...u16(compression), ...u32(declared ?? stored.length)];
  if (compression !== 0) b.push(...u32(stored.length));
  b.push(...u16(encoding), ...stored);
  if (crc) b.push(...u32(crc32(Uint8Array.from(b))));
  return b;
}

const ascii = (s) => [...Buffer.from(s, 'latin1')];
const fixtures = {
  // DEFLATE block that inflates to 100 bytes but declares 99 → E_BGCODE_BOMB.
  'deflate-over-declared.bgcode': [
    ...header(),
    ...gcodeBlock({ compression: 1, stored: [...zlib.deflateSync(Buffer.alloc(100, 0x41))], declared: 99 })
  ],
  // Header checksum type 2 (only 0/1 exist) → E_BGCODE_CHECKSUM.
  'checksum-type-2.bgcode': [...header(2), ...gcodeBlock({ stored: ascii('G1 X1\n'), crc: false })],
  // A valid CRC32 block with the last 2 CRC bytes cut off → E_BGCODE_TRUNCATED "truncated block checksum".
  'truncated-crc.bgcode': [...header(), ...gcodeBlock({ stored: ascii('G1 X1\n') })].slice(0, -2),
  // MeatPack-encoded block with an unknown command (FF FF 00) → E_BGCODE_MEATPACK.
  'meatpack-bad-cmd.bgcode': [...header(), ...gcodeBlock({ encoding: 1, stored: [0xff, 0xff, 0x00] })],
  // Two 60-byte uncompressed GCode blocks (120 bytes total) → E_BGCODE_BOMB at maxOutputBytes 100.
  'aggregate-over-cap.bgcode': [
    ...header(),
    ...gcodeBlock({ stored: ascii('A'.repeat(59) + '\n') }),
    ...gcodeBlock({ stored: ascii('B'.repeat(59) + '\n') })
  ],
  // GCode block with encoding id 3 (only 0..2 exist) → E_BGCODE_UNSUPPORTED_ENCODING.
  'unknown-encoding.bgcode': [...header(), ...gcodeBlock({ encoding: 3, stored: ascii('G1 X1\n') })]
};

for (const [name, bytes] of Object.entries(fixtures)) {
  fs.writeFileSync(path.join(outDir, name), Uint8Array.from(bytes));
  console.log(`${name}  ${bytes.length} bytes`);
}
