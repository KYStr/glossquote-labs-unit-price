import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { PUBLIC_FILES, PRODUCTION_FILES, inspectAssetTree, assetManifest, assertSafePath } from './assets.mjs';
import { checkProject, htmlTags, projectRoot } from './check.mjs';
import { makeProductionAssets, checkDeploymentConfig, ORIGIN, LOCALES } from './release.mjs';

export async function checkProduction(root = projectRoot) {
  await checkProject(root);
  await checkDeploymentConfig(root);
  const destination = path.join(root, 'dist');
  await inspectAssetTree(destination, { allowedFiles: PRODUCTION_FILES });
  const source = new Map();
  for (const file of PUBLIC_FILES) source.set(file, await readFile(path.join(root, 'public', file)));
  const expected = makeProductionAssets(source);
  for (const file of PRODUCTION_FILES) assert.deepEqual(await readFile(path.join(destination, file)), expected.get(file), `Unexpected release bytes: ${file}`);
  for (const locale of LOCALES) {
    const html = expected.get(locale.page).toString('utf8');
    const tags = htmlTags(html);
    const robots = tags.filter((item) => item.tag === 'meta' && item.attributes.name === 'robots');
    assert.deepEqual(robots.map((item) => item.attributes.content), ['index, follow']);
    const canonical = tags.filter((item) => item.tag === 'link' && item.attributes.rel === 'canonical');
    assert.deepEqual(canonical.map((item) => item.attributes.href), [`${ORIGIN}/${locale.page}`]);
    assert.deepEqual(tags.filter((item) => item.tag === 'link' && item.attributes.rel === 'alternate').map((item) => [item.attributes.hreflang, item.attributes.href]), [
      ['zh-Hant', `${ORIGIN}/index.html`], ['en', `${ORIGIN}/en/index.html`], ['x-default', `${ORIGIN}/index.html`],
    ]);
    const json = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
    assert.deepEqual(Object.keys(json).sort(), ['@context', '@type', 'name', 'url', 'description', 'inLanguage', 'applicationCategory'].sort());
    assert.equal(json.url, `${ORIGIN}/${locale.page}`); assert.equal(json.inLanguage, locale.lang); assert.equal(json.name, locale.name);
    assert.equal(json.description, tags.find((item) => item.tag === 'meta' && item.attributes.name === 'description').attributes.content);
  }
  return { ok: true, origin: ORIGIN, config: 'assets-only', manifest: await assetManifest(destination, PRODUCTION_FILES) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await checkProduction(), null, 2)); }
  catch (error) { console.error(`PRODUCTION CHECK FAIL: ${error.message}`); process.exitCode = 1; }
}
