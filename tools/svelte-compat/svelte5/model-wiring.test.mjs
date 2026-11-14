import { beforeEach, describe, it, expect, vi } from 'vitest';
import * as svelte from 'svelte';
import { registerModelWiring } from '../shared/model-wiring.mjs';

// Replace the model controller factory with the recording stand-in for THIS file only (compat.test.mjs keeps the real one).
vi.mock('@chestnutlabs/gcode-model-renderer', async (importOriginal) => {
  const spy = await import('../shared/spy-model.mjs');
  return spy.wrapModel(await importOriginal());
});

registerModelWiring({ describe, it, expect, beforeEach, svelte, expectedMajor: 5 });
