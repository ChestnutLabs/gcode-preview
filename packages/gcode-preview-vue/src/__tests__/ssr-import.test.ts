// @vitest-environment node
/**
 * SSR-import safety (DD-007 §4.2): importing and even *calling* the composable in a
 * DOM-less Node environment must not touch browser globals — everything browser-bound
 * defers to canvas binding / parse time.
 */
import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';

describe('SSR-import safety (§4.2)', () => {
  it('imports and constructs without window/Worker/ResizeObserver', async () => {
    expect(typeof window).toBe('undefined');
    expect(typeof Worker).toBe('undefined');
    const mod = await import('../index');
    const scope = effectScope();
    const preview = scope.run(() => mod.useGcodePreview())!;
    expect(preview.state.parsing).toBe(false);
    expect(preview.raw.renderer()).toBeNull();
    expect(preview.observeProgress({ v: 1, timestampMs: 1, position: { percent: 0.5 } })).toBeNull();
    scope.stop(); // dispose path must also be browser-global-free
  });
});
