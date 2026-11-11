/**
 * DD-032 §4.3 — `ModelScene.source`: what the 3MF itself says about its bed. A Bambu/Orca slicer project
 * (either config entry present) sets `slicerProject`; `project_settings.config`'s `printable_area` becomes the
 * bed box when it is a valid polygon. A plain CAD 3MF and an STL never set it.
 */
import { describe, expect, it } from 'vitest';
import { parse3mf } from '../three-mf.js';
import { parseStl } from '../stl.js';
import { enc, makeZip, singleObjectModel } from './zip-fixture.js';

const MODEL = enc(singleObjectModel('100 100 0'));
const settings = (obj: unknown): Uint8Array => enc(JSON.stringify(obj));
const zip = (...extra: { name: string; data: Uint8Array }[]): Uint8Array =>
  makeZip([{ name: '3D/3dmodel.model', data: MODEL }, ...extra]);

describe('parse3mf → ModelScene.source', () => {
  it('a plain 3MF (CAD export) carries no source — the file said nothing', async () => {
    expect((await parse3mf(zip())).source).toBeUndefined();
  });

  it('project_settings.config marks a Bambu/Orca project and gives its bed box', async () => {
    const s = await parse3mf(
      zip({
        name: 'Metadata/project_settings.config',
        data: settings({ printable_area: ['0x0', '180x0', '180x180', '0x180'], filament_colour: ['#FF0000'] })
      })
    );
    expect(s.source).toEqual({ slicerProject: 'bambu-orca', printableArea: { min: [0, 0], max: [180, 180] } });
  });

  it('model_settings.config alone marks a project, with no declared bed', async () => {
    const s = await parse3mf(
      zip({ name: 'Metadata/model_settings.config', data: enc('<config><object id="10"/></config>') })
    );
    expect(s.source).toEqual({ slicerProject: 'bambu-orca' });
  });

  it('malformed project_settings JSON keeps slicerProject but drops printableArea', async () => {
    const s = await parse3mf(zip({ name: 'Metadata/project_settings.config', data: enc('{ not json') }));
    expect(s.source).toEqual({ slicerProject: 'bambu-orca' });
  });

  it.each([
    ['fewer than 3 points', ['0x0', '180x180']],
    ['garbage', 'banana'],
    ['a non-finite value', ['0x0', 'NaNx0', '180x180']],
    ['a zero-area polygon', ['0x0', '10x0', '20x0']]
  ])('an unusable printable_area (%s) falls back: no printableArea, still a project', async (_n, area) => {
    const s = await parse3mf(
      zip({ name: 'Metadata/project_settings.config', data: settings({ printable_area: area }) })
    );
    expect(s.source).toEqual({ slicerProject: 'bambu-orca' });
  });

  it('a consumer filamentPalette override still reads the declared bed', async () => {
    const s = await parse3mf(
      zip({
        name: 'Metadata/project_settings.config',
        data: settings({ printable_area: ['0x0', '256x0', '256x256', '0x256'] })
      }),
      { filamentPalette: ['#00ff00'] }
    );
    expect(s.source?.printableArea).toEqual({ min: [0, 0], max: [256, 256] });
  });

  it('an STL never carries a source', () => {
    const buf = new ArrayBuffer(84 + 50);
    new DataView(buf).setUint32(80, 1, true);
    expect(parseStl(new Uint8Array(buf)).source).toBeUndefined();
  });
});
