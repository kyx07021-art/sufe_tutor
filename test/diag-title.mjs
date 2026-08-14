import { chromium } from 'playwright';
const BASE = 'https://sufe-tutor.pages.dev';
const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'qa_teacher', password: 'SufeQa2026!' }) });
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
await p.evaluate(() => selectPage('account-settings'));
await p.waitForSelector('#ui-scale-slider', { timeout: 15000 });
await p.waitForTimeout(2000);
const snap = () => {
  const out = [];
  document.querySelectorAll('.settings-section-title').forEach(t => {
    const r = t.getBoundingClientRect();
    const cont = t.parentElement.getBoundingClientRect();
    const isUnit = t.hasAttribute('data-ui-reflow-unit');
    out.push({ text: t.textContent.slice(0, 8), right: +r.right.toFixed(1), w: +r.width.toFixed(1), contRight: +cont.right.toFixed(1), overflow: +(r.right - cont.right).toFixed(1), isUnit });
  });
  return out;
};
const base = await p.evaluate(snap);
await p.evaluate(() => { document.documentElement.dataset.uiReflowing = '1'; const R = window.__uiScaleReflow; R.collectUnits(); R.sampleTargets(); R.begin(); R.renderAt(120); });
await p.waitForTimeout(400);
const prev = await p.evaluate(snap);
await p.evaluate(() => { const R = window.__uiScaleReflow; if (R) R.teardown(); delete document.documentElement.dataset.uiReflowing; document.documentElement.style.setProperty('--ui-scale', '1.2'); });
await p.waitForTimeout(500);
const act = await p.evaluate(snap);
await p.evaluate(() => { document.documentElement.style.setProperty('--ui-scale', ''); });
console.log('BASE  :', JSON.stringify(base));
console.log('PREVIEW:', JSON.stringify(prev));
console.log('ACTUAL:', JSON.stringify(act));
await browser.close();
