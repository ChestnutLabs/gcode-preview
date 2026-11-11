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
 * The name between the prefix (ending at `start`) and the whitespace before the `id` token at
 * `idIndex`, found with index arithmetic only. (A lazy `(.+?)\s+id` scan re-fails at every
 * `printing object` repeat and is quadratic on a hostile line.) A trailing `unique` /
 * `unique label` filler and one enclosing quote pair are stripped.
 */
function nameBeforeId(trimmed: string, start: number, idIndex: number): string {
  let name = trimmed.slice(start, idIndex).trim();
  name = name.replace(/(?:^|\s)unique(?:\s+label)?$/i, '').trim();
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"') && !name.slice(1, -1).includes('"')) {
    name = name.slice(1, -1).trim();
  }
  return name;
}

/**
 * Match an object-start comment (the leading `; ` is already stripped) across all lineage formats,
 * returning the raw object id (stable per object) + optional name, or null.
 */
export function matchPrintingObjectStart(trimmed: string): { id: string; name?: string } | null {
  const prefix = /^(?:start\s+)?printing object\b[,:]?\s*/i.exec(trimmed);
  if (prefix === null) return null;
  // The id is the first whitespace-delimited `id:?<digits>` token, so `bracket(id2) id:7` takes 7 and
  // a name word like `idler` / `Identity` is not mistaken for it. Only when no such token exists
  // (e.g. `printing object,id:3`) fall back to a bare `\bid` match, which carries no name.
  const idm = /\sid:?\s*(\d+)/i.exec(trimmed);
  const bare = idm === null ? /\bid:?\s*(\d+)/i.exec(trimmed) : null;
  const found = idm ?? bare;
  if (found === null) return null;
  // Name: prefer an explicit `name:<…>` suffix (Bambu), else a quoted or bare name BEFORE the id
  // (OrcaSlicer / Anycubic), rejecting `unique` / `unique label` filler.
  let name = '';
  const suffix = /\bname:\s*(\S.*)$/i.exec(trimmed);
  if (suffix !== null) {
    name = suffix[1].trimEnd();
  } else if (idm !== null) {
    name = nameBeforeId(trimmed, prefix[0].length, idm.index);
  }
  return { id: found[1], name: name.length > 0 ? name : undefined };
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

  /** Try to consume a `; printing object` / `; stop printing object` comment; true if it was one. */
  handle(trimmed: string, srcByte: number): boolean {
    const start = matchPrintingObjectStart(trimmed);
    if (start !== null) {
      this.markStart(start.id, start.name, srcByte);
      return true;
    }
    if (/^stop printing object/i.test(trimmed)) {
      this.markEnd(srcByte);
      return true;
    }
    return false;
  }

  /**
   * Open (or reopen) an object range by its stable slicer id — for adapters whose membership uses a
   * non-comment marker convention (e.g. ideaMaker's `;PRINTING_ID:<n>` state). The id maps to a
   * sequential 1-based channel value, reused if seen before.
   */
  markStart(id: string, name: string | undefined, srcByte: number): void {
    let value = this.idToValue.get(id);
    if (value === undefined) {
      value = ++this.counter;
      this.idToValue.set(id, value);
      if (name !== undefined) this.names.set(value, name);
    }
    this.markers.push({ srcByte, value });
  }

  /** Close the current object range (back to "no object"). */
  markEnd(srcByte: number): void {
    this.markers.push({ srcByte, value: 0 });
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
