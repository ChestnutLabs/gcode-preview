/**
 * Firmware-flavor adapters (DD-005 phases 4–5): Klipper, Marlin, RepRap-style.
 * They COMPOSE with slicer adapters (amendment 1 — one winner per kind, both
 * run). Phase 5 (#77) adds object-exclusion semantics through the CommandEvent
 * hook: `EXCLUDE_OBJECT_*` (Klipper, matched on rawLine — the inherited lexer
 * cannot tokenize extended commands) and `M486` (Marlin) populate the `object`
 * channel with EXACT segment indices (`CommandEvent.segIndex`).
 */
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { AnnotationSink, DialectAdapter } from './contracts.js';
import { applySegmentMarkers, type SegMarker } from './annotate.js';

interface ObjectState {
  markers: SegMarker[];
  /** NAME → 1-based object-channel value, first-seen order. */
  names: Map<string, number>;
}

const objState = new WeakMap<AnnotationSink, ObjectState>();

function objStateFor(sink: AnnotationSink): ObjectState {
  let s = objState.get(sink);
  if (s === undefined) {
    s = { markers: [], names: new Map() };
    objState.set(sink, s);
  }
  return s;
}

function objectValueFor(s: ObjectState, name: string): number {
  let v = s.names.get(name);
  if (v === undefined) {
    v = s.names.size + 1;
    s.names.set(name, v);
  }
  return v;
}

function finalizeObjects(ir: ToolpathIR, sink: AnnotationSink, s: ObjectState): void {
  const applied = applySegmentMarkers(s.markers, ir.segments.count, (a, b, v) => sink.setObject(a, b, v));
  if (applied > 0) {
    for (const [name, value] of s.names) sink.defineObject(value, name);
    sink.upgradeCapability('objects', 'known');
  }
}

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
    },
    onCommand(event, sink) {
      // Extended commands don't survive the inherited lexer — match the raw line.
      const m = /^\s*EXCLUDE_OBJECT_(DEFINE|START|END)\b(.*)$/i.exec(event.rawLine);
      if (m === null) return;
      const s = objStateFor(sink);
      const name = /NAME=([^\s]+)/i.exec(m[2])?.[1];
      const verb = m[1].toUpperCase();
      if (verb === 'DEFINE') {
        if (name !== undefined) objectValueFor(s, name); // registers identity/order
      } else if (verb === 'START') {
        if (name !== undefined) s.markers.push({ segIndex: event.segIndex, value: objectValueFor(s, name) });
      } else {
        s.markers.push({ segIndex: event.segIndex, value: 0 }); // END terminates
      }
    },
    finalize(ir, sink) {
      finalizeObjects(ir, sink, objStateFor(sink));
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
    },
    onCommand(event, sink) {
      // M486 S<idx> starts object idx (S-1 = none); M486 carries no names.
      if (event.gcode !== 'm486' || event.params.s === undefined) return;
      const s = objStateFor(sink);
      const idx = event.params.s;
      s.markers.push({ segIndex: event.segIndex, value: idx >= 0 ? objectValueFor(s, `object ${idx}`) : 0 });
    },
    finalize(ir, sink) {
      finalizeObjects(ir, sink, objStateFor(sink));
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
