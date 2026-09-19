/* Static file server for local preview. No dependencies on purpose — the
   site itself has no build step, and neither should looking at it. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = import.meta.dirname;
const PORT = Number(process.env.PORT) || 4173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // normalize() collapses `..`, and the prefix check rejects what escapes ROOT.
  // Directory indexes: /purchase/ and /purchase both mean purchase/index.html.
  let name = url.pathname;
  if (name.endsWith('/')) name += 'index.html';
  else if (!extname(name)) name += '/index.html';
  const path = join(ROOT, normalize(name));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(PORT, () => console.log(`pulse-site on http://localhost:${PORT}`));
