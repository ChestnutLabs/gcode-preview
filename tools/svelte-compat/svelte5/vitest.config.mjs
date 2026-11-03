import { defineConfig } from 'vitest/config';
import * as compiler from 'svelte/compiler';
import { legConfig } from '../shared/base-config.mjs';

export default defineConfig(legConfig({ compiler, major: 5 }));
