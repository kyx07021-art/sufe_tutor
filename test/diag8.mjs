// 穿透：demandSort/favBtn 的 base / 采样[120] / renderAt(120) 实测，定位 x0.97 来源
import { chromium } from 'playwright';
const BASE = 'https://sufe-tutor.pages.dev';
const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'qa_teacher', password: 'SufeQa2026!' }) });
if (r.status !== 200) { console.log('login', r.status); process.exit(1); }
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
await p.evaluate(() => selectPage('browse-demands'));
await p.waitForSelector('.client-page:not(.hidden) .page-header-actions .custom-select-trigger', { timeout: 10000 });
await p.waitForTimeout(1500);

const out = await p.evaluate(() => {
  const R = window.__uiScaleReflow;
  R.collectUnits();
  const V = '.client-page:not(.hidden) ';
  const probe = (sel) => {
    const el = document.querySelector(V + sel);
    const idx = R._units().findIndex(u => u.el === el);
    if (idx < 0) return { sel, isUnit: false, rect: (() => { const r = el.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; })() };
    const u = R._units()[idx];
    return { sel, isUnit: true, idx, isText: u.isText, isDivider: u.isDivider, base: { w: +u.base.w.toFixed(1), h: +u.base.h.toFixed(1) },
      t120: u.targets[120] ? { w: +u.targets[120].w.toFixed(1), h: +u.targets[120].h.toFixed(1) } : null,
      t100: u.targets[100] ? { w: +u.targets[100].w.toFixed(1) } : null,
      t80: u.targets[80] ? { w: +u.targets[80].w.toFixed(1) } : null };
  };
  return { sort: probe('.page-header-actions .custom-select-trigger'), toggle: probe('.page-header-actions .filter-toggle') };
});
console.log('visible page:', await p.evaluate(() => [...document.querySelectorAll('.client-page')].filter(e => !e.classList.contains('hidden')).map(e => e.id || e.className).join(',')));
console.log(JSON.stringify(out, null, 1));

// 手动采样并看 --ui-scale 生效情况
const s2 = await p.evaluate(() => {
  const R = window.__uiScaleReflow;
  const docEl = document.documentElement;
  // 采样前状态
  const before = docEl.style.getPropertyValue('--ui-scale');
  R.sampleTargets();
  const after = docEl.style.getPropertyValue('--ui-scale');
  // 手动设 1.2 测真实宽度
  docEl.style.setProperty('--ui-scale', '1.2');
  const sel = document.querySelector('.client-page:not(.hidden) .page-header-actions .custom-select-trigger');
  const real = sel.getBoundingClientRect();
  docEl.style.setProperty('--ui-scale', before || '');
  return { beforeScale: before || '(none)', afterScale: after || '(none)', realW120: +real.width.toFixed(1), realH120: +real.height.toFixed(1) };
});
console.log(JSON.stringify(s2, null, 1));
await browser.close();
