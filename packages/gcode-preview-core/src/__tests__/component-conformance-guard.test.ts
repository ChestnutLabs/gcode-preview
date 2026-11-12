/**
 * #520: the renderer-unsupported conformance cases need the harness's optional `onRendererUnsupported`.
 * A harness that never wires it must fail with an explicit message, not pass vacuously or with a bare diff.
 */
import { describe, expect, it } from 'vitest';
import { runComponentConformanceSuite, type ComponentHarness } from '../testing';

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
