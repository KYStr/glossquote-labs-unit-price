import { readFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafePath } from './assets.mjs';
import { checkProduction } from './check-production.mjs';
import { projectRoot } from './check.mjs';

export const WRANGLER_VERSION = '4.147.0';
export function isolatedEnvironment(home) {
  return {
    SystemRoot: process.env.SystemRoot || 'C:\\Windows', WINDIR: process.env.WINDIR || 'C:\\Windows',
    Path: `${path.dirname(process.execPath)};C:\\Windows\\System32;C:\\Windows`,
    HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, WRANGLER_HOME: home,
    TEMP: path.join(home, 'tmp'), TMP: path.join(home, 'tmp'), WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_PATH: path.join(home, 'wrangler.log'), CI: 'true', NO_COLOR: '1',
  };
}
export async function runDryRun(cli, { root = projectRoot, help = false } = {}) {
  if (!cli) throw new Error('Pass --cli with an existing Wrangler 4.147.0 bin/wrangler.js; no installation is performed');
  const absoluteCli = path.resolve(cli);
  await assertSafePath(absoluteCli);
  const metadata = JSON.parse(await readFile(path.join(path.dirname(absoluteCli), '..', 'package.json'), 'utf8'));
  if (metadata.name !== 'wrangler' || metadata.version !== WRANGLER_VERSION) throw new Error('Wrangler version must match reviewed tooling');
  if ((await readdir(root)).some((name) => name.startsWith('.env') || name.startsWith('.dev.vars'))) throw new Error('Environment files are not allowed in the offline packaging root');
  if (!help) await checkProduction(root);
  await assertSafePath(path.join(root, '.wrangler'), { allowMissing: true, directory: true });
  const tempBase = path.join(root, 'test', '.tmp');
  await assertSafePath(tempBase, { allowMissing: true, directory: true }); await mkdir(tempBase, { recursive: true });
  const home = await mkdtemp(path.join(tempBase, 'wrangler-'));
  await mkdir(path.join(home, 'tmp'));
  const args = help ? ['deploy', '--help'] : ['deploy', '--dry-run', '--autoconfig=false', '--install-skills=false', '--config', path.join(root, 'wrangler.jsonc'), '--outdir', path.join(home, 'output')];
  const child = spawnSync(process.execPath, [absoluteCli, ...args], { cwd: root, env: isolatedEnvironment(home), encoding: 'utf8', timeout: 45000 });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr, toolVersion: metadata.version, isolatedHome: home, errorCode: child.error?.code || null };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const cliIndex = process.argv.indexOf('--cli');
    const result = await runDryRun(cliIndex < 0 ? null : process.argv[cliIndex + 1], { help: process.argv.includes('--help') });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    console.log(JSON.stringify({ toolVersion: result.toolVersion, isolatedHome: result.isolatedHome, exit: result.status, errorCode: result.errorCode }));
    process.exitCode = result.status ?? 1;
  } catch (error) { console.error(`DRY RUN FAIL: ${error.message}`); process.exitCode = 1; }
}
