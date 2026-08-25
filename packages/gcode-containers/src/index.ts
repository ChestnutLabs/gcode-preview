/**
 * @chestnutlabs/gcode-containers — safe container extraction (DD-005 §4.4/§7).
 *
 * Phase 2 (#74): the hardened in-memory ZIP reader and the `.gcode.3mf`
 * adapter. In-memory only, zero dependencies, never writes files, never
 * fetches. Depends only on @chestnutlabs/toolpath-core; the parser consumes
 * it through its structural ContainerAdapterLike type (worker entries compose).
 */
export {
  ContainerError,
  DEFAULT_CONTAINER_LIMITS,
  canonicalName,
  crc32,
  crc32Final,
  readDirectory,
  locatePayload,
  extractEntry,
  streamEntry
} from './zip.js';
export type { ContainerLimits, ZipEntry, ZipDirectory } from './zip.js';
export { openGcode3mf, sniffGcode3mf, filamentColoursFromSettings } from './gcode-3mf.js';
export type { OpenedContainer, PlateEntry, ContainerMetadata, StreamLike } from './gcode-3mf.js';
