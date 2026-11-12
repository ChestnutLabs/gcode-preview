import { describe, expect, it } from 'vitest';
import { applyUntilStable, diffApplied, findDuplicateImages } from './screenshots/lib/stabilize.mjs';

/** A fake page: `apply` bumps the build counter for the first `rebuilds` calls, like a Lab clobber. */
function fakePage(rebuilds) {
  const log = { applies: 0, settles: 0, builds: 0 };
  return {
    log,
    io: {
      apply: async () => {
        log.applies++;
        if (log.applies <= rebuilds) log.builds++;
      },
      builds: async () => log.builds,
      settle: async () => {
        log.settles++;
      }
    }
  };
}

describe('applyUntilStable', () => {
  it('returns after one round when the apply fires no build', async () => {
    const { io, log } = fakePage(0);
    expect(await applyUntilStable(io)).toBe(1);
    expect(log.applies).toBe(1);
    expect(log.settles).toBe(1);
  });

  it('re-applies and re-settles while a round still fires a build', async () => {
    const { io, log } = fakePage(2);
    expect(await applyUntilStable(io)).toBe(3);
    expect(log.applies).toBe(3);
    expect(log.settles).toBe(3);
  });

  it('throws at the bound when builds never stop', async () => {
    const { io, log } = fakePage(99);
    await expect(applyUntilStable({ ...io, maxRounds: 4 })).rejects.toThrow(
      'settings did not stabilise after 4 rounds (builds kept firing)'
    );
    expect(log.applies).toBe(4);
  });

  it('defaults to a bound of 6 rounds, as the README documents', async () => {
    const { io, log } = fakePage(99);
    await expect(applyUntilStable(io)).rejects.toThrow(
      'settings did not stabilise after 6 rounds (builds kept firing)'
    );
    expect(log.applies).toBe(6);
  });

  it('succeeds on the last allowed round', async () => {
    const { io } = fakePage(3);
    expect(await applyUntilStable({ ...io, maxRounds: 4 })).toBe(4);
  });
});

describe('diffApplied', () => {
  it('is empty when every expected key matches', () => {
    expect(
      diffApplied({ layerRange: [0, 7], colorMode: { mode: 'feature' }, extra: 1 }, { layerRange: [0, 7] })
    ).toEqual([]);
  });

  it('reports a lost layer range with both values', () => {
    expect(diffApplied({ layerRange: [0, 99] }, { layerRange: [0, 7] })).toEqual([
      'layerRange: expected [0,7], controller last received [0,99]'
    ]);
  });

  it('reports a key the controller never received', () => {
    expect(diffApplied({}, { colorMode: { mode: 'feedrate' } })).toEqual([
      'colorMode: expected {"mode":"feedrate"}, controller last received undefined'
    ]);
  });

  it('reports every mismatch, not just the first', () => {
    const out = diffApplied({ theme: { a: 1 }, travel: false }, { theme: { a: 2 }, travel: true });
    expect(out).toHaveLength(2);
  });
});

describe('findDuplicateImages', () => {
  it('returns nothing when every hash is distinct', () => {
    expect(
      findDuplicateImages([
        { name: 'a', hash: '1' },
        { name: 'b', hash: '2' }
      ])
    ).toEqual([]);
  });

  it('groups shots that share a hash', () => {
    expect(
      findDuplicateImages([
        { name: 'viewer-benchy-tubes', hash: 'x' },
        { name: 'other', hash: 'y' },
        { name: 'layer-clip-benchy', hash: 'x' }
      ])
    ).toEqual([['viewer-benchy-tubes', 'layer-clip-benchy']]);
  });

  it('keeps separate groups separate', () => {
    expect(
      findDuplicateImages([
        { name: 'a', hash: '1' },
        { name: 'b', hash: '1' },
        { name: 'c', hash: '2' },
        { name: 'd', hash: '2' }
      ])
    ).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ]);
  });
});
