
// v0.31.10 T6 生产验证：标题字非等比治本——标题容器定宽（横线不戳）+ 标题文字视觉等比 1.2
//   span 视觉 = 容器 block(1,sy) x span isText(fs,fs/ancSy) = (1.2,1.2) 等比；横线随容器定宽
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
await p.evaluate(() => selectPage('account-settings'));
await p.waitForSelector('.settings-section-title', { timeout: 15000 });
await p.waitForTimeout(2200);
const results = [];
const check = (n, ok, d) => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}: ${d}`); };
const snap = () => p.evaluate(() => {
  const out = [];
  document.querySelectorAll('.settings-section-title').forEach(t => {
    const r = t.getBoundingClientRect();
    const cont = t.parentElement.getBoundingClientRect();
    let tr = null;
    const span = t.querySelector('.ui-reflow-text');
    const node = span || (t.firstChild && t.firstChild.nodeType === 3 ? t.firstChild : null);
    if (node) { const rg = document.createRange(); rg.selectNodeContents(node); const rr = rg.getBoundingClientRect(); tr = { w: +rr.width.toFixed(1), h: +rr.height.toFixed(1) }; }
    out.push({ text: t.textContent.trim().slice(0, 6), w: +r.width.toFixed(1), overflow: +(r.right - cont.right).toFixed(1), text: tr, hasSpan: !!span });
  });
  return out;
});
const base = await snap();
await p.evaluate(() => { document.documentElement.dataset.uiReflowing = '1'; const R = window.__uiScaleReflow; R.collectUnits(); R.sampleTargets(); R.begin(); R.renderAt(120); });
await p.waitForTimeout(400);
const preview = await snap();
await p.evaluate(() => { const R = window.__uiScaleReflow; if (R) R.teardown(); delete document.documentElement.dataset.uiReflowing;
  document.documentElement.style.setProperty('--ui-scale', '1.2'); });
await p.waitForTimeout(500);
const actual = await snap();
await p.evaluate(() => { document.documentElement.style.setProperty('--ui-scale', ''); });
const b = base[0], pr = preview[0], ac = actual[0];
console.log('BASE   ', JSON.stringify(b));
console.log('PREVIEW', JSON.stringify(pr));
console.log('ACTUAL ', JSON.stringify(ac));
if (!b || !pr || !ac) { console.log('FAIL 标题缺失'); process.exit(1); }
// P1 容器定宽：PREVIEW 宽度 = BASE（横线不戳）
check('P1 标题容器定宽（横线不戳）', Math.abs(pr.w - b.w) < 2 && pr.overflow <= 1 && ac.overflow <= 1,
  `容器宽 BASE ${b.w} / PREVIEW ${pr.w} / ACTUAL ${ac.w}，overflow PREVIEW ${pr.overflow} ACTUAL ${ac.overflow}`);
// P2 文字等比：PREVIEW 文字视觉 ≈ BASE x 1.2（横向=纵向，不拉扁）
if (pr.text && b.text && ac.text) {
  const sx = pr.text.w / b.text.w, sy = pr.text.h / b.text.h;
  const actSx = ac.text.w / b.text.w, actSy = ac.text.h / b.text.h;
  const eq = (x) => Math.abs(x - 1.2) < 0.1;
  check('P2 标题文字视觉等比 1.2（不拉扁）', eq(sx) && eq(sy) && Math.abs(sx - sy) < 0.05,
    `PREVIEW 文字 ${b.text.w}x${b.text.h} → ${pr.text.w}x${pr.text.h}（sx=${sx.toFixed(2)} sy=${sy.toFixed(2)}）`);
  check('P3 真实 reflow 文字等比 1.2（对照）', eq(actSx) && eq(actSy),
    `ACTUAL 文字 ${ac.text.w}x${ac.text.h}（sx=${actSx.toFixed(2)} sy=${actSy.toFixed(2)}）`);
  check('P4 预览与真实一致', Math.abs(sx - actSx) < 0.1 && Math.abs(sy - actSy) < 0.1, 'PREVIEW 文字缩放 ≈ ACTUAL');
} else check('P2 标题文字等比', false, `text 缺失 base=${!!b.text} preview=${!!pr.text}`);
check('P5 预览期标题文字被 span 包裹（治本机制生效）', pr.hasSpan, `PREVIEW hasSpan=${pr.hasSpan}（span 拆两层）`);
await browser.close();
const fails = results.filter(x => !x.ok).length;
console.log(`\n${results.length - fails}/${results.length} PASS`);
process.exit(fails ? 1 : 0);
