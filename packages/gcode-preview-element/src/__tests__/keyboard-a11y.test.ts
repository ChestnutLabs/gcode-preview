// @vitest-environment happy-dom
/**
 * Keyboard-operability a11y (DD-004, #275/M4). The embedded canvas must be focusable (`tabindex="0"`)
 * so an embedder's viewer is keyboard-reachable, not just the standalone demo page. The custom element
 * mounts a real canvas in an open shadow root, so this is directly assertable here; the OrbitControls
 * key wiring lives in the renderer (`scene.ts`, exercised by the demo/live check).
 */
import { describe, expect, it } from 'vitest';
import { defineGcodePreview, GcodePreviewElement } from '../index';

describe('keyboard a11y (#275/M4)', () => {
  it('the embedded canvas is focusable (tabindex="0") and labelled', () => {
    defineGcodePreview();
    const el = document.createElement('gcode-preview') as GcodePreviewElement;
    document.body.appendChild(el); // connectedCallback builds the canvas synchronously
    const canvas = el.shadowRoot!.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas!.getAttribute('tabindex')).toBe('0');
    expect(canvas!.getAttribute('aria-label')).toBeTruthy();
    el.remove();
  });
});
