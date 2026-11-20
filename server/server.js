// Tidepop server – zero npm dependencies (Node 22+: detailed analytics uses the built-in node:sqlite).
//  * serves the PWA from ../public
//  * free leaderboard API with server-side replay verification
//
//   PORT=8080 DATA_DIR=./data node server/server.js

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStore } from './store.js';
import { createApi } from './api.js';
import { createEvents } from './events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'SAMEORIGIN',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

export function createServer({ dataDir = process.env.DATA_DIR || path.resolve(__dirname, '..', 'data'), now, rate } = {}) {
  const store = createStore(dataDir);
  const events = createEvents(dataDir, { now });
  const api = createApi(store, { now, rate, events });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api.handle(req, res, url);
      if (url.pathname === '/admin') return await serveAdmin(res);
      return await serveStatic(url.pathname, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'server error' }));
    }
  });
  server.on('close', () => { store.flush(); events.close(); });
  return { server, store, events };
}

/** The team dashboard. The page itself holds no data; it asks /api/admin/report with the team key. */
async function serveAdmin(res) {
  const body = await readFile(path.join(__dirname, 'admin.html'));
  res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': MIME['.html'], 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" });
  res.end(body);
}

async function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  let target = file;
  try {
    const s = await stat(target);
    if (s.isDirectory()) target = path.join(target, 'index.html');
  } catch {
    // unknown path → app shell (single page app)
    if (!path.extname(rel)) target = path.join(PUBLIC, 'index.html');
    else {
      res.writeHead(404, SECURITY_HEADERS);
      return res.end('not found');
    }
  }
  const body = await readFile(target);
  const ext = path.extname(target);
  const noCache = ext === '.html' || target.endsWith('sw.js') || ext === '.webmanifest';
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': noCache ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(body);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8080);
  const { server, store, events } = createServer();
  server.listen(port, () => console.log(`Tidepop running on http://localhost:${port}`));
  const shutdown = () => {
    store.flush();
    events.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
