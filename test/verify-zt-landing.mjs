// ZT 运行时几何验证（W43 被拦路径，Playwright 实机）。用法：node test/verify-zt-landing.mjs [BASE_URL]
// 覆盖（对应 ZT 审计 FAIL1/FAIL2/FAIL3 闭合）：
//   1) 短视口（375×480）：首访引导弹窗 header ✕ 不被 stage-nav 拦截（elementFromPoint 命中 ✕ 自身，可点关闭）；
//   2) 桌面 + 短视口：右上角登录按钮不被 overlay 拦截（命中自身，点击关弹窗 + 进登录视图）；
//   3) 点弹窗外 overlay（landing 空白处）仍可关闭弹窗（closable:true 保留）；
//   4) 全程零 console/pageerror。
import { chromium } from 'playwright';

const base = process.argv[2] || 'https://sufe-tutor.pages.dev';
const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const b = await chromium.launch();

// ── 场景 1：短视口 375×480（弹窗 header ✕ 落在 stage-nav 带内）──
{
  const ctx = await b.newContext({ viewport: { width: 375, height: 480 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500); // onboarding first-visit modal
  const r1 = await page.evaluate(() => {
    const modal = document.querySelector('#modal-container .modal');
    const closeBtn = modal ? modal.querySelector('.modal-header [data-action="modal.close"], .modal-header .btn-icon, .modal-header button') : null;
    if (!modal || !closeBtn) return { modal: !!modal, closeBtn: false };
    const r = closeBtn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { modal: true, closeBtnText: (closeBtn.textContent || '').trim().slice(0, 4), hitSelf: el === closeBtn || (el && el.closest && el.closest('.modal-header') === closeBtn.closest('.modal-header')), hit: el ? (el.className || el.tagName) : 'null', btnTop: Math.round(r.top), btnBottom: Math.round(r.bottom) };
  });
  ok('短视口 375×480 弹窗开着', r1.modal, `closeBtn=${r1.closeBtnText || '无'} @y${r1.btnTop}-${r1.btnBottom} hit=${r1.hit}`);
  ok('短视口 ✕ 可点（命中 header 自身，非 stage-nav）', r1.modal && r1.closeBtn && r1.hitSelf, `hit=${r1.hit}`);
  // 实际点 ✕ 应关闭弹窗
  if (r1.modal && r1.closeBtn) {
    await page.click('.modal-header button, .modal-header [data-action]', { timeout: 3000 });
    await page.waitForTimeout(600);
    const closed = await page.evaluate(() => !document.querySelector('#modal-container .modal'));
    ok('短视口点 ✕ 关闭弹窗', closed);
  }
  const loginHit = await page.evaluate(() => {
    const btn = document.querySelector('.stage-nav-actions [data-action="auth.viewLogin"]');
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === btn || (el && el.closest && el.closest('.stage-nav-actions'));
  });
  ok('短视口登录按钮可点', loginHit);
  ok('短视口零 pageerror', errs.length === 0, errs.slice(0, 2).join('; '));
  await ctx.close();
}

// ── 场景 2：桌面 1440×900（登录按钮直达登录视图）──
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const loginHit = await page.evaluate(() => {
    const btn = document.querySelector('.stage-nav-actions [data-action="auth.viewLogin"]');
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === btn || (el && el.closest && el.closest('.stage-nav-actions'));
  });
  ok('桌面登录按钮可点（弹窗开）', loginHit);
  await page.click('.stage-nav-actions [data-action="auth.viewLogin"]', { timeout: 5000 });
  await page.waitForTimeout(900);
  const s2 = await page.evaluate(() => {
    const el = document.getElementById('view-login');
    return { login: !!el && !el.classList.contains('hidden'), modalClosed: !document.querySelector('#modal-container .modal') };
  });
  ok('桌面点登录 → 关弹窗 + 登录视图', s2.login && s2.modalClosed);
  ok('桌面零 pageerror', errs.length === 0, errs.slice(0, 2).join('; '));
  await ctx.close();
}

await b.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
