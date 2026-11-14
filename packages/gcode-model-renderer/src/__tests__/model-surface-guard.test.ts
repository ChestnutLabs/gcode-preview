/** `modelViewerSurfaceGaps`: the comparison every `/model` adapter's surface test runs. Literal lists only. */
import { describe, expect, it } from 'vitest';
import { modelViewerSurfaceGaps } from '../model-testing';

const PROPS = [
  'source',
  'view',
  'cameraState',
  'background',
  'interactionQuality',
  'cameraMode',
  'renderScope',
  'limits',
  'filamentPalette',
  'loaders',
  'buildVolume',
  'showVolumeCage',
  'theme',
  'cameraFov',
  'pixelRatio',
  'createRenderer',
  'createControls'
];
const NAMES = {
  ready: 'r',
  cameraChange: 'cc',
  error: 'e',
  rendererUnsupported: 'ru',
  contextLost: 'cl',
  contextRestored: 'cr',
  progress: 'p'
};
const EVENTS = ['r', 'cc', 'e', 'ru', 'cl', 'cr', 'p'];

describe('modelViewerSurfaceGaps', () => {
  it('the full shared surface (any order) has no gaps', () => {
    expect(modelViewerSurfaceGaps({ props: [...PROPS].reverse(), events: EVENTS, eventNames: NAMES })).toBe('');
  });

  it('names a missing prop and an extra prop', () => {
    const props = PROPS.filter((p) => p !== 'theme').concat(['zeta', 'alpha']);
    expect(modelViewerSurfaceGaps({ props, events: EVENTS, eventNames: NAMES })).toBe(
      'missing props: theme; extra props: alpha, zeta'
    );
  });

  it('names a missing and an extra event, through the adapter mapping', () => {
    const events = EVENTS.filter((e) => e !== 'cl').concat(['x']);
    expect(modelViewerSurfaceGaps({ props: PROPS, events, eventNames: NAMES })).toBe(
      'missing events: cl; extra events: x'
    );
  });

  it('a wrong mapping is a gap on both sides', () => {
    expect(
      modelViewerSurfaceGaps({ props: PROPS, events: EVENTS, eventNames: { ...NAMES, progress: 'onProgress' } })
    ).toBe('missing events: onProgress; extra events: p');
  });

  it('prop and event gaps are both reported', () => {
    expect(modelViewerSurfaceGaps({ props: PROPS.slice(1), events: EVENTS.slice(1), eventNames: NAMES })).toBe(
      'missing props: source; missing events: r'
    );
  });

  it('a duplicated name counts once', () => {
    expect(modelViewerSurfaceGaps({ props: [...PROPS, 'view'], events: [...EVENTS, 'r'], eventNames: NAMES })).toBe('');
  });
});
