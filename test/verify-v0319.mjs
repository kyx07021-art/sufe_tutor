// v0.31.8-fix3 生产验证：设置页「登录设备」区横线承载容器进单元体系（用户返工）
//   P1 .settings-devices 是单元（LAYOUT_RE 补 devices 词）——之前非单元，横线只随壳缩放
//   P2 登录设备横线（.settings-devices border-top y）与第一行 device-row 的 PREVIEW 相对位移 ≈ ACTUAL
//   P3 回归：隐私行横线仍同步（未破坏）
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
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`); };

const snap = () => {
  const g = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { y: +r.y.toFixed(2), h: +r.height.toFixed(2) }; };
  const dev = document.querySelector('.settings-devices');
  const row = document.querySelector('.settings-devices-list .device-row');
  const prow = document.querySelector('#privacy-settings-list .settings-row');
  return {
    devIsUnit: !!document.querySelector('.settings-devices[data-ui-reflow-unit]'),
    devLineY: dev ? +dev.getBoundingClientRect().y.toFixed(2) : null,
    devRowY: row ? +row.getBoundingClientRect().y.toFixed(2) : null,
    rowRel: (dev && row) ? +(row.getBoundingClientRect().y - dev.getBoundingClientRect().y).toFixed(2) : null,
    pRowRel: prow ? +(document.querySelector('#privacy-settings-list .settings-row').getBoundingClientRect().y - prow.getBoundingClientRect().y).toFixed(2) : null,
  };
};
await p.evaluate(() => selectPage('account-settings'));
await p.waitForSelector('#ui-scale-slider', { timeout: 15000 });
await p.waitForTimeout(2000);
const base = await p.evaluate(snap);
await p.evaluate(() => {
  document.documentElement.dataset.uiReflowing = '1';
  const R = window.__uiScaleReflow; R.collectUnits(); R.sampleTargets(); R.begin(); R.renderAt(120);
});
await p.waitForTimeout(400);
const prev = await p.evaluate(snap);
await p.evaluate(() => { const R = window.__uiScaleReflow; if (R) R.teardown(); delete document.documentElement.dataset.uiReflowing; document.documentElement.style.setProperty('--ui-scale', '1.2'); });
await p.waitForTimeout(500);
const act = await p.evaluate(snap);
await p.evaluate(() => { document.documentElement.style.setProperty('--ui-scale', ''); });

check('P1 登录设备区成单元', base.devIsUnit || prev.devIsUnit, `data-ui-reflow-unit=${prev.devIsUnit}`);
check('P2 设备行相对横线 PREVIEW≈ACTUAL', base.rowRel !== null && Math.abs(prev.rowRel - act.rowRel) < 2,
  `BASE ${base.rowRel} / PREVIEW ${prev.rowRel} / ACTUAL ${act.rowRel}`);
check('P3 隐私行相对横线回归', Math.abs(prev.pRowRel - act.pRowRel) < 2,
  `BASE ${base.pRowRel} / PREVIEW ${prev.pRowRel} / ACTUAL ${act.pRowRel}`);
await browser.close();
const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} PASS`);
process.exit(fails ? 1 : 0);
