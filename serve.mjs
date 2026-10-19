import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => console.log(`Serving ${root} at http://localhost:${PORT}`));
