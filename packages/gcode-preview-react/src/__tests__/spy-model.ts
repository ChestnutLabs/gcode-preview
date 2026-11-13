/**
 * Test seam for the `/model` adapter WIRING tests (the model-side twin of spy-core.ts). `wrapModel` stands in
 * for `createModelPreviewController`: it returns the real controller with every `controls` method replaced by a
 * recorder (nothing reaches an engine, so a prop value only has to be what the adapter passes), records the
 * top-level controller calls as `ctl.<name>(...)`, remembers the construction options, and lets a test fire a
 * synthetic `ModelViewerEvent` at whatever the component subscribed with `onEvent`.
 */
import type * as Model from '@chestnutlabs/gcode-model-renderer';

export const log: string[] = [];
export const listeners: Array<(e: unknown) => void> = [];
export const created: Array<{ options: Model.ModelPreviewControllerOptions }> = [];

export function ser(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => {
    if (x === undefined) return 'undefined';
    if (x instanceof Uint8Array) return `Uint8Array(${x.length})`;
    if (typeof x === 'function') return 'fn';
    if (typeof x === 'object' && x !== null && 'nodeType' in x) return 'node';
    return x;
  });
}

export function reset(): void {
  log.length = 0;
  listeners.length = 0;
  created.length = 0;
}

export function fire(e: unknown): void {
  for (const l of listeners.slice()) l(e);
}

export function wrapModel(orig: typeof Model): typeof Model {
  return {
    ...orig,
    createModelPreviewController: (options?: Model.ModelPreviewControllerOptions) => {
      created.push({ options: options ?? {} });
      const c = orig.createModelPreviewController(options);
      const controls = new Proxy(c.controls, {
        get(target, key, receiver) {
          const v = Reflect.get(target, key, receiver) as unknown;
          if (typeof v !== 'function') return v;
          return (...args: unknown[]) => {
            log.push(`${String(key)}(${args.map(ser).join(',')})`);
            return key === 'capture' || key === 'setSource' ? Promise.resolve(null) : undefined;
          };
        }
      });
      const ctl: Record<string, unknown> = { ...c, controls };
      for (const [k, v] of Object.entries(c)) {
        if (typeof v !== 'function' || k === 'onEvent' || k === 'onStateChange' || k === 'getState') continue;
        ctl[k] = (...args: unknown[]) => {
          log.push(`ctl.${k}(${args.map(ser).join(',')})`);
          return (v as (...a: unknown[]) => unknown)(...args);
        };
      }
      ctl['onStateChange'] = (cb: (s: unknown) => void) => {
        const off = c.onStateChange(cb as never);
        return () => {
          log.push('offState()');
          off();
        };
      };
      ctl['onEvent'] = (cb: (e: unknown) => void) => {
        listeners.push(cb);
        return c.onEvent(cb as never);
      };
      return ctl as never;
    }
  };
}
