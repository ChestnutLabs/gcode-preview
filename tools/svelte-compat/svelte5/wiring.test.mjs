import { beforeEach, describe, it, expect, vi } from 'vitest';
import * as svelte from 'svelte';
import { registerWiring } from '../shared/wiring.mjs';

// Replace the controller factory with the recording stand-in for THIS file only (compat.test.mjs keeps the real one).
vi.mock('@chestnutlabs/gcode-preview-core', async (importOriginal) => {
  const spy = await import('../shared/spy-core.mjs');
  return spy.wrapCore(await importOriginal());
});

registerWiring({ describe, it, expect, beforeEach, svelte, expectedMajor: 5 });
