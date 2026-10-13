import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { assertSafePath } from './assets.mjs';
import { htmlTags } from './check.mjs';

export const ORIGIN = 'https://price.glossquote.com';
export const LOCALES = Object.freeze([
  Object.freeze({ page: 'index.html', lang: 'zh-Hant', name: '購物單價比較', ogLocale: 'zh_TW', home: 'https://glossquote.com/index.html' }),
  Object.freeze({ page: 'en/index.html', lang: 'en', name: 'Unit Price Comparison', ogLocale: 'en_US', home: 'https://glossquote.com/en/index.html' }),
]);
export const WRANGLER_CONFIG = Object.freeze({
  $schema: 'https://json.schemastore.org/wrangler.json', name: 'glossquote-labs-unit-price', compatibility_date: '2026-10-13',
  workers_dev: false, preview_urls: false,
  observability: { enabled: false, logs: { enabled: false }, traces: { enabled: false } },
  assets: { directory: './dist', html_handling: 'none', not_found_handling: '404-page' },
  routes: [{ pattern: 'price.glossquote.com', custom_domain: true }],
});
export const REDIRECTS = '/ /index.html 301\n/en /en/index.html 301\n/en/ /en/index.html 301\n';
export async function checkDeploymentConfig(root) {
  const file = path.join(root, 'wrangler.jsonc');
  await assertSafePath(file);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), WRANGLER_CONFIG, 'Deployment configuration differs from approved static contract');
}
const escape = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function makeProductionAssets(source) {
  const output = new Map(source);
  const hashes = [];
  for (const locale of LOCALES) {
    let html = source.get(locale.page).toString('utf8');
    const tags = htmlTags(html);
    const description = tags.find((item) => item.tag === 'meta' && item.attributes.name === 'description').attributes.content;
    const title = html.match(/<title>([^<]+)<\/title>/i)[1];
    const json = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'WebApplication', name: locale.name,
      url: `${ORIGIN}/${locale.page}`, description, inLanguage: locale.lang, applicationCategory: 'UtilitiesApplication',
    }).replace(/</g, '\\u003c');
    hashes.push(`'sha256-${createHash('sha256').update(json).digest('base64')}'`);
    html = html.replace(/<meta\b(?:"[^"]*"|'[^']*'|[^'">])*?>/gi, (tag) => {
      const attributes = htmlTags(tag)[0]?.attributes;
      return attributes?.name?.toLowerCase() === 'robots' ? '<meta name="robots" content="index, follow">' : tag;
    });
    const alternates = [...LOCALES.map((item) => `  <link rel="alternate" hreflang="${item.lang}" href="${ORIGIN}/${item.page}">`),
      `  <link rel="alternate" hreflang="x-default" href="${ORIGIN}/index.html">`];
    const seo = [
      `  <link rel="canonical" href="${ORIGIN}/${locale.page}">`, ...alternates,
      `  <meta property="og:type" content="website">`, `  <meta property="og:site_name" content="GlossQuote">`,
      `  <meta property="og:title" content="${escape(title)}">`, `  <meta property="og:description" content="${escape(description)}">`,
      `  <meta property="og:url" content="${ORIGIN}/${locale.page}">`, `  <meta property="og:locale" content="${locale.ogLocale}">`,
      `  <meta property="og:locale:alternate" content="${LOCALES.find((item) => item.lang !== locale.lang).ogLocale}">`,
      `  <script type="application/ld+json">${json}</script>`,
    ].join('\n');
    html = html.replace(/<\/head>/i, `${seo}\n</head>`);
    output.set(locale.page, Buffer.from(html));
  }
  const csp = `default-src 'none'; script-src 'self' ${hashes.join(' ')}; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  const headers = [
    '/*', `  Content-Security-Policy: ${csp}`, '  X-Content-Type-Options: nosniff', '  X-Frame-Options: DENY',
    '  Referrer-Policy: no-referrer', '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
    '  Cross-Origin-Opener-Policy: same-origin', '  Strict-Transport-Security: max-age=31536000', '  Cache-Control: no-store', '',
  ].join('\n');
  const xmlAlternates = [...LOCALES.map((item) => `    <xhtml:link rel="alternate" hreflang="${item.lang}" href="${ORIGIN}/${item.page}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/index.html"/>`].join('\n');
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${LOCALES.map((item) => `  <url>\n    <loc>${ORIGIN}/${item.page}</loc>\n${xmlAlternates}\n  </url>`).join('\n')}\n</urlset>\n`;
  output.set('robots.txt', Buffer.from(`User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`));
  output.set('sitemap.xml', Buffer.from(sitemap));
  output.set('_headers', Buffer.from(headers));
  output.set('_redirects', Buffer.from(REDIRECTS));
  return output;
}
