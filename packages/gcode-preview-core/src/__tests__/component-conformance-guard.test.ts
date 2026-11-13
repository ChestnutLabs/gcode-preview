/**
 * #520: the renderer-unsupported conformance cases need the harness's optional `onRendererUnsupported`.
 * A harness that never wires it must fail with an explicit message, not pass vacuously or with a bare diff.
 */
import { describe, expect, it } from 'vitest';
import { runComponentConformanceSuite, type ComponentHarness, type MountedComponent } from '../testing';

type Case = () => Promise<void> | void;

/** Run the suite against `harness` with a recording `it`, and return each case's body by title. */
function collect(harness: ComponentHarness): Map<string, Case> {
  const cases = new Map<string, Case>();
  const api = {
    describe: (_name: string, fn: () => void) => fn(),
    it: (name: string, fn: Case) => {
      cases.set(name, fn);
    },
    expect
  };
  runComponentConformanceSuite('guard', api as Parameters<typeof runComponentConformanceSuite>[1], harness);
  return cases;
}

/** Mounts fine, but never calls back: a harness written before #520. */
const unwired: ComponentHarness = {
  mount: () => ({
    emitBuild: () => undefined,
    parse: async () => undefined,
    setCameraMode: () => undefined,
    settle: async () => undefined,
    unmount: () => undefined
  })
};

describe('component conformance: an unwired renderer-unsupported harness (#520)', () => {
  const cases = [...collect(unwired)].filter(([title]) => title.includes('(#520)'));

  it('there are two #520 cases', () => {
    expect(cases.length).toBe(2);
  });

  for (const [title, run] of cases) {
    it(`fails with the explicit message: ${title}`, async () => {
      await expect(Promise.resolve().then(run)).rejects.toThrow(
        'harness must implement onRendererUnsupported (#520): no renderer-unsupported reached it from a 2D mount'
      );
    });
  }
});

describe('component conformance: a harness without the Part C seams', () => {
  const partC = (h: ComponentHarness) => [...collect(h)].filter(([title]) => title.includes('(Part C)'));

  it('there are four Part C cases', () => {
    expect(partC(unwired).length).toBe(4);
  });

  for (const [title, run] of partC(unwired)) {
    const message = title.startsWith('a ready-time')
      ? 'harness must implement setSource and firstChunkDrawCount and controls (Part C)'
      : 'harness must implement setSource and firstChunkDrawCount (Part C)';
    it(`fails with the explicit message: ${title}`, async () => {
      await expect(Promise.resolve().then(run)).rejects.toThrow(message);
    });
  }

  it('the ready-time case also names controls alone when only it is missing', async () => {
    const noControls: ComponentHarness = {
      mount: () => ({
        ...(unwired.mount({} as never) as MountedComponent),
        setSource: () => undefined,
        firstChunkDrawCount: () => 0
      })
    };
    const [, run] = partC(noControls).find(([title]) => title.startsWith('a ready-time'))!;
    await expect(Promise.resolve().then(run)).rejects.toThrow('harness must implement controls (Part C)');
  });
});

describe('component conformance: the re-parse case needs setSource and setParseOptions', () => {
  const reparse = (h: ComponentHarness) => [...collect(h)].filter(([title]) => title.includes('(re-parse)'));

  it('there is one re-parse case', () => {
    expect(reparse(unwired).length).toBe(1);
  });

  const variants: Array<[string, Partial<MountedComponent>]> = [
    ['neither', {}],
    ['setSource only', { setSource: () => undefined }],
    ['setParseOptions only', { setParseOptions: () => undefined }]
  ];
  for (const [label, extra] of variants) {
    it(`fails with the explicit message (${label})`, async () => {
      const h: ComponentHarness = {
        mount: () => ({ ...(unwired.mount({} as never) as MountedComponent), ...extra })
      };
      const [, run] = reparse(h)[0]!;
      await expect(Promise.resolve().then(run)).rejects.toThrow(
        'harness must implement setSource and setParseOptions (re-parse)'
      );
    });
  }
});
