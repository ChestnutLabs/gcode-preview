/**
 * `.bgcode` container adapter (DD-011 phase 4c, #188) — plugs `.bgcode` into the existing parser
 * pipeline via the DD-005 §4.4 container-adapter contract (`{ id, sniff, open }`), beside `.gcode.3mf`.
 * The worker sniffs the input, calls `open`, and parses the single decoded plate; the metadata
 * (machine geometry + whitelisted settings) rides beside the IR.
 *
 * `.bgcode` is single-payload — one plate, no `openPlate` index beyond 0.
 */
import type { MachineGeometry, Point2 } from '@chestnutlabs/toolpath-core';
import { openBgcode, sniffBgcode, type BgcodeThumbnail } from './bgcode.js';

/** Minimal readable-stream mirror the parser worker consumes (same shape as gcode-containers). */
export interface BgcodeStreamLike {
  getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; releaseLock?(): void };
}

export interface OpenedBgcode {
  id: 'bgcode';
  plates: { index: number; name: string; estimatedBytes: number }[];
  metadata: {
    machine?: MachineGeometry;
    raw: Record<string, string>;
    warnings: { code: string; message: string }[];
  };
  /** Thumbnails from the container (bgcode carries them as binary blocks, not G-code comments). */
  thumbnails: BgcodeThumbnail[];
  openPlate(index: number): BgcodeStreamLike;
}

/** Settings keys copied into `metadata.raw` — a whitelist (feeds dialect detection + provenance), never the whole 390-key config. */
const RAW_WHITELIST = [
  'Producer',
  'printer_model',
  'printer_settings_id',
  'print_settings_id',
  'bed_shape',
  'max_print_height',
  'printable_height',
  'nozzle_diameter',
  'filament_type',
  'filament_colour'
];

/** Parse a PrusaSlicer `bed_shape` ("0x0,360x0,360x360,0x360") into points. */
function parseBedShape(value: string): Point2[] | null {
  const parts = value.split(',');
  if (parts.length < 3 || parts.length > 64) return null;
  const points: Point2[] = [];
  for (const p of parts) {
    const m = /^\s*(-?\d+(?:\.\d+)?)x(-?\d+(?:\.\d+)?)\s*$/.exec(p);
    if (m === null) return null;
    points.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
  }
  return points;
}

/** Build a MachineGeometry from the decoded `.bgcode` settings (bed_shape + max_print_height + model). */
function machineFrom(settings: Record<string, string>): MachineGeometry | undefined {
  const points = settings.bed_shape ? parseBedShape(settings.bed_shape) : null;
  if (points === null) return undefined;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const min = { x: Math.min(...xs), y: Math.min(...ys) };
  const max = { x: Math.max(...xs), y: Math.max(...ys) };
  const rect =
    points.length === 4 && points.every((p) => (p.x === min.x || p.x === max.x) && (p.y === min.y || p.y === max.y));
  const h = parseFloat(settings.max_print_height ?? settings.printable_height ?? '');
  return {
    bed: rect ? { kind: 'rect', min, max } : { kind: 'polygon', points },
    origin: { x: 0, y: 0 },
    heightMm: Number.isFinite(h) ? h : undefined,
    printerName: settings.printer_model,
    confidence: 'inferred', // read from the slicer's embedded settings, not machine config
    source: { adapterId: 'bgcode', evidence: 'bgcode metadata (bed_shape)' }
  };
}

/** A one-shot stream over an in-memory buffer. */
function streamOf(bytes: Uint8Array): BgcodeStreamLike {
  return {
    getReader() {
      let done = false;
      return {
        read: () => Promise.resolve(done ? { done: true } : ((done = true), { done: false, value: bytes })),
        releaseLock() {}
      };
    }
  };
}

/**
 * Open a `.bgcode` buffer as a container: decode it to plain G-code (the single plate) and surface its
 * metadata + thumbnails. Errors are the structured `ContainerError`s from {@link openBgcode}.
 */
export async function openBgcodeContainer(bytes: Uint8Array): Promise<OpenedBgcode> {
  const { gcode, settings, thumbnails } = await openBgcode(bytes, { metadata: true });
  const raw: Record<string, string> = {};
  for (const key of RAW_WHITELIST) if (settings[key] !== undefined) raw[key] = settings[key];
  return {
    id: 'bgcode',
    plates: [{ index: 0, name: 'bgcode', estimatedBytes: gcode.length }],
    metadata: { machine: machineFrom(settings), raw, warnings: [] },
    thumbnails,
    openPlate(index: number): BgcodeStreamLike {
      if (index !== 0) throw new Error(`.bgcode has a single plate; requested ${index}`);
      return streamOf(gcode);
    }
  };
}

/** Re-export the sniff so a worker entry can register `{ id, sniff, open }` in one import. */
export { sniffBgcode };
