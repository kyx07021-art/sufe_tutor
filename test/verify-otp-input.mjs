/**
 * Mobile login/register/bind OTP input-row layout geometry regression (G5 / rule 45 +
 * requirement AC + AF-13). Playwright real-browser assertions: on a 375px screen the OTP
 * input visible area must fit 6 digits and the input must top up against the label; the
 * desktop layout must not regress. The three forms (login / register / phone-email bind
 * modal) share the structural marker `.form-group > .form-label + .code-input-wrap` and are
 * all targeted by the AC-1 media-query rules, so each gets an explicit per-form assertion.
 *
 * Background: `.form-label` fixed `flex:0 0 116px` + column gap 22px + right-edge button
 * reservation `padding-right:104px` squeezed the mobile OTP input visible area to 33px
 * (measured on a 375px screen) — 6 digits + placeholder were swallowed (user report
 * "input too narrow, eats typed digits"). AC-1 fix = inside `@media (max-width:480px)`
 * `.form-group:has(.code-input-wrap)` narrows the gap and lets the label size to content,
 * so the input tops the label and fills the row (visible 33→124px).
 *
 * The register form additionally swaps in a channel label ("手机验证码" once a phone is
 * entered) which is wider than the plain "验证码", so its mobile visible area is smaller
 * (~98px) yet still fits 6 digits — its mobile threshold reflects that wider label.
 *
 * Usage: node test/verify-otp-input.mjs (needs playwright; not part of the npm test glob)
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('playwright');
const port = 8953;
const dist = resolve(process.cwd(), 'dist');
const server = createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  if (u === '/api/auth/check') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ exists: true, role: 'student' })); return; }
  const file = resolve(dist, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
  if (!file.startsWith(dist + sep) && file !== dist) { res.statusCode = 403; res.end('Forbidden'); return; }
  if (existsSync(file)) { const t = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream'; res.setHeader('Content-Type', t); res.end(readFileSync(file)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(readFileSync(join(dist, 'index.html'))); }
});
await new Promise(r => server.listen(port, '127.0.0.1', r));
const browser = await chromium.launch();

// All three OTP rows share `.form-group > .form-label + .code-input-wrap > .form-input`.
// Measure label right edge / wrap width / input geometry to lock the AC-1 row layout.
async function measureCodeRow(page, labelSel, wrapSel, inputSel) {
  return await page.evaluate(([labelSel, wrapSel, inputSel]) => {
    const label = document.querySelector(labelSel);
    const wrap = document.querySelector(wrapSel);
    const input = document.querySelector(inputSel);
    if (!label || !wrap || !input) return { missing: true };
    const lr = label.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const ir = input.getBoundingClientRect();
    const cs = getComputedStyle(input);
    return {
      labelRight: Math.round(lr.right), wrapX: Math.round(wr.x), wrapWidth: Math.round(wr.width),
      inputX: Math.round(ir.x), inputWidth: Math.round(ir.width),
      gapBetweenLabelAndInput: Math.round(ir.x - lr.right),
      visibleInput: Math.round(ir.width) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    };
  }, [labelSel, wrapSel, inputSel]);
}

function assertRow(vp, formName, geo, t) {
  assert.ok(geo && !geo.missing, `${vp.name}/${formName}: row must exist (label/wrap/input all present)`);
  assert.ok(geo.visibleInput >= t.minVisible,
    `${vp.name}/${formName}: visible input ${geo.visibleInput}px should be >= ${t.minVisible}px (fits 6 digits + placeholder, no swallowed text)`);
  assert.ok(geo.wrapWidth >= t.minWrap, `${vp.name}/${formName}: input width ${geo.wrapWidth}px should be >= ${t.minWrap}px`);
  assert.ok(geo.gapBetweenLabelAndInput <= t.maxGap,
    `${vp.name}/${formName}: gap input-left→label ${geo.gapBetweenLabelAndInput}px should be <= ${t.maxGap}px (input tops the label)`);
  assert.ok(geo.gapBetweenLabelAndInput >= t.minGap,
    `${vp.name}/${formName}: gap ${geo.gapBetweenLabelAndInput}px should be >= ${t.minGap}px (locks desktop 22px column gap, AC-1 must not leak out of the media block)`);
  assert.ok(geo.inputX <= geo.wrapX + 1, `${vp.name}/${formName}: input shares the wrap left edge`);
}

const cases = [
  {
    name: 'mobile-375', width: 375, height: 667,
    login: { minVisible: 110, minWrap: 200, maxGap: 10, minGap: 0 },
    // Register label = "手机验证码" (wider than "验证码") -> mobile visible ~98px (vs login 124px);
    // floor 90 still fits 6 digits and sits far above the pre-fix squeeze (33px, measured by mutation).
    register: { minVisible: 90, minWrap: 200, maxGap: 10, minGap: 0 },
    bind: { minVisible: 110, minWrap: 200, maxGap: 10, minGap: 0 },
  },
  {
    name: 'desktop-1440', width: 1440, height: 900,
    // minGap:20 locks the desktop column gap at 22px — if an AC-1 rule leaks out of the
    // media block the gap shrinks to 8px and every desktop row turns red (G2 teeth).
    login: { minVisible: 80, minWrap: 180, maxGap: 30, minGap: 20 },
    register: { minVisible: 80, minWrap: 180, maxGap: 30, minGap: 20 },
    bind: { minVisible: 80, minWrap: 180, maxGap: 30, minGap: 20 },
  },
];
for (const vp of cases) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.width < 600, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  // First-visit onboarding modal intercepts clicks: dismiss it by clicking the overlay
  // (closable path, Z-14-F1 lesson).
  await page.evaluate(() => { const ov = document.querySelector('#modal-container .modal-overlay'); if (ov) ov.click(); }).catch(() => {});
  await page.waitForTimeout(300);

  // --- login OTP row ---
  await page.click('[data-action="auth.viewLogin"]');
  await page.waitForSelector('#login-identifier');
  await page.fill('#login-identifier', '13800138000');
  await page.waitForSelector('#login-password-group:not(.hidden)', { timeout: 8000 });
  await page.click('#login-switch-mode'); // switch to code login
  await page.waitForSelector('#login-code-group:not(.hidden)', { timeout: 8000 });
  await page.waitForTimeout(300);
  const loginGeo = await measureCodeRow(page, '#login-code-group .form-label', '#login-code-group .code-input-wrap', '#login-code');
  assertRow(vp, 'login', loginGeo, vp.login);
  console.log(`✔ ${vp.name}/login: visible ${loginGeo.visibleInput}px / wrap ${loginGeo.wrapWidth}px / gap ${loginGeo.gapBetweenLabelAndInput}px`);

  // --- register OTP row (student single form; a phone reveals the code group) ---
  await page.click('#view-login [data-action="auth.viewRegister"]');
  await page.waitForSelector('#view-register:not(.hidden)', { timeout: 8000 });
  await page.waitForSelector('#register-identifier');
  await page.fill('#register-identifier', '13800138000');
  await page.waitForSelector('#register-code-group:not(.hidden)', { timeout: 8000 });
  await page.waitForTimeout(300);
  const registerGeo = await measureCodeRow(page, '#register-code-group .form-label', '#register-code-group .code-input-wrap', '#register-code');
  assertRow(vp, 'register', registerGeo, vp.register);
  console.log(`✔ ${vp.name}/register: visible ${registerGeo.visibleInput}px / wrap ${registerGeo.wrapWidth}px / gap ${registerGeo.gapBetweenLabelAndInput}px`);

  // --- bind modal OTP row (phone/email bind renders the same codeFieldHtml into the modal) ---
  // The bind buttons live in settings (auth:true, needs a login the static mock cannot
  // reach), so the test opens the modal through the real global delegation: make #view-client
  // layoutable (the modal renders into the sibling #modal-container overlay) and inject a
  // trigger that carries the same data-action the settings page uses. The modal is a fixed
  // viewport overlay, so its OTP row geometry is identical to production regardless of the
  // page behind.
  await page.evaluate(() => {
    const vc = document.getElementById('view-client');
    if (vc) vc.classList.remove('hidden');
    const b = document.createElement('button');
    b.dataset.action = 'auth.openPhoneBind';
    b.id = '__af13-bind-trigger';
    document.body.appendChild(b);
    b.click(); // raw click: the document-level delegation fires regardless of overlay z-index
  });
  await page.waitForSelector('#bind-code', { timeout: 8000 });
  await page.waitForTimeout(300);
  const bindGeo = await measureCodeRow(page, '#modal-container #bind-code-label', '#modal-container .code-input-wrap', '#bind-code');
  assertRow(vp, 'bind', bindGeo, vp.bind);
  console.log(`✔ ${vp.name}/bind: visible ${bindGeo.visibleInput}px / wrap ${bindGeo.wrapWidth}px / gap ${bindGeo.gapBetweenLabelAndInput}px`);

  assert.equal(errors.length, 0, `${vp.name}: zero console/pageerror (actual ${errors.length})`);
  await ctx.close();
}
await browser.close();
server.close();
console.log('验证码输入框布局几何：全部通过');
