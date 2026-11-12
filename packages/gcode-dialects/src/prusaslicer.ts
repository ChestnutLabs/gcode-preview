/**
 * PrusaSlicer dialect adapter (DD-005 phase 3, issue #75).
 *
 * Annotates: `;TYPE:` feature roles (→ `featureRoles: 'known'`), bed geometry
 * from the settings-block comments (`bed_shape`, `max_print_height`,
 * `printer_model` — confidence `inferred`, provenance recorded), and bounded
 * `; thumbnail begin/end` PNG thumbnails. Geometry is untouchable by contract.
 */
import { FeatureRole, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { AnnotationSink, DialectAdapter } from './contracts.js';
import {
  INVALID_VALUE_WARNING,
  ThumbnailCollector,
  applyMarkerRanges,
  applyWipeRanges,
  bedFromPoints,
  finiteNonNegative,
  finitePositive,
  matchWipeComment,
  parseAreaPoints,
  parseKeyValue,
  type RangeMarker,
  type WipeMark
} from './annotate.js';
import { PrintingObjectTracker } from './object-markers.js';

/** Prusa `;TYPE:` names → DD-001 FeatureRole (unknown names → Custom, honestly generic). */
const TYPE_MAP: Record<string, number> = {
  perimeter: FeatureRole.Perimeter,
  'external perimeter': FeatureRole.ExternalPerimeter,
  'overhang perimeter': FeatureRole.Perimeter,
  'internal infill': FeatureRole.Infill,
  'solid infill': FeatureRole.SolidInfill,
  'top solid infill': FeatureRole.SolidInfill,
  'bridge infill': FeatureRole.Bridge,
  'internal bridge infill': FeatureRole.Bridge,
  'support material': FeatureRole.Support,
  'support material interface': FeatureRole.Support,
  'skirt/brim': FeatureRole.Skirt,
  skirt: FeatureRole.Skirt,
  brim: FeatureRole.Brim,
  raft: FeatureRole.Raft,
  'wipe tower': FeatureRole.WipeTower,
  custom: FeatureRole.Custom
};

/**
 * Parse PrusaSlicer/Orca `<d>d <h>h <m>m <s>s` (any part optional) → seconds; null when zero/unparsed.
 * The slicers add the day field for prints of 24 h or more (`1d 2h 3m 4s`).
 */
export function parseHmsToSeconds(text: string, onInvalid?: () => void): number | null {
  // Whitespace is consumed once, after each token: adjacent optional `\s*` runs backtrack
  // polynomially on a long whitespace line.
  const m = /^\s*(?:(\d+)\s*d\s*)?(?:(\d+)\s*h\s*)?(?:(\d+)\s*m\s*)?(?:(\d+)\s*s\s*)?$/.exec(text);
  if (m === null) return null;
  const total = Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  if (total === 0) return null;
  // A digit run long enough to overflow is Infinity: drop it (and report it), never pass it on.
  if (!Number.isFinite(total)) {
    onInvalid?.();
    return null;
  }
  return total;
}

/**
 * Prusa-style filament totals (`; filament used [mm|cm3] = X`, `; total filament used [g] = X`) —
 * shared by PrusaSlicer and the Prusa-derived Orca/Bambu adapter (#183). Multi-word bracketed keys
 * that `parseKeyValue` can't tokenize. Returns true when the comment was a filament total.
 */
export function parseFilamentTotals(
  comment: string,
  srcByte: number,
  adapterId: string,
  sink: AnnotationSink
): boolean {
  const source = { adapterId, evidence: '; filament used comments', srcByte };
  // `[\d.]+` also matches `.` / `1.2.3` (NaN) and overflowing digit runs (Infinity): such a value is
  // dropped with a warning, but the comment still counts as a filament total (consumed).
  const read = (text: string, field: string): number | undefined => {
    const v = finiteNonNegative(Number(text)); // Number, not parseFloat: `1.2.3` is unreadable, not 1.2
    if (v === undefined)
      sink.warn(INVALID_VALUE_WARNING, `${field} value '${text.slice(0, 32)}' unreadable; dropped`, srcByte);
    return v;
  };
  let m = /^\s*filament used \[mm\]\s*=\s*([\d.]+)/i.exec(comment);
  if (m !== null) {
    const v = read(m[1], 'filament used [mm]');
    if (v !== undefined) sink.setFilamentUsage({ lengthMm: v, source });
    return true;
  }
  m = /^\s*filament used \[cm3\]\s*=\s*([\d.]+)/i.exec(comment);
  if (m !== null) {
    const v = read(m[1], 'filament used [cm3]');
    if (v !== undefined) sink.setFilamentUsage({ volumeCm3: v, source });
    return true;
  }
  m = /^\s*total filament used \[g\]\s*=\s*([\d.]+)/i.exec(comment);
  if (m !== null) {
    const v = read(m[1], 'total filament used [g]');
    if (v !== undefined) sink.setFilamentUsage({ weightG: v, source });
    return true;
  }
  return false;
}

interface PrusaState {
  markers: RangeMarker[];
  wipes: WipeMark[];
  objectTracker: PrintingObjectTracker;
  bedPoints: string | null;
  bedSrcByte?: number;
  heightMm?: number;
  printerModel?: string;
  thumbs: ThumbnailCollector;
}

const state = new WeakMap<AnnotationSink, PrusaState>();

function stateFor(sink: AnnotationSink): PrusaState {
  let s = state.get(sink);
  if (s === undefined) {
    s = {
      markers: [],
      wipes: [],
      objectTracker: new PrintingObjectTracker(),
      bedPoints: null,
      thumbs: new ThumbnailCollector()
    };
    state.set(sink, s);
  }
  return s;
}

export function prusaSlicer(): DialectAdapter {
  return {
    id: 'prusaslicer',
    displayName: 'PrusaSlicer',
    kind: 'slicer',
    detect(input) {
      const m = /generated by (PrusaSlicer[^\n\r]*)/.exec(input.headText);
      if (m !== null) {
        return { dialectId: 'prusaslicer', kind: 'slicer', confidence: 'known', evidence: `header: ${m[1].trim()}` };
      }
      // Settings live at the tail; a tail-only match still identifies the file.
      if (/;\s*generated by PrusaSlicer/.test(input.tailText) || /\n;\s*bed_shape\s*=/.test(input.tailText)) {
        return { dialectId: 'prusaslicer', kind: 'slicer', confidence: 'inferred', evidence: 'settings block (tail)' };
      }
      return null;
    },
    onComment(comment, srcByte, sink) {
      const s = stateFor(sink);
      if (comment.startsWith('TYPE:')) {
        const role = TYPE_MAP[comment.slice(5).trim().toLowerCase()];
        s.markers.push({ srcByte, value: role ?? FeatureRole.Custom });
        return;
      }
      // Object membership (`; printing object …` / `; stop printing object …`) when Label objects is
      // enabled — RR-007 §5.1 / DD-026 T1. The comment retains a leading space, so trim for the parser.
      if (s.objectTracker.handle(comment.trim(), srcByte)) return;
      const wipe = matchWipeComment(comment);
      if (wipe !== null) {
        s.wipes.push({ srcByte, open: wipe === 'start' });
        return;
      }
      if (s.thumbs.isActive || comment.trimStart().toLowerCase().startsWith('thumbnail')) {
        s.thumbs.feed(comment, sink);
        return;
      }
      // Filament totals + print time — multi-word keys `parseKeyValue` can't tokenize (#183).
      if (parseFilamentTotals(comment, srcByte, 'prusaslicer', sink)) return;
      const time = /^\s*estimated printing time \(normal mode\)\s*=\s*(\S.*)$/i.exec(comment.trimEnd());
      if (time !== null) {
        const sec = parseHmsToSeconds(time[1].trim(), () =>
          sink.warn(INVALID_VALUE_WARNING, 'estimated printing time out of range; dropped', srcByte)
        );
        if (sec !== null) {
          sink.setPrintEstimate({
            seconds: sec,
            mode: 'normal',
            source: { adapterId: 'prusaslicer', evidence: '; estimated printing time', srcByte }
          });
        }
        return;
      }
      const kv = parseKeyValue(comment);
      if (kv === null) return;
      if (kv.key === 'bed_shape') {
        s.bedPoints = kv.value;
        s.bedSrcByte = srcByte;
      } else if (kv.key === 'max_print_height') {
        const h = finitePositive(parseFloat(kv.value));
        if (h !== undefined) s.heightMm = h;
        else sink.warn(INVALID_VALUE_WARNING, 'max_print_height is not a positive number; dropped', srcByte);
      } else if (kv.key === 'printer_model') {
        s.printerModel = kv.value;
      }
    },
    finalize(ir: ToolpathIR, sink) {
      const s = stateFor(sink);
      const applied = applyMarkerRanges(ir, s.markers, (a, b, v) => sink.setFeature(a, b, v));
      if (applied > 0) sink.upgradeCapability('featureRoles', 'known');
      s.objectTracker.apply(ir, sink);
      if (applyWipeRanges(ir, s.wipes, sink) > 0) sink.upgradeCapability('wipeMoves', 'known');
      if (s.bedPoints !== null) {
        const points = parseAreaPoints(s.bedPoints);
        if (points !== null) {
          sink.setMachine(
            bedFromPoints(
              points,
              'prusaslicer',
              '; bed_shape settings comment',
              s.heightMm,
              s.printerModel,
              s.bedSrcByte
            )
          );
        } else {
          sink.warn('dialect-bed-unparsed', 'bed_shape comment present but unparseable');
        }
      }
      if (s.printerModel !== undefined) sink.setRaw('printer_model', s.printerModel);
    }
  };
}
