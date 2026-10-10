/* Regression test: AI Training — two brand profiles, approved-example retrieval, master training, quality checks,
   and proof that the saved training really reaches the AI request (the /v1/ai/chat body the browser sends).
   Run:  node tests/ai-training-brands.ui.test.mjs      (needs Playwright + Chromium installed)
   Self-contained: serves index.html from a temporary local server and mocks every /v1 API call in the browser.
   It never contacts the dev or production API. */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(process.env.PLAYWRIGHT_MODULES ? process.env.PLAYWRIGHT_MODULES.replace(/\/?$/, '/') : import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright')); }
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : path.normalize(q.url.split('?')[0]).replace(/^(\.\.[/\\])+/, '')); fs.readFile(f, (e, b) => { if (e) { s.statusCode = 404; return s.end('nf'); } s.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); s.end(b); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = 'http://127.0.0.1:' + server.address().port;
let pass = 0, fail = 0; const check = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 400)); };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(async () => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
let sent = []; /* every AI request body the browser sends */
await page.route(/\/v1\//, (r) => {
  const u = r.request().url(); if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
  if (/\/v1\/ai\/chat/.test(u)) { sent.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ json: { choices: [{ message: { content: 'ok' } }] }, headers: CORS }); }
  return r.fulfill({ json: { ok: true }, headers: CORS });
});
const closeModal = async () => { await page.evaluate(() => { const m = document.querySelector('#modal.open [data-close]'); if (m) m.click(); }); await page.waitForTimeout(250); };
const dropSplash = () => page.evaluate(() => { const x = document.getElementById('splash'); if (x) x.remove(); });
const reload = async () => { await page.reload(); await page.waitForTimeout(900); await dropSplash(); await closeModal(); };
const boot = async () => {
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(900); await dropSplash(); await closeModal();
  await page.evaluate(() => { const c = LDCLOUD.cfg(); c.apiUrl = 'http://127.0.0.1:9'; c.token = 'test-token'; c.workspaceId = 'ws_test'; c.email = 'g@example.com'; c.workspaces = [{ id: 'ws_test', name: 'My Business' }]; LD.save(); });
  await closeModal();
};
const nm = () => page.evaluate(() => JSON.parse(JSON.stringify(LDOS.space().nm)));
const ask = async (feature, text) => { sent = []; await page.evaluate(([f, t]) => LDNET.chat({ feature: f, task: 'write', system: 'You are helpful.', messages: [{ role: 'user', content: t }], maxTokens: 50 }), [feature, text]); return (sent[0] && sent[0].system) || ''; };
const clickNm = async (action, a) => { await page.evaluate(([ac, ar]) => { const b = document.createElement('button'); b.setAttribute('data-nm', ac); if (ar != null) b.setAttribute('data-a', ar); document.body.appendChild(b); b.click(); b.remove(); }, [action, a]); await page.waitForTimeout(300); };
const goto = async (sec, pg) => { await page.evaluate(([s, p]) => LD.goto(s, p), [sec, pg]); await page.waitForTimeout(350); };

await boot();
/* a legacy example saved before this feature existed (no brand / approved fields) must be preserved and stay in use */
await page.evaluate(() => { const n = LDOS.space().nm || (LDOS.space().nm = {}); n.examples = [{ id: 'ex_legacy', kind: 'good_script', title: 'Old reel', text: 'Legacy reel script about plumber websites that load slowly and lose calls', created: new Date().toISOString() }]; LD.save(); });
await goto('aitraining', 'brands');
let html = await page.locator('.wrap.nm').innerText();
check('Brands page renders both brand profiles', /NONMAJORITY DIGITAL/.test(html) && /NON MAJORITY/.test(html) && /Apply NONMAJORITY master training/.test(html));
let d = await nm();
check('legacy example is kept and migrated as approved / both brands', d.examples.length === 1 && d.examples[0].approved === true && d.examples[0].brand === 'all', d.examples);

/* master training: confirm modal, backup, overwrite */
await page.evaluate(() => { LDOS.space().nm.training.business.description = 'My old description'; LDOS.space().nm.training.brands.digital.industry = 'OLD INDUSTRY TEXT'; LD.save(); });
await clickNm('masterAsk'); await page.waitForTimeout(200);
check('master apply asks for confirmation and mentions the backup', /backed up|backup/i.test(await page.locator('#modal').innerText()));
await clickNm('masterDo'); await page.waitForTimeout(400);
d = await nm();
check('backup of the previous training was saved first', d.flags.trainingBackup && d.flags.trainingBackup.training.brands.digital.industry === 'OLD INDUSTRY TEXT', d.flags.trainingBackup && d.flags.trainingBackup.training.brands.digital.industry);
check('digital profile overwritten with master text', /B2B digital growth agency/.test(d.training.brands.digital.industry) && /Don't be the majority/.test(d.training.brands.digital.positioning));
check('outdoor profile filled with master text', /City > Trail > Summit/.test(d.training.brands.outdoor.positioning) && /outdoor sports/.test(d.training.brands.outdoor.targetMarket));
check('master rules added with brand scope and priority', d.instructions.some((i) => i.brand === 'digital' && i.priority === 'CRITICAL' && /guaranteed rankings/.test(i.text)) && d.instructions.some((i) => i.brand === 'outdoor'));
check('existing example survived the overwrite', d.examples.some((e) => e.id === 'ex_legacy'));
await reload();
d = await nm();
check('training persists across a page reload', /B2B digital growth agency/.test(d.training.brands.digital.industry) && d.instructions.length >= 13);

/* autosave from the real input */
await goto('aitraining', 'brands');
await page.fill('[data-nmf="brand.outdoor.services"]', 'Products, drops, and trail stories'); await page.waitForTimeout(1100);
await reload();
d = await nm();
check('typing in a brand field autosaves and survives a reload', d.training.brands.outdoor.services === 'Products, drops, and trail stories' && !!d.training.brands.outdoor.reviewed);

/* brand selection through the real chip row */
await goto('aitraining', 'brands');
await page.click('.nm-brandbar button:has-text("NONMAJORITY DIGITAL")'); await page.waitForTimeout(300);
check('brand chip selects NONMAJORITY DIGITAL', (await nm()).training.activeBrand === 'digital');
let sys = await ask('ask_ai', 'Write a follow-up for a plumber lead who asked about a website');
check('digital: training block is in the AI request', /AI TRAINING CONTEXT/.test(sys) && /ACTIVE BRAND: NONMAJORITY DIGITAL/.test(sys));
check('digital: brand profile + rules reach the request', /B2B digital growth agency/.test(sys) && /guaranteed rankings/.test(sys) && /smallest appropriate solution/.test(sys));
check('digital: outdoor brand material is NOT in the request', !/City > Trail > Summit/.test(sys) && !/Mountain-inspired streetwear/i.test(sys) && !/authentic to people who actually do outdoor sports/.test(sys), sys.match(/.{60}Trail.{60}/));
check('hierarchy and example rules are in the request', /never copy their wording/.test(sys) && /stay separate/.test(sys));

await page.click('.nm-brandbar button:has-text("NON MAJORITY")'); await page.waitForTimeout(300);
sys = await ask('ask_ai', 'Write a caption for a new snowboard jacket drop');
check('outdoor: active brand + profile reach the request', /ACTIVE BRAND: NON MAJORITY/.test(sys) && /City > Trail > Summit/.test(sys) && /outdoor sports/.test(sys));
check('outdoor: agency profile, pricing/offer rules are NOT in the request', !/B2B digital growth agency/.test(sys) && !/guaranteed rankings/.test(sys) && !/smallest appropriate solution/.test(sys) && !/Don't be the majority/.test(sys));
check('shared rules still apply to both brands', /Never fabricate/.test(sys) && /API keys/.test(sys));
sys = await ask('outreach_email', 'Write outreach to a roofing company with a slow website');
check('outreach is always NONMAJORITY DIGITAL, even when outdoor is selected', /ACTIVE BRAND: NONMAJORITY DIGITAL/.test(sys) && !/City > Trail > Summit/.test(sys));

/* Auto mode infers the brand from the wording */
await page.click('.nm-brandbar button:has-text("Auto")'); await page.waitForTimeout(300);
sys = await ask('ask_ai', 'Plan three reels about snowboarding and hiking in our new hoodie');
check('Auto: outdoor wording selects NON MAJORITY', /ACTIVE BRAND: NON MAJORITY/.test(sys));
sys = await ask('ask_ai', 'Draft SEO fixes and a CRM automation pitch for a dentist website');
check('Auto: agency wording selects NONMAJORITY DIGITAL', /ACTIVE BRAND: NONMAJORITY DIGITAL/.test(sys));
sys = await ask('ask_ai', 'What should I work on today?');
check('Auto: ambiguous wording assumes no brand and never pulls in the outdoor brand', /No brand is selected/.test(sys) && !/ACTIVE BRAND: /.test(sys) && !/City > Trail > Summit/.test(sys) && !/authentic to people who actually do outdoor sports/.test(sys));

/* examples: approval, brand scoping, task relevance */
await goto('aitraining', 'examples');
const addEx = async (kind, brand, title, text, approved) => {
  await page.selectOption('#exKind', kind); await page.selectOption('#exBrand', brand); await page.fill('#exTitle', title); await page.fill('#exText', text);
  if (!approved) await page.uncheck('#exApproved'); await page.click('[data-nm="exAdd"]'); await page.waitForTimeout(300);
};
await addEx('good_outreach', 'digital', 'Roofing outreach', 'Hi Sam, your roofing site takes six seconds to load on a phone, which loses calls. A lighter page usually fixes it. Want me to show you the before and after?', true);
await addEx('good_outreach', 'digital', 'Dentist outreach', 'Hi Dana, the booking form on your dental site fails on mobile. Fixing it keeps new patients from bouncing. Open to a quick look?', true);
await addEx('follow_up', 'digital', 'Plumber follow-up', 'Quick follow-up on the plumber website idea from Tuesday. Still worth a look, or should I close the loop?', true);
await addEx('good_outreach', 'digital', 'Cafe outreach', 'Hi Lee, your cafe menu is a PDF that is hard to read on a phone. A simple menu page would help. Interested?', true);
await addEx('good_outreach', 'digital', 'UNAPPROVED outreach', 'UNAPPROVED-MARKER message that must never reach the AI request at all.', false);
await addEx('brand_content', 'outdoor', 'Trail caption', 'OUTDOOR-MARKER first light on the ridge, 40 degrees, shell packed, bike loaded.', true);
d = await nm();
check('examples saved with brand and approval flags', d.examples.filter((e) => e.brand === 'digital').length === 5 && d.examples.some((e) => e.approved === false && /UNAPPROVED/.test(e.text)));
await goto('aitraining', 'brands'); await page.click('.nm-brandbar button:has-text("NONMAJORITY DIGITAL")'); await page.waitForTimeout(300);
sys = await ask('outreach_email', 'Roofing company website loads slowly on phones');
check('approved digital example matching the request is retrieved', /Roofing site|roofing site takes six seconds/i.test(sys) && /APPROVED EXAMPLE \(Good outreach, NONMAJORITY DIGITAL\)/.test(sys));
check('unapproved example is never sent', !/UNAPPROVED-MARKER/.test(sys));
check('outdoor example is never sent to a digital task', !/OUTDOOR-MARKER/.test(sys));
const nEx = (sys.match(/- APPROVED EXAMPLE \(/g) || []).length;
const firstEx = (sys.match(/- APPROVED EXAMPLE \(.{0,160}/) || [''])[0];
check('at most 3 of the 5 digital examples are retrieved, best match for the request listed first', nEx === 3 && /roofing site/.test(firstEx) && !(/dental site/.test(sys) && /cafe menu is a PDF/.test(sys)), { nEx, firstEx });
await page.click('.nm-brandbar button:has-text("NON MAJORITY")'); await page.waitForTimeout(300);
sys = await ask('ask_ai', 'Write a caption about a ridge ride');
check('outdoor task retrieves the outdoor example, not digital ones', /OUTDOOR-MARKER/.test(sys) && !/roofing site takes six seconds/.test(sys));

/* Script tool (the Content Studio gen() path) */
await page.evaluate(() => { const n = LDOS.space().nm; n.scripts.unshift({ id: 'sc_t', name: 'Slow site reel', ideaId: '', hook: 'Your site loses calls', script: 'Your plumber website takes six seconds on a phone. Here is the fix and what it costs you in missed calls.', type: '', pillar: '', platform: 'TikTok', audience: '', cta: '', concept: '', broll: '', filming: '', caption: '', durationOverride: 0, status: 'draft', created: '2026-01-01', filmedDate: '', postedDate: '', tags: [], notes: '', versions: [], archived: false, aiGenerated: false, updated: new Date().toISOString() }); LD.state.nm.scriptId = 'sc_t'; LD.save(); });
await page.click('.nm-brandbar button:has-text("NONMAJORITY DIGITAL")').catch(() => {});
await page.evaluate(() => { LDOS.space().nm.training.activeBrand = 'digital'; LD.save(); });
sent = []; await clickNm('tool', 'hook'); await page.waitForTimeout(700);
const toolSys = (sent[0] && sent[0].system) || '';
check('Content Studio script tool sends the training context for the selected brand', /ACTIVE BRAND: NONMAJORITY DIGITAL/.test(toolSys) && /AI TRAINING CONTEXT \(retrieved for this task: script\)/.test(toolSys) && !/City > Trail > Summit/.test(toolSys), toolSys.slice(0, 200));

/* quality checks */
await page.evaluate(() => { const n = LDOS.space().nm; n.examples.push({ id: 'ex_mix', kind: 'good_caption', title: 'Mixed one', text: 'Our new snowboard hoodie for the trail and the summit', brand: 'digital', approved: true, created: new Date().toISOString() }, { id: 'ex_dupA', kind: 'sales_messaging', title: 'Dup A', text: 'Fix the slow website and the broken lead form this month.', brand: 'digital', approved: true, created: new Date().toISOString() }, { id: 'ex_dupB', kind: 'sales_messaging', title: 'Dup B', text: 'Fix the slow website and the broken lead form this month.', brand: 'digital', approved: true, created: new Date().toISOString() }); n.training.groups.push({ id: 'gr_short', name: 'Short', text: 'Be nice.', brand: 'all', enabled: true }); n.training.brands.outdoor.reviewed = '2024-01-01'; LD.save(); });
await goto('aitraining', 'health');
const hh = await page.locator('.wrap.nm').innerText();
check('Training Health: mixed-brand content is flagged', /Content mixes the two brands/.test(hh) && /Mixed one/.test(hh));
check('Training Health: duplicate example pair is flagged', /duplicate example pair/.test(hh));
check('Training Health: unapproved example is flagged', /saved but not approved/.test(hh));
check('Training Health: incomplete custom instruction is flagged', /Incomplete custom instructions/.test(hh));
check('Training Health: outdated brand offers are flagged', /NON MAJORITY offers may be outdated/.test(hh));
check('Training Health: every problem has a Fix button', (await page.locator('.nm-rec button:has-text("Fix")').count()) >= 5);

/* restore the backup */
await goto('aitraining', 'brands'); await clickNm('masterRestore'); await page.waitForTimeout(300);
d = await nm();
check('restore brings back the pre-master training', d.training.brands.digital.industry === 'OLD INDUSTRY TEXT' && !d.flags.trainingBackup);

/* every existing Training tab still renders */
for (const pg of ['about', 'business', 'audience', 'voice', 'rules', 'goals', 'examples', 'custom', 'health', 'brands']) {
  await goto('aitraining', pg);
  check('AI Training › ' + pg + ' renders', (await page.locator('.wrap.nm').count()) > 0 && (await page.locator('.wrap.nm').innerText()).length > 40);
}
check('no JavaScript errors', errs.length === 0, errs);
console.log('\n' + pass + ' passed, ' + fail + ' failed'); await browser.close(); server.close(); process.exit(fail ? 1 : 0);
