<script>
  // A parent template for the component conformance mount (#520). A parent's `on:` listeners are attached
  // before the child mounts, as in a real app. Mounting GcodePreview directly with `new C({ target })`
  // (Svelte 4) mounts it inside the constructor, before `$on` can attach, so mount-time events were lost.
  import GcodePreview from '../../../packages/gcode-preview-svelte/src/GcodePreview.svelte';

  export let props = {};
  export let handlers = {};
  let inner;
  /** The child's store/action handle (`preview`). */
  export function getPreview() {
    return inner.preview;
  }
  const forward = (name) => (e) => handlers[name]?.(e);
</script>

<GcodePreview
  {...props}
  bind:this={inner}
  on:ready={forward('ready')}
  on:buildcomplete={forward('buildcomplete')}
  on:disclosure={forward('disclosure')}
  on:rendererunsupported={forward('rendererunsupported')}
/>
