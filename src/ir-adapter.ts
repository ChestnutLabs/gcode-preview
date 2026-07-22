/**
 * Compatibility adapter: inherited `Job` -> neutral `ToolpathIR` (DD-001 §9, issue #29).
 *
 * Maps the inherited xyz-tools structures (`Job` / `Layer` / `Path`, produced by
 * `Parser` + `Interpreter`) onto the DD-001 contract from `@chestnutlabs/toolpath-core`.
 *
 * The inherited model retains geometry, travel/extrusion kind, tool, and layer membership,
 * but NOT per-segment extrusion deltas, feed rates, source positions, feature roles, or
 * object identity. Per DD-001, the adapter reports those honestly as `unavailable`
 * (sentinel values + capability flags) instead of fabricating data. The native worker
 * parser (E2/DD-003) will populate them from the source directly.
 *
 * This module is a transitional seam: it lets golden IR fixtures (#28) and IR consumers
 * exist against real parse output before the inherited interpreter is replaced. It is
 * intentionally NOT exported from the public facade (`src/gcode-preview.ts`).
 */
import { MoveKind, ToolpathIRBuilder, type Confidence, type ToolpathIR, type Units } from '@chestnutlabs/toolpath-core';
import { Job } from './job';
import { PathType } from './path';

export interface JobToIROptions {
  /** Version string recorded in the IR header, e.g. the library version. */
  parserVersion?: string;
  /** Source identity/size when the caller knows it (byte length of the parsed text). */
  source?: { id?: string; byteLength?: number };
  /** Units of the parsed file. The inherited interpreter does not track G20/G21, so
   *  callers may override; defaults to mm with `inferred` confidence. */
  units?: Units;
  unitsSource?: Confidence;
}

/**
 * Convert an inherited {@link Job} into a canonical {@link ToolpathIR}.
 */
export function jobToToolpathIR(job: Job, opts: JobToIROptions = {}): ToolpathIR {
  const builder = new ToolpathIRBuilder({
    parserVersion: opts.parserVersion ?? 'xyz-tools-inherited',
    units: opts.units ?? 'mm',
    unitsSource: opts.unitsSource ?? 'inferred',
    source: opts.source
  });

  // Layer membership: the inherited LayersIndexer indexes the same Path objects.
  const layerOfPath = new Map<object, number>();
  job.layers.forEach((layer, index) => {
    for (const path of layer.paths) {
      layerOfPath.set(path, index);
    }
  });

  const layersKnown = job.layers.length > 0;
  let unindexedPaths = 0;
  let lastLayer = 0;

  for (const path of job.paths) {
    const vertices = path.vertices;
    if (vertices.length < 6) {
      continue; // a segment needs two points
    }

    const mapped = layerOfPath.get(path);
    if (mapped !== undefined) {
      lastLayer = mapped;
    } else {
      unindexedPaths++;
    }
    const layer = mapped ?? lastLayer;
    const kind = path.travelType === PathType.Extrusion ? MoveKind.Extrude : MoveKind.Travel;

    for (let i = 0; i + 5 < vertices.length; i += 3) {
      builder.addSegment({
        x0: vertices[i],
        y0: vertices[i + 1],
        z0: vertices[i + 2],
        x1: vertices[i + 3],
        y1: vertices[i + 4],
        z1: vertices[i + 5],
        // Not retained by the inherited structures — honest sentinels + capabilities below.
        e: undefined,
        feedrate: undefined,
        kind,
        tool: path.tool,
        layer,
        srcByte: 0
      });
    }
  }

  // Capabilities: what the inherited model can and cannot supply (DD-001 §4.5).
  builder.setCapability('geometry', 'known');
  builder.setCapability('moveKind', 'known'); // extrude/travel only; retract/wipe/seam not distinguished
  builder.setCapability('tools', 'known');
  builder.setCapability('layers', layersKnown ? (unindexedPaths > 0 ? 'inferred' : 'known') : 'unavailable');
  builder.setCapability('extrusionDelta', 'unavailable');
  builder.setCapability('feedrate', 'unavailable');
  builder.setCapability('sourcePositions', 'unavailable');
  builder.setCapability('featureRoles', 'unavailable');
  builder.setCapability('objects', 'unavailable');

  if (!layersKnown) {
    builder.addWarning({
      code: 'layers-unavailable',
      message: 'Inherited job has no planar layer index; all segments assigned to layer 0.',
      severity: 'warn'
    });
  }
  if (unindexedPaths > 0) {
    builder.addWarning({
      code: 'layers-partially-inferred',
      message: `${unindexedPaths} path(s) were not in the inherited layer index; layer carried forward.`,
      severity: 'info',
      count: unindexedPaths
    });
  }
  builder.addWarning({
    code: 'adapter-lossy-source',
    message:
      'IR produced via the inherited-structures adapter: extrusion deltas, feed rates and source positions are unavailable.',
    severity: 'info'
  });

  return builder.finalize();
}
