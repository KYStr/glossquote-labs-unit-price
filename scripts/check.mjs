import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PUBLIC_FILES, inspectAssetTree, assertSafePath } from './assets.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function decodeAttribute(text) {
  return text.replace(/&(?:#(x[0-9a-f]+|[0-9]+);?|([a-z]+);)/gi, (entity, code, named) => {
    if (code) {
      const number = code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
      if (number > 0x10FFFF) throw new Error('Invalid HTML character reference');
      return String.fromCodePoint(number);
    }
    const values = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', colon: ':', sol: '/', tab: '\t', newline: '\n' };
    return values[named.toLowerCase()] ?? entity;
  });
}

export function htmlTags(html) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  if (/<!--|-->/.test(clean)) throw new Error('Unclosed HTML comment');
  const tags = [];
  const tagPattern = /<(\/?)([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  for (const match of clean.matchAll(tagPattern)) {
    if (match[1]) continue;
    const attributes = {};
    const attrPattern = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const attr of match[3].matchAll(attrPattern)) {
      const name = attr[1].toLowerCase();
      if (Object.hasOwn(attributes, name)) throw new Error('Duplicate HTML attribute');
      attributes[name] = decodeAttribute(attr[2] ?? attr[3] ?? attr[4] ?? '');
    }
    tags.push({ tag: match[2].toLowerCase(), attributes });
  }
  return tags;
}

export function resolveAsset(from, value) {
  if (!value || /[\\\u0000-\u0020%]/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//') || /[?#]/.test(value)) throw new Error('Nonlocal or ambiguous asset reference');
  const normalized = value.startsWith('/') ? path.posix.normalize(value).slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(from), value));
  if (!PUBLIC_FILES.includes(normalized)) throw new Error('Reference is outside approved assets');
  return normalized;
}

export async function checkProject(root = projectRoot) {
  if (Number.parseInt(process.versions.node.split('.')[0], 10) < 24) throw new Error('Node 24 or newer is required');
  const config = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (config.type !== 'module' || config.private !== true || config.engines?.node !== '>=24' || Object.keys(config.dependencies || {}).length || Object.keys(config.devDependencies || {}).length) throw new Error('Package violates M1 dependency contract');
  for (const file of ['serve.mjs', 'check.mjs', 'build.mjs', 'assets.mjs', 'release.mjs', 'check-production.mjs', 'serve-production.mjs', 'cloudflare-dry-run.mjs', 'source-files.mjs', 'verify-source.mjs']) {
    const target = path.join(root, 'scripts', file);
    await assertSafePath(target);
    const syntax = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
    if (syntax.status !== 0) throw new Error(`Script syntax failed: ${file}`);
  }
  const publicRoot = path.join(root, 'public');
  await inspectAssetTree(publicRoot);
  const contents = new Map();
  for (const file of PUBLIC_FILES) contents.set(file, await readFile(path.join(publicRoot, file), 'utf8'));
  const idsByPage = [];
  for (const [page, lang] of [['index.html', 'zh-Hant'], ['en/index.html', 'en'], ['404.html', 'zh-Hant'], ['en/404.html', 'en']]) {
    const isApp = page.endsWith('index.html');
    const home = lang === 'en' ? 'https://glossquote.com/en/index.html' : 'https://glossquote.com/index.html';
    const html = contents.get(page);
    const tags = htmlTags(html);
    const find = (tag) => tags.filter((item) => item.tag === tag);
    const ids = tags.map((item) => item.attributes.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate page ID');
    if (find('html').length !== 1 || find('html')[0].attributes.lang !== lang || find('h1').length !== 1 || !/<title>[^<]+<\/title>/i.test(html)) throw new Error('Language, heading, or title is missing');
    const robots = find('meta').filter((item) => item.attributes.name?.toLowerCase() === 'robots');
    if (robots.length !== 1 || robots[0].attributes.content?.toLowerCase() !== 'noindex, nofollow') throw new Error('Preview robots must be active noindex, nofollow');
    if (!find('meta').some((item) => item.attributes.name === 'description' && item.attributes.content)) throw new Error('Page description is missing');
    if (find('link').some((item) => /canonical|alternate/i.test(item.attributes.rel || '')) || find('script').some((item) => item.attributes.type === 'application/ld+json')) throw new Error('Production SEO is not allowed in M1');
    const resources = [];
    for (const { tag, attributes } of tags) {
      if (tag === 'meta' && attributes['http-equiv']?.trim().toLowerCase() === 'refresh') throw new Error('Meta refresh navigation is not allowed');
      if (['base', 'iframe', 'object', 'embed'].includes(tag)) throw new Error('Active embedded content is not allowed');
      if (Object.keys(attributes).some((name) => /^on/i.test(name)) || Object.hasOwn(attributes, 'srcdoc') || Object.hasOwn(attributes, 'srcset') || Object.hasOwn(attributes, 'style')) throw new Error('Inline active attribute is not allowed');
      if (tag === 'script' && (attributes.type !== 'module' || !attributes.src)) throw new Error('Only local module scripts are allowed');
      for (const name of ['href', 'src', 'action', 'formaction', 'poster', 'data', 'xlink:href']) {
        if (!Object.hasOwn(attributes, name)) continue;
        const value = attributes[name];
        if (name === 'action' || name === 'formaction') throw new Error('Forms may not transmit input');
        if (tag === 'a' && name === 'href' && value.startsWith('#')) {
          if (!ids.includes(value.slice(1))) throw new Error('Missing fragment target');
        } else {
          if (tag === 'a' && name === 'href' && value === home) continue;
          const resolved = resolveAsset(page, value);
          if (tag === 'script' && resolved !== 'js/app.mjs') throw new Error('Unapproved script');
          if (tag === 'link' && (attributes.rel !== 'stylesheet' || resolved !== 'styles/app.css')) throw new Error('Unapproved stylesheet');
          if (tag !== 'a') resources.push(resolved);
        }
      }
      for (const name of ['for', 'aria-labelledby', 'aria-describedby']) {
        if (attributes[name] && attributes[name].split(/\s+/).some((id) => !ids.includes(id))) throw new Error('Missing accessible label target');
      }
    }
    if (resources.sort().join(',') !== (isApp ? 'js/app.mjs,styles/app.css' : 'styles/app.css')) throw new Error('Required page resources are missing');
    if (!find('a').some((item) => item.attributes.href === home)) throw new Error('Matching-language homepage link is missing');
    const alternate = page === 'index.html' ? 'en/index.html' : 'index.html';
    if (isApp && !find('a').some((item) => item.attributes.hreflang && resolveAsset(page, item.attributes.href) === alternate)) throw new Error('Language switch is missing');
    if (isApp && (!find('noscript').length || !tags.some((item) => item.attributes.id === 'app' && Object.hasOwn(item.attributes, 'hidden')))) throw new Error('No-JavaScript recovery is missing');
    if (isApp) idsByPage.push(ids.sort().join(','));
  }
  if (idsByPage[0] !== idsByPage[1]) throw new Error('Locale controls are not equivalent');
  const css = contents.get('styles/app.css');
  if (/@import\b|url\s*\(/i.test(css)) throw new Error('CSS external assets are not allowed');
  for (const file of PUBLIC_FILES.filter((name) => name.endsWith('.mjs'))) {
    const script = contents.get(file);
    if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|caches|serviceWorker|eval|execCommand|readText|innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b|\bdocument\.cookie\b|\bnew\s+Function\b|\bconsole\s*\./.test(script)) throw new Error('Prohibited runtime API');
    if (/\bimport\s*\(/.test(script)) throw new Error('Dynamic module loading is not allowed');
    for (const reference of script.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/g)) resolveAsset(file, reference[1]);
    const result = spawnSync(process.execPath, ['--check', path.join(publicRoot, file)], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Module syntax failed: ${file}`);
  }
  if (!/^User-agent: \*\r?\nDisallow: \/\r?\n?$/.test(contents.get('robots.txt'))) throw new Error('Preview crawler disallow is missing');
  return { ok: true, files: PUBLIC_FILES.length, locales: ['zh-Hant', 'en'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await checkProject())); }
  catch (error) { console.error(`CHECK FAIL: ${error.message}`); process.exitCode = 1; }
}
