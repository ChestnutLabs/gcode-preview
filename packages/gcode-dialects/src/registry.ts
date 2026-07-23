/**
 * Dialect registry & run composition (DD-005 §4.1/§4.5, as amended).
 *
 * Explicit, tree-shakeable: `createDialectRunner(adapters)` — no global
 * side-effect registry. The returned factory matches the parser's structural
 * `DialectRunnerFactory` shape (the parser never imports this package;
 * worker entries compose the two).
 *
 * Composition (amendment 1): detection picks at most ONE adapter per `kind`
 * (highest confidence wins; ties select none for that kind — never a guess),
 * and all selected adapters run together. Adapter exceptions are contained:
 * a throwing adapter is disabled for the run with an `adapter-failed` warning.
 */
import type { DialectDetection, DialectMetadata, ToolpathIR, Warning } from '@chestnutlabs/toolpath-core';
import type { CommandEvent, DetectInput, DialectAdapter } from './contracts.js';
import { BufferedAnnotationSink } from './sink.js';

const CONFIDENCE_RANK: Record<string, number> = { known: 3, inferred: 2, approximated: 1, unavailable: 0 };

export interface DialectRunInput {
  /** 'auto' runs detection over all registered adapters; an array restricts by id. */
  selection: 'auto' | string[];
  config?: Record<string, unknown>;
  headText: string;
  tailText: string;
  containerMeta?: Record<string, string>;
}

export interface DialectRunResult {
  metadata?: DialectMetadata;
  warnings: Warning[];
}

export interface DialectRun {
  detections: DialectDetection[];
  onComment: (text: string, srcByte: number) => void;
  onCommand: (event: CommandEvent) => void;
  finalize(ir: ToolpathIR): DialectRunResult;
}

export interface DialectRunnerFactory {
  adapterIds: string[];
  createRun(input: DialectRunInput): DialectRun | null;
}

interface ActiveAdapter {
  adapter: DialectAdapter;
  detection: DialectDetection;
  sink: BufferedAnnotationSink;
  config: unknown;
  failed: boolean;
}

export function createDialectRunner(adapters: DialectAdapter[]): DialectRunnerFactory {
  return {
    adapterIds: adapters.map((a) => a.id),
    createRun(input: DialectRunInput): DialectRun | null {
      const pool = input.selection === 'auto' ? adapters : adapters.filter((a) => input.selection.includes(a.id));
      const detect: DetectInput = {
        headText: input.headText,
        tailText: input.tailText,
        containerMeta: input.containerMeta
      };

      // Detection: best confidence per kind; ambiguous ties select none for that kind.
      const byKind = new Map<string, { adapter: DialectAdapter; detection: DialectDetection }[]>();
      for (const adapter of pool) {
        let detection: DialectDetection | null = null;
        try {
          detection = adapter.detect(detect);
        } catch {
          detection = null;
        }
        if (detection === null) continue;
        const list = byKind.get(adapter.kind) ?? [];
        list.push({ adapter, detection });
        byKind.set(adapter.kind, list);
      }
      const active: ActiveAdapter[] = [];
      for (const list of byKind.values()) {
        list.sort((a, b) => CONFIDENCE_RANK[b.detection.confidence] - CONFIDENCE_RANK[a.detection.confidence]);
        const best = list[0];
        const tied =
          list.length > 1 &&
          CONFIDENCE_RANK[list[1].detection.confidence] === CONFIDENCE_RANK[best.detection.confidence];
        if (tied) continue; // never a guess presented as a decision
        active.push({
          adapter: best.adapter,
          detection: best.detection,
          sink: new BufferedAnnotationSink(best.adapter.id),
          config: input.config?.[best.adapter.id],
          failed: false
        });
      }
      if (active.length === 0) return null;

      const contain = (a: ActiveAdapter, fn: () => void): void => {
        if (a.failed) return;
        try {
          fn();
        } catch (err) {
          a.failed = true;
          a.sink.warn(
            'adapter-failed',
            `adapter '${a.adapter.id}' failed: ${err instanceof Error ? err.message : err}`
          );
        }
      };

      return {
        detections: active.map((a) => a.detection),
        onComment: (text, srcByte) => {
          for (const a of active) {
            if (a.adapter.onComment) contain(a, () => a.adapter.onComment?.(text, srcByte, a.sink, a.config));
          }
        },
        onCommand: (event) => {
          for (const a of active) {
            if (a.adapter.onCommand) contain(a, () => a.adapter.onCommand?.(event, a.sink, a.config));
          }
        },
        finalize(ir: ToolpathIR): DialectRunResult {
          const metadata: DialectMetadata = { dialects: active.map((a) => a.detection) };
          const conflicts: Warning[] = [];
          for (const a of active) {
            contain(a, () => a.adapter.finalize?.(ir, a.sink, a.config));
            a.sink.apply(ir, metadata, (code, message) =>
              conflicts.push({ code, message, severity: 'warn', count: 1 })
            );
          }
          for (const w of conflicts) ir.header.warnings.push(w);
          ir.header.dialects.push(
            ...active.map((a) => ({ id: a.detection.dialectId, confidence: a.detection.confidence }))
          );
          return { metadata, warnings: conflicts };
        }
      };
    }
  };
}
