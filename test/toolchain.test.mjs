import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, link, symlink, unlink, rename } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { projectRoot, checkProject, htmlTags } from '../scripts/check.mjs';
import { buildPreview } from '../scripts/build.mjs';
import { startStaticServer } from '../scripts/serve.mjs';
import { assertSafePath, contained, assetManifest, PUBLIC_FILES } from '../scripts/assets.mjs';

const temporaryBase = path.join(projectRoot, 'test', '.tmp');
async function fixture(t) {
  await assertSafePath(temporaryBase, { allowMissing: true, directory: true });
  await mkdir(temporaryBase, { recursive: true });
  const directory = await mkdtemp(path.join(temporaryBase, 'case-'));
  const root = path.join(directory, 'tool');
  await mkdir(root);
  await cp(path.join(projectRoot, 'public'), path.join(root, 'public'), { recursive: true });
  await cp(path.join(projectRoot, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  await cp(path.join(projectRoot, 'package.json'), path.join(root, 'package.json'));
  t.after(async () => {
    if (!contained(temporaryBase, directory) || path.resolve(directory) === path.resolve(temporaryBase)) throw new Error('Unsafe fixture cleanup target');
    await assertSafePath(directory, { directory: true });
    await rm(directory, { recursive: true });
  });
  return { root, directory };
}
async function edit(root, file, transform) {
  const target = path.join(root, 'public', file);
  await writeFile(target, transform(await readFile(target, 'utf8')));
}
function rawRequest(url, target, method = 'GET') {
  const { port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: target, method }, (res) => {
      let body = '';
      res.setEncoding('utf8'); res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
}

test('A34 loopback static server raw traversal, encoded paths, hidden files and POST', async (t) => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, 'SENTINEL.txt'), 'OUTSIDE-PUBLIC-SENTINEL');
  const { server, url } = await startStaticServer(path.join(root, 'public'), { port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal(server.address().address, '127.0.0.1');
  for (const [target, mime] of [['/', 'text/html'], ['/en/', 'text/html'], ['/index.html', 'text/html'], ['/en/index.html', 'text/html'], ['/js/app.mjs', 'text/javascript'], ['/styles/app.css', 'text/css'], ['/robots.txt', 'text/plain']]) {
    const result = await rawRequest(url, target);
    assert.equal(result.status, 200); assert.ok(result.headers['content-type'].startsWith(mime));
  }
  assert.equal((await rawRequest(url, '/index.html', 'HEAD')).body, '');
  for (const target of ['/../SENTINEL.txt', '/%2e%2e/SENTINEL.txt', '/%252e%252e/SENTINEL.txt', '/js/../../SENTINEL.txt', '/js%2f..%2f..%2fSENTINEL.txt', '/.hidden', '/.git/config', '/js/./app.mjs', '//index.html', '/index.html::$DATA', '/index.html?name=TEST', '/missing', '/SENTINEL.txt']) {
    const result = await rawRequest(url, target);
    assert.ok(result.status >= 400, target); assert.ok(!result.body.includes('OUTSIDE-PUBLIC-SENTINEL'));
  }
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await rawRequest(url, '/index.html', method)).status, 405);
});
test('occupied requested port falls back to OS port without touching occupier', async (t) => {
  const occupying = createServer();
  await new Promise((resolve) => occupying.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => occupying.close(resolve)));
  const port = occupying.address().port;
  const { server } = await startStaticServer(path.join(projectRoot, 'public'), { port });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.notEqual(server.address().port, port); assert.equal(occupying.listening, true);
});
test('check and build create only the reviewed preview assets; second build identical', async (t) => {
  const { root } = await fixture(t);
  assert.equal((await checkProject(root)).ok, true);
  const first = await buildPreview(root);
  assert.equal(first.mode, 'preview-noindex');
  assert.deepEqual(first.manifest.map((item) => item.path), PUBLIC_FILES);
  assert.deepEqual(await assetManifest(path.join(root, 'public')), first.manifest);
  assert.deepEqual((await buildPreview(root)).manifest, first.manifest);
  assert.match(await readFile(path.join(root, 'dist', 'index.html'), 'utf8'), /noindex, nofollow/);
  assert.equal(await readFile(path.join(root, 'dist', 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
});
test('build refuses unknown stale output before changing approved files', async (t) => {
  const { root } = await fixture(t);
  await buildPreview(root);
  await writeFile(path.join(root, 'dist', 'unknown.txt'), 'KEEP-UNKNOWN');
  const before = await readFile(path.join(root, 'dist', 'index.html'));
  await assert.rejects(buildPreview(root), /Unknown asset/);
  assert.deepEqual(await readFile(path.join(root, 'dist', 'index.html')), before);
  assert.equal(await readFile(path.join(root, 'dist', 'unknown.txt'), 'utf8'), 'KEEP-UNKNOWN');
});
test('hardlinked output cannot overwrite an external sentinel', async (t) => {
  const { root, directory } = await fixture(t);
  const sentinel = path.join(directory, 'sentinel.txt'); await writeFile(sentinel, 'KEEP-HARDLINK-SENTINEL');
  await mkdir(path.join(root, 'dist')); await link(sentinel, path.join(root, 'dist', 'index.html'));
  await assert.rejects(buildPreview(root), /Hardlinked/);
  assert.equal(await readFile(sentinel, 'utf8'), 'KEEP-HARDLINK-SENTINEL');
});
test('hardlinked public asset is refused by check, build and server', async (t) => {
  const { root, directory } = await fixture(t);
  const sentinel = path.join(directory, 'sentinel.txt'); await writeFile(sentinel, 'KEEP-PUBLIC-SENTINEL');
  await unlink(path.join(root, 'public', 'index.html')); await link(sentinel, path.join(root, 'public', 'index.html'));
  await assert.rejects(checkProject(root), /Hardlinked/); await assert.rejects(buildPreview(root), /Hardlinked/);
  const { server, url } = await startStaticServer(path.join(root, 'public'), { port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await rawRequest(url, '/index.html'); assert.equal(result.status, 403); assert.ok(!result.body.includes('KEEP-PUBLIC-SENTINEL'));
});
test('Windows junction ancestor in project/public paths is rejected', async (t) => {
  const { root, directory } = await fixture(t);
  const alias = path.join(directory, 'alias'); await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await assert.rejects(buildPreview(alias), /Symlink or junction/);
    await assert.rejects(startStaticServer(path.join(alias, 'public'), { port: 0 }), /Symlink or junction/);
  } finally { await unlink(alias); }
});
test('server refuses a junction replacing a public subdirectory', async (t) => {
  const { root, directory } = await fixture(t);
  const external = path.join(directory, 'external'); await mkdir(external); await writeFile(path.join(external, 'index.html'), 'KEEP-JUNCTION-SENTINEL');
  const original = path.join(root, 'public', 'en'); await rename(original, path.join(root, 'en-backup'));
  await symlink(external, original, process.platform === 'win32' ? 'junction' : 'dir');
  const { server, url } = await startStaticServer(path.join(root, 'public'), { port: 0 });
  try {
    const result = await rawRequest(url, '/en/index.html'); assert.equal(result.status, 403); assert.ok(!result.body.includes('KEEP-JUNCTION-SENTINEL'));
    await assert.rejects(buildPreview(root));
  } finally { await new Promise((resolve) => server.close(resolve)); await unlink(original); }
});
test('build refuses a junction output directory and preserves external contents', async (t) => {
  const { root, directory } = await fixture(t);
  const external = path.join(directory, 'external'); await mkdir(external); await writeFile(path.join(external, 'index.html'), 'KEEP-DIST-SENTINEL');
  const destination = path.join(root, 'dist'); await symlink(external, destination, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await assert.rejects(buildPreview(root), /Symlink or junction/);
    assert.equal(await readFile(path.join(external, 'index.html'), 'utf8'), 'KEEP-DIST-SENTINEL');
  } finally { await unlink(destination); }
});
test('active HTML references: quote/case/comments/entities and sink boundaries', async (t) => {
  const { root } = await fixture(t);
  await edit(root, 'index.html', (text) => text.replace('<meta name="robots" content="noindex, nofollow">', "<META NAME='RoBoTs' CONTENT='noindex, nofollow'>"));
  assert.equal((await checkProject(root)).ok, true);
  const parsed = htmlTags(`<!-- <meta name="robots" content="noindex, nofollow"> --><SCRIPT SRC='x>y' TYPE=module></SCRIPT>`);
  assert.equal(parsed.length, 1); assert.equal(parsed[0].attributes.src, 'x>y');
  await edit(root, 'index.html', (text) => text.replace("<META NAME='RoBoTs' CONTENT='noindex, nofollow'>", "<!-- <META NAME='RoBoTs' CONTENT='noindex, nofollow'> -->"));
  await assert.rejects(checkProject(root), /active noindex/);
});
test('HTML active URLs cannot use navigation/resource loopholes', async (t) => {
  const { root } = await fixture(t);
  const original = await readFile(path.join(root, 'public', 'index.html'), 'utf8');
  for (const mutation of [
    (text) => text.replace('src="js/app.mjs"', "SRC='https://glossquote.com/js/app.mjs'"),
    (text) => text.replace('src="js/app.mjs"', "src='&#104;ttps://example.invalid/x.mjs'"),
    (text) => text.replace('src="js/app.mjs"', 'src="../private.mjs"'),
    (text) => text.replace('href="styles/app.css"', 'href="//example.invalid/style.css"'),
    (text) => text.replace('<body>', '<body ONLOAD="unsafe()">'),
    (text) => text.replace('<body>', '<body><img srcset="https://example.invalid/p.png 1x">'),
    (text) => text.replace('id="comparison-form"', 'id="comparison-form" action="https://glossquote.com"'),
  ]) {
    await writeFile(path.join(root, 'public', 'index.html'), mutation(original));
    await assert.rejects(checkProject(root));
  }
});
test('UP-M1-R2 active meta refresh is rejected by check/build without output changes', async (t) => {
  const { root } = await fixture(t);
  const before = (await buildPreview(root)).manifest;
  const original = await readFile(path.join(root, 'public', 'index.html'), 'utf8');
  for (const refresh of [
    '<meta http-equiv="refresh" content="0; url=https://example.invalid/">',
    "<MeTa HTTP-EQUIV='REFRESH' CONTENT='0; URL=https://example.invalid/'>",
    '<meta http-equiv="r&#x65;fr&#101;sh" content="0;url=https://example.invalid/">',
    '<meta http-equiv="r&#101fr&#101sh" content="0;url=https://example.invalid/">',
    '<meta HtTp-EqUiV=refresh content="0;url=https://example.invalid/">',
    '<META HTTP-EQUIV=" &#82;efresh&#x20;" content="0;url=https://example.invalid/">',
  ]) {
    await writeFile(path.join(root, 'public', 'index.html'), original.replace('</head>', `${refresh}\n</head>`));
    await assert.rejects(checkProject(root), /Meta refresh navigation is not allowed/);
    await assert.rejects(buildPreview(root), /Meta refresh navigation is not allowed/);
    assert.deepEqual(await assetManifest(path.join(root, 'dist')), before);
  }
  await writeFile(path.join(root, 'public', 'index.html'), original.replace('</head>', '<!-- <meta http-equiv="refresh" content="0;url=https://example.invalid/"> -->\n</head>'));
  assert.equal((await checkProject(root)).ok, true);
});
test('check rejects missing references, dependencies, unsafe runtime and syntax', async (t) => {
  const { root } = await fixture(t);
  const original = await readFile(path.join(root, 'public', 'js', 'app.mjs'), 'utf8');
  for (const suffix of ["\nfetch('https://example.invalid');", "\nnode.innerHTML = 'test';", "\nimport './missing.mjs';", '\n<<<']) {
    await writeFile(path.join(root, 'public', 'js', 'app.mjs'), original + suffix);
    await assert.rejects(checkProject(root));
  }
  await writeFile(path.join(root, 'public', 'js', 'app.mjs'), original);
  const config = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')); config.dependencies = { forbidden: '1.0.0' };
  await writeFile(path.join(root, 'package.json'), JSON.stringify(config)); await assert.rejects(checkProject(root), /dependency contract/);
});
test('toolchain CLIs fail with nonzero status on invalid source, no output build', async (t) => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, 'public', 'extra.txt'), 'UNKNOWN');
  for (const script of ['check.mjs', 'build.mjs', 'serve.mjs']) {
    const result = spawnSync(process.execPath, [`scripts/${script}`], { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /FAIL/);
  }
  assert.equal(await assertSafePath(path.join(root, 'dist'), { allowMissing: true, directory: true }), undefined);
});
