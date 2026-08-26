/**
 * Shared parsing for slicer object-membership comments (`; printing object …` / `; stop printing
 * object …`), used by every Prusa/Orca/Bambu-lineage adapter. Grounded in the real marker formats
 * catalogued in RR-007 §5:
 *   - Bambu Studio: `start printing object, unique label id: 89` (name may follow as `name: …`)
 *   - OrcaSlicer:   `printing object <name> id:729618461984033312` (no "start"; id can exceed Uint32)
 *   - Anycubic / Prusa-lineage: `printing object "<name>" id:0 copy 0`
 *
 * The `object` channel is a `Uint32Array` (0 = none); raw slicer ids can exceed 2^32 and repeat per
 * layer, so each DISTINCT id is mapped to a sequential 1-based channel value, reused across
 * re-bracketing of the same object.
 */
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { AnnotationSink } from './contracts.js';
import { applyMarkerRanges, type RangeMarker } from './annotate.js';

/**
 * Match an object-start comment (the leading `; ` is already stripped) across all lineage formats,
 * returning the raw object id (stable per object) + optional name, or null.
 */
export function matchPrintingObjectStart(trimmed: string): { id: string; name?: string } | null {
  if (!/^(?:start\s+)?printing object\b/i.test(trimmed)) return null;
  const idm = /\bid:?\s*(\d+)/i.exec(trimmed);
  if (idm === null) return null;
  // Name: prefer an explicit `name:<…>` suffix (Bambu), else a quoted or bare name BEFORE the id
  // (OrcaSlicer / Anycubic), rejecting `unique` / `unique label` filler.
  let name = '';
  const suffix = /\bname:\s*(.+?)\s*$/i.exec(trimmed);
  if (suffix !== null) {
    name = suffix[1].trim();
  } else {
    const pre = /printing object[,:]?\s*(?:"([^"]*)"|(.+?))\s+(?:unique\s+(?:label\s+)?)?id:?/i.exec(trimmed);
    name = (pre?.[1] ?? pre?.[2] ?? '').trim();
    if (/^unique(\s+label)?$/i.test(name)) name = '';
  }
  return { id: idm[1], name: name.length > 0 ? name : undefined };
}

/**
 * Collects `; printing object` / `; stop printing object` markers during a parse and applies them as
 * object-channel ranges at finalize. One instance per parse (per adapter state).
 */
export class PrintingObjectTracker {
  private readonly markers: RangeMarker[] = [];
  private readonly idToValue = new Map<string, number>();
  private readonly names = new Map<number, string>();
  private counter = 0;

  /** Try to consume an object start/stop comment; returns true if it was one. */
  handle(trimmed: string, srcByte: number): boolean {
    const start = matchPrintingObjectStart(trimmed);
    if (start !== null) {
      let value = this.idToValue.get(start.id);
      if (value === undefined) {
        value = ++this.counter;
        this.idToValue.set(start.id, value);
        if (start.name !== undefined) this.names.set(value, start.name);
      }
      this.markers.push({ srcByte, value });
      return true;
    }
    if (/^stop printing object/i.test(trimmed)) {
      this.markers.push({ srcByte, value: 0 }); // range terminator
      return true;
    }
    return false;
  }

  /** Apply the collected object ranges + names; upgrades the `objects` capability if any resolved. */
  apply(ir: ToolpathIR, sink: AnnotationSink): number {
    const applied = applyMarkerRanges(ir, this.markers, (a, b, v) => sink.setObject(a, b, v));
    if (applied > 0) {
      for (const [value, name] of this.names) sink.defineObject(value, name);
      sink.upgradeCapability('objects', 'known');
    }
    return applied;
  }
}
