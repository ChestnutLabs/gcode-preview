/**
 * DD-003 §4.4/§11 Electron consumer smoke.
 *
 * Serves the Vite-built consumer app (../vite-app/dist) over a loopback HTTP
 * server and loads it in an Electron renderer (default webPreferences — no
 * nodeIntegration). Polls the page's #result verdict, prints it to stdout as
 * `ELECTRON_SMOKE_RESULT <json>`, and exits 0 on PASS / 1 otherwise.
 */
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const distDir = path.join(__dirname, '..', 'vite-app', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

function serveDist() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = req.url === '/' ? '/index.html' : (req.url ?? '/index.html').split('?')[0];
        const file = path.join(distDir, path.normalize(urlPath).replace(/^([\\/.])+/, ''));
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await serveDist();
  const { port } = server.address();
  const win = new BrowserWindow({ show: false, width: 800, height: 600 });
  await win.loadURL(`http://127.0.0.1:${port}/`);

  let verdict = null;
  for (let i = 0; i < 60; i++) {
    const text = await win.webContents.executeJavaScript(
      'document.getElementById("result") ? document.getElementById("result").textContent : ""'
    );
    if (text && text !== 'running…') {
      verdict = text;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('ELECTRON_SMOKE_RESULT ' + (verdict ?? '{"smoke":"FAIL","error":"timeout"}'));
  const pass = verdict !== null && verdict.includes('"smoke": "PASS"');
  server.close();
  app.exit(pass ? 0 : 1);
}

app.whenReady().then(main);
