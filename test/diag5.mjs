// v0.31.5 返工诊断：①my-demands 卡片 编辑 vs 试课意向展开按钮观感；②browse-teachers 筛选下拉
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

// ① my-demands：编辑 vs 试课意向展开按钮
await p.evaluate(() => selectPage('my-demands'));
await p.waitForTimeout(3000);
const md = await p.evaluate(() => {
  const cs = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return { cls: String(el.className).slice(0, 60), bg: s.backgroundColor, radius: s.borderRadius, frost: (s.backdropFilter || '').slice(0, 30), h: Math.round(r.height), color: s.color, fw: s.fontWeight };
  };
  const cards = [...document.querySelectorAll('#my-demands-list .list-card')].filter(c => c.getBoundingClientRect().height > 0);
  const card = cards[0];
  if (!card) return { cards: 0 };
  const edit = card.querySelector('.btn-soft[onclick*="openDemandModal"], .btn-soft:not(.btn-intent-cta):not(.btn-intent-wait):not(.btn-intent-ok)');
  const intentToggle = card.querySelector('#intent-toggle-');
  const all = [...card.querySelectorAll('button')].map(b => ({ txt: b.textContent.trim().slice(0, 12), ...cs(b) }));
  return { cards: cards.length, edit: cs(edit), intentToggle: cs(intentToggle), all };
});
console.log('MY-DEMANDS:', JSON.stringify(md, null, 1));

// ② browse-teachers：筛选下拉
await p.evaluate(() => selectPage('browse-teachers'));
await p.waitForTimeout(2500);
const bt = await p.evaluate(() => {
  const cs = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return { cls: String(el.className).slice(0, 60), bg: s.backgroundColor, radius: s.borderRadius, frost: (s.backdropFilter || '').slice(0, 30), h: Math.round(r.height), color: s.color };
  };
  // 展开教师筛选面板
  const panel = document.getElementById('teacher-filters');
  if (panel && typeof toggleFilters === 'function') toggleFilters();
  const triggers = [...document.querySelectorAll('#teacher-filters .filter-group .custom-select-trigger, #teacher-filters .filter-group .filter-select')]
    .filter(t => { const s = getComputedStyle(t); return s.display !== 'none' && t.getBoundingClientRect().height > 0; });
  const sort = document.querySelector('.client-page:not(.hidden) .page-header-actions .custom-select-trigger');
  return { triggers: triggers.map(cs), sort: cs(sort), teacherListCards: document.querySelectorAll('#teachers-list .list-card').length };
});
console.log('BROWSE-TEACHERS:', JSON.stringify(bt, null, 1));
await browser.close();
