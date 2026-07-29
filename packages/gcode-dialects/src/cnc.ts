/**
 * Non-extrusion dialect families (DD-012 phase 3, #189): CNC mill / laser / plotter controllers.
 *
 * These adapters DETECT the controller and declare a **validation tier** (DD-012 D6). They do not
 * touch geometry — the parser already classifies `Cut`/`Travel`, the `toolPower` channel, and
 * canned-cycle geometry. A dialect adds provenance (controller, machine class, tool-power label) and,
 * critically, the honesty tier:
 *
 *   - **validated**  — confirmed on real hardware → non-extrusion claims stay `known`.
 *   - **experimental** — recognized but only spec/synthetic-tested → claims downgraded to `inferred`
 *     with a disclosure warning.
 *
 * Every launch dialect ships **experimental** (synthetic fixtures only). Flip `tier` to `'validated'`
 * for a given controller once its classification is confirmed on real hardware (DD-012 §8/§15) — the
 * one-line change marked at each dialect below.
 */
import type { Confidence, ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { AnnotationSink, DetectInput, DialectAdapter } from './contracts.js';

export type ValidationTier = 'validated' | 'experimental';
export type MachineClass = 'laser' | 'mill' | 'plotter';

/** Non-extrusion capability claims whose confidence the validation tier governs (DD-012 D6). */
const NON_EXTRUSION_CAPS = ['cutMoves', 'toolPower', 'cannedCycles'] as const;

interface CncSpec {
  id: string;
  displayName: string;
  machineClass: MachineClass;
  /** Presentation label for the `toolPower` (S) channel — "power" vs "RPM" is a label, not a channel (D4). */
  toolPowerLabel: string;
  tier: ValidationTier;
  detect: (input: DetectInput) => { evidence: string; confidence: Confidence } | null;
}

function makeCncDialect(spec: CncSpec): DialectAdapter {
  return {
    id: spec.id,
    displayName: spec.displayName,
    kind: 'firmware',
    detect(input) {
      const hit = spec.detect(input);
      return hit === null
        ? null
        : { dialectId: spec.id, kind: 'firmware', confidence: hit.confidence, evidence: hit.evidence };
    },
    finalize(ir: ToolpathIR, sink: AnnotationSink) {
      sink.setRaw('cnc.controller', spec.id);
      sink.setRaw('cnc.machineClass', spec.machineClass);
      sink.setRaw('cnc.validationTier', spec.tier);
      sink.setRaw('cnc.toolPowerLabel', spec.toolPowerLabel);
      // Validation tier (DD-012 D6): until hardware-validated, non-extrusion claims are `inferred`,
      // never `known`. Only downgrade claims the file actually made (present as 'known') — never
      // fabricate a claim for a feature the file did not use.
      if (spec.tier === 'experimental') {
        let downgraded = false;
        for (const cap of NON_EXTRUSION_CAPS) {
          if (ir.header.capabilities[cap] === 'known') {
            sink.upgradeCapability(cap, 'inferred');
            downgraded = true;
          }
        }
        if (downgraded) {
          sink.warn(
            'cnc-dialect-experimental',
            `${spec.displayName} support is EXPERIMENTAL (spec-derived, not yet hardware-validated); ` +
              `non-extrusion classification is reported as 'inferred'.`
          );
        }
      }
    }
  };
}

/** GRBL diode/CO₂ laser (LightBurn and GRBL-laser post-processors). */
export function grblLaser(): DialectAdapter {
  return makeCncDialect({
    id: 'grbl-laser',
    displayName: 'GRBL laser (LightBurn)',
    machineClass: 'laser',
    toolPowerLabel: 'laser power (S)',
    tier: 'experimental', // → 'validated' after a real GRBL-laser run (DD-012 §8)
    detect(input) {
      const t = input.headText;
      if (/LightBurn/i.test(t)) return { evidence: 'LightBurn header', confidence: 'known' };
      if (/\$32\s*=\s*1/.test(t)) return { evidence: 'GRBL $32=1 (laser mode)', confidence: 'inferred' };
      // M4 dynamic power + S with no extrusion is the GRBL-laser fingerprint.
      if (/^\s*M0?4\b/im.test(t) && /\bS\d/i.test(t) && !/\bE-?\d/i.test(t)) {
        return { evidence: 'M4 dynamic power + S, no extrusion', confidence: 'inferred' };
      }
      return null;
    }
  });
}

/** GRBL CNC milling (constant-power spindle). */
export function grblMill(): DialectAdapter {
  return makeCncDialect({
    id: 'grbl-mill',
    displayName: 'GRBL mill',
    machineClass: 'mill',
    toolPowerLabel: 'spindle RPM (S)',
    tier: 'experimental', // → 'validated' after a real GRBL-mill run (DD-012 §8)
    detect(input) {
      const t = input.headText;
      if (/LightBurn/i.test(t) || /\$32\s*=\s*1/.test(t)) return null; // that's a laser, not a mill
      // A GRBL banner / settings dump plus a constant-power spindle (M3) and no extrusion.
      if (/\bGrbl\b/.test(t) && /^\s*M0?3\b/im.test(t) && !/\bE-?\d/i.test(t)) {
        return { evidence: 'Grbl banner + M3 spindle, no extrusion', confidence: 'inferred' };
      }
      return null;
    }
  });
}

/** LinuxCNC / EMC milling. */
export function linuxCnc(): DialectAdapter {
  return makeCncDialect({
    id: 'linuxcnc',
    displayName: 'LinuxCNC mill',
    machineClass: 'mill',
    toolPowerLabel: 'spindle RPM (S)',
    tier: 'experimental', // → 'validated' after a real LinuxCNC run (DD-012 §8)
    detect(input) {
      const t = input.headText;
      if (/\b(LinuxCNC|EMC2?)\b/i.test(t)) return { evidence: 'LinuxCNC/EMC header', confidence: 'known' };
      // A `%` program envelope with a constant-power spindle (M3) and no extrusion is the common form.
      if (/^\s*%/m.test(t) && /^\s*M0?3\b/im.test(t) && !/\bE-?\d/i.test(t)) {
        return { evidence: '%-program envelope + M3 spindle, no extrusion', confidence: 'inferred' };
      }
      return null;
    }
  });
}
