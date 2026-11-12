// Test seam for the Svelte WIRING tests (same idea as the React/Vue spy-core.ts): `wrapCore` stands in for
// `createPreviewController`. It returns the real controller with every `controls` method replaced by a recorder
// (nothing reaches an engine), records top-level controller calls as `ctl.<name>(...)`, remembers the construction
// options, and lets a test fire a synthetic PreviewEvent at whatever the component subscribed with `onEvent`.
export const log = [];
export const listeners = [];
export const created = [];

export function ser(v) {
  return JSON.stringify(v, (_k, x) => {
    if (x === Number.POSITIVE_INFINITY) return 'Infinity';
    if (x === undefined) return 'undefined';
    if (x instanceof Uint8Array) return `Uint8Array(${x.length})`;
    if (typeof x === 'function') return 'fn';
    if (typeof x === 'object' && x !== null && 'nodeType' in x) return 'node';
    return x;
  });
}

export function reset() {
  log.length = 0;
  listeners.length = 0;
  created.length = 0;
}

export function fire(e) {
  for (const l of listeners.slice()) l(e);
}

export function wrapCore(orig) {
  return {
    ...orig,
    createPreviewController: (options) => {
      created.push({ options: options ?? {} });
      const c = orig.createPreviewController(options);
      const controls = new Proxy(c.controls, {
        get(target, key, receiver) {
          const v = Reflect.get(target, key, receiver);
          if (typeof v !== 'function') return v;
          return (...args) => {
            log.push(`${String(key)}(${args.map(ser).join(',')})`);
            return key === 'capture' ? Promise.resolve(null) : undefined;
          };
        }
      });
      const ctl = { ...c, controls };
      for (const [k, v] of Object.entries(c)) {
        if (typeof v !== 'function' || k === 'onEvent' || k === 'onStateChange' || k === 'getState') continue;
        ctl[k] = (...args) => {
          log.push(`ctl.${k}(${args.map(ser).join(',')})`);
          return v(...args);
        };
      }
      ctl.onEvent = (cb) => {
        listeners.push(cb);
        return c.onEvent(cb);
      };
      return ctl;
    }
  };
}
