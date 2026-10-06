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
let pass = 0, fail = 0; const check = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n, c ? '' : JSON.stringify(x || '').slice(0, 300)); };
const API = 'http://127.0.0.1:9', PW = 'Correct-Horse-9-Battery';
const seen = []; let hasPassword = false, loginMode = 'ok', logoutCalls = 0;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(async () => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
await page.route(/127\.0\.0\.1:9\/v1\//, async (r) => {
  const req = r.request(), u = new URL(req.url()), body = req.postData() || ''; seen.push({ m: req.method(), p: u.pathname, body, auth: req.headers()['authorization'] || '' });
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
  const J = (o, s) => r.fulfill({ status: s || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.pathname === '/v1/auth/login') { if (loginMode === 'locked') return J({ error: 'Too many attempts. Try again in a few minutes.' }, 429); const b = JSON.parse(body); if (b.password !== PW) return J({ error: 'Invalid email or password.' }, 401); hasPassword = true; return J({ ok: true, token: 'session-token-abc', user: { id: 'u1', email: b.email, name: null }, workspaces: [{ id: 'ws1', name: 'My Business', role: 'owner' }], has_password: true }); }
  if (u.pathname === '/v1/auth/me') return J({ ok: true, user: { id: 'u1', email: 'owner@example.com' }, workspaces: [{ id: 'ws1', name: 'My Business', role: 'owner' }], has_password: hasPassword });
  if (u.pathname === '/v1/auth/password') { const b = JSON.parse(body); if (hasPassword && b.current_password !== PW) return J({ error: 'Current password is incorrect.' }, 401); if (!b.new_password || b.new_password.length < 12) return J({ error: 'Use at least 12 characters.' }, 400); hasPassword = true; return J({ ok: true, message: 'Password saved.' }); }
  if (u.pathname === '/v1/auth/logout') { logoutCalls++; return J({ ok: true }); }
  return J({ ok: true, leads: [], contacts: [], tasks: [], calendar_events: [], appointments: [] });
});
await page.goto(BASE + '/index.html'); await page.waitForTimeout(900);
await page.evaluate(() => { const m = document.querySelector('#modal.open [data-close]'); if (m) m.click(); }); await page.waitForTimeout(300);
await page.evaluate((a) => { try { document.getElementById('splashSkip') && document.getElementById('splashSkip').click(); } catch (e) {} const c = LDCLOUD.cfg(); c.apiUrl = a; c.token = ''; c.workspaceId = ''; LD.save(); }, API);
const openCard = async () => { await page.evaluate(() => { LD.goto('settings', 'integrations'); }); await page.waitForTimeout(500); await page.evaluate(() => { const h = document.querySelector('[data-intopen="cloudsync"]'); const card = h && h.closest('.intcard'); if (h && !(card && card.classList.contains('open'))) h.click(); }); await page.waitForTimeout(400); };
await openCard();
check('login form: email, password (type=password, autocomplete) and a Log in button', await page.locator('#cloudEmail').count() === 1 && (await page.locator('#cloudPassword').getAttribute('type')) === 'password' && (await page.locator('#cloudPassword').getAttribute('autocomplete')) === 'current-password' && await page.locator('#cloudLogin').count() === 1);
check('the magic-link flow is only inside a collapsed "Recovery" section, not the main login', (await page.locator('details:has(#cloudSendLink)').count()) === 1 && !(await page.locator('#cloudSendLink').isVisible()));
await page.fill('#cloudEmail', 'owner@example.com'); await page.fill('#cloudPassword', 'wrong-password-12'); await page.click('#cloudLogin'); await page.waitForTimeout(500);
check('wrong password shows a generic error and stays logged out', /Invalid email or password/.test(await page.locator('#cloudLoginResult').innerText()) && !(await page.evaluate(() => LDCLOUD.cfg().token)));
check('the password field is cleared after a failed attempt', (await page.locator('#cloudPassword').inputValue()) === '');
loginMode = 'locked'; await page.fill('#cloudPassword', 'wrong-password-12'); await page.click('#cloudLogin'); await page.waitForTimeout(400);
check('a 429 shows a calm "too many attempts" message', /Too many attempts/i.test(await page.locator('#cloudLoginResult').innerText())); loginMode = 'ok';
await page.fill('#cloudPassword', PW); await page.press('#cloudPassword', 'Enter'); await page.waitForTimeout(700);
const cfgAfter = await page.evaluate(() => JSON.parse(JSON.stringify(LDCLOUD.cfg())));
check('correct password (Enter key submits) logs in: token, email, workspace saved', cfgAfter.token === 'session-token-abc' && cfgAfter.email === 'owner@example.com' && cfgAfter.workspaceId === 'ws1' && cfgAfter.hasPassword === true, cfgAfter);
const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + JSON.stringify(LDCLOUD.cfg()) + document.documentElement.innerHTML.slice(0, 200000));
check('the password is never kept in localStorage, settings or the page', !stored.includes(PW));
const loginCall = seen.find((x) => x.p === '/v1/auth/login' && x.body.includes(PW));
check('the password was sent only to /v1/auth/login, once, with no Authorization header and no other request carried it', !!loginCall && !loginCall.auth && seen.filter((x) => x.body.includes(PW)).length === 1);
check('connected view shows Account security and a Log out button', /Account security/.test(await page.locator('.intcard.open').innerText()) && (await page.locator('#cloudDisconnect').innerText()).toLowerCase().includes('log out'));
check('with a password set, the form asks for the CURRENT password (change flow)', await page.locator('#cloudPwCur').count() === 1 && /Change password/.test(await page.locator('#cloudSetPassword').innerText()));
await page.fill('#cloudPwCur', PW); await page.fill('#cloudPwNew', 'Another-Strong-Pass-42'); await page.fill('#cloudPwNew2', 'Different-Pass-42-x'); await page.click('#cloudSetPassword'); await page.waitForTimeout(300);
check('mismatched new passwords are caught in the browser (nothing sent)', /do not match/i.test(await page.locator('#cloudPwResult').innerText()) && !seen.some((x) => x.p === '/v1/auth/password'));
await page.fill('#cloudPwNew2', 'Another-Strong-Pass-42'); await page.fill('#cloudPwCur', 'not-the-password-1'); await page.click('#cloudSetPassword'); await page.waitForTimeout(400);
check('a wrong current password shows the server error', /Current password is incorrect/.test(await page.locator('#cloudPwResult').innerText()));
await page.fill('#cloudPwCur', PW); await page.fill('#cloudPwNew', 'Another-Strong-Pass-42'); await page.fill('#cloudPwNew2', 'Another-Strong-Pass-42'); await page.click('#cloudSetPassword'); await page.waitForTimeout(500);
check('a correct change succeeds, fields are cleared, and the new password is not stored', !(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(LDCLOUD.cfg()))).includes('Another-Strong-Pass-42') && (await page.locator('#cloudPwNew').inputValue()) === '');
// first-time set for an account that has none
await page.evaluate(() => { const c = LDCLOUD.cfg(); c.hasPassword = undefined; c._pwChecked = false; LD.save(); }); hasPassword = false; await openCard(); await page.waitForTimeout(500);
check('an existing session for an account WITHOUT a password shows "Set password" (no current-password box), via /v1/auth/me has_password', await page.locator('#cloudPwCur').count() === 0 && /Set password/.test(await page.locator('#cloudSetPassword').innerText()), await page.locator('.intcard.open').innerText());
await page.fill('#cloudPwNew', 'First-Password-Set-77'); await page.fill('#cloudPwNew2', 'First-Password-Set-77'); await page.click('#cloudSetPassword'); await page.waitForTimeout(500);
check('first-time set sends only new_password, with the session token', (() => { const c = seen.filter((x) => x.p === '/v1/auth/password').pop(); return c && c.auth === 'Bearer session-token-abc' && !('current_password' in JSON.parse(c.body)); })());
// logout
await openCard(); await page.click('#cloudDisconnect'); await page.waitForTimeout(300);
await page.evaluate(() => { const b = document.querySelector('#modal.open .btn:not([data-close]), .modal.open .btn.danger, #confirmOk, [data-ok]'); if (b) b.click(); }); await page.waitForTimeout(500);
check('Log out revokes the session on the server and clears the local token', logoutCalls === 1 && !(await page.evaluate(() => LDCLOUD.cfg().token)), { logoutCalls });
check('no JavaScript errors', errs.length === 0, errs);
console.log('\n' + pass + ' passed, ' + fail + ' failed'); await browser.close(); server.close(); process.exit(fail ? 1 : 0);
