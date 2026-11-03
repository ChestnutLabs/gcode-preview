/**
 * #449: parse3mf charges every entry it extracts (rels, main part, settings, model_settings, external
 * parts) to ONE archive-wide `maxExpandedBytesTotal` budget, and maps the trip to
 * `E_MODEL_TOO_LARGE`. The real total is a fixed 1 GiB, so the container default is mocked to a small
 * value here; everything else in gcode-containers is the real code.
 */
import { describe, expect, it, vi } from 'vitest';
import { parse3mf } from '../three-mf.js';
import { ModelParseError } from '../limits.js';
import { buildZip, type BuildEntry } from '../../../gcode-containers/src/__tests__/zip-builder';

const h = vi.hoisted(() => ({ total: 1024 * 1024 * 1024 }));
vi.mock('@chestnutlabs/gcode-containers', async (importOriginal) => {
  const real = await importOriginal<typeof import('@chestnutlabs/gcode-containers')>();
  const limits = { ...real.DEFAULT_CONTAINER_LIMITS };
  Object.defineProperty(limits, 'maxExpandedBytesTotal', { get: () => h.total });
  return { ...real, DEFAULT_CONTAINER_LIMITS: limits };
});

const SHELL = `<?xml version="1.0"?>
<model unit="millimeter" requiredextensions="p" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
 <resources><object id="2" type="model"><components>
  <component p:path="/3D/Objects/object_1.model" objectid="1"/>
 </components></object></resources>
 <build><item objectid="2"/></build>
</model>`;
const EXTERNAL = `<?xml version="1.0"?>
<model unit="millimeter"><resources>
 <object id="1"><mesh>
  <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices>
  <triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
</resources></model>`;
const SETTINGS = JSON.stringify({ filament_colour: ['#FF0000'] });
const MODEL_SETTINGS = '<config><object id="2"><metadata key="extruder" value="1"/></object></config>';
const RELS = '<Relationships><Relationship Target="/3D/main.model" Type="x"/></Relationships>';

const ENTRIES: BuildEntry[] = [
  { name: '3D/3dmodel.model', data: SHELL },
  { name: '3D/Objects/object_1.model', data: EXTERNAL },
  { name: 'Metadata/project_settings.config', data: SETTINGS },
  { name: 'Metadata/model_settings.config', data: MODEL_SETTINGS }
];
const SUM = SHELL.length + EXTERNAL.length + SETTINGS.length + MODEL_SETTINGS.length;

async function modelErr(p: Promise<unknown>): Promise<ModelParseError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ModelParseError);
    return e as ModelParseError;
  }
  throw new Error('expected a ModelParseError, nothing was thrown');
}

describe('parse3mf expanded-total budget (#449)', () => {
  it('main + settings + model_settings + external part share one budget: at the total passes', async () => {
    h.total = SUM;
    const scene = await parse3mf(buildZip(ENTRIES).bytes);
    expect(scene.objects).toHaveLength(1);
  });

  it('one byte under the sum → E_MODEL_TOO_LARGE on the last part extracted', async () => {
    h.total = SUM - 1;
    const e = await modelErr(parse3mf(buildZip(ENTRIES).bytes));
    expect(e.code).toBe('E_MODEL_TOO_LARGE');
    expect(e.message).toBe(
      `3MF expands past ${SUM - 1} bytes: entry '3d/objects/object_1.model' claims ${EXTERNAL.length} B, ` +
        `past the archive's ${SUM - 1} B expanded total`
    );
  });

  it('a rels part over the total → E_MODEL_TOO_LARGE (no raw ContainerError)', async () => {
    h.total = RELS.length - 1;
    const bytes = buildZip([
      { name: '_rels/.rels', data: RELS },
      { name: '3D/main.model', data: SHELL }
    ]).bytes;
    const e = await modelErr(parse3mf(bytes));
    expect(e.code).toBe('E_MODEL_TOO_LARGE');
    expect(e.message).toBe(
      `3MF expands past ${RELS.length - 1} bytes: entry '_rels/.rels' claims ${RELS.length} B, ` +
        `past the archive's ${RELS.length - 1} B expanded total`
    );
  });

  it('a corrupt rels part → E_MODEL_PARSE (no raw ContainerError)', async () => {
    h.total = 1024 * 1024 * 1024;
    const bytes = buildZip([
      { name: '_rels/.rels', data: RELS, local: { crc: 1 }, central: { crc: 1 } },
      { name: '3D/main.model', data: SHELL }
    ]).bytes;
    const e = await modelErr(parse3mf(bytes));
    expect(e.code).toBe('E_MODEL_PARSE');
    expect(e.message).toBe("3MF unzip failed: CRC mismatch for '_rels/.rels'");
  });

  it('a corrupt external part → E_MODEL_PARSE (no raw ContainerError)', async () => {
    h.total = 1024 * 1024 * 1024;
    const bytes = buildZip([ENTRIES[0], { ...ENTRIES[1], local: { crc: 1 }, central: { crc: 1 } }]).bytes;
    const e = await modelErr(parse3mf(bytes));
    expect(e.code).toBe('E_MODEL_PARSE');
    expect(e.message).toBe("3MF unzip failed: CRC mismatch for '3d/objects/object_1.model'");
  });
});
