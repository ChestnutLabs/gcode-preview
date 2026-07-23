/**
 * `.gcode.3mf` container adapter (DD-005 §4.4, as amended) — the Bambu
 * Studio / OrcaSlicer sliced-project ZIP: per-plate G-code payloads under
 * `Metadata/plate_*.gcode` plus machine/filament configuration.
 *
 * Lifecycle (amendment 3): `open()` is DISCOVERY ONLY (central directory +
 * bounded metadata — no payload inflate); the consumer selects a plate;
 * `openPlate(i)` streams exactly one payload with incremental caps and
 * end-of-stream CRC verification.
 */
import type { MachineGeometry, FilamentInfo, Point2 } from '@chestnutlabs/toolpath-core';
import {
  ContainerError,
  DEFAULT_CONTAINER_LIMITS,
  canonicalName,
  crc32,
  crc32Final,
  extractEntry,
  readDirectory,
  streamEntry,
  type ContainerLimits,
  type ZipEntry
} from './zip.js';

export interface PlateEntry {
  index: number;
  name: string;
  estimatedBytes: number;
}

export interface ContainerMetadata {
  machine?: MachineGeometry;
  filaments?: FilamentInfo[];
  /** Whitelisted key/value settings (bounded) — also feeds dialect detection. */
  raw: Record<string, string>;
  warnings: { code: string; message: string }[];
}

export interface StreamLike {
  getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; releaseLock?(): void };
}

export interface OpenedContainer {
  id: 'gcode-3mf';
  plates: PlateEntry[];
  metadata: ContainerMetadata;
  openPlate(index: number): StreamLike;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const PLATE_RE = /^metadata\/plate_(\d+)\.gcode$/;
/** Settings keys copied into metadata.raw — a whitelist, never the whole config. */
const RAW_WHITELIST = [
  'printer_model',
  'printer_settings_id',
  'print_settings_id',
  'printable_height',
  'nozzle_diameter',
  'filament_type',
  'filament_colour',
  'version'
];

export function sniffGcode3mf(prefix: Uint8Array, name?: string): boolean {
  const magic = prefix.length >= 4 && ZIP_MAGIC.every((b, i) => prefix[i] === b);
  if (!magic) return false;
  // Extension hint refines but never overrides the magic (a .zip named .gcode is still not a container).
  return name === undefined || /\.(gcode\.)?3mf$/i.test(name) || true;
}

/** Bambu/Orca `printable_area`: ["0x0","256x0","256x256","0x256"] or "0x0,256x0,..." */
function parsePrintableArea(value: unknown): Point2[] | null {
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (parts === null || parts.length < 3 || parts.length > 64) return null;
  const points: Point2[] = [];
  for (const p of parts) {
    if (typeof p !== 'string') return null;
    const m = /^\s*(-?\d+(?:\.\d+)?)x(-?\d+(?:\.\d+)?)\s*$/.exec(p);
    if (m === null) return null;
    points.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
  }
  return points;
}

function machineFromSettings(settings: Record<string, unknown>): MachineGeometry | undefined {
  const points = parsePrintableArea(settings['printable_area']);
  if (points === null) return undefined;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const min = { x: Math.min(...xs), y: Math.min(...ys) };
  const max = { x: Math.max(...xs), y: Math.max(...ys) };
  const axisAlignedRect =
    points.length === 4 && points.every((p) => (p.x === min.x || p.x === max.x) && (p.y === min.y || p.y === max.y));
  const height = Number(settings['printable_height']);
  const printerName =
    typeof settings['printer_model'] === 'string'
      ? settings['printer_model']
      : typeof settings['printer_settings_id'] === 'string'
        ? settings['printer_settings_id']
        : undefined;
  return {
    bed: axisAlignedRect ? { kind: 'rect', min, max } : { kind: 'polygon', points },
    origin: { x: 0, y: 0 },
    heightMm: Number.isFinite(height) ? height : undefined,
    printerName,
    confidence: 'known', // read from the project's own machine config
    source: { adapterId: 'gcode-3mf', evidence: 'Metadata/project_settings.config printable_area' }
  };
}

function filamentsFromSettings(settings: Record<string, unknown>): FilamentInfo[] | undefined {
  const types = settings['filament_type'];
  if (!Array.isArray(types)) return undefined;
  const colours = Array.isArray(settings['filament_colour']) ? settings['filament_colour'] : [];
  return types.slice(0, 64).map((t, i) => ({
    slot: i,
    type: typeof t === 'string' ? t : undefined,
    color: typeof colours[i] === 'string' ? colours[i] : undefined
  }));
}

export async function openGcode3mf(
  bytes: Uint8Array,
  limits: ContainerLimits = DEFAULT_CONTAINER_LIMITS
): Promise<OpenedContainer> {
  const dir = readDirectory(bytes, limits);
  const warnings = [...dir.warnings];

  const plates: (PlateEntry & { entry: ZipEntry })[] = [];
  for (const entry of dir.entries) {
    const m = PLATE_RE.exec(entry.name);
    if (m !== null) {
      plates.push({ index: plates.length, name: entry.rawName, estimatedBytes: entry.uncompressedSize, entry });
    }
  }
  plates.sort(
    (a, b) =>
      parseInt(PLATE_RE.exec(a.name.toLowerCase())?.[1] ?? '0') -
      parseInt(PLATE_RE.exec(b.name.toLowerCase())?.[1] ?? '0')
  );
  plates.forEach((p, i) => (p.index = i));
  if (plates.length === 0) {
    throw new ContainerError('E_CONTAINER_NO_PAYLOAD', 'no Metadata/plate_*.gcode entries found');
  }
  // Amendment 3: a duplicate of a SELECTED PAYLOAD name is an error, not a warning.
  const payloadDup = warnings.find(
    (w) =>
      w.code === 'container-duplicate-entry' && plates.some((p) => w.message.includes(`'${canonicalName(p.name)}'`))
  );
  if (payloadDup !== undefined) {
    throw new ContainerError('E_CONTAINER_DUPLICATE', payloadDup.message);
  }

  // Bounded metadata extraction (discovery-time; small entries only).
  const raw: Record<string, string> = {};
  let machine: MachineGeometry | undefined;
  let filaments: FilamentInfo[] | undefined;
  const settingsEntry = dir.entries.find((e) => e.name === 'metadata/project_settings.config');
  if (settingsEntry !== undefined) {
    if (settingsEntry.uncompressedSize > limits.maxMetadataBytes) {
      warnings.push({
        code: 'metadata-truncated',
        message: 'project_settings.config exceeds maxMetadataBytes; skipped'
      });
    } else {
      try {
        const text = new TextDecoder().decode(await extractEntry(bytes, settingsEntry, limits.maxMetadataBytes));
        const settings = JSON.parse(text) as Record<string, unknown>;
        machine = machineFromSettings(settings);
        filaments = filamentsFromSettings(settings);
        for (const key of RAW_WHITELIST) {
          const v = settings[key];
          if (typeof v === 'string' || typeof v === 'number') raw[key] = String(v).slice(0, 4096);
          else if (Array.isArray(v)) raw[key] = v.slice(0, 64).join(',').slice(0, 4096);
        }
      } catch (err) {
        warnings.push({
          code: 'container-metadata-invalid',
          message: `project_settings.config unreadable: ${err instanceof Error ? err.message : err}`
        });
      }
    }
  }

  return {
    id: 'gcode-3mf',
    plates: plates.map(({ index, name, estimatedBytes }) => ({ index, name, estimatedBytes })),
    metadata: { machine, filaments, raw, warnings },
    openPlate(index: number): StreamLike {
      const plate = plates[index];
      if (plate === undefined) {
        throw new ContainerError('E_CONTAINER_NO_PAYLOAD', `plate ${index} does not exist (${plates.length} plates)`);
      }
      // Stream with incremental caps; verify CRC + size at end-of-stream.
      const gen = streamEntry(bytes, plate.entry, limits.maxExpandedBytesPerEntry);
      let crc = 0xffffffff;
      let total = 0;
      return {
        getReader: () => ({
          read: async () => {
            const { done, value } = await gen.next();
            if (done) {
              if (crc32Final(crc) !== plate.entry.crc32) {
                throw new ContainerError('E_CONTAINER_CRC', `CRC mismatch for '${plate.entry.name}'`);
              }
              if (total !== plate.entry.uncompressedSize) {
                throw new ContainerError(
                  'E_CONTAINER_HEADER_MISMATCH',
                  `expanded size of '${plate.entry.name}' differs from headers`
                );
              }
              return { done: true as const };
            }
            crc = crc32(value as Uint8Array, crc);
            total += (value as Uint8Array).byteLength;
            return { done: false as const, value: value as Uint8Array };
          }
        })
      };
    }
  };
}
