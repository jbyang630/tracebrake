import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.sol': 'text/plain; charset=utf-8', '.hex': 'text/plain; charset=utf-8' };

export function staticServer(url, { page = 'index.html', overrides = new Map(), allowOnly = null } = {}) {
  const root = fileURLToPath(url);
  return createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).slice(1) || page;
      if (allowOnly && !allowOnly.includes(pathname)) { res.writeHead(404).end(); return; }
      const path = resolve(root, pathname);
      if (!path.startsWith(resolve(root) + sep)) { res.writeHead(404).end(); return; }
      const data = overrides.get(pathname) ?? await readFile(path);
      const suffix = path.slice(path.lastIndexOf('.'));
      res.writeHead(200, {
        'content-type': types[suffix] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer'
      }).end(req.method === 'HEAD' ? undefined : data);
    } catch (e) {
      const code = e.code === 'ENOENT' ? 404 : 400;
      res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }).end('无法读取文件。');
    }
  });
}

export async function listen(server, port = 0) {
  await new Promise((ready, error) => {
    server.once('error', error);
    server.listen(port, '127.0.0.1', ready);
  });
  return `http://127.0.0.1:${server.address().port}/`;
}
