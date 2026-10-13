import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_FILES, assertSafePath } from './assets.mjs';
import { checkProduction } from './check-production.mjs';
import { projectRoot } from './check.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
export async function startProductionPreview(root = projectRoot) {
  await checkProduction(root);
  const dist = path.join(root, 'dist');
  const rules = (await readFile(path.join(dist, '_headers'), 'utf8')).split('\n').slice(1).filter(Boolean);
  const headers = Object.fromEntries(rules.map((line) => { const colon = line.indexOf(':'); return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()]; }));
  const redirects = new Map((await readFile(path.join(dist, '_redirects'), 'utf8')).trim().split('\n').map((line) => { const [from, to] = line.split(' '); return [from, to]; }));
  const server = createServer(async (req, res) => {
    const error = (status) => { res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : 'Resource unavailable.'); };
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); error(405); return; }
    const raw = req.url;
    if (!raw?.startsWith('/') || raw.length > 2048 || /[%\\\u0000-\u0020]/.test(raw) || raw.split(/[/?]/).some((part) => part.startsWith('.'))) { error(400); return; }
    const target = raw.split('?')[0];
    if (redirects.has(target)) { res.writeHead(301, { ...headers, Location: redirects.get(target) }); res.end(); return; }
    const file = target.slice(1);
    const found = PRODUCTION_FILES.includes(file) && !file.startsWith('_');
    const asset = found ? file : target.startsWith('/en/') ? 'en/404.html' : '404.html';
    try {
      const absolute = path.join(dist, asset); await assertSafePath(absolute);
      const content = await readFile(absolute);
      res.writeHead(found ? 200 : 404, { ...headers, 'Content-Type': MIME[path.extname(asset)], 'Content-Length': content.length });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { error(403); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const { url } = await startProductionPreview(); console.log(JSON.stringify({ status: 'READY', url, pid: process.pid, mode: 'local-production-simulation' })); }
  catch (error) { console.error(`PRODUCTION PREVIEW FAIL: ${error.message}`); process.exitCode = 1; }
}
