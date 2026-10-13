import { PUBLIC_FILES, assertSafePath } from './assets.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Only this self-contained source set is published. Internal chat/task records,
// evidence, credentials, caches and build output are never in the source tree.
export const SOURCE_FILES = Object.freeze([
  '.gitignore', 'README.md', 'package.json', 'wrangler.jsonc', ...PUBLIC_FILES.map((file) => `public/${file}`),
  ...['assets', 'build', 'check', 'check-production', 'cloudflare-dry-run', 'release', 'serve', 'serve-production', 'source-files', 'verify-source'].map((name) => `scripts/${name}.mjs`),
  ...['unit-price', 'state', 'toolchain', 'release'].map((name) => `test/${name}.test.mjs`),
].sort());
export async function sourceManifest(root) {
  const records = [];
  for (const file of SOURCE_FILES) {
    const target = path.join(root, file); await assertSafePath(target);
    const content = await readFile(target);
    if (content.length > 1048576) throw new Error('Source file is too large');
    records.push({ path: file, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
  }
  return records;
}
