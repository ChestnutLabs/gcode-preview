// The only place the Svelte 4 / Svelte 5 component APIs differ. `svelte` is injected so it is the leg's own.
import { reactiveProps } from './reactive-props.svelte.js';

/**
 * Mount `Component` into `target` with the current major's API and return a uniform handle.
 *  - Svelte 4: `new C({ target, props })`, `$on`, `$set`, `$destroy`.
 *  - Svelte 5: `mount(C, { target, props, events })`, rune-backed props, `unmount`.
 */
export function mountComponent(svelte, Component, { target, props, events = {} }) {
  if (typeof svelte.mount === 'function') {
    const reactive = reactiveProps(props);
    const instance = svelte.mount(Component, { target, props: reactive, events });
    return {
      instance,
      setProps: (patch) => {
        Object.assign(reactive, patch);
        svelte.flushSync();
      },
      destroy: () => svelte.unmount(instance)
    };
  }
  const instance = new Component({ target, props });
  for (const [name, handler] of Object.entries(events)) instance.$on(name, handler);
  return {
    instance,
    setProps: (patch) => instance.$set(patch),
    destroy: () => instance.$destroy()
  };
}
