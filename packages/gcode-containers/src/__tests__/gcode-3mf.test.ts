/**
 * .gcode.3mf extraction + adversarial corpus tests (DD-005 §4.4/§7, issue #74).
 * Every §4.4 integrity requirement (amendment 3) has a structured-outcome test.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ContainerError,
  DEFAULT_CONTAINER_LIMITS,
  filamentColoursFromSettings,
  openGcode3mf,
  readDirectory,
  sniffGcode3mf
} from '../index';

describe('filamentColoursFromSettings', () => {
  it('returns the filament_colour palette by slot, undefined where absent, [] when missing', () => {
    expect(filamentColoursFromSettings({ filament_colour: ['#8080FF', '#000000'] })).toEqual(['#8080FF', '#000000']);
    expect(filamentColoursFromSettings({ filament_colour: ['#FFF', 42] })).toEqual(['#FFF', undefined]);
    expect(filamentColoursFromSettings({})).toEqual([]);
    expect(filamentColoursFromSettings({ filament_colour: 'nope' })).toEqual([]);
  });
});

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../test-data/fixtures/containers'
);
const load = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(fixtureDir, name)));

async function drain(stream: {
  getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> };
}): Promise<string> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) parts.push(value);
  }
  return parts.map((p) => new TextDecoder().decode(p)).join('');
}

const expectCode = async (fn: () => Promise<unknown>, code: string): Promise<void> => {
  let err: unknown;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ContainerError);
  expect((err as ContainerError).code).toBe(code);
};

describe('.gcode.3mf container (#74)', () => {
  it('sniffs ZIP magic', () => {
    expect(sniffGcode3mf(load('mini-project.gcode.3mf').subarray(0, 8))).toBe(true);
    expect(sniffGcode3mf(new TextEncoder().encode('G0 X0 Y0'))).toBe(false);
  });

  it('discovery: ordered plates, machine geometry (known), filaments, whitelisted raw', async () => {
    const opened = await openGcode3mf(load('mini-project.gcode.3mf'));
    expect(opened.plates.map((p) => p.name)).toEqual(['Metadata/plate_1.gcode', 'Metadata/plate_2.gcode']);
    const m = opened.metadata.machine;
    expect(m?.bed).toEqual({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 256, y: 256 } });
    expect(m?.heightMm).toBe(256);
    expect(m?.printerName).toBe('Chestnut Test Printer X1');
    expect(m?.confidence).toBe('known');
    expect(m?.source.adapterId).toBe('gcode-3mf');
    expect(opened.metadata.filaments?.length).toBe(2);
    expect(opened.metadata.filaments?.[0]).toEqual({ slot: 0, type: 'PLA', color: '#22AA55' });
    expect(opened.metadata.raw['printer_model']).toBe('Chestnut Test Printer X1');
    expect(opened.metadata.raw['printable_area']).toBeUndefined(); // whitelist only
  });

  it('openPlate streams the selected plate payload (CRC verified at end)', async () => {
    const opened = await openGcode3mf(load('mini-project.gcode.3mf'));
    const text1 = await drain(opened.openPlate(0));
    const text2 = await drain(opened.openPlate(1));
    expect(text1).toContain('; generated fixture plate 1');
    expect(text2).toContain('; generated fixture plate 2');
    expect(text1.split('\n').length).toBe(405); // header + FEATURE markers + 400 moves
    expect(() => opened.openPlate(9)).toThrow(ContainerError);
  });

  it('CRC mismatch → E_CONTAINER_CRC (amendment 3)', async () => {
    const opened = await openGcode3mf(load('adv-bad-crc.gcode.3mf'));
    await expectCode(() => drain(opened.openPlate(0)), 'E_CONTAINER_CRC');
  });

  it('encrypted entry → E_CONTAINER_ENCRYPTED (amendment 3)', async () => {
    const opened = await openGcode3mf(load('adv-encrypted.gcode.3mf'));
    await expectCode(() => drain(opened.openPlate(0)), 'E_CONTAINER_ENCRYPTED');
  });

  it('central/local header disagreement → E_CONTAINER_HEADER_MISMATCH (amendment 3)', async () => {
    const opened = await openGcode3mf(load('adv-header-mismatch.gcode.3mf'));
    await expectCode(() => drain(opened.openPlate(0)), 'E_CONTAINER_HEADER_MISMATCH');
  });

  it('duplicate canonical PAYLOAD name → E_CONTAINER_DUPLICATE at open (amendment 3)', async () => {
    await expectCode(() => openGcode3mf(load('adv-duplicate-plate.gcode.3mf')), 'E_CONTAINER_DUPLICATE');
  });

  it('hostile names are rejected with warnings; sane plates still open', async () => {
    const opened = await openGcode3mf(load('adv-traversal-names.gcode.3mf'));
    expect(opened.plates.length).toBe(1);
    const hostile = opened.metadata.warnings.filter((w) => w.code === 'container-entry-hostile-name');
    expect(hostile.length).toBe(2);
    expect(await drain(opened.openPlate(0))).toContain('; generated fixture plate 1');
  });

  it('model/project 3MF (no sliced plates) → explanatory E_CONTAINER_NO_PAYLOAD', async () => {
    let err: unknown;
    try {
      await openGcode3mf(load('model-project.3mf'));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ContainerError);
    expect((err as ContainerError).code).toBe('E_CONTAINER_NO_PAYLOAD');
    expect((err as ContainerError).message).toContain('model/project 3MF');
    expect((err as ContainerError).message).toContain('Export plate sliced file');
  });

  it('truncated archive → structured format error', async () => {
    await expectCode(() => openGcode3mf(load('adv-truncated.gcode.3mf')), 'E_CONTAINER_FORMAT');
  });

  it('lying size headers are caught at end-of-stream (amendment 3)', async () => {
    const opened = await openGcode3mf(load('adv-size-lie.gcode.3mf'));
    await expectCode(() => drain(opened.openPlate(0)), 'E_CONTAINER_HEADER_MISMATCH');
  });

  it('limits enforced: maxEntries and per-entry expanded cap (§7.2)', async () => {
    const bytes = load('mini-project.gcode.3mf');
    expect(() => readDirectory(bytes, { ...DEFAULT_CONTAINER_LIMITS, maxEntries: 1 })).toThrow(ContainerError);
    const opened = await openGcode3mf(bytes, { ...DEFAULT_CONTAINER_LIMITS, maxExpandedBytesPerEntry: 100 });
    await expectCode(() => drain(opened.openPlate(0)), 'E_CONTAINER_LIMIT_EXPANDED');
  });
});
