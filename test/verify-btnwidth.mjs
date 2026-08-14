// v0.31.9 K1-K6 生产验证：卡片页上边缘 + 点赞收藏按钮宽度随 --ui-scale 可变（定宽→可变宽度）
//   P1 需求页头筛选 ×1.2（曾 ×1.0 定宽）
//   P2 需求页头排序 ×1.2（曾 ×1.1）
//   P3 卡片点赞 pill ×1.2（曾 ×1.03）
//   P4 卡片收藏 pill ×1.2（曾 ×1.07）
//   P5 对照：广场收藏/发布按钮仍 ×1.2（不回归）
import { chromium } from 'playwright';
const BASE = 'https://sufe-tutor.pages.dev';
const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'qa_teacher', password: 'SufeQa2026!' }) });
if (r.status !== 200) { console.log('login', r.status, await r.text()); process.exit(1); }
const { authToken, user } = await r.json();
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
p.on('dialog', d => d.dismiss().catch(() => {}));
await p.addInitScript(({ user, authToken }) => {
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('sufe_session_teacher', JSON.stringify({ user, authToken, expires: Date.now() + 3600e3 }));
  localStorage.setItem('sufe_last_role', 'teacher');
}, { user, authToken });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 40; i++) { await p.waitForTimeout(1000); if (await p.evaluate(() => typeof selectPage === 'function')) break; }
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`); };
async function widthRatio(pageId, waitSel, sels) {
  await p.evaluate((pid) => selectPage(pid), pageId);
  await p.waitForSelector(waitSel, { timeout: 15000 });
  await p.waitForTimeout(2200);
  const snap = () => p.evaluate((ss) => {
    const out = {};
    for (const [k, sel] of Object.entries(ss)) {
      const el = document.querySelector(sel);
      if (!el) { out[k] = null; continue; }
      const r = el.getBoundingClientRect();
      out[k] = { w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    }
    return out;
  }, sels);
  const b = await snap();
  await p.evaluate(() => { document.documentElement.style.setProperty('--ui-scale', '1.2'); });
  await p.waitForTimeout(500);
  const a = await snap();
  await p.evaluate(() => { document.documentElement.style.setProperty('--ui-scale', ''); });
  await p.waitForTimeout(300);
  return { b, a, sels };
}
const near = (x, tol) => x >= 1.2 - tol && x <= 1.2 + tol;
// P1/P2 需求页头
const m1 = await widthRatio('browse-demands', '.client-page:not(.hidden) .page-header-actions .custom-select-trigger',
  { 筛选: '.client-page:not(.hidden) .page-header-actions .filter-toggle', 排序: '.client-page:not(.hidden) .page-header-actions .custom-select-trigger' });
for (const [k, sel] of Object.entries(m1.sels)) {
  const b = m1.b[k], a = m1.a[k];
  if (!b || !a) { check(`P1 需求页头「${k}」`, false, '缺失'); continue; }
  const sx = a.w / b.w;
  check(`P1/P2 需求页头「${k}」宽度可变(×1.2)`, near(sx, 0.08), `BASE ${b.w}→ACTUAL ${a.w} ×${sx.toFixed(2)}（曾 ${k === '筛选' ? '×1.0' : '×1.1'}）`);
}
// P3/P4/P5 广场
const m2 = await widthRatio('resource-share', '.posts-toolbar',
  { 收藏: '.posts-toolbar .posts-fav-btn', 发布: '.posts-toolbar .posts-create-btn', 卡点赞: '#posts-list .post-like', 卡收藏: '#posts-list .post-fav' });
for (const [k, sel] of Object.entries(m2.sels)) {
  const b = m2.b[k], a = m2.a[k];
  if (!b || !a) { check(`P3 广场「${k}」`, false, '缺失'); continue; }
  const sx = a.w / b.w;
  const isPill = k.startsWith('卡');
  check(`${isPill ? 'P3/P4' : 'P5'} 广场「${k}」宽度可变(×1.2)`, near(sx, 0.08),
    `BASE ${b.w}→ACTUAL ${a.w} ×${sx.toFixed(2)}（${isPill ? '曾 ×1.03/×1.07 定宽' : '对照保持可变'}）`);
}
await browser.close();
const fails = results.filter(x => !x.ok).length;
console.log(`\n${results.length - fails}/${results.length} PASS`);
process.exit(fails ? 1 : 0);
