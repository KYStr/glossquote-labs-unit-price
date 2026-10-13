import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { SOURCE_FILES } from './source-files.mjs';
import { assertSafePath, contained } from './assets.mjs';

function git(root, args) {
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', '-C', root, ...args], { maxBuffer: 16777216 });
  if (result.status !== 0) throw new Error('Git source inspection failed');
  return result.stdout;
}
export async function verifySource(repository, commit, extracted) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Use an exact full commit SHA');
  await assertSafePath(repository, { directory: true }); await assertSafePath(extracted, { directory: true });
  const tree = git(repository, ['ls-tree', '-r', '-z', commit]).toString('utf8').split('\0').filter(Boolean).map((entry) => {
    const match = entry.match(/^(100644|100755) blob ([a-f0-9]{40})\t([ -~]+)$/);
    if (!match || !SOURCE_FILES.includes(match[3])) throw new Error('Unexpected or linked Git tree entry');
    return { mode: match[1], blob: match[2], path: match[3] };
  });
  assert.deepEqual(tree.map((entry) => entry.path).sort(), [...SOURCE_FILES]);
  const actual = [];
  const allowedDirectories = new Set(SOURCE_FILES.flatMap((file) => {
    const parts = file.split('/'); const result = [];
    for (let count = 1; count < parts.length; count++) result.push(parts.slice(0, count).join('/'));
    return result;
  }));
  async function walk(root, prefix = '') {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(root, entry.name);
      if (!contained(extracted, absolute)) throw new Error('Extracted path escapes source root');
      if (entry.isDirectory()) {
        if (!allowedDirectories.has(relative)) throw new Error('Unknown extracted directory');
        await assertSafePath(absolute, { directory: true }); await walk(absolute, relative);
      } else {
        if (!SOURCE_FILES.includes(relative)) throw new Error('Unknown extracted source file');
        await assertSafePath(absolute); actual.push(relative);
      }
    }
  }
  await walk(extracted); assert.deepEqual(actual.sort(), [...SOURCE_FILES]);
  const manifest = [];
  for (const entry of tree) {
    const blob = git(repository, ['cat-file', 'blob', entry.blob]); const disk = await readFile(path.join(extracted, entry.path));
    assert.deepEqual(disk, blob, `Source bytes differ from Git blob: ${entry.path}`);
    manifest.push({ ...entry, bytes: blob.length, sha256: createHash('sha256').update(blob).digest('hex') });
  }
  return { ok: true, commit, files: manifest.length, manifest };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await verifySource(process.argv[2], process.argv[3], process.argv[4]), null, 2)); }
  catch (error) { console.error(`SOURCE VERIFY FAIL: ${error.message}`); process.exitCode = 1; }
}
