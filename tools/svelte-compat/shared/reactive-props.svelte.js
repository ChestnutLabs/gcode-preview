/* global $state */
// Svelte 5 only (compiled by compileSvelte as a rune module). Svelte 4 never calls this: the file loads
// as plain JS there and the `$state` rune is only evaluated inside the function body.
export function reactiveProps(initial) {
  const props = $state({ ...initial });
  return props;
}
