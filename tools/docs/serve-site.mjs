/*
 * Minimal static server for the built docs-site/ — for locally verifying the GitHub Pages artifact
 * (the manual, API, media, and the live demos under /demos/) exactly as it will be served. Not part
 * of the build; a convenience for the docs/demo parity check. Port 5098 (override with PORT).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs-site');
const port = Number(process.env.PORT) || 5098;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.gcode': 'text/plain; charset=utf-8',
  '.ngc': 'text/plain; charset=utf-8',
  '.3mf': 'application/octet-stream',
  '.bgcode': 'application/octet-stream',
  '.stl': 'application/octet-stream'
};

createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(root, rel);
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end('not found: ' + rel);
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(port, () => console.log(`docs-site served at http://localhost:${port}/  (root: ${root})`));
