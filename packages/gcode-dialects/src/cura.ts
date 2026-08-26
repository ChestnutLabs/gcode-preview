/**
 * Cura dialect adapter (DD-005 phase 4, issue #76).
 *
 * Annotates `;TYPE:` feature roles (Cura's UPPERCASE vocabulary) and picks up
 * the printer name where newer Cura versions expose it. Bed geometry is NOT
 * derivable from standard Cura output (its settings tail encodes machine size
 * inside a packed settings blob — out of v1 scope; matrix records `partial`).
 */
import { FeatureRole, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { AnnotationSink, DialectAdapter } from './contracts.js';
import { applyMarkerRanges, parseKeyValue, type RangeMarker } from './annotate.js';

/** Cura `;TYPE:` names → DD-001 FeatureRole. */
const TYPE_MAP: Record<string, number> = {
  'wall-outer': FeatureRole.ExternalPerimeter,
  'wall-inner': FeatureRole.Perimeter,
  skin: FeatureRole.SolidInfill,
  fill: FeatureRole.Infill,
  support: FeatureRole.Support,
  'support-interface': FeatureRole.Support,
  skirt: FeatureRole.Skirt,
  raft: FeatureRole.Raft,
  'prime-tower': FeatureRole.PrimeTower,
  bridge: FeatureRole.Bridge
};

interface CuraState {
  markers: RangeMarker[];
  printerName?: string;
}

const state = new WeakMap<AnnotationSink, CuraState>();

function stateFor(sink: AnnotationSink): CuraState {
  let s = state.get(sink);
  if (s === undefined) {
    s = { markers: [] };
    state.set(sink, s);
  }
  return s;
}

export function cura(): DialectAdapter {
  return {
    id: 'cura',
    displayName: 'Cura',
    kind: 'slicer',
    detect(input) {
      const m = /Generated with (Cura_SteamEngine[^\n\r]*)/.exec(input.headText);
      if (m !== null) {
        return { dialectId: 'cura', kind: 'slicer', confidence: 'known', evidence: `header: ${m[1].trim()}` };
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
      if (trimmed.startsWith('TARGET_MACHINE.NAME:')) {
        s.printerName = trimmed.slice('TARGET_MACHINE.NAME:'.length).trim();
        return;
      }
      // Cura print-time comment: `;TIME:<seconds>` (total; per-layer `;TIME_ELAPSED:` is ignored).
      if (trimmed.startsWith('TIME:')) {
        const sec = Number(trimmed.slice('TIME:'.length).trim());
        if (Number.isFinite(sec) && sec > 0) {
          sink.setPrintEstimate({ seconds: sec, source: { adapterId: 'cura', evidence: ';TIME:', srcByte } });
        }
        return;
      }
      // Cura filament comment: `;Filament used: 2.22m` (metres; multi-material → first value).
      if (trimmed.toLowerCase().startsWith('filament used:')) {
        const metres = parseFloat(trimmed.slice('filament used:'.length).trim());
        if (Number.isFinite(metres)) {
          sink.setFilamentUsage({
            lengthMm: metres * 1000,
            source: { adapterId: 'cura', evidence: ';Filament used:', srcByte }
          });
        }
        return;
      }
      const kv = parseKeyValue(comment);
      if (kv !== null && kv.key === 'target_machine') s.printerName = kv.value;
    },
    finalize(ir: ToolpathIR, sink) {
      const s = stateFor(sink);
      const applied = applyMarkerRanges(ir, s.markers, (a, b, v) => sink.setFeature(a, b, v));
      if (applied > 0) sink.upgradeCapability('featureRoles', 'known');
      if (s.printerName !== undefined) sink.setRaw('printer_model', s.printerName);
    }
  };
}
