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
  ExpansionBudget,
  canonicalName,
  crc32,
  crc32Final,
  extractEntry,
  readDirectory,
  resolveContainerLimits,
  streamEntry,
  type ContainerLimits,
  type ZipEntry
} from './zip.js';
import { readPngSize } from './png.js';

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

/** One plate preview image read from the archive (always PNG; `width`/`height` come from its IHDR chunk). */
export interface PlateThumbnail {
  format: 'png';
  width: number;
  height: number;
  bytes: Uint8Array;
}

/** Result of {@link OpenedContainer.thumbnailsFor}: the images that survived, and why any were dropped. */
export interface PlateThumbnails {
  thumbnails: PlateThumbnail[];
  warnings: { code: string; message: string }[];
}

export interface OpenedContainer {
  id: 'gcode-3mf';
  plates: PlateEntry[];
  metadata: ContainerMetadata;
  openPlate(index: number): StreamLike;
  /**
   * The slicer's preview images for one plate (#483): `Metadata/plate_N.png`, then
   * `Metadata/plate_N_small.png`, where either exists. `top_N.png` and `pick_N.png` are NOT included
   * (`pick_` is an object-id colour map, `top_` is not the plate preview).
   *
   * `plate` is the **index into {@link OpenedContainer.plates}** — the same value as the parse `{plate}`
   * option and `metadata.plates.parsed` — NOT the number `N` in the file name. A file with plates 1 and 3
   * has indices 0 and 1, and index 1 reads `plate_3.png`. An index outside `plates` returns no images.
   *
   * Call this AFTER the plate's G-code has been streamed: the images then draw on whatever is left of the
   * archive-wide expanded-bytes budget, so they can never make the G-code read fail. An image that is
   * too large, over budget, corrupt, or not a PNG is dropped with a warning; this method never throws.
   * Every call returns freshly allocated bytes (safe to transfer).
   */
  thumbnailsFor(plate: number): Promise<PlateThumbnails>;
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
  // The ZIP local-file magic alone decides; `name` is kept only for the public signature (any archive
  // whose bytes start with the magic sniffs as a container). A prefix shorter than the magic fails too:
  // its missing bytes read as undefined, which never equals a magic byte.
  void name;
  return ZIP_MAGIC.every((b, i) => prefix[i] === b);
}

/** Warning code for a settings value that is present but unusable (dropped, never thrown). */
const METADATA_INVALID = 'container-metadata-invalid';

type Warn = (message: string) => void;

/**
 * Bambu/Orca `printable_area`: ["0x0","256x0","256x256","0x256"] or "0x0,256x0,...". Null when the
 * value is not 3..64 well-formed points with finite coordinates (a digit run past ~309 digits parses
 * to Infinity: an unreadable point, same as a malformed one).
 */
function parsePrintableArea(value: unknown): Point2[] | null {
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (parts === null || parts.length < 3 || parts.length > 64) return null;
  const points: Point2[] = [];
  for (const p of parts) {
    if (typeof p !== 'string') return null;
    const m = /^\s*(-?\d+(?:\.\d+)?)x(-?\d+(?:\.\d+)?)\s*$/.exec(p);
    if (m === null) return null;
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push({ x, y });
  }
  return points;
}

/**
 * `printable_height` in mm when it is a finite number above zero (Bambu/Orca write it as a string,
 * e.g. "250"). Absent → undefined silently; present but unusable → undefined and a warning.
 */
function heightFromSettings(value: unknown, warn: Warn): number | undefined {
  if (value === undefined) return undefined;
  // Only a string or a number can hold a height; Number('') and Number('  ') are 0 and fail the > 0 test.
  const height = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (Number.isFinite(height) && height > 0) return height;
  warn(`printable_height ${JSON.stringify(String(value)).slice(0, 80)} is not a positive number; ignored`);
  return undefined;
}

function machineFromSettings(settings: Record<string, unknown>, warn: Warn): MachineGeometry | undefined {
  const area = settings['printable_area'];
  if (area === undefined) return undefined;
  const points = parsePrintableArea(area);
  if (points === null) {
    warn('printable_area is not 3 to 64 finite "XxY" points; no machine geometry');
    return undefined;
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const min = { x: Math.min(...xs), y: Math.min(...ys) };
  const max = { x: Math.max(...xs), y: Math.max(...ys) };
  const axisAlignedRect =
    points.length === 4 && points.every((p) => (p.x === min.x || p.x === max.x) && (p.y === min.y || p.y === max.y));
  const printerName =
    typeof settings['printer_model'] === 'string'
      ? settings['printer_model']
      : typeof settings['printer_settings_id'] === 'string'
        ? settings['printer_settings_id']
        : undefined;
  return {
    bed: axisAlignedRect ? { kind: 'rect', min, max } : { kind: 'polygon', points },
    origin: { x: 0, y: 0 },
    heightMm: heightFromSettings(settings['printable_height'], warn),
    printerName,
    confidence: 'known', // read from the project's own machine config
    source: { adapterId: 'gcode-3mf', evidence: 'Metadata/project_settings.config printable_area' }
  };
}

/**
 * The slicer filament palette from a parsed `project_settings.config`: the `filament_colour` array,
 * one hex string per filament slot (0-based), `undefined` where a slot has no colour. This is the
 * single source of the "which key is the palette" semantics — shared so the model presentation
 * renderer (`@chestnutlabs/gcode-model-renderer`) reads the same palette for source-model painting
 * (Bambu/Orca `paint_color`) instead of duplicating it. Empty array when the key is absent/malformed.
 */
export function filamentColoursFromSettings(settings: Record<string, unknown>): (string | undefined)[] {
  const colours = settings['filament_colour'];
  if (!Array.isArray(colours)) return [];
  return colours.slice(0, 64).map((c) => (typeof c === 'string' ? c : undefined));
}

function filamentsFromSettings(settings: Record<string, unknown>): FilamentInfo[] | undefined {
  const types = settings['filament_type'];
  if (!Array.isArray(types)) return undefined;
  const colours = filamentColoursFromSettings(settings);
  return types.slice(0, 64).map((t, i) => ({
    slot: i,
    type: typeof t === 'string' ? t : undefined,
    color: colours[i]
  }));
}

export async function openGcode3mf(bytes: Uint8Array, requested?: ContainerLimits): Promise<OpenedContainer> {
  const limits = resolveContainerLimits(requested);
  // One budget per opened archive: metadata + every plate stream share maxExpandedBytesTotal (#449).
  const budget = new ExpansionBudget(limits.maxExpandedBytesTotal);
  const dir = readDirectory(bytes, limits);
  const warnings = [...dir.warnings];

  // `number` is the N of plate_N, taken from the CANONICAL name: the raw name may use `\` or `//`
  // separators, which canonicalName normalises but PLATE_RE (anchored on `metadata/`) would not match.
  const plates: (PlateEntry & { entry: ZipEntry; number: string })[] = [];
  for (const entry of dir.entries) {
    const m = PLATE_RE.exec(entry.name);
    if (m !== null) {
      plates.push({
        index: plates.length,
        name: entry.rawName,
        estimatedBytes: entry.uncompressedSize,
        entry,
        number: m[1]
      });
    }
  }
  plates.sort((a, b) => parseInt(a.number) - parseInt(b.number));
  plates.forEach((p, i) => (p.index = i));
  // The plate NUMBER N from each name (plates are sorted by it; indices are positions in that order).
  const plateNumbers = plates.map((p) => p.number);
  if (plates.length === 0) {
    // Distinguish the common user mistake: a MODEL/PROJECT 3MF (meshes, no
    // sliced G-code) vs a genuinely empty/unrecognized archive. Slicing is a
    // slicer's job — tell the user what to export instead.
    const isModelProject = dir.entries.some((e) => e.name === '3d/3dmodel.model');
    throw new ContainerError(
      'E_CONTAINER_NO_PAYLOAD',
      isModelProject
        ? 'this is a model/project 3MF (3D meshes, no sliced G-code). The viewer displays sliced output — ' +
          'in Bambu Studio/OrcaSlicer, slice the plate and use "Export plate sliced file" (.gcode.3mf)'
        : 'no Metadata/plate_*.gcode entries found'
    );
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
        const text = new TextDecoder().decode(
          await extractEntry(bytes, settingsEntry, limits.maxMetadataBytes, budget)
        );
        const parsed: unknown = JSON.parse(text);
        // Valid JSON that is not an object (null, an array, a number) holds no settings.
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not a JSON object');
        }
        const settings = parsed as Record<string, unknown>;
        machine = machineFromSettings(settings, (message) => warnings.push({ code: METADATA_INVALID, message }));
        filaments = filamentsFromSettings(settings);
        for (const key of RAW_WHITELIST) {
          const v = settings[key];
          if (typeof v === 'string' || typeof v === 'number') raw[key] = String(v).slice(0, 4096);
          else if (Array.isArray(v)) raw[key] = v.slice(0, 64).join(',').slice(0, 4096);
        }
      } catch (err) {
        warnings.push({
          code: METADATA_INVALID,
          message: `project_settings.config unreadable: ${err instanceof Error ? err.message : err}`
        });
      }
    }
  }

  return {
    id: 'gcode-3mf',
    plates: plates.map(({ index, name, estimatedBytes }) => ({ index, name, estimatedBytes })),
    metadata: { machine, filaments, raw, warnings },
    async thumbnailsFor(index: number): Promise<PlateThumbnails> {
      const out: PlateThumbnails = { thumbnails: [], warnings: [] };
      const number = plateNumbers[index];
      if (number === undefined) return out;
      for (const name of [`metadata/plate_${number}.png`, `metadata/plate_${number}_small.png`]) {
        const entry = dir.entries.find((e) => e.name === name);
        if (entry === undefined) continue;
        if (entry.uncompressedSize > limits.maxMetadataBytes) {
          out.warnings.push({
            code: 'metadata-truncated',
            message: `${entry.rawName} exceeds maxMetadataBytes; skipped`
          });
          continue;
        }
        let image: Uint8Array;
        try {
          image = await extractEntry(bytes, entry, limits.maxMetadataBytes, budget);
        } catch (err) {
          out.warnings.push({
            // An exhausted archive-wide budget says nothing about the image itself: report it like the
            // per-image cap (skipped for size), not as a corrupt image.
            code:
              err instanceof ContainerError && err.code === 'E_CONTAINER_LIMIT_TOTAL'
                ? 'metadata-truncated'
                : 'container-thumbnail-invalid',
            message: `${entry.rawName} unreadable: ${err instanceof Error ? err.message : err}`
          });
          continue;
        }
        const size = readPngSize(image);
        if (size === null) {
          out.warnings.push({
            code: 'container-thumbnail-invalid',
            message: `${entry.rawName} is not a PNG with a valid header; skipped`
          });
          continue;
        }
        out.thumbnails.push({ format: 'png', width: size.width, height: size.height, bytes: image });
      }
      return out;
    },
    openPlate(index: number): StreamLike {
      const plate = plates[index];
      if (plate === undefined) {
        throw new ContainerError('E_CONTAINER_NO_PAYLOAD', `plate ${index} does not exist (${plates.length} plates)`);
      }
      // Stream with incremental caps; verify CRC + size at end-of-stream.
      const gen = streamEntry(bytes, plate.entry, limits.maxExpandedBytesPerEntry, budget);
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
