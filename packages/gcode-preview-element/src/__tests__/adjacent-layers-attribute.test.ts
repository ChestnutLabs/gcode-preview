// @vitest-environment happy-dom
/**
 * #554 review: `adjacent-layers` is markup, so a non-numeric value is ignored (the default of one ghost
 * layer) instead of throwing a RangeError out of connectedCallback, which left the element unbound and
 * the source unparsed. The 2D view of the suite IR (2 layers x 6 extrusions) draws 12 strokes at its top
 * layer with one ghost layer, and 6 with none.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SuiteStubWorker, installSuite2DProbe, type Suite2DProbe } from '@chestnutlabs/gcode-preview-core/testing';
import { type GcodePreviewElement, defineGcodePreview } from '../index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

let probe: Suite2DProbe;
let el: GcodePreviewElement | null = null;
beforeEach(() => {
  probe = installSuite2DProbe();
});
afterEach(() => {
  el?.remove();
  el = null;
  probe.restore();
});

async function strokesWith(adjacent: string | null): Promise<number> {
  defineGcodePreview();
  el = document.createElement('gcode-preview') as GcodePreviewElement;
  el.createWorker = () => new SuiteStubWorker();
  el.setAttribute('renderer', '2d');
  if (adjacent !== null) el.setAttribute('adjacent-layers', adjacent);
  el.source = new Uint8Array(1_000);
  document.body.appendChild(el);
  await settle();
  return probe.strokes();
}

describe('element <gcode-preview adjacent-layers> markup', () => {
  it('a non-numeric value connects, parses and draws with the default one ghost layer', async () => {
    expect(await strokesWith('abc')).toBe(12);
    expect(probe.used()).toBe(true);
  });

  it('"NaN" is non-numeric too', async () => {
    expect(await strokesWith('NaN')).toBe(12);
  });

  it('a numeric value still applies: 0 draws the top layer alone', async () => {
    expect(await strokesWith('0')).toBe(6);
  });

  it('absent is the default', async () => {
    expect(await strokesWith(null)).toBe(12);
  });
});
