// ZT 运行时几何验证（W43 被拦路径，Playwright 实机）。用法：node test/verify-zt-landing.mjs [BASE_URL]
// 覆盖（ZT 审计 FAIL1/FAIL2/FAIL3 闭合 + 窄屏 ✕/登录按钮物理重叠的 noClose 定案）：
//   1) onboarding 首访引导弹窗 header 无 ✕（noClose:true）——窄屏下弹窗 header（width:100% 顶到右上角）
//      与 stage-nav 登录/注册按钮物理重叠，可见但点不到的 ✕ 是审计 FAIL1 陷阱；关闭改由遮罩点击 + 底部按钮；
//   2) 手机竖屏（375×667）横屏矮视口（375×480）桌面（1440×900）：右上角登录按钮可点（命中自身非 overlay），
//      点击 → 关弹窗 + 进登录视图；
//   3) 遮罩点击（弹窗外）关闭弹窗（closable:true 保留，Z-14-F1）；
//   4) 全程零 console/pageerror。
import { chromium } from 'playwright';

const base = process.argv[2] || 'https://sufe-tutor.pages.dev';
const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const b = await chromium.launch();

async function assertViewport(name, width, height, { checkX = false } = {}) {
  const ctx = await b.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500); // onboarding first-visit modal
  const modal = await page.evaluate(() => {
    const m = document.querySelector('#modal-container .modal');
    return { open: !!m, hasX: !!m && !!m.querySelector('.modal-header button'), footerBtns: m ? m.querySelectorAll('.modal-footer button').length : 0 };
  });
  ok(`${name} onboarding 弹窗开着`, modal.open);
  ok(`${name} onboarding 弹窗无 ✕（noClose 消除窄屏冲突源）`, modal.open && !modal.hasX, `footer 按钮 ${modal.footerBtns} 个兜底关闭`);
  // 右上角登录按钮可点（命中自身）
  const loginHit = await page.evaluate(() => {
    const btn = document.querySelector('.stage-nav-actions [data-action="auth.viewLogin"]');
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === btn || (el && el.closest && el.closest('.stage-nav-actions'));
  });
  ok(`${name} 右上角登录按钮可点（非 overlay/死区）`, loginHit);
  // 点登录 → 关弹窗 + 登录视图
  await page.click('.stage-nav-actions [data-action="auth.viewLogin"]', { timeout: 5000 });
  await page.waitForTimeout(900);
  const s = await page.evaluate(() => {
    const el = document.getElementById('view-login');
    return { login: !!el && !el.classList.contains('hidden'), modalClosed: !document.querySelector('#modal-container .modal') };
  });
  ok(`${name} 点登录 → 关弹窗 + 登录视图`, s.login && s.modalClosed);
  ok(`${name} 零 pageerror`, errs.length === 0, errs.slice(0, 2).join('; '));
  await ctx.close();
}

// ── 场景 1：手机竖屏 375×667 ──
await assertViewport('手机竖屏 375×667', 375, 667);
// ── 场景 2：横屏矮视口 375×480（弹窗超高顶到 y20 与导航带重叠）──
await assertViewport('横屏矮视口 375×480', 375, 480);
// ── 场景 3：桌面 1440×900 ──
await assertViewport('桌面 1440×900', 1440, 900);

// ── 场景 4：遮罩点击关闭（closable:true 保留，桌面）──
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const hadModal = await page.evaluate(() => !!document.querySelector('#modal-container .modal'));
  if (hadModal) {
    // 点弹窗外遮罩（避开 stage-nav 区域与弹窗本体：弹窗 580 居中，点左上角落）
    await page.mouse.click(40, 450);
    await page.waitForTimeout(600);
    const closed = await page.evaluate(() => !document.querySelector('#modal-container .modal'));
    ok('遮罩点击关闭弹窗（closable:true）', closed);
  } else {
    ok('遮罩点击关闭弹窗（closable:true）', false, '弹窗未出现');
  }
  await ctx.close();
}

await b.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
