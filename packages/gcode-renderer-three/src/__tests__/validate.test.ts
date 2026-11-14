/**
 * validate.ts: the one source of truth for the renderer's option rules, shared with gcode-preview-core
 * through `/lite`. Literal messages and allowed lists, so a reworded rule is a deliberate test change.
 */
import { describe, expect, it } from 'vitest';
import {
  CAMERA_MODES,
  CAMERA_VIEWS,
  FRAME_CONTENT_MODES,
  INTERACTION_QUALITY_MODES,
  MAX_GRID_LINES_PER_AXIS,
  PROGRESSIVE_PREVIEW_MODES,
  QUALITY_POLICIES,
  RENDERER_MODES,
  checkBuildVolume,
  checkCameraFov,
  checkCameraMode,
  checkCameraState,
  checkCameraView,
  checkFrameContent,
  checkInteractionQuality,
  checkPixelRatio,
  checkProgressivePreview,
  checkQualityMode,
  checkRendererMode,
  checkTheme
} from '../validate.js';
import * as stage from '../stage.js';
import * as interactive from '../interactive-stage.js';
import * as tubes from '../tubes.js';
import { VIEW_DIRECTIONS } from '../interactive-stage.js';
import type { CameraState } from '../interactive-stage.js';
import type { Theme } from '../theme.js';
import type { BuildVolumeDef } from '../build-volume.js';

const bad = (fn: () => void, message: string): void => {
  expect(fn).toThrow(RangeError);
  expect(fn).toThrow(message);
};

describe('enum checks', () => {
  it('export their allowed values as literal tuples', () => {
    expect(CAMERA_MODES).toEqual(['perspective', 'orthographic']);
    expect(CAMERA_VIEWS).toEqual(['top', 'bottom', 'front', 'back', 'left', 'right', 'iso']);
    expect(PROGRESSIVE_PREVIEW_MODES).toEqual(['auto', 'lines', 'hold', 'off']);
    expect(QUALITY_POLICIES).toEqual(['full', 'adaptive', 'fast']);
    expect(FRAME_CONTENT_MODES).toEqual(['object', 'all']);
    expect(INTERACTION_QUALITY_MODES).toEqual(['off', 'auto']);
    expect(RENDERER_MODES).toEqual(['2d', '3d']);
  });

  it('CAMERA_VIEWS is exactly the preset table the stage moves to', () => {
    expect([...CAMERA_VIEWS].sort()).toEqual(Object.keys(VIEW_DIRECTIONS).sort());
  });

  it.each([
    [
      'cameraMode',
      checkCameraMode,
      CAMERA_MODES,
      "cameraMode must be 'perspective' or 'orthographic' (got Perspective)"
    ],
    [
      'view',
      checkCameraView,
      CAMERA_VIEWS,
      "view must be 'top', 'bottom', 'front', 'back', 'left', 'right' or 'iso' (got Perspective)"
    ],
    [
      'progressivePreview',
      checkProgressivePreview,
      PROGRESSIVE_PREVIEW_MODES,
      "progressivePreview must be 'auto', 'lines', 'hold' or 'off' (got Perspective)"
    ],
    [
      'qualityMode',
      checkQualityMode,
      QUALITY_POLICIES,
      "qualityMode must be 'full', 'adaptive' or 'fast' (got Perspective)"
    ],
    [
      'frameContent',
      checkFrameContent,
      FRAME_CONTENT_MODES,
      "frameContent must be 'object' or 'all' (got Perspective)"
    ],
    [
      'interactionQuality',
      checkInteractionQuality,
      INTERACTION_QUALITY_MODES,
      "interactionQuality must be 'off' or 'auto' (got Perspective)"
    ],
    ['renderer.mode', checkRendererMode, RENDERER_MODES, "renderer.mode must be '2d' or '3d' (got Perspective)"]
  ] as const)('%s: every listed value passes, anything else throws the literal message', (_n, check, allowed, msg) => {
    const fn = check as (v: unknown) => void;
    for (const v of allowed) expect(() => fn(v)).not.toThrow();
    bad(() => fn('Perspective'), msg);
    // Exact match only: no case folding, no trimming, no undefined default.
    expect(() => fn(`${allowed[0]} `)).toThrow(RangeError);
    expect(() => fn(allowed[0].toUpperCase())).toThrow(RangeError);
    expect(() => fn(undefined)).toThrow(RangeError);
  });
});

describe('lens checks', () => {
  it('cameraFov: [10, 120] inclusive, NaN rejected', () => {
    for (const f of [10, 50, 120]) expect(() => checkCameraFov(f)).not.toThrow();
    bad(() => checkCameraFov(9.99), 'fov must be in [10, 120] degrees (got 9.99)');
    bad(() => checkCameraFov(120.01), 'fov must be in [10, 120] degrees (got 120.01)');
    bad(() => checkCameraFov(Number.NaN), 'fov must be in [10, 120] degrees (got NaN)');
  });

  it("pixelRatio: 'device' or (0, 4]", () => {
    for (const r of ['device', 0.5, 4] as const) expect(() => checkPixelRatio(r)).not.toThrow();
    bad(() => checkPixelRatio(0), "pixelRatio must be 'device' or a number in (0, 4] (got 0)");
    bad(() => checkPixelRatio(4.01), "pixelRatio must be 'device' or a number in (0, 4] (got 4.01)");
    bad(() => checkPixelRatio('Device' as 'device'), "pixelRatio must be 'device' or a number in (0, 4] (got Device)");
  });
});

describe('camera state', () => {
  const ok: CameraState = {
    cameraMode: 'perspective',
    position: { x: 1, y: 2, z: 3 },
    target: { x: 0, y: 0, z: 0 },
    zoom: 1
  };
  it('accepts a finite pose and rejects each bad field with its own message', () => {
    expect(() => checkCameraState(ok)).not.toThrow();
    bad(() => checkCameraState(null as unknown as CameraState), 'camera state must be an object');
    bad(
      () => checkCameraState({ ...ok, cameraMode: 'fisheye' as 'perspective' }),
      "cameraMode must be 'perspective' or 'orthographic' (got fisheye)"
    );
    bad(
      () => checkCameraState({ ...ok, position: { x: 1, y: Number.NaN, z: 3 } }),
      'camera state position must be {x, y, z} finite numbers'
    );
    bad(
      () => checkCameraState({ ...ok, target: null as unknown as CameraState['target'] }),
      'camera state target must be {x, y, z} finite numbers'
    );
    bad(() => checkCameraState({ ...ok, zoom: 0 }), 'camera state zoom must be a finite number > 0 (got 0)');
  });
});

describe('theme', () => {
  it('no theme and an empty theme pass; a bad value throws the #559 message', () => {
    expect(() => checkTheme(undefined)).not.toThrow();
    expect(() => checkTheme({})).not.toThrow();
    bad(() => checkTheme({ gridOpacity: 1.5 }), 'theme gridOpacity must be a number in [0,1] (got 1.5)');
    bad(
      () => checkTheme({ materialPreset: 'shiny' } as unknown as Theme),
      "theme materialPreset must be one of 'matte', 'glossy' (got shiny)"
    );
  });
});

describe('build volume', () => {
  const def: BuildVolumeDef = { x: 220, y: 220, z: 250 };
  it('a real bed passes; the grid-line cap is 10 000 per axis', () => {
    expect(MAX_GRID_LINES_PER_AXIS).toBe(10_000);
    expect(() => checkBuildVolume(def)).not.toThrow();
    // 99 990 mm at 10 mm = exactly 10 000 lines: allowed; one more pitch is not.
    expect(() => checkBuildVolume({ ...def, x: 99_990 })).not.toThrow();
    bad(
      () => checkBuildVolume({ ...def, x: 100_000 }),
      'buildVolume.x of 100000 mm at a 10 mm grid needs 10001 grid lines (> 10000 per axis)'
    );
    bad(() => checkBuildVolume({ ...def, grid: 0 }), 'buildVolume.grid must be a positive finite number (got 0)');
  });
});

describe('one source of truth: the renderer modules re-export these exact functions', () => {
  it('stage, interactive-stage and tubes hand out the validate.ts bindings', () => {
    expect(stage.checkFov).toBe(checkCameraFov);
    expect(stage.checkPixelRatio).toBe(checkPixelRatio);
    expect(interactive.checkCameraMode).toBe(checkCameraMode);
    expect(interactive.checkCameraState).toBe(checkCameraState);
    expect(tubes.checkQualityMode).toBe(checkQualityMode);
  });
});
