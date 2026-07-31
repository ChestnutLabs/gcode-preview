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

/**
 * Evidence markers scored from the head text (DD-012 phase 3, #189). Real controller output usually
 * carries NO generator header (a raw LaserGRBL/CAM job is just motion + M-codes), so process detection
 * scores behavioral markers, not just banners. Extrusion evidence short-circuits everything — an FDM
 * file is never a CNC/laser candidate. Comment bodies are stripped first so `(M3)` in a comment or a
 * `; LinuxCNC` note does not create a false marker (body-vs-metadata separation, per the corpus brief).
 */
interface Evidence {
  extrusion: boolean; // E on a motion line, or M82/M83 — an FDM signal
  m3: boolean; // spindle/laser on, constant (or generic tool-on)
  m4: boolean; // spindle CCW / dynamic-power laser
  power: boolean; // an S value on a motion line or a bare S line
  plunge: boolean; // a move to negative Z — cutting into material (a mill signal, not a laser one)
  lightBurn: boolean;
  laserMode: boolean; // GRBL `$32=1`
  linuxCnc: boolean; // explicit LinuxCNC/EMC header
  grblBanner: boolean; // a `Grbl` startup banner
  oWord: boolean; // RS274NGC O-word subroutine/flow (LinuxCNC family)
}

function scoreEvidence(head: string): Evidence {
  // Strip line comments (';…' and LinuxCNC/RS274 '(…)') so words inside them never score as markers.
  const code = head
    .split('\n')
    .map((l) => l.split(';')[0].replace(/\([^)]*\)/g, ''))
    .join('\n');
  const has = (re: RegExp): boolean => re.test(code);
  // G-code words run together without spaces (`G1M3`, `g1z-.1`), so a LEADING word-boundary fails.
  // Match the command by its number + a trailing NON-digit lookahead: `M0*3(?!\d)` matches `M3`/`M03`
  // (incl. mid-line `s3400 m3` and concatenated `G1M3`) but not `M30`/`M300`.
  return {
    // Extrusion = an `E` value on a G0–G3 MOTION line — NOT bare `E` (LinuxCNC laser uses `M67 E0 Q…`
    // for analog power, which must not be mistaken for FDM extrusion).
    extrusion: has(/G0*[0-3](?!\d)[^\n;]*E-?[.\d]/i) || has(/M8[23](?!\d)/i),
    m3: has(/M0*3(?!\d)/i),
    m4: has(/M0*4(?!\d)/i),
    power: has(/S\d/i),
    plunge: has(/Z\s*-\s*[.\d]/i), // negative Z incl. leading-dot decimals (`Z-.1`)
    lightBurn: /LightBurn/i.test(head), // header-only marker; keep the raw head (comments allowed)
    laserMode: /\$32\s*=\s*1/.test(code),
    linuxCnc: /\b(?:LinuxCNC|EMC2?)\b/i.test(head),
    grblBanner: /\bGrbl\s*[0-9]/i.test(head),
    oWord: has(/[oO][\s<]*\w*\s*(?:sub|call|if|while|do|repeat|return|endsub)\b/im)
  };
}

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
    // Hardware-validated 2026-07-29 (DD-012 D8; see docs/design/DD-012-hardware-validation-log.md):
    // a real GRBL/LightBurn laser run — 6161 moves incl. fill + offset-fill, full 0–1000 S power ramp —
    // confirmed machine-class detection, Cut-vs-rapid classification, and the toolPower channel against
    // the physical cut. Claims report `known`, not `inferred`. (Mill/LinuxCNC remain experimental.)
    tier: 'validated',
    detect(input) {
      const e = scoreEvidence(input.headText);
      if (e.extrusion || e.linuxCnc) return null;
      if (e.lightBurn) return { evidence: 'LightBurn header', confidence: 'known' };
      if (e.laserMode) return { evidence: 'GRBL $32=1 (laser mode)', confidence: 'inferred' };
      // No-header GRBL laser (the common LaserGRBL case): a tool-on command with power, and NO Z
      // plunging — lasers are planar; a mill would cut down into Z. Works whether the file uses M3
      // (constant power) or M4 (dynamic).
      if ((e.m3 || e.m4) && e.power && !e.plunge) {
        return { evidence: `${e.m4 ? 'M4 dynamic' : 'M3'} + S power, planar (no Z plunge)`, confidence: 'inferred' };
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
      const e = scoreEvidence(input.headText);
      if (e.extrusion || e.lightBurn || e.laserMode || e.linuxCnc) return null;
      // A spindle (M3) that plunges into the material (negative Z) with no extrusion — a milling
      // fingerprint that distinguishes it from a planar laser. GRBL/family-level, so a banner is a
      // stronger signal but not required (most CAM output has no banner).
      if (e.m3 && e.plunge) {
        const ev = e.grblBanner ? 'Grbl banner + M3 + Z-plunge' : 'M3 spindle + Z-plunge, no extrusion';
        return { evidence: ev, confidence: 'inferred' };
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
      const e = scoreEvidence(input.headText);
      if (e.extrusion) return null;
      if (e.linuxCnc) return { evidence: 'LinuxCNC/EMC header', confidence: 'known' };
      // RS274NGC O-word subroutines / flow control (`O100 sub`, `o<name> call`) are the LinuxCNC
      // family's distinguishing dialect feature — GRBL/TinyG do not have them.
      if (e.oWord) return { evidence: 'RS274NGC O-word subroutine/flow', confidence: 'inferred' };
      // A `%` program envelope with a spindle and no extrusion (also common in Fanuc-style output;
      // reported family-level, not as a specific controller).
      if (/^\s*%/m.test(input.headText) && e.m3) {
        return { evidence: '%-program envelope + M3 spindle, no extrusion', confidence: 'inferred' };
      }
      return null;
    }
  });
}
