/*
 * Node module hook for tools/bundle-check.mjs (the runtime half of the DD-014 D4 check). Registered with
 * `node --import`, it makes resolving the renderer's MAIN entry throw. So importing a package, with nothing
 * called, proves that its startup path loads no three.js, whatever shape the import takes: an eager
 * import() inside an IIFE, a promise chain or an `if` block, or a template-literal specifier. The bundle
 * half can't see those, because any import() makes a lazy chunk.
 */
import { register } from 'node:module';

/** True for the renderer's main-entry module URL (not `/lite`, not any other dist file). */
export function isRendererMain(url) {
  return /gcode-renderer-three[\\/]dist[\\/]index\.js$/.test(decodeURIComponent(url));
}

export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  if (isRendererMain(result.url)) {
    throw new Error(`STARTUP-LOADS-RENDERER: ${specifier} from ${context.parentURL ?? '(entry)'}`);
  }
  return result;
}

// `--import` runs this file on the main thread: register this same module as the resolve hook.
if (!process.env.BUNDLE_CHECK_HOOK_LOADED) {
  process.env.BUNDLE_CHECK_HOOK_LOADED = '1';
  register(import.meta.url);
}
