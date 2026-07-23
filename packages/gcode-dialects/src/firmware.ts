/**
 * Firmware-flavor adapters (DD-005 phase 4, issue #76): Klipper, Marlin,
 * RepRap-style. These COMPOSE with slicer adapters (amendment 1 — one winner
 * per kind, both run). In this phase they are detection + identity; their
 * command semantics (`EXCLUDE_OBJECT_*`, `M486` object exclusion, tool
 * metadata) land in phase 5 (#77) through the CommandEvent hook.
 */
import type { DialectAdapter } from './contracts.js';

export function klipper(): DialectAdapter {
  return {
    id: 'klipper',
    displayName: 'Klipper',
    kind: 'firmware',
    detect(input) {
      const m = /(EXCLUDE_OBJECT_DEFINE|SET_VELOCITY_LIMIT|ACTIVATE_EXTRUDER|SDCARD_PRINT_FILE)/.exec(input.headText);
      if (m !== null) {
        return { dialectId: 'klipper', kind: 'firmware', confidence: 'known', evidence: `command: ${m[1]}` };
      }
      if (/gcode_flavor\s*=\s*klipper/i.test(input.tailText)) {
        return { dialectId: 'klipper', kind: 'firmware', confidence: 'known', evidence: 'gcode_flavor = klipper' };
      }
      return null;
    }
  };
}

export function marlin(): DialectAdapter {
  return {
    id: 'marlin',
    displayName: 'Marlin',
    kind: 'firmware',
    detect(input) {
      if (/^;\s*FLAVOR\s*:\s*Marlin/im.test(input.headText)) {
        return { dialectId: 'marlin', kind: 'firmware', confidence: 'known', evidence: ';FLAVOR:Marlin header' };
      }
      if (/gcode_flavor\s*=\s*marlin/i.test(input.tailText)) {
        return { dialectId: 'marlin', kind: 'firmware', confidence: 'inferred', evidence: 'gcode_flavor = marlin' };
      }
      return null;
    }
  };
}

export function repRap(): DialectAdapter {
  return {
    id: 'reprap',
    displayName: 'RepRap-style',
    kind: 'firmware',
    detect(input) {
      if (/^;\s*FLAVOR\s*:\s*RepRap/im.test(input.headText)) {
        return { dialectId: 'reprap', kind: 'firmware', confidence: 'known', evidence: ';FLAVOR:RepRap header' };
      }
      if (/gcode_flavor\s*=\s*reprap/i.test(input.tailText)) {
        return { dialectId: 'reprap', kind: 'firmware', confidence: 'inferred', evidence: 'gcode_flavor = reprap' };
      }
      return null;
    }
  };
}
