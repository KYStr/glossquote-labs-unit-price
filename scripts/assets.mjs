import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const PUBLIC_FILES = Object.freeze([
  '404.html', 'en/404.html', 'en/index.html', 'index.html', 'js/app.mjs', 'js/core/unit-price.mjs', 'js/i18n.mjs', 'js/state.mjs', 'robots.txt', 'styles/app.css',
]);
export const PRODUCTION_FILES = Object.freeze([...PUBLIC_FILES, '_headers', '_redirects', 'sitemap.xml'].sort());
export const PUBLIC_DIRS = Object.freeze(['en', 'js', 'js/core', 'styles']);

export function contained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// Inspect every ancestor: checking only the final leaf misses Windows junctions.
export async function assertSafePath(target, { allowMissing = false, directory = false } = {}) {
  const absolute = path.resolve(target);
  const chain = [];
  let current = absolute;
  while (true) {
    chain.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  let finalStat;
  for (const item of chain) {
    let stat;
    try { stat = await lstat(item); }
    catch (error) {
      if (error.code === 'ENOENT' && allowMissing) continue;
      throw new Error('Missing or inaccessible asset path');
    }
    if (stat.isSymbolicLink()) throw new Error('Symlink or junction is not allowed');
    if (item !== absolute && !stat.isDirectory()) throw new Error('Asset ancestor is not a directory');
    if (stat.isFile() && stat.nlink !== 1) throw new Error('Hardlinked asset is not allowed');
    finalStat = item === absolute ? stat : undefined;
  }
  if (finalStat && (directory ? !finalStat.isDirectory() : !finalStat.isFile())) throw new Error('Unexpected asset path type');
  return finalStat;
}

export async function inspectAssetTree(root, { requireAll = true, allowedFiles = PUBLIC_FILES } = {}) {
  await assertSafePath(root, { directory: true });
  const files = [];
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (!contained(root, absolute)) throw new Error('Asset escapes public root');
      if (entry.isDirectory()) {
        if (!PUBLIC_DIRS.includes(relative)) throw new Error('Unknown asset directory');
        await assertSafePath(absolute, { directory: true });
        await visit(absolute, relative);
      } else {
        if (!allowedFiles.includes(relative)) throw new Error('Unknown asset file');
        const stat = await assertSafePath(absolute);
        if (stat.size > 1048576) throw new Error('Asset exceeds local size limit');
        files.push(relative);
      }
    }
  }
  await visit(path.resolve(root));
  files.sort();
  if (requireAll && (files.length !== allowedFiles.length || allowedFiles.some((file) => !files.includes(file)))) throw new Error('Required assets are missing');
  return files;
}

export async function assetManifest(root, allowedFiles = PUBLIC_FILES) {
  const files = await inspectAssetTree(root, { allowedFiles });
  const manifest = [];
  for (const file of files) {
    const content = await readFile(path.join(root, file));
    manifest.push({ path: file, size: content.length, sha256: createHash('sha256').update(content).digest('hex') });
  }
  return manifest;
}
