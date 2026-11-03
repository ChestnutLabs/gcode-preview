import { describe, it, expect } from 'vitest';
import * as svelte from 'svelte';
import * as compiler from 'svelte/compiler';
import { registerCompat } from '../shared/compat.mjs';

// The major is a literal on purpose: the suite asserts the installed compiler AND runtime match it.
registerCompat({ describe, it, expect, svelte, compiler, expectedMajor: 5 });
