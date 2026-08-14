// v0.31.7 实测：①按钮宽度是否随缩放（筛选/排序/我的收藏/发布帖子/收藏/点赞）；②设置页横线是否预览戳出右边界
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
for (let i = 0; i < 40; i++) { await p.waitForTimeout(1000); if (await p.evaluate(() => typeof selectPage === 'function' && !!document.querySelector('.client-main'))) break; }

const snapBtns = async (pageId, selectors) => p.evaluate(({ selectors }) => {
  const out = {};
  for (const [k, sel] of Object.entries(selectors)) {
    const el = document.querySelector(sel);
    if (!el) { out[k] = null; continue; }
    const r = el.getBoundingClientRect();
    out[k] = { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1) };
  }
  return out;
}, { selectors });
const snapLines = async () => p.evaluate(() => {
  // 设置页全部横线：行/区的 border-top 右边界 vs 内容容器右边界
  const container = document.querySelector('.client-page:not(.hidden)') || document.querySelector('#account-settings-content');
  const cRight = container ? container.getBoundingClientRect().right : null;
  const els = [...document.querySelectorAll('.settings-row, .settings-devices, .settings-section-title')].filter(e => getComputedStyle(e).borderTopWidth !== '0px' && e.getBoundingClientRect().height > 0);
  const lines = els.map(e => {
    const r = e.getBoundingClientRect();
    return { cls: String(e.className).slice(0, 30), right: +r.right.toFixed(1), w: +r.width.toFixed(1), overflow: cRight ? +(r.right - cRight).toFixed(1) : null };
  });
  return { containerRight: cRight ? +cRight.toFixed(1) : null, lines };
});

const btns = {
  favBtn: '#posts-toolbar .posts-fav-btn, .posts-toolbar .posts-fav-btn',
  createBtn: '.posts-create-btn',
  postsSort: '.posts-toolbar .custom-select-trigger',
  demandSort: '.client-page:not(.hidden) .page-header-actions .custom-select-trigger',
  filterToggle: '.client-page:not(.hidden) .page-header-actions .filter-toggle',
};

// base 态：广场
await p.evaluate(() => selectPage('resource-share'));
await p.waitForSelector('.posts-toolbar', { timeout: 10000 });
await p.waitForTimeout(1500);
const basePosts = await snapBtns('resource-share', { favBtn: '.posts-fav-btn', createBtn: '.posts-create-btn', postsSort: '.posts-toolbar .custom-select-trigger' });
// 需求大厅 base
await p.evaluate(() => selectPage('browse-demands'));
await p.waitForTimeout(1500);
const baseDemand = await snapBtns('browse-demands', { demandSort: '.client-page:not(.hidden) .page-header-actions .custom-select-trigger', filterToggle: '.client-page:not(.hidden) .page-header-actions .filter-toggle' });
// 设置页 base + 横线
await p.evaluate(() => selectPage('account-settings'));
await p.waitForSelector('#ui-scale-slider', { timeout: 15000 });
await p.waitForTimeout(1500);
const baseLines = await snapLines();

// 预览 renderAt(120)
await p.evaluate(() => {
  document.documentElement.dataset.uiReflowing = '1';
  const R = window.__uiScaleReflow; R.collectUnits(); R.sampleTargets(); R.begin(); R.renderAt(120);
});
await p.evaluate(() => selectPage('resource-share'));
await p.waitForTimeout(800);
const prevPosts = await snapBtns('resource-share', { favBtn: '.posts-fav-btn', createBtn: '.posts-create-btn', postsSort: '.posts-toolbar .custom-select-trigger' });
await p.evaluate(() => selectPage('browse-demands'));
await p.waitForTimeout(800);
const prevDemand = await snapBtns('browse-demands', { demandSort: '.client-page:not(.hidden) .page-header-actions .custom-select-trigger', filterToggle: '.client-page:not(.hidden) .page-header-actions .filter-toggle' });
await p.evaluate(() => selectPage('account-settings'));
await p.waitForTimeout(800);
const prevLines = await snapLines();

// 实际 commit 1.2
await p.evaluate(() => {
  const R = window.__uiScaleReflow; if (R) R.teardown();
  delete document.documentElement.dataset.uiReflowing;
  document.documentElement.style.setProperty('--ui-scale', '1.2');
});
await p.waitForTimeout(800);
await p.evaluate(() => selectPage('resource-share'));
await p.waitForTimeout(800);
const actPosts = await snapBtns('resource-share', { favBtn: '.posts-fav-btn', createBtn: '.posts-create-btn', postsSort: '.posts-toolbar .custom-select-trigger' });
await p.evaluate(() => selectPage('browse-demands'));
await p.waitForTimeout(800);
const actDemand = await snapBtns('browse-demands', { demandSort: '.client-page:not(.hidden) .page-header-actions .custom-select-trigger', filterToggle: '.client-page:not(.hidden) .page-header-actions .filter-toggle' });
await p.evaluate(() => selectPage('account-settings'));
await p.waitForTimeout(800);
const actLines = await snapLines();

const show = (label, b, pr, ac) => {
  console.log(`\n## ${label}`);
  for (const k of Object.keys(b)) {
    if (b[k] && pr[k] && ac[k]) {
      const scale = (pr[k].w / b[k].w).toFixed(2);
      const target = (ac[k].w / b[k].w).toFixed(2);
      console.log(`  ${k}: base ${b[k].w} → 预览 ${pr[k].w} (x${scale}) | 实际 ${ac[k].w} (x${target}) ${Math.abs(scale - target) > 0.05 ? '  <<< 不缩放/超缩' : ''}`);
    } else console.log(`  ${k}: ${b[k] ? 'preview null' : 'base null'} (b=${!!b[k]} pr=${!!pr[k]} ac=${!!ac[k]})`);
  }
};
show('按钮宽度', basePosts, prevPosts, actPosts);
show('需求页控件', baseDemand, prevDemand, actDemand);
const showLines = (label, s) => { console.log(`\n## ${label}`); console.log('  容器右:', s.containerRight); s.lines.forEach(l => console.log(`  ${l.cls}: right ${l.right} (w ${l.w}) overflow ${l.overflow}`)); };
showLines('BASE 横线', baseLines);
showLines('PREVIEW 横线', prevLines);
showLines('ACTUAL 横线', actLines);
await browser.close();
