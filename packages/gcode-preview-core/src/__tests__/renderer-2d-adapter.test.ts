// @vitest-environment happy-dom
/**
 * `LayerView2DRenderer` (core's 2D adapter) clause by clause: sizing, the layer range (the top of the range,
 * `Infinity` = the top layer), the travel toggle, the colour-mode gate, progress, the 3D-only disclosures,
 * the constructor options and the disposed guard. happy-dom has no Canvas 2D, so each canvas gets a
 * recording context: one `clearRect` per frame, one `stroke` per drawn segment.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { LayerView2D } from '@chestnutlabs/gcode-renderer-2d';
import { LayerView2DRenderer, type LayerView2DRendererOptions, type PreviewRendererEvent } from '../index';
import { installSuite2DProbe, makeTestIR } from '../testing';

interface Stroke {
  style: string;
  width: number;
  alpha: number;
}

function recordingCanvas() {
  const canvas = document.createElement('canvas');
  const rec = { frames: 0, strokes: [] as Stroke[] };
  const ctx = {
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => {
      rec.strokes.push({ style: ctx.strokeStyle, width: ctx.lineWidth, alpha: ctx.globalAlpha });
    },
    clearRect: () => {
      rec.frames++;
      rec.strokes = [];
    }
  };
  canvas.getContext = (() => ctx) as unknown as typeof canvas.getContext;
  return { canvas, rec };
}

function make(opts?: LayerView2DRendererOptions) {
  const { canvas, rec } = recordingCanvas();
  const r = new LayerView2DRenderer(canvas, opts);
  const events: PreviewRendererEvent[] = [];
  r.onEvent((e) => events.push(e));
  const unsupported = () =>
    events.flatMap((e) => (e.type === 'renderer-unsupported' ? [`${e.feature}: ${e.message}`] : []));
  return { canvas, rec, r, events, unsupported };
}

/** makeTestIR (2 layers × 6 extrusions) plus one travel on layer 0, after its extrusions. */
function irWithTravel(): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 't', units: 'mm', unitsSource: 'known' });
  for (let l = 0; l < 2; l++) {
    for (let s = 0; s < 6; s++) {
      const seg = { x0: s, y0: 0, z0: 0.2 * (l + 1), x1: s + 1, y1: 0, z1: 0.2 * (l + 1), e: 1, layer: l };
      b.addSegment({ ...seg, kind: MoveKind.Extrude, srcByte: l * 100 + s });
    }
    if (l === 0) {
      b.addSegment({
        x0: 6,
        y0: 0,
        z0: 0.2,
        x1: 0,
        y1: 5,
        z1: 0.2,
        e: 0,
        kind: MoveKind.Travel,
        layer: 0,
        srcByte: 50
      });
    }
  }
  return b.finalize();
}

const styles = (strokes: Stroke[]) => strokes.map((s) => s.style);

describe('LayerView2DRenderer sizing', () => {
  it('rounds the canvas size and redraws', () => {
    const { canvas, rec, r } = make();
    r.setIR(makeTestIR());
    const before = rec.frames;
    r.resize(300.6, 150.4);
    expect(canvas.width).toBe(301);
    expect(canvas.height).toBe(150);
    expect(rec.frames).toBe(before + 1);
  });

  it('clamps a size below 1, NaN or infinite to 1 (host-page data, never thrown on)', () => {
    const { canvas, r } = make();
    r.resize(0.2, 0);
    expect(`${canvas.width}x${canvas.height}`).toBe('1x1');
    r.resize(NaN, Number.POSITIVE_INFINITY);
    expect(`${canvas.width}x${canvas.height}`).toBe('1x1');
    r.resize(-5, Number.NEGATIVE_INFINITY);
    expect(`${canvas.width}x${canvas.height}`).toBe('1x1');
  });
});

describe('LayerView2DRenderer setIR', () => {
  it('draws the new toolpath at once', () => {
    const { rec, r } = make({ adjacentLayers: 0 });
    r.setLayerRange(0, 0);
    const before = rec.frames;
    r.setIR(makeTestIR());
    expect(rec.frames).toBe(before + 1);
    expect(rec.strokes.length).toBe(6);
  });
});

describe('LayerView2DRenderer layer range', () => {
  it('counts are 0 before a toolpath, then the IR’s', () => {
    const { r } = make();
    expect(r.layerCount).toBe(0);
    expect(r.segmentCount).toBe(0);
    r.setIR(makeTestIR());
    expect(r.layerCount).toBe(2);
    expect(r.segmentCount).toBe(12);
  });

  it('draws the TOP of the range; Infinity, past-the-end and fractions never blank the view', () => {
    const { rec, r } = make();
    r.setIR(makeTestIR());
    const at = (start: number, end: number) => {
      const before = rec.frames;
      r.setLayerRange(start, end);
      expect(rec.frames).toBe(before + 1); // every call redraws
      return rec.strokes.length;
    };
    // Layer 0 = 6 strokes; layer 1 = its 6 + one ghost layer of 6 beneath it.
    expect(at(1, 0)).toBe(6); // the end, not the start, picks the layer
    expect(at(0, 1)).toBe(12);
    expect(at(0, Number.POSITIVE_INFINITY)).toBe(12); // the adapters' cleared layerRange
    expect(at(0, 0.9)).toBe(6);
    expect(at(0, 99)).toBe(12);
    expect(at(0, -3)).toBe(6);
    expect(at(0, NaN)).toBe(6); // ignored: the current layer (0) stays
  });

  it('a past-the-end request stays the top layer across a re-parse with more layers', () => {
    const { rec, r } = make();
    r.setIR(makeTestIR());
    r.setLayerRange(0, Number.POSITIVE_INFINITY);
    r.setIR(irWithTravel()); // also 2 layers; the top one again
    expect(rec.strokes.length).toBe(12);
  });
});

describe('LayerView2DRenderer travel toggle', () => {
  it('only travel is toggled; extrusion and wipe are no-ops that do not redraw', () => {
    const { rec, r } = make();
    r.setIR(irWithTravel());
    r.setLayerRange(0, 0);
    const before = rec.frames;
    r.setKindVisible('extrusion', false);
    r.setKindVisible('wipe', true);
    expect(rec.frames).toBe(before);
    r.setKindVisible('travel', true);
    expect(rec.frames).toBe(before + 1);
    expect(rec.strokes.length).toBe(7);
    expect(JSON.stringify(rec.strokes[0])).toBe(
      JSON.stringify({ style: 'rgba(120,120,120,0.9)', width: 0.5, alpha: 1 })
    );
    r.setKindVisible('travel', false);
    expect(rec.frames).toBe(before + 2);
    expect(rec.strokes.length).toBe(6);
  });

  it('re-enabling travel restores the constructor’s travel style, not the default grey', () => {
    const { rec, r } = make({ travel: { color: 'red', lineWidth: 2 } });
    r.setIR(irWithTravel());
    r.setLayerRange(0, 0);
    expect(JSON.stringify(rec.strokes[0])).toBe(JSON.stringify({ style: 'red', width: 2, alpha: 1 }));
    r.setKindVisible('travel', false);
    expect(rec.strokes.length).toBe(6);
    r.setKindVisible('travel', true);
    expect(rec.strokes.length).toBe(7);
    expect(JSON.stringify(rec.strokes[0])).toBe(JSON.stringify({ style: 'red', width: 2, alpha: 1 }));
  });
});

describe('LayerView2DRenderer colour-mode gate', () => {
  const MODES = ['feature', 'colorChange', 'object', 'feedrate', 'layerHeight', 'power', 'single', 'tool', 'moveKind'];
  const CAP: Record<string, string> = {
    feature: 'featureRoles',
    colorChange: 'colorChanges',
    object: 'objects',
    feedrate: 'feedrate',
    layerHeight: 'layers',
    power: 'toolPower'
  };
  const table = (r: LayerView2DRenderer) =>
    MODES.map((m) => `${m}:${r.isColorModeAvailable(m as Parameters<typeof r.isColorModeAvailable>[0])}`).join(' ');
  const withCaps = (conf: string | undefined): ToolpathIR => {
    const ir = makeTestIR();
    const caps = ir.header.capabilities as Record<string, string | undefined>;
    for (const key of Object.values(CAP)) {
      if (conf === undefined) delete caps[key];
      else caps[key] = conf;
    }
    return ir;
  };

  it('no toolpath: only the always-present channels (and feedrate, as in 3D) are available', () => {
    const { r } = make();
    expect(table(r)).toBe(
      'feature:false colorChange:false object:false feedrate:true layerHeight:false power:false single:true tool:true moveKind:true'
    );
  });

  it('a channel the IR does not mention is unavailable (feedrate excepted, as in 3D)', () => {
    const { r } = make();
    r.setIR(withCaps(undefined));
    expect(table(r)).toBe(
      'feature:false colorChange:false object:false feedrate:true layerHeight:false power:false single:true tool:true moveKind:true'
    );
  });

  it("'unavailable' gates every capability-backed mode; 'known' opens it", () => {
    const { r } = make();
    r.setIR(withCaps('unavailable'));
    expect(table(r)).toBe(
      'feature:false colorChange:false object:false feedrate:false layerHeight:false power:false single:true tool:true moveKind:true'
    );
    r.setIR(withCaps('known'));
    expect(table(r)).toBe(
      'feature:true colorChange:true object:true feedrate:true layerHeight:true power:true single:true tool:true moveKind:true'
    );
  });

  it('setColorMode refuses an unavailable mode without redrawing, and applies an available one', () => {
    const { rec, r } = make();
    r.setIR(withCaps('unavailable'));
    r.setLayerRange(0, 0);
    const before = rec.frames;
    expect(r.setColorMode({ mode: 'feature' })).toBe(false);
    expect(rec.frames).toBe(before);
    expect(r.setColorMode({ mode: 'single', color: [1, 0, 0] })).toBe(true);
    expect(rec.frames).toBe(before + 1);
    expect(JSON.stringify([...new Set(styles(rec.strokes))])).toBe('["rgb(255, 0, 0)"]');
  });

  it("hasColorChanges is true only for 'known' M600 boundaries; hasRetractions is always false", () => {
    const { r } = make();
    expect(r.hasColorChanges).toBe(false);
    const ir = makeTestIR();
    ir.header.capabilities['colorChanges'] = 'inferred';
    r.setIR(ir);
    expect(r.hasColorChanges).toBe(false);
    ir.header.capabilities['colorChanges'] = 'known';
    expect(r.hasColorChanges).toBe(true);
    expect(r.hasRetractions).toBe(false);
  });
});

describe('LayerView2DRenderer disclosures', () => {
  it('retraction markers disclose only when turned on', () => {
    const { r, unsupported } = make();
    r.setShowRetractions(false);
    expect(unsupported().length).toBe(0);
    r.setShowRetractions(true);
    expect(JSON.stringify(unsupported())).toBe(
      JSON.stringify(['retractions: Retraction markers are only shown in the 3D renderer.'])
    );
  });

  it('preset views and camera state disclose with their own text', () => {
    const { r, unsupported } = make();
    r.setView('top');
    r.setCameraState({ position: [0, 0, 1], target: [0, 0, 0], up: [0, 1, 0], zoom: 1 } as never);
    expect(JSON.stringify(unsupported())).toBe(
      JSON.stringify([
        'camera: Preset views apply only to the 3D renderer; the 2D view is fixed top-down.',
        'camera: Camera state applies only to the 3D renderer; the 2D view has no 3D pose.'
      ])
    );
  });

  it('an unsubscribed listener hears nothing more', () => {
    const { canvas } = recordingCanvas();
    const r = new LayerView2DRenderer(canvas);
    const heard: string[] = [];
    const off = r.onEvent((e) => heard.push(e.type));
    r.setShowRetractions(true);
    off();
    r.setShowRetractions(true);
    expect(JSON.stringify(heard)).toBe('["renderer-unsupported"]');
  });
});

describe('LayerView2DRenderer progress', () => {
  it('projects segIndex and layerIndex: segments after the cut on the active layer draw dimmed', () => {
    const { rec, r } = make({ adjacentLayers: 0 });
    r.setIR(makeTestIR());
    r.setLayerRange(0, 0);
    const before = rec.frames;
    r.setProgress({ segIndex: 2, layerIndex: 0 } as never);
    expect(rec.frames).toBe(before + 1);
    expect(JSON.stringify(rec.strokes.map((s) => s.alpha))).toBe('[1,1,1,0.15,0.15,0.15]');
    r.setProgress(null);
    expect(JSON.stringify(rec.strokes.map((s) => s.alpha))).toBe('[1,1,1,1,1,1]');
  });

  it('frame() is a redraw', () => {
    const { rec, r } = make();
    r.setIR(makeTestIR());
    const before = rec.frames;
    r.frame();
    expect(rec.frames).toBe(before + 1);
  });
});

describe('LayerView2DRenderer constructor options', () => {
  it('colorMode, adjacentLayers, ghostOpacity and lineWidth reach the view', () => {
    const { rec, r } = make({ colorMode: { mode: 'single', color: [0, 0, 1] }, ghostOpacity: 0.5, lineWidth: 3 });
    r.setIR(makeTestIR());
    r.setLayerRange(0, 1);
    expect(JSON.stringify(rec.strokes.map((s) => s.alpha))).toBe('[0.5,0.5,0.5,0.5,0.5,0.5,1,1,1,1,1,1]');
    expect(JSON.stringify([...new Set(rec.strokes.map((s) => `${s.style} ${s.width}`))])).toBe('["rgb(0, 0, 255) 3"]');
    const none = make({ adjacentLayers: 0 });
    none.r.setIR(makeTestIR());
    none.r.setLayerRange(0, 1);
    expect(none.rec.strokes.length).toBe(6);
  });

  it('a travel style in the constructor draws travel from the start', () => {
    const { rec, r } = make({ travel: { color: 'blue', lineWidth: 1 } });
    r.setIR(irWithTravel());
    r.setLayerRange(0, 0);
    expect(rec.strokes.length).toBe(7);
  });

  it('invalid options throw a RangeError naming the option', () => {
    const { canvas } = recordingCanvas();
    const bad: [LayerView2DRendererOptions, string][] = [
      [{ adjacentLayers: NaN }, 'LayerView2D: adjacentLayers must be a number (got NaN).'],
      [{ ghostOpacity: 1.5 }, 'LayerView2D: ghostOpacity must be in [0, 1] (got 1.5).'],
      [{ ghostOpacity: NaN }, 'LayerView2D: ghostOpacity must be in [0, 1] (got NaN).'],
      [{ lineWidth: 0 }, 'LayerView2D: lineWidth must be a finite number > 0 (got 0).'],
      [{ lineWidth: Number.POSITIVE_INFINITY }, 'LayerView2D: lineWidth must be a finite number > 0 (got Infinity).']
    ];
    for (const [opts, message] of bad) {
      expect(() => new LayerView2DRenderer(canvas, opts)).toThrowError(new RangeError(message));
    }
    // The documented floor stays legal: negative counts draw no ghosts, Infinity draws every layer below.
    expect(() => new LayerView2DRenderer(canvas, { adjacentLayers: -1, ghostOpacity: 0 })).not.toThrow();
    expect(() => new LayerView2DRenderer(canvas, { adjacentLayers: Infinity, ghostOpacity: 1 })).not.toThrow();
  });
});

describe('LayerView2DRenderer dispose', () => {
  it('drops the toolpath and listeners, and never draws again (like the 3D renderer)', async () => {
    const { rec, r, events } = make();
    r.setIR(makeTestIR());
    await Promise.resolve();
    const seen = events.length;
    r.dispose();
    expect(r.layerCount).toBe(0);
    expect((r as unknown as { view: LayerView2D }).view.layerCount).toBe(0);
    const frames = rec.frames;
    r.setIR(makeTestIR());
    await Promise.resolve();
    expect(r.layerCount).toBe(0);
    r.resize(10, 10);
    r.setLayerRange(0, 1);
    r.setKindVisible('travel', true);
    r.setColorMode({ mode: 'single', color: [1, 1, 1] });
    r.setProgress(null);
    r.frame();
    r.setShowRetractions(true);
    expect(rec.frames).toBe(frames);
    expect(events.length).toBe(seen);
  });
});

describe('installSuite2DProbe (testing.ts)', () => {
  it('serves only 2D contexts, counts strokes per frame, and restores the original getContext', () => {
    const original = HTMLCanvasElement.prototype.getContext;
    const probe = installSuite2DProbe();
    try {
      const canvas = document.createElement('canvas');
      expect(canvas.getContext('webgl2')).toBe(original.call(canvas, 'webgl2'));
      expect(probe.used()).toBe(false);
      const ctx = canvas.getContext('2d')!;
      expect(probe.used()).toBe(true);
      ctx.stroke();
      ctx.stroke();
      expect(probe.strokes()).toBe(2);
      ctx.clearRect(0, 0, 1, 1);
      expect(probe.strokes()).toBe(0);
    } finally {
      probe.restore();
    }
    expect(HTMLCanvasElement.prototype.getContext).toBe(original);
  });
});
