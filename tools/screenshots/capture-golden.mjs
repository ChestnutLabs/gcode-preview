/*
 * v0.20.1 capture() colour-space golden (AnyBridge validation). Drives the Feature Lab (:5199, built
 * from the FIXED sources) and saves two reference captures produced through the real render-to-target
 * `controls.capture()` path — the one AnyBridge's thumbnail sidecar uses:
 *   - capture-golden-grey.png      : solid `#6d7176` background (a deterministic background sample)
 *   - capture-golden-transparent.png: `background:'transparent'` (AnyBridge's exact call)
 * It also prints the sampled colours so the fix can be validated by VALUE (GPU-independent for flat
 * regions), since a pixel-hash is not portable across GPUs (this box renders on SwiftShader).
 *
 * Run:  node tools/screenshots/capture-golden.mjs   (Feature Lab must be running on :5199)
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launchBrowser, savePngDataUrl } from './lib/browser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../docs/reference/goldens');
const BASE = process.env.DEMO_URL || 'http://localhost:5199';

const run = async () => {
  const { browser } = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.viewer?.preview?.getState().segmentCount > 0, null, { timeout: 30000 });

  const result = await page.evaluate(async () => {
    const p = window.viewer.preview;
    const toHex = (a) => '#' + [a[0], a[1], a[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    const toUrl = (blob) =>
      new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(blob);
      });
    const grey = await p.controls.capture({ background: '#6d7176', width: 800, height: 500, format: 'image/png' });
    const bmpG = await createImageBitmap(grey);
    const cg = new OffscreenCanvas(bmpG.width, bmpG.height);
    const xg = cg.getContext('2d');
    xg.drawImage(bmpG, 0, 0);
    const bgSample = [...xg.getImageData(3, 3, 1, 1).data];
    const trans = await p.controls.capture({ background: 'transparent', width: 800, height: 500, format: 'image/png' });
    return { greyUrl: await toUrl(grey), transUrl: await toUrl(trans), bgSample, bgSampleHex: toHex(bgSample) };
  });

  savePngDataUrl(resolve(OUT, 'capture-golden-grey.png'), result.greyUrl);
  savePngDataUrl(resolve(OUT, 'capture-golden-transparent.png'), result.transUrl);
  console.log('background sample (solid #6d7176 capture):', result.bgSampleHex, result.bgSample);
  console.log('saved capture-golden-grey.png + capture-golden-transparent.png to docs/reference/goldens/');
  await browser.close();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
