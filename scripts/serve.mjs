import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PUBLIC_FILES, assertSafePath } from './assets.mjs';
import { projectRoot, checkProject } from './check.mjs';

const MIME = Object.freeze({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8' });
export function createStaticServer(publicRoot) {
  return createServer(async (req, res) => {
    const fixedError = (status) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : 'Resource unavailable.'); };
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); fixedError(405); return; }
    const raw = req.url;
    if (typeof raw !== 'string' || raw.length > 2048 || !raw.startsWith('/') || /[%\\?#\u0000-\u0020]/.test(raw) || raw.split('/').some((segment) => segment.startsWith('.'))) { fixedError(400); return; }
    const file = raw === '/' ? 'index.html' : raw === '/en/' ? 'en/index.html' : raw.slice(1);
    if (!PUBLIC_FILES.includes(file)) { fixedError(404); return; }
    try {
      const target = path.join(publicRoot, file);
      await assertSafePath(target);
      const content = await readFile(target);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)], 'Content-Length': content.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { fixedError(403); }
  });
}

export async function startStaticServer(publicRoot = path.join(projectRoot, 'public'), { port = 4196, fallbackOnBusy = true } = {}) {
  await assertSafePath(publicRoot, { directory: true });
  const server = createStaticServer(publicRoot);
  const listen = (requestedPort) => new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(requestedPort, '127.0.0.1');
  });
  try { await listen(port); }
  catch (error) { if (error.code === 'EADDRINUSE' && fallbackOnBusy && port !== 0) await listen(0); else throw error; }
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await checkProject();
    const { url } = await startStaticServer();
    console.log(JSON.stringify({ status: 'READY', url, pid: process.pid, startedAt: new Date().toISOString(), mode: 'preview-only' }));
  } catch (error) { console.error(`DEV FAIL: ${error.message}`); process.exitCode = 1; }
}
