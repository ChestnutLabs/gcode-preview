/**
 * ideaMaker dialect adapter (DD-026 T1, RR-007 §5.6).
 *
 * Annotates `;TYPE:` feature roles (ideaMaker's UPPERCASE vocabulary) and object membership from the
 * `;PRINTING: <name>` + `;PRINTING_ID: <n>` STATE channel — `PRINTING_ID: -1` (with `PRINTING:
 * NON-OBJECT`) is housekeeping, `PRINTING_ID: <n≥0>` is model — → `object` channel + `objects:'known'`.
 * ideaMaker emits Marlin-flavoured motion; the marlin firmware adapter composes for firmware identity.
 */
import { FeatureRole, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { AnnotationSink, DialectAdapter } from './contracts.js';
import { applyMarkerRanges, type RangeMarker } from './annotate.js';
import { PrintingObjectTracker } from './object-markers.js';

/** ideaMaker `;TYPE:` names → DD-001 FeatureRole (unknown names → Custom, honestly generic). */
const TYPE_MAP: Record<string, number> = {
  'wall-outer': FeatureRole.ExternalPerimeter,
  'wall-inner': FeatureRole.Perimeter,
  fill: FeatureRole.Infill,
  'solid-fill': FeatureRole.SolidInfill,
  support: FeatureRole.Support,
  skirt: FeatureRole.Skirt,
  raft: FeatureRole.Brim,
  'wipe-tower': FeatureRole.Custom,
  bridge: FeatureRole.Bridge
};

interface IdeaMakerState {
  markers: RangeMarker[];
  objectTracker: PrintingObjectTracker;
  /** Name from the `;PRINTING:` line, consumed by the following `;PRINTING_ID:`. */
  pendingName?: string;
}

const state = new WeakMap<AnnotationSink, IdeaMakerState>();

function stateFor(sink: AnnotationSink): IdeaMakerState {
  let s = state.get(sink);
  if (s === undefined) {
    s = { markers: [], objectTracker: new PrintingObjectTracker() };
    state.set(sink, s);
  }
  return s;
}

export function ideaMaker(): DialectAdapter {
  return {
    id: 'ideamaker',
    displayName: 'ideaMaker',
    kind: 'slicer',
    detect(input) {
      const m = /Sliced by (ideaMaker[^\n\r]*)/.exec(input.headText);
      if (m !== null) {
        return { dialectId: 'ideamaker', kind: 'slicer', confidence: 'known', evidence: `header: ${m[1].trim()}` };
      }
      return null;
    },
    onComment(comment, srcByte, sink) {
      const s = stateFor(sink);
      const trimmed = comment.trim();
      if (trimmed.startsWith('TYPE:')) {
        const role = TYPE_MAP[trimmed.slice(5).trim().toLowerCase()];
        s.markers.push({ srcByte, value: role ?? FeatureRole.Custom });
        return;
      }
      // Object membership STATE channel. `;PRINTING:` names the object (or NON-OBJECT), then
      // `;PRINTING_ID:<n>` opens object n (n≥0) or closes to housekeeping (n<0).
      if (trimmed.startsWith('PRINTING_ID:')) {
        const id = trimmed.slice('PRINTING_ID:'.length).trim();
        if (/^\d+$/.test(id)) {
          s.objectTracker.markStart(id, s.pendingName, srcByte);
        } else {
          s.objectTracker.markEnd(srcByte); // `-1` (NON-OBJECT) or any non-numeric → close
        }
        s.pendingName = undefined;
        return;
      }
      if (trimmed.startsWith('PRINTING:')) {
        const name = trimmed.slice('PRINTING:'.length).trim();
        s.pendingName = /^non-object$/i.test(name) ? undefined : name;
        return;
      }
    },
    finalize(ir: ToolpathIR, sink) {
      const s = stateFor(sink);
      const applied = applyMarkerRanges(ir, s.markers, (a, b, v) => sink.setFeature(a, b, v));
      if (applied > 0) sink.upgradeCapability('featureRoles', 'known');
      s.objectTracker.apply(ir, sink);
    }
  };
}
