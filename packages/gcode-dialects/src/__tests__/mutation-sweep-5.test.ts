/**
 * Mutation sweep 5 (dialects sweep 3, 2026-11-13): pins the two `matchPrintTime` behaviours no test
 * guarded. Expected values are literals, never the module's own constants.
 */
import { describe, expect, it } from 'vitest';
import { orcaBambu } from '../orca-bambu';
import { annotate, must } from './sweep-4-helpers';

const BAMBU = '; BambuStudio 01.09.00.70';

describe('Orca/Bambu one-line print time', () => {
  it('the first readable model time on a line wins over a later one', () => {
    const r = must(annotate([orcaBambu()], [BAMBU, '; model printing time: 5m; model printing time: 10m', 'G1 X1']));
    expect(r.metadata.printEstimate?.seconds).toBe(300);
    expect(r.metadata.printEstimate?.source.evidence).toBe('; model printing time: 5m');
  });

  it('an upper-case TOTAL ESTIMATED TIME is the total, not a model time', () => {
    const r = must(
      annotate([orcaBambu()], [BAMBU, '; MODEL PRINTING TIME: 1h; TOTAL ESTIMATED TIME: 2h 0m 34s', 'G1 X1'])
    );
    expect(r.metadata.printEstimate?.seconds).toBe(7234);
    expect(r.metadata.printEstimate?.source.evidence).toBe('; TOTAL ESTIMATED TIME: 2h 0m 34s');
  });
});
