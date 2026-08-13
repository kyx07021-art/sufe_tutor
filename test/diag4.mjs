// P1 调试：theme-opt 按钮为何不被收集/不缩放
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
  localStorage.setItem('sufe_ui_scale', '105');
}, { user, authToken });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 40; i++) { await p.waitForTimeout(1000); if (await p.evaluate(() => typeof selectPage === 'function' && !!document.querySelector('.client-main'))) break; }
await p.evaluate(() => selectPage('account-settings'));
await p.waitForSelector('#ui-scale-slider', { timeout: 15000 });
await p.waitForTimeout(2500);
const out = await p.evaluate(() => {
  const R = window.__uiScaleReflow;
  R.collectUnits();
  const units = R._units();
  const btn = document.querySelector('#privacy-settings-list .theme-opt');
  const row = document.querySelector('#privacy-settings-list .settings-row');
  const btnIdx = units.findIndex(u => u.el === btn);
  const rowIdx = units.findIndex(u => u.el === row);
  const b = btn.getBoundingClientRect();
  const info = (idx) => idx < 0 ? null : { idx, base: units[idx].base, isText: units[idx].isText, isDivider: units[idx].isDivider, parentIdx: units[idx].parentIdx };
  // 找 theme-opts 容器 / settings 相关单元
  const opts = document.querySelector('#privacy-settings-list .theme-opts');
  const optsIdx = units.findIndex(u => u.el === opts);
  const near = [];
  for (let i = Math.max(0, btnIdx - 8); i < btnIdx + 12 && i < units.length; i++) {
    near.push({ idx: i, cls: String(units[i].el.className || units[i].el.tagName).slice(0, 30), t: units[i].isText, base: { w: Math.round(units[i].base.w), h: Math.round(units[i].base.h) }, p: units[i].parentIdx });
  }
  R.begin(); R.renderAt(110);
  const immediate = (() => {
    const r = btn.getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  })();
  return { unitCount: units.length, btnIdx, rowIdx, btnRect: { w: +b.width.toFixed(1), h: +b.height.toFixed(1) }, info: info(btnIdx), optsIdx, near, immediate };
});
console.log(JSON.stringify(out, null, 1));
// 引擎 transform 过渡 .18s 走完后再测（验证 transition 滞后理论）
await p.waitForTimeout(500);
const settled = await p.evaluate(() => {
  const btn = document.querySelector('#privacy-settings-list .theme-opt');
  const r = btn.getBoundingClientRect();
  return { rect: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) } };
});
console.log('SETTLED(500ms):', JSON.stringify(settled));
await browser.close();
