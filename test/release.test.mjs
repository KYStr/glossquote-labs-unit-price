import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, cp, mkdtemp, rm, readFile, writeFile, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildProduction, buildPreview } from '../scripts/build.mjs';
import { checkProduction } from '../scripts/check-production.mjs';
import { checkProject, htmlTags, projectRoot } from '../scripts/check.mjs';
import { startProductionPreview } from '../scripts/serve-production.mjs';
import { assetManifest, assertSafePath, contained, PUBLIC_FILES, PRODUCTION_FILES } from '../scripts/assets.mjs';
import { isolatedEnvironment, runDryRun } from '../scripts/cloudflare-dry-run.mjs';
import { SOURCE_FILES } from '../scripts/source-files.mjs';
import { verifySource } from '../scripts/verify-source.mjs';

const temporaryBase = path.join(projectRoot, 'test', '.tmp');
async function fixture(t) {
  await assertSafePath(temporaryBase, { allowMissing: true, directory: true }); await mkdir(temporaryBase, { recursive: true });
  const directory = await mkdtemp(path.join(temporaryBase, 'release-')); const root = path.join(directory, 'tool'); await mkdir(root);
  for (const file of ['public', 'scripts']) await cp(path.join(projectRoot, file), path.join(root, file), { recursive: true });
  for (const file of ['package.json', 'wrangler.jsonc']) await cp(path.join(projectRoot, file), path.join(root, file));
  t.after(async () => {
    if (!contained(temporaryBase, directory) || directory === temporaryBase) throw new Error('Unsafe fixture cleanup target');
    await assertSafePath(directory, { directory: true }); await rm(directory, { recursive: true });
  });
  return { root, directory };
}
async function get(url, target, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: new URL(url).port, path: target, method }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }); req.on('error', reject); req.end();
  });
}

test('production bilingual canonical, alternates, OG and truthful JSON-LD', async (t) => {
  const { root } = await fixture(t); await buildProduction(root); assert.equal((await checkProduction(root)).ok, true);
  for (const [page, lang, name, ogLocale] of [['index.html', 'zh-Hant', '購物單價比較', 'zh_TW'], ['en/index.html', 'en', 'Unit Price Comparison', 'en_US']]) {
    const html = await readFile(path.join(root, 'dist', page), 'utf8'); const tags = htmlTags(html);
    assert.equal(tags.find((item) => item.tag === 'html').attributes.lang, lang);
    assert.deepEqual(tags.filter((item) => item.attributes.rel === 'canonical').map((item) => item.attributes.href), [`https://price.glossquote.com/${page}`]);
    assert.deepEqual(tags.filter((item) => item.attributes.rel === 'alternate').map((item) => [item.attributes.hreflang, item.attributes.href]), [
      ['zh-Hant', 'https://price.glossquote.com/index.html'], ['en', 'https://price.glossquote.com/en/index.html'], ['x-default', 'https://price.glossquote.com/index.html'],
    ]);
    assert.equal(tags.find((item) => item.attributes.property === 'og:url').attributes.content, `https://price.glossquote.com/${page}`);
    assert.equal(tags.find((item) => item.attributes.property === 'og:locale').attributes.content, ogLocale);
    assert.equal(tags.find((item) => item.attributes.name === 'robots').attributes.content, 'index, follow');
    const json = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
    assert.equal(json['@context'], 'https://schema.org'); assert.equal(json['@type'], 'WebApplication'); assert.equal(json.name, name); assert.equal(json.inLanguage, lang);
    assert.equal(json.url, `https://price.glossquote.com/${page}`); assert.equal(json.applicationCategory, 'UtilitiesApplication');
    assert.equal(json.description, tags.find((item) => item.attributes.name === 'description').attributes.content);
    assert.equal(tags.find((item) => item.attributes.property === 'og:description').attributes.content, json.description);
    assert.ok(!('aggregateRating' in json) && !('review' in json) && !('offers' in json));
  }
});
test('sitemap only two fixed URLs, robots crawlable; CSP hashes exact inline JSON', async (t) => {
  const { root } = await fixture(t); await buildProduction(root);
  const robots = await readFile(path.join(root, 'dist', 'robots.txt'), 'utf8');
  assert.equal(robots, 'User-agent: *\nAllow: /\nSitemap: https://price.glossquote.com/sitemap.xml\n');
  const sitemap = await readFile(path.join(root, 'dist', 'sitemap.xml'), 'utf8');
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]), ['https://price.glossquote.com/index.html', 'https://price.glossquote.com/en/index.html']);
  assert.equal([...sitemap.matchAll(/hreflang="x-default" href="https:\/\/price.glossquote.com\/index.html"/g)].length, 2);
  assert.doesNotMatch(sitemap, /localhost|127\.0\.0\.1|404\.html/);
  const headers = await readFile(path.join(root, 'dist', '_headers'), 'utf8');
  for (const page of ['index.html', 'en/index.html']) {
    const html = await readFile(path.join(root, 'dist', page), 'utf8'); const json = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1];
    assert.ok(headers.includes(`'sha256-${createHash('sha256').update(json).digest('base64')}'`));
  }
  for (const directive of ["connect-src 'none'", "worker-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", 'X-Content-Type-Options: nosniff', 'Referrer-Policy: no-referrer', 'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()']) assert.ok(headers.includes(directive));
  assert.doesNotMatch(headers, /unsafe-inline|unsafe-eval|report-uri|report-to/);
});
test('preview/prod/preview transitions remove only known generated metadata', async (t) => {
  const { root } = await fixture(t); const preview = await buildPreview(root);
  await buildProduction(root); const nextPreview = await buildPreview(root);
  assert.deepEqual(nextPreview.manifest, preview.manifest); assert.deepEqual(nextPreview.manifest.map((file) => file.path), PUBLIC_FILES);
  for (const page of ['index.html', 'en/index.html']) {
    const html = await readFile(path.join(root, 'dist', page), 'utf8'); assert.match(html, /noindex, nofollow/); assert.doesNotMatch(html, /rel="canonical"|application\/ld\+json/);
  }
  assert.equal(await assertSafePath(path.join(root, 'dist', 'sitemap.xml'), { allowMissing: true }), undefined);
  assert.equal((await checkProject(root)).ok, true);
});
test('core and runtime modules preserve source bytes and production is reproducible', async (t) => {
  const { root } = await fixture(t); const first = await buildProduction(root); const second = await buildProduction(root); assert.deepEqual(first.manifest, second.manifest);
  for (const file of ['js/app.mjs', 'js/core/unit-price.mjs', 'js/i18n.mjs', 'js/state.mjs']) assert.deepEqual(await readFile(path.join(root, 'dist', file)), await readFile(path.join(root, 'public', file)));
});
test('production checker rejects SEO/header/output/config corruption', async (t) => {
  const { root } = await fixture(t); await buildProduction(root);
  for (const [file, transform] of [
    ['index.html', (text) => text.replace('https://price.glossquote.com/index.html', 'https://example.invalid/index.html')],
    ['en/index.html', (text) => text.replace('index, follow', 'noindex, nofollow')],
    ['_headers', (text) => text.replace("connect-src 'none'", "connect-src *")],
    ['sitemap.xml', (text) => text.replace('https://price.glossquote.com/en/index.html', 'http://localhost/test')],
  ]) {
    const filePath = path.join(root, 'dist', file); const original = await readFile(filePath, 'utf8'); await writeFile(filePath, transform(original)); await assert.rejects(checkProduction(root)); await writeFile(filePath, original);
  }
  const configPath = path.join(root, 'wrangler.jsonc'); const config = JSON.parse(await readFile(configPath, 'utf8')); config.assets.not_found_handling = 'single-page-application';
  const before = await assetManifest(path.join(root, 'dist'), PRODUCTION_FILES); await writeFile(configPath, JSON.stringify(config));
  await assert.rejects(checkProduction(root)); await assert.rejects(buildProduction(root)); assert.deepEqual(await assetManifest(path.join(root, 'dist'), PRODUCTION_FILES), before);
});
test('production stale/linked output refusal leaves sentinel and existing bytes intact', async (t) => {
  const { root, directory } = await fixture(t); await buildProduction(root);
  const before = await readFile(path.join(root, 'dist', 'index.html')); const sentinel = path.join(directory, 'sentinel.txt'); await writeFile(sentinel, 'KEEP-PRODUCTION-SENTINEL');
  await unlink(path.join(root, 'dist', '_headers')); await link(sentinel, path.join(root, 'dist', '_headers'));
  await assert.rejects(buildProduction(root), /Hardlinked/); await assert.rejects(buildPreview(root), /Hardlinked/);
  assert.equal(await readFile(sentinel, 'utf8'), 'KEEP-PRODUCTION-SENTINEL'); assert.deepEqual(await readFile(path.join(root, 'dist', 'index.html')), before);
});
test('real local HTTP status/MIME/security/404/redirects; Host/query never select SEO', async (t) => {
  const { root } = await fixture(t); await buildProduction(root); const { server, url } = await startProductionPreview(root);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal(server.address().address, '127.0.0.1');
  for (const [target, mime] of [['/index.html', 'text/html'], ['/en/index.html', 'text/html'], ['/styles/app.css', 'text/css'], ['/js/core/unit-price.mjs', 'text/javascript'], ['/sitemap.xml', 'application/xml'], ['/robots.txt', 'text/plain']]) {
    const response = await get(url, target); assert.equal(response.status, 200); assert.ok(response.headers['content-type'].startsWith(mime));
    assert.equal(response.headers['x-content-type-options'], 'nosniff'); assert.equal(response.headers['referrer-policy'], 'no-referrer'); assert.ok(response.headers['content-security-policy'].includes("connect-src 'none'"));
  }
  const queryResponse = await get(url, '/index.html?host=example.invalid'); assert.ok(queryResponse.body.includes('rel="canonical" href="https://price.glossquote.com/index.html"'));
  for (const target of ['/missing', '/en/missing', '/_headers', '/_redirects']) { const response = await get(url, target); assert.equal(response.status, 404); assert.doesNotMatch(response.body, /id="comparison-form"/); }
  assert.match((await get(url, '/en/missing')).body, /<html lang="en">/); assert.match((await get(url, '/missing')).body, /<html lang="zh-Hant">/);
  for (const [target, location] of [['/', '/index.html'], ['/en', '/en/index.html'], ['/en/', '/en/index.html']]) { const response = await get(url, target); assert.equal(response.status, 301); assert.equal(response.headers.location, location); }
  assert.equal((await get(url, '/index.html', 'HEAD')).body, ''); assert.equal((await get(url, '/index.html', 'POST')).status, 405);
  for (const target of ['/../sentinel.txt', '/%2e%2e/sentinel.txt']) assert.equal((await get(url, target)).status, 400);
});
test('homepage navigation allowlist never admits external script/form resources', async (t) => {
  const { root } = await fixture(t); const file = path.join(root, 'public', 'index.html'); const original = await readFile(file, 'utf8');
  for (const mutation of [
    (text) => text.replace('src="js/app.mjs"', 'src="https://glossquote.com/index.html"'),
    (text) => text.replace('href="https://glossquote.com/index.html"', 'href="https://glossquote.com/en/index.html"'),
    (text) => text.replace('id="comparison-form"', 'id="comparison-form" action="https://glossquote.com/index.html"'),
  ]) { await writeFile(file, mutation(original)); await assert.rejects(checkProject(root)); }
});
test('dry-run child has isolated homes and no credential/telemetry environment', async (t) => {
  const { directory } = await fixture(t); const env = isolatedEnvironment(directory);
  for (const name of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'WRANGLER_HOME']) assert.equal(env[name], directory);
  assert.equal(env.WRANGLER_SEND_METRICS, 'false');
  assert.ok(!Object.hasOwn(env, 'CLOUDFLARE_API_TOKEN') && !Object.hasOwn(env, 'CLOUDFLARE_ACCOUNT_ID') && !Object.hasOwn(env, 'GITHUB_TOKEN'));
  await assert.rejects(runDryRun(null), /existing Wrangler/);
});
test('fixed source verification compares every Git blob and rejects extra/changed bytes', async (t) => {
  const { directory } = await fixture(t); const repository = path.join(directory, 'repository'); const extracted = path.join(directory, 'extracted');
  await mkdir(repository); await mkdir(extracted);
  for (const file of SOURCE_FILES) {
    for (const root of [repository, extracted]) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), `SYNTHETIC ${file}\n`); }
  }
  const git = (args) => { const result = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=__disabled_hooks__', '-c', 'commit.gpgSign=false', '-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid', '-C', repository, ...args], { encoding: 'utf8' }); assert.equal(result.status, 0); return result.stdout.trim(); };
  git(['init', '-b', 'codex/fixture']); git(['add', '--', ...SOURCE_FILES]); git(['commit', '-m', 'Synthetic fixed source']); const commit = git(['rev-parse', 'HEAD']);
  assert.equal((await verifySource(repository, commit, extracted)).files, SOURCE_FILES.length);
  await writeFile(path.join(extracted, 'README.md'), 'CHANGED\r\n'); await assert.rejects(verifySource(repository, commit, extracted), /Source bytes differ/);
  await writeFile(path.join(extracted, 'README.md'), 'SYNTHETIC README.md\n'); await writeFile(path.join(extracted, 'extra.txt'), 'EXTRA'); await assert.rejects(verifySource(repository, commit, extracted), /Unknown extracted/);
  await assert.rejects(verifySource(repository, 'HEAD', extracted), /full commit SHA/);
});
test('offline CLI refuses environment files before launching its child', async (t) => {
  const { root, directory } = await fixture(t); const cliRoot = path.join(directory, 'synthetic-cli'); await mkdir(path.join(cliRoot, 'bin'), { recursive: true });
  const cli = path.join(cliRoot, 'bin', 'wrangler.js'); await writeFile(cli, 'throw new Error("Must never run");'); await writeFile(path.join(cliRoot, 'package.json'), JSON.stringify({ name: 'wrangler', version: '4.147.0' }));
  await writeFile(path.join(root, '.env'), 'SYNTHETIC_ENV_CANARY=not-a-real-secret');
  await assert.rejects(runDryRun(cli, { root, help: true }), /Environment files are not allowed/);
});
