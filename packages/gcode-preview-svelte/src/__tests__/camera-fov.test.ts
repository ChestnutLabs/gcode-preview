/**
 * DD-032: the Svelte shell's `cameraFov` prop. There is no component-mount harness here (see
 * prop-reactivity.test.ts), so this pins the wiring in the source: the prop exists, is unset by default,
 * is passed into the renderer options at construction, and a change calls `setCameraFov` only when defined
 * and different (#520; the mounted behaviour is covered in tools/svelte-compat).
 */
import { describe, expect, it } from 'vitest';
import SOURCE from '../GcodePreview.svelte?raw';

describe('Svelte shell cameraFov (DD-032)', () => {
  it('is an unset-by-default prop', () => {
    expect(SOURCE).toMatch(/export let cameraFov = undefined;/);
  });
  it('is passed to the renderer options at construction', () => {
    expect(SOURCE).toMatch(/renderer: \{[^}]*\n\s+cameraFov,\n/);
  });
  it('re-applies on change only when defined and different (#520)', () => {
    expect(SOURCE).toMatch(/\$: applyCameraFov\(cameraFov\);/);
    expect(SOURCE).toMatch(/if \(fov === undefined \|\| fov === appliedCameraFov\) return;/);
  });
});
