import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const base = process.env.PREVIEW_BASE || '/CanadaPayCalculator/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw new Error('PREVIEW_BASE must be a slash-terminated URL path');
await stat(path.join(root, 'index.html')).catch(() => { throw new Error('Run npm run build before preview'); });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400); response.end(); return; }
  if (pathname === base.slice(0, -1) || (pathname === '/' && base !== '/')) {
    response.writeHead(302, { Location: base }); response.end(); return;
  }
  if (!pathname.startsWith(base)) { response.writeHead(404); response.end(); return; }
  const relative = pathname.slice(base.length) || 'index.html';
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
    if (!(await stat(target)).isFile()) throw new Error('Not a file');
    const body = await readFile(target);
    response.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
    response.setHeader('Cache-Control', relative === 'sw.js' || relative === 'index.html' ? 'no-cache' : 'public, max-age=0');
    response.setHeader('Content-Length', body.length);
    if (relative === 'sw.js') response.setHeader('Service-Worker-Allowed', base);
    response.writeHead(200);
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Production preview: http://127.0.0.1:${port}${base}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
