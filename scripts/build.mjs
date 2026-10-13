import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PUBLIC_FILES, PRODUCTION_FILES, assertSafePath, inspectAssetTree, assetManifest, contained } from './assets.mjs';
import { checkProject, projectRoot } from './check.mjs';
import { makeProductionAssets, checkDeploymentConfig } from './release.mjs';

export async function buildPreview(root = projectRoot) {
  return buildAssets(root, false);
}
export async function buildProduction(root = projectRoot) {
  return buildAssets(root, true);
}
async function buildAssets(root, production) {
  await assertSafePath(root, { directory: true });
  await checkProject(root);
  if (production) await checkDeploymentConfig(root);
  const source = path.join(root, 'public');
  const destination = path.resolve(root, 'dist');
  if (!contained(root, destination) || destination === path.resolve(root)) throw new Error('Build destination is outside tool');
  const existing = await assertSafePath(destination, { allowMissing: true, directory: true });
  if (existing) await inspectAssetTree(destination, { requireAll: false, allowedFiles: PRODUCTION_FILES });
  else await mkdir(destination);
  // Validate the entire existing output before writing any file. Unknown/stale
  // files and links cause a refusal; never recursively delete a build folder.
  const sourceFiles = new Map();
  for (const file of PUBLIC_FILES) sourceFiles.set(file, await readFile(path.join(source, file)));
  const output = production ? makeProductionAssets(sourceFiles) : sourceFiles;
  for (const file of PRODUCTION_FILES.filter((file) => !output.has(file))) {
    const stale = path.join(destination, file);
    if (await assertSafePath(stale, { allowMissing: true })) await unlink(stale);
  }
  for (const [file, content] of output) {
    const target = path.join(destination, file);
    const parent = path.dirname(target);
    await assertSafePath(parent, { allowMissing: true, directory: true });
    await mkdir(parent, { recursive: true });
    await assertSafePath(target, { allowMissing: true });
    const temporary = path.join(parent, `.${path.basename(target)}-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { flag: 'wx' });
      await assertSafePath(target, { allowMissing: true });
      await rename(temporary, target);
    } finally {
      const leftover = await assertSafePath(temporary, { allowMissing: true });
      if (leftover) await unlink(temporary);
    }
  }
  return { ok: true, mode: production ? 'production' : 'preview-noindex', manifest: await assetManifest(destination, production ? PRODUCTION_FILES : PUBLIC_FILES) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await (process.argv.includes('--production') ? buildProduction() : buildPreview()), null, 2)); }
  catch (error) { console.error(`BUILD FAIL: ${error.message}`); process.exitCode = 1; }
}
