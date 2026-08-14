// v0.31.7 预览返工实测：①允许/关闭按钮 vs 行 border-top 高度同步；②红点非等比；③侧边栏选项卡高度不缩放
import { chromium } from 'playwright';
const BASE = 'https://sufe-tutor.pages.dev';
const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'qa_student', password: 'SufeQa2026!' }) });
if (r.status !== 200) { console.log('login', r.status, await r.text()); process.exit(1); }
const { authToken, user } = await r.json();
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
p.on('dialog', d => d.dismiss().catch(() => {}));
await p.addInitScript(({ user, authToken }) => {
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('sufe_session_student', JSON.stringify({ user, authToken, expires: Date.now() + 3600e3 }));
  localStorage.setItem('sufe_last_role', 'student');
}, { user, authToken });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 40; i++) { await p.waitForTimeout(1000); if (await p.evaluate(() => typeof selectPage === 'function' && !!document.querySelector('.client-main'))) break; }
await p.evaluate(() => selectPage('account-settings'));
await p.waitForSelector('#privacy-settings-list .theme-opt', { timeout: 15000 });
await p.waitForTimeout(2000);

const snap = async () => p.evaluate(() => {
  const g = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { y: +r.y.toFixed(2), h: +r.height.toFixed(2), w: +r.width.toFixed(2), x: +r.x.toFixed(2) }; };
  // 隐私设置行（允许/关闭）
  const prow = document.querySelector('#privacy-settings-list .settings-row');
  const pbtns = [...document.querySelectorAll('#privacy-settings-list .privacy-opts .theme-opt')].filter(b => b.getBoundingClientRect().height > 0);
  const pr = prow.getBoundingClientRect();
  const pb = pbtns.length ? pbtns[0].getBoundingClientRect() : null;
  // 主题设置行（浅色/深色）
  const trow = document.querySelector('.theme-opt') ? (document.querySelector('.settings-row') || null) : null;
  // 侧边栏 nav item
  const items = [...document.querySelectorAll('.sidebar-nav .sidebar-item')].filter(i => i.getBoundingClientRect().height > 0);
  const sideItems = items.map(i => { const r = i.getBoundingClientRect(); return { y: +r.y.toFixed(1), h: +r.height.toFixed(1) }; });
  // 红点（sidebar-dot）
  const dots = [...document.querySelectorAll('.sidebar-dot')].filter(d => d.getBoundingClientRect().height > 0);
  const dotRects = dots.map(d => { const r = d.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; });
  return {
    privacyRow: { y: +pr.y.toFixed(2), h: +pr.height.toFixed(2) },
    privacyBtn: pb ? { y: +pb.y.toFixed(2), h: +pb.height.toFixed(2), relToRow: +(pb.y - pr.y).toFixed(2) } : null,
    themeOpts: [...document.querySelectorAll('.theme-opts .theme-opt')].filter(b => b.getBoundingClientRect().height > 0).map(b => { const r = b.getBoundingClientRect(); return { y: +r.y.toFixed(1), h: +r.height.toFixed(1), rel: +(r.y - b.closest('.settings-row').getBoundingClientRect().y).toFixed(1) }; }),
    sideItems, dotRects, count: { items: items.length, dots: dots.length },
  };
});

const base = await snap();
// 预览 renderAt(120)（挂 reflowing 门控复刻真实流程）
await p.evaluate(() => {
  document.documentElement.dataset.uiReflowing = '1';
  const R = window.__uiScaleReflow;
  R.collectUnits(); R.sampleTargets(); R.begin(); R.renderAt(120);
});
const preview = await snap();
// 撤预览 commit --ui-scale=1.2
await p.evaluate(() => {
  const R = window.__uiScaleReflow; if (R) R.teardown();
  delete document.documentElement.dataset.uiReflowing;
  document.documentElement.style.setProperty('--ui-scale', '1.2');
});
await p.waitForTimeout(600);
const actual = await snap();
console.log('BASE   :', JSON.stringify(base));
console.log('PREVIEW:', JSON.stringify(preview));
console.log('ACTUAL :', JSON.stringify(actual));
await browser.close();
