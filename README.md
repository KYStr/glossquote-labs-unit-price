# 購物單價比較 / Unit Price Comparison

A bilingual, browser-only tool for comparing 2–12 products by the total price paid, size of one pack, and pack count. Weight uses g/kg, volume uses mL/L, and item count uses whole pieces. All prices must use the same currency.

輸入同一幣別的整組實付價格、每包容量及包數，比較每 100 g、每 100 mL 或每件的單價。不同類別不能混算；工具不查價、換匯或推測折扣。

The calculation uses BigInt rational numbers for parsing, quantity conversion, sorting and exact ties. Four-decimal half-up rounding is only for display. Rounded collisions retain different ranks; a positive value below display precision appears as `<0.0001` rather than free.

Example: A costs 120 for two 500 g packs; B costs 150 for one 1.5 kg pack. Their prices per 100 g are 12.0000 and 10.0000, so B ranks first. Loading the example fills the form; comparison remains an explicit action.

## Data and limits / 資料與限制

Entries and results stay in the current page's memory. Editing clears stale results, and leaving or reloading clears the form. There is no storage, analytics, remote font, product API or server-side calculation. Copy writes plain text only after a direct button action; a refused Clipboard API has a manual selection fallback. A pending copy is guarded by both request ID and input revision.

價格最多兩位小數（0–9,999,999.99），每包容量最多三位小數且大於 0、最多 1,000,000，包數為 1–1000 整數，件數不可有小數。數字只接受 ASCII 固定格式，不接受指數、正負號或千分位。所有列必須有效，不能略過缺列。名稱選填，最多 80 UTF-16 code units；合法 HTML 樣文字只作文字顯示。

This source is a release candidate for review. Public source, a deployed website, and external acceptance are separate milestones. Native clipboard, complete browser Network/Storage inspection, BFCache confirmation, assistive technology, physical mobile devices and 200% zoom still need the documented manual checks. No universal browser-support or accessibility certification claim is made. No open-source license has been assigned.

## Local commands

Node.js 24+ and Git are required for the offline test suite. No npm dependencies or installation are needed.

```powershell
npm test
npm run check
npm run build
npm run dev
```

`dev` binds only to 127.0.0.1:4196, serves approved public assets using GET/HEAD, and falls back to an OS-assigned port if occupied. It never stops an existing process. Both source pages and preview builds retain noindex; preview robots disallows crawling.

## Production candidate

```powershell
npm run build:production
npm run check:production
npm run test:production
npm run preview:production
```

Production output is generated into `dist/` with fixed URLs:

- https://price.glossquote.com/index.html — zh-Hant
- https://price.glossquote.com/en/index.html — English

Both pages have self-canonical, reciprocal language alternates and x-default, a two-page sitemap, crawlable robots, matching-language Gloss Tools backlinks, and WebApplication JSON-LD matching visible descriptions. CSP allows only exact hashes for the generated JSON-LD. The static Workers config uses explicit HTML filenames and nearest-language 404 pages, with no SPA fallback, Worker application code, bindings or observability.

`preview:production` is a loopback HTTP simulation of the checked static configuration, including status/MIME/headers/404. It does not establish live Cloudflare behavior. Live HTTPS, routing, security headers, homepage integration and external review are verified separately after deployment.

An existing Wrangler 4.147.0 installation can package the candidate without upload:

```powershell
npm run dry-run:production -- --cli /absolute/path/to/wrangler/bin/wrangler.js
```

The helper requires the reviewed version, isolates child homes/temp, disables metrics and automatic configuration/skill installation, rejects local environment files, and supplies no Cloudflare credentials. It performs no dependency installation or deployment.

## Fixed source archives

Only the explicit allowlist in `scripts/source-files.mjs` belongs to the public source set. Internal coordination/evidence, caches, build output and credentials are excluded. `scripts/verify-source.mjs` checks an extracted tree against an exact full Git commit SHA, rejects unknown/link entries, and compares every file's bytes to its Git blob:

```powershell
node scripts/verify-source.mjs /absolute/repository/path FULL_COMMIT_SHA /absolute/extracted/path
```

The build refuses symlink/junction ancestors, hardlinks and unknown stale assets before changing output. Preview/production transitions remove only the known generated metadata. Static scanning is an additional guard; it is not proof that arbitrary JavaScript has no network effects.