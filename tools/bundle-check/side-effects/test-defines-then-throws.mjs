// Test-only (tools/bundle-check.test.mjs): registers the tag, then throws. A bundle that does this must FAIL
// the side-effect check even though it printed the registration. Not in SIDE_EFFECT_IMPORTS.
customElements.define('gcode-preview', class extends HTMLElement {});
throw new Error('boom after define');
