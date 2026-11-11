/**
 * DD-032: the Svelte shell's `cameraFov` prop. There is no component-mount harness here (see
 * prop-reactivity.test.ts), so this pins the wiring in the source: the prop exists, is unset by default,
 * is passed into the renderer options at construction, and a change calls `setCameraFov` only when defined.
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
  it('re-applies on change only when defined', () => {
    expect(SOURCE).toMatch(/\$: if \(cameraFov !== undefined\) preview\.controls\.setCameraFov\(cameraFov\);/);
  });
});
