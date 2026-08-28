/**
 * Browser + capture plumbing shared by the documentation harness.
 *
 * - Resolves a launchable Chromium: honors CHROME_PATH, otherwise scans the
 *   Playwright browser cache for this platform and returns an ORDERED list of
 *   candidates so a broken binary (e.g. an ACL-blocked revision) falls through
 *   to the next one automatically.
 * - Locates the Playwright-bundled ffmpeg for optional animation encoding.
 * - Reads a WebGL canvas back as a PNG via a 2D-canvas copy — the deterministic
 *   technique the repo's own VR harness uses; avoids the compositor stall that a
 *   live rAF loop causes under headless SwiftShader.
 */
/* eslint-env node */
import { chromium } from 'playwright-core';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function playwrightCacheDir() {
  if (process.platform === 'win32')
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  return join(homedir(), '.cache', 'ms-playwright');
}

function chromeExeIn(revDir) {
  const p = process.platform;
  if (p === 'win32') {
    return [join(revDir, 'chrome-win64', 'chrome.exe'), join(revDir, 'chrome-win', 'chrome.exe')];
  }
  if (p === 'darwin') {
    return [
      join(revDir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      join(revDir, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
    ];
  }
  return [join(revDir, 'chrome-linux', 'chrome')];
}

/** Ordered Chromium candidates: CHROME_PATH first, then cached revisions (highest first). */
export function resolveChromeCandidates() {
  const out = [];
  if (process.env.CHROME_PATH) out.push(process.env.CHROME_PATH);
  const cache = playwrightCacheDir();
  if (existsSync(cache)) {
    const revs = readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const rev of revs) {
      for (const exe of chromeExeIn(join(cache, rev))) if (existsSync(exe)) out.push(exe);
    }
  }
  // Last-ditch conventional locations.
  if (process.platform !== 'win32') out.push('/usr/bin/google-chrome-stable', '/usr/bin/chromium');
  return [...new Set(out)];
}

/** Locate the Playwright-bundled ffmpeg (for animation encoding). Returns a path or null. */
export function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  const cache = playwrightCacheDir();
  if (!existsSync(cache)) return null;
  const dirs = readdirSync(cache).filter((d) => /^ffmpeg-\d+$/.test(d));
  for (const d of dirs) {
    const names =
      process.platform === 'win32'
        ? ['ffmpeg-win64.exe', 'ffmpeg-win32.exe']
        : process.platform === 'darwin'
          ? ['ffmpeg-mac']
          : ['ffmpeg-linux'];
    for (const n of names) {
      const p = join(cache, d, n);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const LAUNCH_ARGS = ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader'];

/** Launch the first Chromium candidate that actually spawns. Throws if none do. */
export async function launchBrowser() {
  const candidates = resolveChromeCandidates();
  if (!candidates.length) throw new Error('No Chromium found. Set CHROME_PATH or install a Playwright browser.');
  const errors = [];
  for (const executablePath of candidates) {
    try {
      const browser = await chromium.launch({ executablePath, headless: true, args: LAUNCH_ARGS });
      return { browser, executablePath };
    } catch (e) {
      errors.push(`  ${executablePath}: ${e.message.split('\n')[0]}`);
    }
  }
  throw new Error('Could not launch any Chromium candidate:\n' + errors.join('\n'));
}

/** Copy a WebGL canvas' backing store into a 2D canvas and return a PNG data URL. */
export async function readCanvasPng(page, canvasId, renderFirst = true) {
  return page.evaluate(
    ({ id, renderFirst }) => {
      if (renderFirst && window.viewer?.renderer?.render) window.viewer.renderer.render();
      const src = document.getElementById(id);
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      c.getContext('2d').drawImage(src, 0, 0);
      return c.toDataURL('image/png');
    },
    { id: canvasId, renderFirst }
  );
}

/** Write a `data:image/png;base64,...` URL to disk. */
export function savePngDataUrl(outPath, dataUrl) {
  writeFileSync(outPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
}
