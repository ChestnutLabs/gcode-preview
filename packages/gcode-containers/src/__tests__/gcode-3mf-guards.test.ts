/**
 * Packet 2 sweep (G1): the .gcode.3mf adapter's own guards: the printable_area part-count bound,
 * the filament_type shape check, the metadata size limit, metadata integrity failures surfacing
 * through extractEntry, the plate index bound, and the sniff contract.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContainerError, DEFAULT_CONTAINER_LIMITS, openGcode3mf, sniffGcode3mf } from '../index';
import { buildZip, refCrc32, type BuildEntry } from './zip-builder';

const enc = new TextEncoder();
const PLATE: BuildEntry = { name: 'Metadata/plate_1.gcode', data: 'G1 X1 Y1\n', deflate: true };
const SETTINGS_NAME = 'Metadata/project_settings.config';

const project = (settings: unknown, over: Partial<BuildEntry> = {}): Uint8Array =>
  buildZip([PLATE, { name: SETTINGS_NAME, data: JSON.stringify(settings), deflate: true, ...over }]).bytes;

const AREA_INVALID = {
  code: 'container-metadata-invalid',
  message: 'printable_area is not 3 to 64 finite "XxY" points; no machine geometry'
};

const pts = (n: number): string[] => Array.from({ length: n }, (_, i) => `${i}x${i * 2}`);

describe('printable_area part-count bound', () => {
  it.each([
    ['2 parts (array)', pts(2), undefined],
    ['3 parts (array)', pts(3), 3],
    ['64 parts (array)', pts(64), 64],
    ['65 parts (array)', pts(65), undefined],
    ['2 parts (string)', '0x0,10x0', undefined],
    ['3 parts (string)', '0x0,10x0,0x10', 3]
  ])('%s → %s polygon points', async (_label, area, expected) => {
    const opened = await openGcode3mf(project({ printable_area: area }));
    const bed = opened.metadata.machine?.bed;
    if (expected === undefined) {
      expect(opened.metadata.machine).toBeUndefined();
      expect(opened.metadata.warnings).toEqual([AREA_INVALID]);
    } else {
      expect(opened.metadata.warnings).toEqual([]);
      expect(bed?.kind).toBe('polygon');
      expect(bed?.kind === 'polygon' ? bed.points.length : -1).toBe(expected);
    }
  });

  it('a 4-part axis-aligned string area is a rect', async () => {
    const opened = await openGcode3mf(project({ printable_area: '0x0,10x0,10x20,0x20' }));
    expect(opened.metadata.machine?.bed).toEqual({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 10, y: 20 } });
  });

  it.each([
    ['a non-string part', [0, '10x0', '0x10']],
    // String(['0x0']) === '0x0' would match the regex: only the typeof check rejects it.
    ['a nested-array part', [['0x0'], '10x0', '0x10']],
    ['a malformed part', ['0x0', '10by0', '0x10']],
    ['a number', 5]
  ])('%s → no machine, container-metadata-invalid warning', async (_label, area) => {
    const opened = await openGcode3mf(project({ printable_area: area }));
    expect(opened.metadata.machine).toBeUndefined();
    expect(opened.metadata.warnings).toEqual([AREA_INVALID]);
  });

  it('missing → no machine, no warning', async () => {
    const opened = await openGcode3mf(project({ printer_model: 'M' }));
    expect(opened.metadata.machine).toBeUndefined();
    expect(opened.metadata.warnings).toEqual([]);
  });
});

describe('filament_type shape', () => {
  it('a non-array filament_type → no filaments, no warning; the string still reaches raw', async () => {
    const opened = await openGcode3mf(project({ filament_type: 'PLA' }));
    expect(opened.metadata.filaments).toBeUndefined();
    expect(opened.metadata.warnings).toEqual([]);
    expect(opened.metadata.raw['filament_type']).toBe('PLA');
  });

  it('an array filament_type → one filament per slot', async () => {
    const opened = await openGcode3mf(project({ filament_type: ['PLA', 7] }));
    expect(opened.metadata.filaments).toEqual([
      { slot: 0, type: 'PLA', color: undefined },
      { slot: 1, type: undefined, color: undefined }
    ]);
  });
});

describe('metadata bounds and integrity (through extractEntry)', () => {
  const settings = JSON.stringify({ printer_model: 'M' });

  it('maxMetadataBytes: at the limit parses, one under → metadata-truncated warning', async () => {
    const bytes = project({ printer_model: 'M' });
    const atLimit = await openGcode3mf(bytes, { ...DEFAULT_CONTAINER_LIMITS, maxMetadataBytes: settings.length });
    expect(atLimit.metadata.raw['printer_model']).toBe('M');
    expect(atLimit.metadata.warnings).toEqual([]);
    const over = await openGcode3mf(bytes, { ...DEFAULT_CONTAINER_LIMITS, maxMetadataBytes: settings.length - 1 });
    expect(over.metadata.raw).toEqual({});
    expect(over.metadata.warnings).toEqual([
      { code: 'metadata-truncated', message: 'project_settings.config exceeds maxMetadataBytes; skipped' }
    ]);
  });

  it('settings entry with a wrong CRC → container-metadata-invalid (CRC mismatch), plates still open', async () => {
    const bad = { crc: (refCrc32(enc.encode(settings)) ^ 0x10) >>> 0 };
    const opened = await openGcode3mf(project({ printer_model: 'M' }, { local: bad, central: bad }));
    expect(opened.metadata.raw).toEqual({});
    expect(opened.metadata.warnings).toEqual([
      {
        code: 'container-metadata-invalid',
        message: "project_settings.config unreadable: CRC mismatch for 'metadata/project_settings.config'"
      }
    ]);
    expect(opened.plates.length).toBe(1);
  });

  it.each([
    ['smaller', settings.length - 1],
    ['larger', settings.length + 1]
  ])('settings entry with a %s claimed size → container-metadata-invalid (size)', async (_label, claim) => {
    const lie = { uncompressedSize: claim };
    const opened = await openGcode3mf(project({ printer_model: 'M' }, { local: lie, central: lie }));
    expect(opened.metadata.raw).toEqual({});
    expect(opened.metadata.warnings).toEqual([
      {
        code: 'container-metadata-invalid',
        message:
          "project_settings.config unreadable: expanded size of 'metadata/project_settings.config' differs from headers"
      }
    ]);
  });
});

describe('plate selection bound', () => {
  it('a missing plate index → E_CONTAINER_NO_PAYLOAD with the plate count', async () => {
    const opened = await openGcode3mf(buildZip([PLATE]).bytes);
    for (const index of [1, -1]) {
      let err: unknown;
      try {
        opened.openPlate(index);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ContainerError);
      expect((err as ContainerError).code).toBe('E_CONTAINER_NO_PAYLOAD');
      expect((err as ContainerError).message).toBe(`plate ${index} does not exist (1 plates)`);
    }
  });
});

describe('sniffGcode3mf: the ZIP magic alone decides', () => {
  const magic = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  it.each([
    [magic, undefined, true],
    [magic, 'project.gcode.3mf', true],
    [magic, 'archive.zip', true],
    [magic, 'model.gcode', true],
    [enc.encode('G1 X0 Y0'), 'project.gcode.3mf', false],
    [magic.subarray(0, 3), 'project.gcode.3mf', false],
    [Uint8Array.from([0x50, 0x4b, 0x03, 0x05]), undefined, false]
  ])('%#: name %j → %j', (prefix, name, expected) => {
    expect(sniffGcode3mf(prefix, name)).toBe(expected);
  });
});

describe('committed adversarial corpus (test-data/fixtures/containers/adversarial)', () => {
  const dir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../test-data/fixtures/containers/adversarial'
  );
  const load = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(dir, name)));
  const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ContainerError);
      return (e as ContainerError).code;
    }
    return 'no error';
  };
  const drainPlate = async (bytes: Uint8Array): Promise<void> => {
    const reader = (await openGcode3mf(bytes)).openPlate(0).getReader();
    while (!(await reader.read()).done);
  };

  it('adv-metadata-bad-crc: CRC warning, plate opens', async () => {
    const opened = await openGcode3mf(load('adv-metadata-bad-crc.gcode.3mf'));
    expect(opened.metadata.warnings).toEqual([
      {
        code: 'container-metadata-invalid',
        message: "project_settings.config unreadable: CRC mismatch for 'metadata/project_settings.config'"
      }
    ]);
    await drainPlate(load('adv-metadata-bad-crc.gcode.3mf'));
  });

  it('adv-metadata-size-lie: size warning', async () => {
    const opened = await openGcode3mf(load('adv-metadata-size-lie.gcode.3mf'));
    expect(opened.metadata.warnings.map((w) => w.message)).toEqual([
      "project_settings.config unreadable: expanded size of 'metadata/project_settings.config' differs from headers"
    ]);
  });

  it('adv-zip64-eocd → E_CONTAINER_ZIP64', async () => {
    expect(await codeOf(() => openGcode3mf(load('adv-zip64-eocd.gcode.3mf')))).toBe('E_CONTAINER_ZIP64');
  });

  it('adv-cd-past-eof → E_CONTAINER_FORMAT', async () => {
    expect(await codeOf(() => openGcode3mf(load('adv-cd-past-eof.gcode.3mf')))).toBe('E_CONTAINER_FORMAT');
  });

  it('adv-nul-name: hostile entry dropped, plate opens', async () => {
    const opened = await openGcode3mf(load('adv-nul-name.gcode.3mf'));
    expect(opened.plates.map((p) => p.name)).toEqual(['Metadata/plate_1.gcode']);
    expect(opened.metadata.warnings).toEqual([
      { code: 'container-entry-hostile-name', message: 'entry name rejected: "Metadata/plate_\\u0000.gcode"' }
    ]);
    await drainPlate(load('adv-nul-name.gcode.3mf'));
  });

  it('adv-method-12 → E_CONTAINER_METHOD when streamed', async () => {
    expect(await codeOf(() => drainPlate(load('adv-method-12.gcode.3mf')))).toBe('E_CONTAINER_METHOD');
  });
});
