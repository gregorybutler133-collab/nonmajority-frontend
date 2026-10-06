/* Regression test: Lead Finder evidence-confidence chip (High / Medium / Low) in the real index.html.
   Run:  node tests/lead-finder-confidence.ui.test.mjs      (needs Playwright + Chromium installed)
   Self-contained: serves index.html from a temporary local server and mocks every /v1 API call in the browser.
   It never contacts the dev or production API, and never writes anything.
   Note: the chip's CSS uppercases its text, so text is compared with textContent, not innerText. */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(process.env.PLAYWRIGHT_MODULES ? process.env.PLAYWRIGHT_MODULES.replace(/\/?$/, '/') : import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright')); }
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : path.normalize(q.url.split('?')[0]).replace(/^(\.\.[/\\])+/, '')); fs.readFile(f, (e, b) => { if (e) { s.statusCode = 404; return s.end('nf'); } s.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); s.end(b); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = 'http://127.0.0.1:' + server.address().port;
const bearer = 'test-token', ws = 'ws_test';
let pass = 0, fail = 0; const check = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n, c ? '' : JSON.stringify(x || '').slice(0, 300)); };
const R = (l, p, rs) => ({ level: l, points: p, reasons: rs });
const DATA = [
  ['KJI Plumbing', 84, 'HIGH', R('Medium', 4, ['Their own site was not read directly.', '2 independent public sources.', '5 verified findings.', 'Some details stated by a cited source.', 'Most findings are inference.'])],
  ['Loyall Plumbing', 79, 'HIGH', R('High', 8, ['Their own site was read directly.', '4 independent public sources.', '11 verified findings.', 'Some details stated by a cited source.'])],
  ['AV Roofing & Construction, Inc.', 78, 'HIGH', R('Medium', 4, ['Their own site was not read directly.', '2 independent public sources.', '4 verified findings.', 'Some details stated by a cited source.', 'Most findings are inference.'])],
  ['Pacific Hydrojetting & Rooter', 73, 'MEDIUM', R('Low', 2, ['Their own site was not read directly.', '1 independent public source.', '1 verified finding.', 'Some details stated by a cited source.', 'Most findings are inference.'])],
  ['Select Home Services', 47, 'LOW', R('Low', 1, ['Their own site was not read directly.', 'No independent public source.', '1 verified finding.', 'Some details stated by a cited source.', 'Most findings are inference.'])],
];
const run = { id: 'lf_fixture', status: 'complete', criteria: { industry: 'plumber', location: 'Palmdale, CA', count: 5 }, notes: [], usage: { searches: 3, cost_usd: 0.09 }, candidates: DATA.map((d, i) => ({ id: 'c' + (i + 1), name: d[0], city: 'Palmdale', state: 'CA', industry: 'Plumbing', status: 'done', score: d[1], tier: d[2], confidence: d[3], web: { state: 'analysed', url: 'https://x.example.com/' }, contact: {}, social: {}, problems: [], growth: [], factors: [], why: [], evidence: [], recommended: { service: 'Website', offer: 'o', channel: 'Call', channel_reason: 'r' } })) };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(async () => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
await page.route(/\/v1\//, (r) => { const u = r.request().url(); if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS }); if (/lead-finder\/runs\/lf_fixture/.test(u)) return r.fulfill({ json: { ok: true, run }, headers: CORS }); if (/lead-finder\/runs(\?.*)?$/.test(u) && r.request().method() === 'GET') return r.fulfill({ json: { ok: true, runs: [{ id: run.id, status: 'complete', criteria: run.criteria }] }, headers: CORS }); return r.fulfill({ json: { ok: true }, headers: CORS }); });
await page.goto(BASE + '/index.html'); await page.waitForTimeout(900);
await page.evaluate(() => { const m = document.querySelector('#modal.open [data-close]'); if (m) m.click(); }); await page.waitForTimeout(300);
await page.evaluate(([b, w]) => { const c = LDCLOUD.cfg(); c.apiUrl = 'http://127.0.0.1:9'; c.token = b; c.workspaceId = w; c.email = 'g@example.com'; c.workspaces = [{ id: w, name: 'My Business' }]; LD.save(); }, [bearer, ws]);
await page.evaluate(() => LDCLOUD.pull()); await page.waitForTimeout(400);
await page.evaluate(() => { const m = document.querySelector('#modal.open [data-close]'); if (m) m.click(); }); await page.waitForTimeout(300);
await page.evaluate(() => LD.goto('crm', 'leadfinder')); await page.waitForSelector('.ai-cand', { timeout: 8000 }).catch(() => {});
const cards = await page.locator('.ai-cand').count(); check('five candidate cards rendered', cards === 5, cards);
for (const d of DATA) {
  const c = page.locator('.ai-cand', { hasText: d[0] }).first();
  const txt = await c.innerText();
  const scoreTxt = await c.locator('.ai-score').innerText();
  const chip = c.locator('span.pill', { hasText: 'Confidence' }).first();
  const chipTxt = (await chip.textContent()).trim();
  check(d[0] + ': name, score ' + d[1] + ', tier ' + d[2], txt.includes(d[0]) && scoreTxt.replace(/\s+/g, ' ').includes(String(d[1])) && scoreTxt.toUpperCase().includes(d[2]), scoreTxt);
  check(d[0] + ': chip "Confidence: ' + d[3].level + '"', chipTxt === 'Confidence: ' + d[3].level, chipTxt);
  const title = await chip.getAttribute('title'), aria = await chip.getAttribute('aria-label');
  check(d[0] + ': reasons in hover title + aria-label', d[3].reasons.every((r) => title.includes(r) && aria.includes(r)) && aria.startsWith('Evidence confidence ' + d[3].level), { title, aria });
  check(d[0] + ': score element does not contain confidence text', !/confidence/i.test(scoreTxt), scoreTxt);
  check(d[0] + ': score aria-label stays "Opportunity score ' + d[1] + '"', (await c.locator('.ai-score').getAttribute('aria-label')) === 'Opportunity score ' + d[1]);
}
const sep = await page.evaluate(() => { const c = document.querySelector('.ai-cand'); const s = c.querySelector('.ai-score').getBoundingClientRect(), p = [...c.querySelectorAll('span.pill')].find((e) => /Confidence/.test(e.textContent)).getBoundingClientRect(); return { sx: s.right, px: p.left, overlap: !(s.right <= p.left || p.right <= s.left || s.bottom <= p.top || p.bottom <= s.top) }; });
check('score badge and confidence chip are separate, non-overlapping elements', !sep.overlap && sep.sx <= sep.px + 1, sep);
const colors = await page.evaluate(() => [...document.querySelectorAll('.ai-cand')].map((c) => [getComputedStyle(c.querySelector('.ai-score')).borderColor, getComputedStyle([...c.querySelectorAll('span.pill')].find((e) => /Confidence/.test(e.textContent))).borderColor]));
check('chip styling is neutral and identical for High/Medium/Low (no colour implying confidence from score)', new Set(colors.map((c) => c[1])).size === 1, colors);
const k = await page.locator('.ai-cand', { hasText: 'KJI' }).first();
check('84/HIGH with Medium confidence: score 84 kept, chip says Medium (high score does not imply high confidence)', (await k.locator('.ai-score').innerText()).includes('84') && (await k.textContent()).includes('Confidence: Medium'));
const s5 = await page.locator('.ai-cand', { hasText: 'Select Home' }).first();
check('Low confidence leaves score 47 / LOW intact', (await s5.locator('.ai-score').innerText()).includes('47') && (await s5.textContent()).includes('Confidence: Low'));
check('existing Lead Finder controls still render (form, filters, save button)', (await page.locator('#lfIndustry').count()) > 0 && (await page.locator('[data-ai=c-save]').count()) >= 1);
// lead card
const lead = await page.evaluate((d) => { const x = { id: 'L1', business: 'Fixture Co', ai_intel: { score: d[1], tier: d[2], confidence: d[3], recommended: {} } }; const box = document.createElement('div'); box.id = 'fx'; box.innerHTML = LDAI.leadCard(x); document.body.appendChild(box); const chip = [...box.querySelectorAll('span.pill')].find((e) => /Confidence/.test(e.textContent)); const t = box.innerText; box.remove(); return { chip: chip && chip.textContent, title: chip && chip.title, t }; }, DATA[0]);
check('lead card shows Opportunity score 84 + HIGH and Confidence: Medium chip', lead.chip === 'Confidence: Medium' && /84/.test(lead.t) && /HIGH/.test(lead.t) && lead.title.includes('5 verified findings.'), lead);
const noIntel = await page.evaluate(() => LDAI.leadCard({ id: 'L2', business: 'No Intel' }));
check('lead card without Lead Finder data renders and has no confidence chip', typeof noIntel === 'string' && !/Confidence:/.test(noIntel));
const oldIntel = await page.evaluate(() => LDAI.leadCard({ id: 'L3', business: 'Old', ai_intel: { score: 60, tier: 'MEDIUM', recommended: {} } }));
check('older saved lead (intel without confidence) still renders, no chip, no error', /60/.test(oldIntel) && !/Confidence:/.test(oldIntel));
check('no JavaScript errors', errs.length === 0, errs);
console.log('\n' + pass + ' passed, ' + fail + ' failed'); await browser.close(); server.close(); process.exit(fail ? 1 : 0);
