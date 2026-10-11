// Tiny static server for previewing the site locally (no dependencies).
//
//   node scripts/serve.mjs          -> http://localhost:4321
//   PORT=8080 node scripts/serve.mjs

import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4321;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

// The local caption-review page (drafts/caption-review/) posts its answers
// here so they land in a file. Loopback only, one fixed path, small JSON only.
const ANSWERS = join(ROOT, 'drafts', 'caption-review', 'answers.json');
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

async function saveAnswers(req, res) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) { res.writeHead(403).end('Forbidden'); return; }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) { res.writeHead(413).end('Too large'); return; }
  }
  let data;
  try { data = JSON.parse(body); } catch { res.writeHead(400).end('Bad JSON'); return; }
  const valid = data && typeof data === 'object' && !Array.isArray(data) &&
    Object.entries(data).every(([k, v]) => /^[\w.-]{1,40}$/.test(k) && typeof v === 'string' && v.length <= 200);
  if (!valid) { res.writeHead(400).end('Unexpected shape'); return; }
  await writeFile(ANSWERS, JSON.stringify({ savedAt: new Date().toISOString(), answers: data }, null, 2) + '\n');
  res.writeHead(204).end();
}

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/drafts/caption-review/answers') {
    await saveAnswers(req, res).catch(() => { if (!res.headersSent) res.writeHead(500).end('Save failed'); });
    return;
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(normalize(ROOT + sep)) && path !== normalize(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    const notFound = await readFile(join(ROOT, '404.html')).catch(() => 'Not found');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(notFound);
  }
}).listen(PORT, () => console.log(`Previewing on http://localhost:${PORT}`));
