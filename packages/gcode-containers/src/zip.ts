/**
 * Minimal, hostile-input-hardened ZIP reader (DD-005 §4.4/§7, as amended).
 *
 * In-memory only — never touches a filesystem. Zero dependencies: inflate uses
 * the platform `DecompressionStream('deflate-raw')` (browsers, workers, and the
 * pinned Node 22+ runtime; NOT Node 18). Enforced per amendment 3:
 *   - per-entry CRC32 verification (streaming accumulation)
 *   - central/local header agreement (name, sizes, method)
 *   - encrypted-entry rejection
 *   - duplicate canonical-name handling
 *   - incremental expanded-byte caps (a lying header cannot balloon memory)
 * Zip64 is detected and rejected with a structured error (v1 scope; .gcode.3mf
 * payloads are far below 4 GB).
 */

export class ContainerError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ContainerError';
  }
}

export interface ContainerLimits {
  maxEntries: number;
  maxEntryNameBytes: number;
  maxExpandedBytesPerEntry: number;
  maxExpandedBytesTotal: number;
  maxMetadataBytes: number;
}

/** §7.2 defaults (provisional; ratified by the E4 benchmark phase). */
export const DEFAULT_CONTAINER_LIMITS: ContainerLimits = {
  maxEntries: 4096,
  maxEntryNameBytes: 1024,
  maxExpandedBytesPerEntry: 512 * 1024 * 1024,
  maxExpandedBytesTotal: 1024 * 1024 * 1024,
  maxMetadataBytes: 8 * 1024 * 1024
};

export interface ZipEntry {
  /** Canonical name: forward slashes, no traversal — see canonicalName(). */
  name: string;
  rawName: string;
  method: number; // 0 = stored, 8 = deflate
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
  flags: number;
}

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_EOCD_SIG = 0x06064b50;

/** CRC32 (IEEE) with the standard table. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, seed = 0xffffffff): number {
  let c = seed;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return c >>> 0;
}

export const crc32Final = (c: number): number => (c ^ 0xffffffff) >>> 0;

/**
 * Canonicalize an entry name for duplicate detection and selection sanity:
 * backslashes → slashes, case-folded, collapsed slashes. Returns null for
 * HOSTILE names (traversal segments, absolute paths, drive letters, NUL).
 */
export function canonicalName(rawName: string): string | null {
  if (rawName.includes('\0')) return null;
  const slashed = rawName.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(slashed) || slashed.startsWith('/')) return null;
  const parts = slashed.split('/').filter((p) => p.length > 0);
  if (parts.some((p) => p === '..' || p === '.')) return null;
  if (parts.length === 0) return null;
  return parts.join('/').toLowerCase();
}

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

export interface ZipDirectory {
  /** Central-directory entries in CD order, hostile names excluded (warned). */
  entries: ZipEntry[];
  warnings: { code: string; message: string }[];
}

/** Parse the central directory (discovery only — no payload inflate). */
export function readDirectory(bytes: Uint8Array, limits: ContainerLimits): ZipDirectory {
  // Locate EOCD: scan backward over the last 64KB+22 for the signature.
  const scanStart = Math.max(0, bytes.length - (64 * 1024 + 22));
  let eocd = -1;
  for (let i = bytes.length - 22; i >= scanStart; i--) {
    if (u32(bytes, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new ContainerError('E_CONTAINER_FORMAT', 'not a ZIP archive (no end-of-central-directory)');
  const totalEntries = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (totalEntries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new ContainerError('E_CONTAINER_ZIP64', 'zip64 archives are not supported (v1 scope)');
  }
  // Explicit zip64 EOCD present anywhere near the tail → reject rather than misparse.
  for (let i = Math.max(0, eocd - 76); i < eocd; i++) {
    if (u32(bytes, i) === ZIP64_EOCD_SIG) {
      throw new ContainerError('E_CONTAINER_ZIP64', 'zip64 archives are not supported (v1 scope)');
    }
  }
  if (totalEntries > limits.maxEntries) {
    throw new ContainerError(
      'E_CONTAINER_LIMIT_ENTRIES',
      `archive has ${totalEntries} entries (> ${limits.maxEntries})`
    );
  }
  if (cdOffset + cdSize > bytes.length) {
    throw new ContainerError('E_CONTAINER_FORMAT', 'central directory extends past the archive');
  }

  const warnings: { code: string; message: string }[] = [];
  const entries: ZipEntry[] = [];
  const seen = new Map<string, number>();
  let o = cdOffset;
  const dec = new TextDecoder();
  for (let n = 0; n < totalEntries; n++) {
    if (o + 46 > bytes.length || u32(bytes, o) !== CD_SIG) {
      throw new ContainerError('E_CONTAINER_FORMAT', `malformed central directory at entry ${n}`);
    }
    const flags = u16(bytes, o + 8);
    const method = u16(bytes, o + 10);
    const crc = u32(bytes, o + 16);
    const compressedSize = u32(bytes, o + 20);
    const uncompressedSize = u32(bytes, o + 24);
    const nameLen = u16(bytes, o + 28);
    const extraLen = u16(bytes, o + 30);
    const commentLen = u16(bytes, o + 32);
    const localHeaderOffset = u32(bytes, o + 42);
    if (nameLen > limits.maxEntryNameBytes) {
      throw new ContainerError('E_CONTAINER_LIMIT_NAME', `entry name of ${nameLen} B (> ${limits.maxEntryNameBytes})`);
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new ContainerError('E_CONTAINER_ZIP64', 'zip64 entry fields are not supported (v1 scope)');
    }
    const rawName = dec.decode(bytes.subarray(o + 46, o + 46 + nameLen));
    o += 46 + nameLen + extraLen + commentLen;

    if (rawName.endsWith('/')) continue; // directory entries carry no payload
    const name = canonicalName(rawName);
    if (name === null) {
      warnings.push({
        code: 'container-entry-hostile-name',
        message: `entry name rejected: ${JSON.stringify(rawName)}`
      });
      continue;
    }
    const dup = seen.get(name);
    if (dup !== undefined) {
      warnings.push({ code: 'container-duplicate-entry', message: `duplicate canonical name '${name}' (first wins)` });
      continue; // amendment 3: first central-directory occurrence wins for metadata; payload dups error at selection
    }
    seen.set(name, entries.length);
    entries.push({ name, rawName, method, compressedSize, uncompressedSize, crc32: crc, localHeaderOffset, flags });
  }
  return { entries, warnings };
}

/** Validate central/local header agreement and return the payload data offset. */
export function locatePayload(bytes: Uint8Array, entry: ZipEntry): number {
  const o = entry.localHeaderOffset;
  if (o + 30 > bytes.length || u32(bytes, o) !== LOCAL_SIG) {
    throw new ContainerError('E_CONTAINER_FORMAT', `bad local header for '${entry.name}'`);
  }
  const flags = u16(bytes, o + 6);
  if ((flags & 0x1) !== 0 || (entry.flags & 0x1) !== 0) {
    throw new ContainerError('E_CONTAINER_ENCRYPTED', `entry '${entry.name}' is encrypted — no decryption path exists`);
  }
  const method = u16(bytes, o + 8);
  const nameLen = u16(bytes, o + 26);
  const extraLen = u16(bytes, o + 28);
  const localName = new TextDecoder().decode(bytes.subarray(o + 30, o + 30 + nameLen));
  if (method !== entry.method || localName !== entry.rawName) {
    throw new ContainerError(
      'E_CONTAINER_HEADER_MISMATCH',
      `central/local header disagreement for '${entry.name}' — treating the entry as hostile`
    );
  }
  // When the local header carries sizes (no data-descriptor flag), they must agree too.
  if ((flags & 0x8) === 0) {
    const localCrc = u32(bytes, o + 14);
    const localCompressed = u32(bytes, o + 18);
    const localUncompressed = u32(bytes, o + 22);
    if (
      localCrc !== entry.crc32 ||
      localCompressed !== entry.compressedSize ||
      localUncompressed !== entry.uncompressedSize
    ) {
      throw new ContainerError(
        'E_CONTAINER_HEADER_MISMATCH',
        `central/local size/CRC disagreement for '${entry.name}' — treating the entry as hostile`
      );
    }
  }
  const dataStart = o + 30 + nameLen + extraLen;
  if (dataStart + entry.compressedSize > bytes.length) {
    throw new ContainerError('E_CONTAINER_FORMAT', `entry '${entry.name}' payload extends past the archive`);
  }
  return dataStart;
}

const INFLATE_CHUNK = 256 * 1024;

/**
 * Extract one entry fully in memory with incremental caps + streaming CRC.
 * `cap` bounds the expanded size REGARDLESS of what headers claim.
 */
export async function extractEntry(bytes: Uint8Array, entry: ZipEntry, cap: number): Promise<Uint8Array> {
  const out: Uint8Array[] = [];
  let total = 0;
  let crc = 0xffffffff;
  for await (const chunk of streamEntry(bytes, entry, cap)) {
    out.push(chunk);
    total += chunk.byteLength;
    crc = crc32(chunk, crc);
  }
  if (crc32Final(crc) !== entry.crc32) {
    throw new ContainerError('E_CONTAINER_CRC', `CRC mismatch for '${entry.name}'`);
  }
  if (total !== entry.uncompressedSize) {
    throw new ContainerError('E_CONTAINER_HEADER_MISMATCH', `expanded size of '${entry.name}' differs from headers`);
  }
  const joined = new Uint8Array(total);
  let off = 0;
  for (const c of out) {
    joined.set(c, off);
    off += c.byteLength;
  }
  return joined;
}

/**
 * Stream an entry's expanded bytes with an incremental cap. CRC verification
 * for the streaming path is the CALLER's job via crc32/crc32Final (the plate
 * pipeline verifies at end-of-stream); extractEntry() verifies internally.
 */
export async function* streamEntry(bytes: Uint8Array, entry: ZipEntry, cap: number): AsyncGenerator<Uint8Array> {
  const dataStart = locatePayload(bytes, entry);
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.uncompressedSize > cap) {
    throw new ContainerError(
      'E_CONTAINER_LIMIT_EXPANDED',
      `entry '${entry.name}' claims ${entry.uncompressedSize} B (> cap ${cap})`
    );
  }
  let produced = 0;
  const guard = (chunk: Uint8Array): Uint8Array => {
    produced += chunk.byteLength;
    if (produced > cap) {
      throw new ContainerError(
        'E_CONTAINER_LIMIT_EXPANDED',
        `entry '${entry.name}' expanded past ${cap} B — headers lied; extraction stopped`
      );
    }
    return chunk;
  };
  if (entry.method === 0) {
    if (compressed.byteLength !== entry.uncompressedSize) {
      throw new ContainerError('E_CONTAINER_HEADER_MISMATCH', `stored entry '${entry.name}' size disagreement`);
    }
    for (let o = 0; o < compressed.byteLength; o += INFLATE_CHUNK) {
      yield guard(compressed.subarray(o, Math.min(o + INFLATE_CHUNK, compressed.byteLength)));
    }
    return;
  }
  if (entry.method !== 8) {
    throw new ContainerError('E_CONTAINER_METHOD', `entry '${entry.name}' uses unsupported method ${entry.method}`);
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  // The writer side must never become an unobserved rejection: on corrupt
  // deflate data the stream errors BOTH ends, and an unawaited writer promise
  // crashes the process as an unhandled rejection even though the reader path
  // converts its copy of the error (found by the #131 fuzzer — see the
  // fuzz-regressions corpus). Capture instead of floating.
  let writeError: unknown;
  const writeAll = (async () => {
    for (let o = 0; o < compressed.byteLength; o += INFLATE_CHUNK) {
      await writer.write(compressed.subarray(o, Math.min(o + INFLATE_CHUNK, compressed.byteLength)));
    }
    await writer.close();
  })().catch((e: unknown) => {
    writeError = e;
  });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined && value.byteLength > 0) yield guard(value);
    }
    await writeAll;
    if (writeError !== undefined) throw writeError;
  } catch (err) {
    await writeAll; // settled by construction; never rejects
    if (err instanceof ContainerError) throw err;
    throw new ContainerError(
      'E_CONTAINER_INFLATE',
      `inflate failed for '${entry.name}': ${err instanceof Error ? err.message : err}`
    );
  }
}
