"""Base RED sweep of gcode-model-renderer consumer half. Usage: python red.py <worktree> <log> [ids...]
Each mutant: one source replacement (LF in this table; converted to CRLF when the file is CRLF), the whole
package vitest suite, restore from a fresh backup. INVALID (import/syntax) and HANG listed apart."""
import re, shutil, subprocess, sys, pathlib

WT = pathlib.Path(sys.argv[1])
LOG = pathlib.Path(sys.argv[2])
ONLY = set(sys.argv[3:])
PKG = 'packages/gcode-model-renderer'
F = {k: f'{PKG}/src/{v}' for k, v in dict(P='model-preview.ts', V='model-viewer.ts', S='render-model-still.ts',
                                          K='cache-key.ts', C='model-content.ts', R='scene-model.ts').items()}


def drop(line):
    return (line, '')


M = [
    ('CONTROL', 'P', "export const INITIAL_MODEL_STATE", "// red no-op control\nexport const INITIAL_MODEL_STATE"),
    # ---------------- model-preview.ts (controller) ----------------
    ('P01-ctor-theme', 'P', *drop("  if (options.theme !== undefined) resolveTheme(options.theme); // invalid options fail synchronously\n")),
    ('P02-ctor-fov', 'P', *drop("  if (options.cameraFov !== undefined) checkModelFov(options.cameraFov);\n")),
    ('P03-ctor-volume-null', 'P', "options.buildVolume ?? null;", "(options.buildVolume as BuildVolumeDef | null);"),
    ('P04-ctor-cage-default', 'P', "options.showVolumeCage ?? true;", "options.showVolumeCage ?? false;"),
    ('P05-ctor-pixelRatio', 'P', *drop("  if (options.pixelRatio !== undefined) checkModelPixelRatio(options.pixelRatio);\n")),
    ('P06-ctor-scope', 'P', *drop("  if (options.renderScope !== undefined) checkRenderScope(options.renderScope);\n")),
    ('P07-eo-loaders', 'P', *drop("    ...(options.loaders ? { loaders: options.loaders } : {}),\n")),
    ('P08-eo-background', 'P', *drop("    ...(currentBackground !== undefined ? { background: currentBackground } : {}),\n")),
    ('P09-eo-interaction', 'P', *drop("    ...(currentInteraction ? { interactionQuality: currentInteraction } : {}),\n")),
    ('P10-eo-cameraMode', 'P', *drop("    ...(options.cameraMode ? { cameraMode: options.cameraMode } : {}),\n")),
    ('P11-eo-limits', 'P', *drop("    ...(options.limits ? { limits: options.limits } : {}),\n")),
    ('P12-eo-palette', 'P', *drop("    ...(options.filamentPalette ? { filamentPalette: options.filamentPalette } : {}),\n")),
    ('P13-eo-scope', 'P', *drop("    ...(currentScope !== null ? { renderScope: currentScope } : {}),\n")),
    ('P14-eo-createControls', 'P', *drop("    ...(options.createControls ? { createControls: options.createControls } : {}),\n")),
    ('P15-eo-autoFrame', 'P', *drop("    ...(options.autoFrameOnResize !== undefined ? { autoFrameOnResize: options.autoFrameOnResize } : {}),\n")),
    ('P16-eo-volume', 'P', *drop("    ...(currentBuildVolume !== null ? { buildVolume: currentBuildVolume } : {}),\n")),
    ('P17-eo-theme', 'P', *drop("    ...(currentTheme !== undefined ? { theme: currentTheme } : {}),\n")),
    ('P18-eo-cage', 'P', *drop("    showVolumeCage: currentCage,\n")),
    ('P19-eo-fov', 'P', *drop("    ...(currentFov !== undefined ? { cameraFov: currentFov } : {}),\n")),
    ('P20-eo-pixelRatio', 'P', *drop("    ...(currentPixelRatio !== undefined ? { pixelRatio: currentPixelRatio } : {}),\n")),
    ('P21-progress-loading', 'P', "loading: p.stage !== 'ready' });", "loading: true });"),
    ('P22-progress-forward', 'P', *drop("      options.onProgress?.(p);\n")),
    ('P23-sync-placement-eq', 'P', "      p.placement === snapshot.placement &&\n", "      true &&\n"),
    ('P24-sync-offset-z', 'P', "o.z === p.placementOffset.z);", "true);"),
    ('P25-sync-always', 'P', "    if (!same) mutate({ placement", "    if (same || !same) mutate({ placement"),
    ('P26-ready-error-clear', 'P', "      ready: true,\n      error: null,\n", "      ready: true,\n"),
    ('P27-ready-plates-null', 'P', "      plates: info.plates ?? null,\n", "      plates: info.plates as never,\n"),
    ('P28-ready-hasPlates', 'P', "      hasPlates: info.plates !== undefined,", "      hasPlates: true,"),
    ('P29-ev-camera', 'P', *drop("          mutate({ cameraState: e.state });\n")),
    ('P30-ev-error-loading', 'P', "          mutate({ loading: false, error: { code: e.code, message: e.message } });",
     "          mutate({ loading: true, error: { code: e.code, message: e.message } });"),
    ('P31-ev-unsupported', 'P', "mutate({ rendererSupported: false, error:", "mutate({ rendererSupported: true, error:"),
    ('P32-ev-forward', 'P', "      emit(e);\n    });", "    });"),
    ('P33-size-guard', 'P', *drop("    if (typeof el.getBoundingClientRect !== 'function') return;\n")),
    ('P34-size-zero', 'P', "      if (w > 0 && h > 0) v.resize(w, h);", "      if (w > 0 || h > 0) v.resize(w, h);"),
    ('P35-size-initial', 'P', "    fit();\n    let ro", "    let ro"),
    ('P36-size-observe', 'P', *drop("      ro.observe(canvas as HTMLCanvasElement);\n")),
    ('P37-size-window-add', 'P', *drop("    if (hasWindow) window.addEventListener('resize', fit);\n")),
    ('P38-size-window-remove', 'P', *drop("      if (hasWindow) window.removeEventListener('resize', fit);\n")),
    ('P39-size-disconnect', 'P', *drop("      ro?.disconnect();\n")),
    ('P40-bind-same', 'P', "    if (disposed || canvas === boundCanvas) return;", "    if (disposed) return;"),
    ('P41-bind-disposed', 'P', "    if (disposed || canvas === boundCanvas) return;", "    if (canvas === boundCanvas) return;"),
    ('P42-bind-unsize', 'P', "    unsizeCanvas?.();\n    unsizeCanvas = null;\n    // Tear down", "    // Tear down"),
    ('P43-bind-dispose-old', 'P', *drop("      engine.dispose();\n")),
    ('P44-bind-replay-ops', 'P', *drop("    for (const op of pendingOps) op(v);\n")),
    ('P45-bind-clear-ops', 'P', "    for (const op of pendingOps) op(v);\n    pendingOps.length = 0;\n", "    for (const op of pendingOps) op(v);\n"),
    ('P46-bind-replay-source', 'P', "    if (lastSource !== null) {\n      mutate", "    if (false as boolean) {\n      mutate"),
    ('P47-bind-replay-loading', 'P', "      mutate({ loading: true, error: null });\n      v.setSource", "      v.setSource"),
    ('P48-bind-waiters-resolve', 'P', *drop("          for (const w of waiters) w.resolve(info);\n")),
    ('P49-bind-waiters-reject', 'P', *drop("          for (const w of waiters) w.reject(err);\n")),
    ('P50-src-disposed', 'P', *drop("      if (disposed) return Promise.reject(new Error('E_MODEL_PREVIEW_DISPOSED'));\n")),
    ('P51-src-remember', 'P', *drop("      lastSource = input;\n")),
    ('P52-src-loading', 'P', "      lastSource = input;\n      mutate({ loading: true, error: null });\n", "      lastSource = input;\n"),
    ('P53-view-queue', 'P', "      else pendingOps.push((v) => v.setView(view));", ""),
    ('P54-cam-fallback', 'P', "engine.getCameraState() : snapshot.cameraState;", "engine.getCameraState() : null;"),
    ('P55-camstate-queue', 'P', "      else pendingOps.push((v) => v.setCameraState(state));", ""),
    ('P56-bg-remember', 'P', *drop("      currentBackground = bg;\n")),
    ('P57-bg-engine', 'P', "      if (engine !== null) engine.setBackground(bg);", ""),
    ('P58-vol-remember', 'P', *drop("      currentBuildVolume = def;\n")),
    ('P59-vol-sync', 'P', "        engine.setBuildVolume(def);\n        syncPlacement(engine);\n", "        engine.setBuildVolume(def);\n"),
    ('P60-cage-remember', 'P', *drop("      currentCage = visible;\n")),
    ('P61-cage-engine', 'P', *drop("      if (engine !== null) engine.setBuildVolumeCage(visible);\n")),
    ('P62-theme-check', 'P', *drop("      resolveTheme(theme); // synchronous RangeError, before and after a canvas binds\n")),
    ('P63-theme-remember', 'P', *drop("      currentTheme = theme;\n")),
    ('P64-fov-check', 'P', *drop("      checkModelFov(deg);\n")),
    ('P65-fov-remember', 'P', *drop("      currentFov = deg;\n")),
    ('P66-pr-check', 'P', *drop("      checkModelPixelRatio(ratio);\n")),
    ('P67-pr-remember', 'P', *drop("      currentPixelRatio = ratio;\n")),
    ('P68-iq-remember', 'P', *drop("      currentInteraction = mode;\n")),
    ('P69-scope-check', 'P', *drop("      if (scope !== null) checkRenderScope(scope); // RangeError before anything is stored, bound or not\n")),
    ('P70-scope-remember', 'P', *drop("      currentScope = scope;\n")),
    ('P71-scope-sync', 'P', "        engine.setRenderScope(scope);\n        syncPlacement(engine);\n", "        engine.setRenderScope(scope);\n"),
    ('P72-frame-queue', 'P', "      else pendingOps.push((v) => v.frame());", ""),
    ('P73-resize-queue', 'P', "      else pendingOps.push((v) => v.resize(width, height));", ""),
    ('P74-capture-unbound', 'P', "Promise.reject(new CaptureUnsupportedError('no canvas bound'))", "Promise.reject(new Error('no canvas bound'))"),
    ('P75-dispose-guard', 'P', "    if (disposed) return;\n    disposed = true;", "    disposed = true;"),
    ('P76-dispose-unsize', 'P', "    disposed = true;\n    unsizeCanvas?.();\n", "    disposed = true;\n"),
    ('P77-dispose-ops', 'P', "    boundCanvas = null;\n    pendingOps.length = 0;\n", "    boundCanvas = null;\n"),
    ('P78-dispose-waiters', 'P', "      w.reject(new Error('E_MODEL_PREVIEW_DISPOSED'));", ""),
    ('P79-unsub-state', 'P', "      return () => stateListeners.delete(cb);", "      return () => false;"),
    ('P80-unsub-event', 'P', "      return () => eventListeners.delete(cb);", "      return () => false;"),
    ('P81-dispose-engine', 'P', "    engine?.dispose();\n    engine = null;\n    boundCanvas = null;", "    engine = null;\n    boundCanvas = null;"),
    # ---------------- model-viewer.ts (engine) ----------------
    ('V01-bg-default', 'V', "options.background ?? 'transparent';", "options.background ?? '#ffffff';"),
    ('V02-ctor-theme', 'V', *drop("  if (theme !== undefined) resolveTheme(theme);\n")),
    ('V03-ctor-fov', 'V', *drop("  if (options.cameraFov !== undefined) checkModelFov(options.cameraFov);\n")),
    ('V04-ctor-pr', 'V', *drop("  if (options.pixelRatio !== undefined) checkModelPixelRatio(options.pixelRatio);\n")),
    ('V05-ctor-scope', 'V', *drop("  if (options.renderScope !== undefined) checkRenderScope(options.renderScope);\n")),
    ('V06-pending-hold', 'V', "      pending.push(e);\n      return;", "      return;"),
    ('V07-cage-default', 'V', "options.showVolumeCage ?? true);", "options.showVolumeCage ?? false);"),
    ('V08-scoped', 'V', ": currentScope ? applyRenderScope(currentScene, currentScope) : currentScene;", ": currentScene;"),
    ('V09-autoframe-default', 'V', "options.autoFrameOnResize ?? true;", "options.autoFrameOnResize ?? false;"),
    ('V10-fit-keepdir', 'V', "keepDirection ? { direction: stage.viewDirection() } : {}", "{}"),
    ('V11-cameraMode-default', 'V', "options.cameraMode ?? 'perspective',", "options.cameraMode ?? 'orthographic',"),
    ('V12-iq-default', 'V', "options.interactionQuality ?? 'auto',", "options.interactionQuality ?? 'off',"),
    ('V13-stage-pr', 'V', *drop("      ...(options.pixelRatio !== undefined ? { pixelRatio: options.pixelRatio } : {}),\n")),
    ('V14-interaction-start', 'V', "      onInteractionStart: () => {\n        autoFraming = false;\n", "      onInteractionStart: () => {\n"),
    ('V15-restore-content', 'V', "          content.setScene(shown);\n          replate(); // the plate's", "          replate(); // the plate's"),
    ('V16-restore-replate', 'V', "          replate(); // the plate's textures/geometry are GPU resources too: rebuild, freeing the old\n", ""),
    ('V17-restore-fit', 'V', "freeing the old\n          if (autoFraming) fit(true);\n", "freeing the old\n"),
    ('V18-restore-emit', 'V', *drop("        emit({ type: 'context-restored' });\n")),
    ('V19-unsupported-msg', 'V', "      message: err instanceof Error ? err.message : String(err)\n    });\n  }\n  if (stage",
     "      message: String(err)\n    });\n  }\n  if (stage"),
    ('V20-ctor-setFov', 'V', *drop("  if (stage !== null && options.cameraFov !== undefined) stage.setFov(options.cameraFov);\n")),
    ('V21-progress-current', 'V', "onProgress !== undefined && my === sourceToken && !disposed)", "onProgress !== undefined && !disposed)"),
    ('V22-progress-disposed', 'V', "onProgress !== undefined && my === sourceToken && !disposed)", "onProgress !== undefined && my === sourceToken)"),
    ('V23-unavail-msg', 'V', "disposed ? 'model viewer is disposed' : 'WebGL renderer unavailable'", "'WebGL renderer unavailable'"),
    ('V24-unavail-emit', 'V', *drop("      emit({ type: 'error', code: 'E_MODEL_RENDERER_UNAVAILABLE', message });\n")),
    ('V25-progress-parsing', 'V', *drop("      progress({ stage: 'parsing', indeterminate: true });\n")),
    ('V26-info-plates', 'V', *drop("      if (parsed.plates !== undefined) info.plates = parsed.plates;\n")),
    ('V27-superseded-token', 'V', "      if (my !== sourceToken || disposed || stage === null) return info;", "      if (disposed || stage === null) return info;"),
    ('V28-superseded-disposed', 'V', "      if (my !== sourceToken || disposed || stage === null) return info;", "      if (my !== sourceToken || stage === null) return info;"),
    ('V29-progress-build0', 'V', *drop("      progress({ stage: 'building-geometry', done: 0, total, unit: 'objects' });\n")),
    ('V30-progress-perobj', 'V', "      content.setScene(shown, (done) => progress({ stage: 'building-geometry', done, total, unit: 'objects' }));",
     "      content.setScene(shown);"),
    ('V31-src-replate', 'V', "      replate();\n      info.placement", "      info.placement"),
    ('V32-info-placement', 'V', *drop("      info.placement = plate.getPlacement().placement;\n")),
    ('V33-src-autoframe', 'V', "      autoFraming = true;\n      fit();\n      progress({ stage: 'ready' });", "      fit();\n      progress({ stage: 'ready' });"),
    ('V34-src-fit', 'V', "      autoFraming = true;\n      fit();\n      progress({ stage: 'ready' });", "      autoFraming = true;\n      progress({ stage: 'ready' });"),
    ('V35-progress-ready', 'V', *drop("      progress({ stage: 'ready' });\n")),
    ('V36-ready-emit', 'V', *drop("      emit({ type: 'ready', info });\n")),
    ('V37-err-code', 'V', "err instanceof ModelParseError ? err.code : 'E_MODEL_PARSE';", "'E_MODEL_PARSE';"),
    ('V38-err-current', 'V', "      if (my === sourceToken && !disposed) emit({ type: 'error', code, message });",
     "      if (!disposed) emit({ type: 'error', code, message });"),
    ('V39-view-fit', 'V', "across resizes).\n      if (autoFraming) fit(true);\n", "across resizes).\n"),
    ('V40-camstate-userown', 'V', "      autoFraming = false;\n      stage?.setCameraState(state);", "      stage?.setCameraState(state);"),
    ('V41-bg-render', 'V', "      backdrop = applyModelBackground(scene, theme, fallbackBackground, backdrop);\n      stage?.render();\n    },\n    setBuildVolume",
     "      backdrop = applyModelBackground(scene, theme, fallbackBackground, backdrop);\n    },\n    setBuildVolume"),
    ('V42-vol-replate', 'V', "      plate.setBuildVolume(def);\n      replate();\n", "      plate.setBuildVolume(def);\n"),
    ('V43-vol-fit', 'V', "re-fit to them.\n      if (autoFraming) fit(true);\n", "re-fit to them.\n"),
    ('V44-cage-render', 'V', "      plate.setCageVisible(visible);\n      stage?.render();\n", "      plate.setCageVisible(visible);\n"),
    ('V45-theme-check', 'V', *drop("      resolveTheme(next); // throws before anything changes\n")),
    ('V46-theme-plate', 'V', *drop("      plate.setTheme(next);\n")),
    ('V47-theme-backdrop', 'V', "      plate.setTheme(next);\n      backdrop = applyModelBackground(scene, theme, fallbackBackground, backdrop);\n",
     "      plate.setTheme(next);\n"),
    ('V48-fov-check', 'V', "      checkModelFov(fov);\n      stage?.setFov(fov);", "      stage?.setFov(fov);"),
    ('V49-fov-fit', 'V', "auto-framing stays on.\n      if (autoFraming) fit(true);\n", "auto-framing stays on.\n"),
    ('V50-pr-check', 'V', "      checkModelPixelRatio(ratio);\n      stage?.setPixelRatio", "      stage?.setPixelRatio"),
    ('V51-resize-zero', 'V', "autoFraming && width > 0 && height > 0) fit(true);", "autoFraming) fit(true);"),
    ('V52-resize-opt', 'V', "      if (autoFrameOnResize && autoFraming &&", "      if (autoFraming &&"),
    ('V53-resize-userowned', 'V', "      if (autoFrameOnResize && autoFraming &&", "      if (autoFrameOnResize &&"),
    ('V54-frame-autoframe', 'V', "    frame() {\n      autoFraming = true;\n", "    frame() {\n"),
    ('V55-scope-check', 'V', *drop("      if (scope !== null) checkRenderScope(scope); // throws before anything changes\n")),
    ('V56-scope-autoframe', 'V', "      replate();\n      autoFraming = true;\n      fit();\n    },", "      replate();\n      fit();\n    },"),
    ('V57-scope-replate', 'V', "      content.setScene(shown);\n      replate();\n      autoFraming = true;", "      content.setScene(shown);\n      autoFraming = true;"),
    ('V58-capture-hide', 'V', "opts?.includeBuildVolume === false ? () => plate.hide() : undefined", "undefined"),
    ('V59-capture-unsupported', 'V', "        throw new CaptureUnsupportedError('model viewer renderer unavailable');", "        throw new Error('model viewer renderer unavailable');"),
    ('V60-onEvent-flush', 'V', "        for (const e of flushed) cb(e);\n", ""),
    ('V61-dispose-guard', 'V', "      if (disposed) return;\n      disposed = true;\n      stage?.dispose();", "      disposed = true;\n      stage?.dispose();"),
    ('V62-dispose-clear', 'V', *drop("      listeners.clear();\n")),
    ('V63-dispose-backdrop', 'V', *drop("      backdrop?.dispose();\n")),
    ('V64-dispose-plate', 'V', *drop("      plate.dispose();\n")),
    ('V65-dispose-content', 'V', *drop("      content.dispose();\n")),
    ('V66-dispose-stage', 'V', "      disposed = true;\n      stage?.dispose();\n", "      disposed = true;\n"),
    # ---------------- render-model-still.ts ----------------
    ('S01-finite', 'S', *drop("    assertFiniteBounds(source.bounds, 'ModelScene');\n")),
    ('S02-key-plate', 'S', "return { p: sel.plateId };", "return { p: 0 };"),
    ('S03-key-sort', 'S', "return { o: [...sel.objectIds].sort() };", "return { o: [...sel.objectIds] };"),
    ('S04-key-plate-undef', 'S', "  if (sel.plateId !== undefined) return { p: sel.plateId };", "  if ('plateId' in sel) return { p: sel.plateId };"),
    ('S05-key-fn', 'S', "return { fn: ++scopeKeyCounter };", "return { fn: 0 };"),
    ('S06-key-tex', 'S', "return { tex: ++scopeKeyCounter };", "return { tex: 0 };"),
    ('S07-key-theme', 'S', "  return theme;\n}", "  return undefined;\n}"),
    ('S08-width', 'S', "options.width ?? canvas.width;", "options.width ?? 1;"),
    ('S09-height', 'S', "options.height ?? canvas.height;", "options.height ?? 1;"),
    ('S10-bg-default', 'S', "options.background ?? 'transparent';", "options.background ?? '#ffffff';"),
    ('S11-fov-check', 'S', "  if (options.cameraFov !== undefined) checkModelFov(options.cameraFov); // before any work", "  // before any work"),
    ('S12-scope-check', 'S', *drop("  if (options.renderScope !== undefined) checkRenderScope(options.renderScope);\n")),
    ('S13-scope-apply', 'S', "options.renderScope ? applyRenderScope(fullScene, options.renderScope) : fullScene;", "fullScene;"),
    ('S14-r-volume', 'S', *drop("    ...(options.buildVolume ? { buildVolume: options.buildVolume } : {}),\n")),
    ('S15-r-theme', 'S', *drop("    ...(options.theme ? { theme: options.theme } : {}),\n")),
    ('S16-r-fov', 'S', *drop("    ...(options.cameraFov !== undefined ? { cameraFov: options.cameraFov } : {}),\n")),
    ('S17-r-preserve', 'S', "    preserveDrawingBuffer: true\n", "    preserveDrawingBuffer: false\n"),
    ('S18-resize', 'S', *drop("    renderer.resize(width, height);\n")),
    ('S19-setScene-full', 'S', "{ full: fullScene, scope: options.renderScope ?? null }", "{ full: scene, scope: null }"),
    ('S20-render', 'S', "    renderer.render();\n\n", "\n"),
    ('S21-k-width', 'S', "      width,\n      height,\n      background,\n      view,", "      height,\n      background,\n      view,"),
    ('S22-k-height', 'S', "      width,\n      height,\n      background,\n      view,", "      width,\n      background,\n      view,"),
    ('S23-k-bg', 'S', "      height,\n      background,\n      view,", "      height,\n      view,"),
    ('S24-k-view', 'S', "      background,\n      view,\n      palette", "      background,\n      palette"),
    ('S25-k-palette', 'S', *drop("      palette: options.filamentPalette,\n")),
    ('S26-k-scope', 'S', *drop("      scope: scopeCacheKey(options.renderScope),\n")),
    ('S27-k-plate', 'S', *drop("      plate: options.buildVolume ?? undefined,\n")),
    ('S28-k-theme', 'S', *drop("      theme: themeCacheKey(options.theme),\n")),
    ('S29-k-fov', 'S', "      theme: themeCacheKey(options.theme),\n      fov: options.cameraFov\n", "      theme: themeCacheKey(options.theme)\n"),
    ('S30-k-env', 'S', "computeCacheKey(sourceBytes, optionsJson, options.envId);", "computeCacheKey(sourceBytes, optionsJson);"),
    ('S31-plates', 'S', *drop("      ...(scene.plates !== undefined ? { plates: scene.plates } : {}),\n")),
    ('S32-dispose', 'S', "  } finally {\n    renderer.dispose();\n  }", "  } finally {\n  }"),
    ('S33-instanced', 'S', "      instancedCount: sceneInstanceCount(scene),", "      instancedCount: scene.objects.length,"),
    ('S34-count-scoped', 'S', "      objectCount: scene.objects.length,", "      objectCount: fullScene.objects.length,"),
    ('S35-scene-bytes', 'S', "sourceBytes: new TextEncoder().encode(sceneFingerprint(source)) };", "sourceBytes: new Uint8Array(0) };"),
    # ---------------- cache-key.ts ----------------
    ('K01-bytes-xor', 'K', "    h ^= bytes[i];\n", "    h ^= bytes[i] & 0x7f;\n"),
    ('K02-str-lo', 'K', "    h ^= s.charCodeAt(i) & 0xff;\n", "    h ^= s.charCodeAt(i) & 0x7f;\n"),
    ('K03-str-hi', 'K', "    h ^= (s.charCodeAt(i) >> 8) & 0xff;\n    h = Math.imul(h, FNV_PRIME);\n", ""),
    ('K04-typed-offset', 'K', "new Uint8Array(a.buffer, a.byteOffset, a.byteLength)", "new Uint8Array(a.buffer)"),
    ('K05-typed-null', 'K', "  if (a === undefined) return null;", "  if (a === undefined) return '00000000';"),
    ('K06-fp-id', 'K', *drop("      i: o.id,\n")),
    ('K07-fp-name', 'K', *drop("      n: o.name,\n")),
    ('K08-fp-pos', 'K', *drop("      p: typedHash(o.geometry.positions),\n")),
    ('K09-fp-normals', 'K', *drop("      nm: typedHash(o.geometry.normals),\n")),
    ('K10-fp-indices', 'K', *drop("      ix: typedHash(o.geometry.indices),\n")),
    ('K11-fp-colors', 'K', *drop("      c: typedHash(o.geometry.colors),\n")),
    ('K12-fp-transform', 'K', *drop("      t: o.transform,\n")),
    ('K13-fp-instances', 'K', *drop("      in: o.instances,\n")),
    ('K14-fp-plateIds', 'K', *drop("      pl: o.plateIds,\n")),
    ('K15-fp-material', 'K', "      pl: o.plateIds,\n      m: o.material\n", "      pl: o.plateIds\n"),
    ('K16-fp-bounds', 'K', *drop("    b: scene.bounds,\n")),
    ('K17-fp-caps', 'K', *drop("    c: scene.capabilities,\n")),
    ('K18-fp-plates', 'K', *drop("    pl: scene.plates,\n")),
    ('K19-fp-source', 'K', "    pl: scene.plates,\n    s: scene.source\n", "    pl: scene.plates\n"),
    ('K20-hex-pad', 'K', "(n >>> 0).toString(16).padStart(8, '0');", "(n >>> 0).toString(16);"),
    ('K21-env-default', 'K', "return `three${REVISION}`;", "return 'three';"),
    ('K22-chain-opt', 'K', "fnv1aString(optionsJson, src);", "fnv1aString(optionsJson);"),
    ('K23-chain-env', 'K', "fnv1aString(envId, opt);", "fnv1aString(envId);"),
    ('K24-prefix', 'K', "return `mr1_${", "return `mr2_${"),
    # ---------------- model-content.ts ----------------
    ('C01-root-rot', 'C', "    this.root.rotation.x = -Math.PI / 2;\n", ""),
    ('C02-onObject', 'C', *drop("      onObject?.(i + 1);\n")),
    ('C03-radius-min', 'C', "Math.max(1e-3, center.distanceTo(", "Math.max(0, center.distanceTo("),
    ('C04-scene-min', 'C', "new Vector3(minX, minZ, -maxY);", "new Vector3(minX, minY, -maxZ);"),
    ('C05-scene-max', 'C', "new Vector3(maxX, maxZ, -minY);", "new Vector3(maxX, maxY, -minZ);"),
    ('C06-offset-reset', 'C', "    if (offset === null) this.root.position.set(0, 0, 0);\n    else ", "    if (offset !== null) "),
    ('C07-offset-map', 'C', "this.root.position.set(offset.x, offset.z, -offset.y);", "this.root.position.set(offset.x, offset.y, offset.z);"),
    ('C08-framing-offset', 'C', "    if (f === null || o === null) return f;", "    return f;"),
    ('C09-framing-ds', 'C', "const ds = new Vector3(o.x, o.z, -o.y);", "const ds = new Vector3(o.x, o.y, o.z);"),
    ('C10-indices', 'C', *drop("    if (obj.geometry.indices !== undefined) g.setIndex(new BufferAttribute(obj.geometry.indices, 1));\n")),
    ('C11-normals-compute', 'C', "    else g.computeVertexNormals();\n", ""),
    ('C12-vertexColors', 'C', *drop("      mat.vertexColors = true;\n")),
    ('C13-material-color', 'C', *drop("      mat.color.setRGB(color[0], color[1], color[2]);\n")),
    ('C14-instanced-gt1', 'C', "obj.instances.length > 1)", "obj.instances.length > 0)"),
    ('C15-instance-update', 'C', *drop("      inst.instanceMatrix.needsUpdate = true;\n")),
    ('C16-mesh-autoupdate', 'C', *drop("    mesh.matrixAutoUpdate = false;\n")),
    ('C17-mesh-matrix', 'C', *drop("    mesh.matrix.fromArray(obj.transform as number[]);\n")),
    ('C18-clear-dispose', 'C', *drop("    for (const d of this.disposables) d.dispose();\n")),
    ('C19-clear-root', 'C', *drop("    this.root.clear();\n")),
    ('C20-neutral', 'C', "obj.material?.color ?? NEUTRAL_COLOR;", "obj.material?.color ?? ([1, 1, 1] as RGB);"),
    # ---------------- scene-model.ts (scope) ----------------
    ('R01-scope-object', 'R', "  if (typeof s !== 'object' || s === null) throw new RangeError('renderScope must be an object');\n", ""),
    ('R02-scope-undef-key', 'R', ".filter((k) => s[k] !== undefined);", ".filter((k) => k in s);"),
    ('R03-scope-exactly-one', 'R', "  if (keys.length !== 1) {", "  if (keys.length > 1) {"),
    ('R04-scope-ids-array', 'R', "if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) {", "if (!Array.isArray(ids)) {"),
    ('R05-scope-plate-int', 'R', "if (!Number.isInteger(s.plateId))", "if (typeof s.plateId !== 'number')"),
    ('R06-scope-fn', 'R', "  } else if (typeof s.instanceFilter !== 'function') {", "  } else if (false as boolean) {"),
    ('R07-apply-check', 'R', "  checkRenderScope(scope);\n  // Same rule", "  // Same rule"),
    ('R08-match-plate-idx', 'R', "o.plateIds?.[i] === sel.plateId;", "o.plateIds?.[0] === sel.plateId;"),
    ('R09-match-order', 'R', "    if (sel.objectIds !== undefined) return sel.objectIds.includes(o.id);\n", ""),
    ('R10-kept-instances', 'R', "keptPlacements.length > 1 ? keptPlacements.slice() : undefined,", "keptPlacements.slice(),"),
    ('R11-kept-plateIds', 'R', "o.plateIds ? kept.map((i) => o.plateIds![i]) : undefined", "o.plateIds"),
    ('R12-empty-bounds', 'R', "bounds.min[0] > bounds.max[0] ? { min: [0, 0, 0], max: [0, 0, 0] } : bounds;", "bounds;"),
    ('R13-empty-geom', 'R', "  if (lmin[0] > lmax[0]) return; // empty geometry\n", ""),
    ('R14-mat-translate', 'R', "m[0] * x + m[4] * y + m[8] * z + m[12],", "m[0] * x + m[4] * y + m[8] * z,"),
    ('R15-count-default', 'R', "n += o.instances?.length ?? 1;", "n += o.instances?.length ?? 0;"),
    ('R16-kept-transform', 'R', "      transform: keptPlacements[0],\n", "      transform: o.transform,\n"),
]


def run():
    cmd = 'timeout 300 npx vitest run --maxWorkers=8'
    r = subprocess.run(['bash', '-lc', cmd], cwd=WT / PKG, capture_output=True, text=True, encoding='utf-8', errors='replace')
    txt = r.stdout + r.stderr
    if r.returncode == 124:
        return 'HANG', txt
    if re.search(r'^\s+Tests\s+\d+ failed', txt, re.M):
        return 'KILLED', txt
    if r.returncode == 0 and re.search(r'^\s+Tests\s+\d+ passed', txt, re.M):
        return 'SURVIVED', txt
    return 'INVALID', txt


if __name__ == '__main__':
    if '--list' in ONLY:
        for m in M:
            print(m[0])
        sys.exit(0)
    out = []
    for mid, fk, old, new in M:
        if ONLY and mid not in ONLY:
            continue
        p = WT / F[fk]
        src = p.read_bytes().decode('utf-8')
        if '\r\n' in src:
            old, new = old.replace('\n', '\r\n'), new.replace('\n', '\r\n')
        if src.count(old) != 1:
            out.append(f'{mid}: NOMATCH ({src.count(old)})')
            print(out[-1], flush=True)
            continue
        backup = p.with_name(p.name + '.redbak')
        shutil.copyfile(p, backup)
        try:
            p.write_bytes(src.replace(old, new).encode('utf-8'))
            v, txt = run()
            if v == 'INVALID':
                (LOG.parent / f'{mid}.invalid.txt').write_text(txt[-4000:], encoding='utf-8')
            if v == 'KILLED':
                fails = sorted(set(re.findall(r'FAIL\s+(src/__tests__/\S+)', txt)))
                v = f'KILLED {fails[:4]}'
            out.append(f'{mid}: {v}')
        finally:
            shutil.copyfile(backup, p)
            backup.unlink()
        print(out[-1], flush=True)
        LOG.write_text('\n'.join(out) + '\n', encoding='utf-8')
    LOG.write_text('\n'.join(out) + '\n', encoding='utf-8')
