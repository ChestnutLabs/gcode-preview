/**
 * #430: `<GcodePreview onDisclosure>` must report the CURRENT build's disclosure, so it reads the
 * controller through the live-state side channel instead of the hook's lagging render snapshot. The
 * component wiring itself is pinned by the portable conformance case (component-conformance.test.ts, #502).
 */
import { describe, expect, it } from 'vitest';
import { readLiveState, registerLiveState } from '../live-state';

describe('live-state side channel (#430)', () => {
  it('reads the registered reader each call, and refuses an unregistered object', () => {
    const handle = {};
    let n = 0;
    registerLiveState(handle, () => ({ disclosure: `call ${++n}` }) as never);
    expect(readLiveState(handle).disclosure).toBe('call 1');
    expect(readLiveState(handle).disclosure).toBe('call 2');
    expect(() => readLiveState({})).toThrow('readLiveState: not a useGcodePreview handle');
  });
});
