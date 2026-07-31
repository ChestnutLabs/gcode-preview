/**
 * Non-extrusion dialect families (DD-012 phase 3, #189): GRBL-laser / GRBL-mill / LinuxCNC.
 * Detection + the validation-tier honesty mechanism. GRBL-laser is hardware-VALIDATED (2026-07-29,
 * DD-012 §16 log) → its claims report `known`; GRBL-mill and LinuxCNC remain EXPERIMENTAL → their
 * claims are downgraded to `inferred` until a real CNC run. The flip is per-controller (evidence in
 * docs/design/DD-012-hardware-validation-log.md). Fixtures are synthetic (MIT-clean fingerprints,
 * not copied third-party files).
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR, type ParseOptions } from '../../../gcode-parser/src/parse';
import { createDialectRunner } from '../registry';
import { grblLaser, grblMill, linuxCnc } from '../cnc';

/** Parse text through the CNC dialect set exactly like the worker does. */
function cncParse(text: string, opts: ParseOptions = {}) {
  const runner = createDialectRunner([grblLaser(), grblMill(), linuxCnc()]);
  const run = runner.createRun({
    selection: 'auto',
    headText: text.slice(0, 64 * 1024),
    tailText: text.slice(-16 * 1024)
  });
  const result = parseGcodeToIR(text, { ...opts, onComment: run?.onComment, onCommand: run?.onCommand });
  const out = run ? run.finalize(result.ir) : { metadata: {} as Record<string, unknown> };
  return { ir: result.ir, metadata: out.metadata, detected: run !== null };
}

const LASER =
  ['; LightBurn 1.4', 'G21', 'G90', 'M4 S0', 'G0 X0 Y0', 'G1 X10 Y0 S255 F600', 'G1 X10 Y10 S255', 'M5'].join('\n') +
  '\n';

const LINUXCNC =
  [
    '%',
    '(LinuxCNC milling program)',
    'G21 G90 G94',
    'M3 S12000',
    'G0 X0 Y0 Z5',
    'G1 Z-2 F100',
    'G1 X20 Y0',
    'G81 X30 Y0 Z-5 R2',
    'G80',
    'M5'
  ].join('\n') + '\n';

const GRBLMILL =
  ['Grbl 1.1', 'G21 G90', 'M3 S10000', 'G0 X0 Y0 Z5', 'G1 Z-1 F100', 'G1 X10 Y0', 'M5'].join('\n') + '\n';

describe('DD-012 phase 3 — non-extrusion dialects (#189)', () => {
  it('detects GRBL laser (LightBurn), hardware-VALIDATED → claims known, no experimental warning', () => {
    const { ir, metadata } = cncParse(LASER, { modalChannels: ['toolPower'] });
    expect(ir.header.dialects.some((d) => d.id === 'grbl-laser')).toBe(true);
    const raw = metadata.raw as Record<string, string>;
    expect(raw['cnc.machineClass']).toBe('laser');
    expect(raw['cnc.validationTier']).toBe('validated');
    expect(raw['cnc.toolPowerLabel']).toMatch(/laser/i);
    // Validated (2026-07-29 real GRBL/LightBurn run, DD-012 D8): no downgrade — the claims the file
    // actually makes stay `known`, and the experimental disclosure is not emitted.
    expect(ir.header.capabilities.cutMoves).toBe('known');
    expect(ir.header.capabilities.toolPower).toBe('known');
    expect(ir.header.warnings.some((w) => w.code === 'cnc-dialect-experimental')).toBe(false);
  });

  it('detects LinuxCNC mill and downgrades the canned-cycle claim to inferred', () => {
    const { ir, metadata } = cncParse(LINUXCNC);
    expect(ir.header.dialects.some((d) => d.id === 'linuxcnc')).toBe(true);
    expect((metadata.raw as Record<string, string>)['cnc.machineClass']).toBe('mill');
    expect(ir.header.capabilities.cannedCycles).toBe('inferred'); // was 'known' from the parser
    expect(ir.header.capabilities.cutMoves).toBe('inferred');
  });

  it('detects GRBL mill (Grbl banner + M3 spindle) — still EXPERIMENTAL (claims inferred)', () => {
    const { ir, metadata } = cncParse(GRBLMILL);
    const raw = metadata.raw as Record<string, string>;
    expect(ir.header.dialects.some((d) => d.id === 'grbl-mill')).toBe(true);
    expect(raw['cnc.machineClass']).toBe('mill');
    expect(raw['cnc.toolPowerLabel']).toMatch(/RPM/i);
    // The laser flip is per-controller: mill/linuxcnc are NOT yet hardware-validated, so they still
    // downgrade to `inferred` with the experimental disclosure.
    expect(raw['cnc.validationTier']).toBe('experimental');
    expect(ir.header.capabilities.cutMoves).toBe('inferred');
    expect(ir.header.warnings.some((w) => w.code === 'cnc-dialect-experimental')).toBe(true);
  });

  it('does not misdetect an FDM file as CNC', () => {
    const { detected } = cncParse('M82\nG1 X0 Y0 Z0.2 E0\nG1 X10 E5\nG1 X20 E10\n');
    expect(detected).toBe(false);
  });

  it('a validated dialect still never fabricates a claim for an unused feature', () => {
    // grbl-laser is validated, but the tier only governs how a *made* claim is reported — it never
    // invents one. A laser file that never engages the tool has no cut moves to claim.
    const { ir } = cncParse('; LightBurn\nG90\nG0 X0 Y0\nG1 X10 Y0\n'); // laser header but tool never engaged
    expect(ir.header.capabilities.cutMoves).toBe('unavailable'); // no M3/M4 → stays unavailable, not fabricated
  });
});

// Evidence-based detection distilled from real public samples (LaserGRBL, LinuxCNC, GRBL CAM output).
// Fixtures are MIT-clean re-creations of the real *fingerprints*, not copied third-party files.
describe('DD-012 phase 3 — evidence-based detection of header-less real files (#189)', () => {
  it('no-header GRBL laser: M3 + S power, planar (the raw LaserGRBL form)', () => {
    const { ir, metadata } = cncParse('M3 S0\nG1 X100 F1200 S1000\nS0\nM5\n');
    expect(ir.header.dialects.some((d) => d.id === 'grbl-laser')).toBe(true);
    expect((metadata.raw as Record<string, string>)['cnc.machineClass']).toBe('laser');
  });

  it('mill from mid-line spindle + Z-plunge, no header, concatenated words (g1z-.1, s3400 m3)', () => {
    const { ir, metadata } = cncParse('g20 g64\ns3400 m3\ng0z1\ng1z-.1f24\ng1x10y0\nm5\n');
    expect(ir.header.dialects.some((d) => d.id === 'grbl-mill')).toBe(true);
    expect((metadata.raw as Record<string, string>)['cnc.machineClass']).toBe('mill');
  });

  it('LinuxCNC from an O-word subroutine (RS274NGC)', () => {
    const { ir } = cncParse('o100 sub\ng1 x10 f100\no100 endsub\no100 call\n');
    expect(ir.header.dialects.some((d) => d.id === 'linuxcnc')).toBe(true);
  });

  it('LinuxCNC M67 analog laser power is NOT mistaken for FDM extrusion', () => {
    const { detected } = cncParse('M3\nG1 X10 F600 S255\nM67 E0 Q128\nG1 X20\nM5\n');
    expect(detected).toBe(true); // recognized as non-extrusion, not rejected as FDM by the bare `E`
  });

  it('a commented-out spindle (`(M3)`) is not treated as tool-on', () => {
    // TinyG posts sometimes note `(M3)` in a comment with no active spindle — no tool-state to infer.
    const { detected } = cncParse('N1 T1M6\nN2 (M3)\nN3 G1 X10 Y0 F100\nN4 X20\n');
    expect(detected).toBe(false); // honest: no real spindle/laser command → not a confident CNC call
  });
});
