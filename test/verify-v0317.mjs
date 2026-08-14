// v0.31.7 R4 生产验证：同页 BASE/PREVIEW/ACTUAL 三态测量（不跨页，避免 diag7 切页测量噪声）
//   P1 侧栏选项卡高度缩放（R4-7 采样禁 transition 根治）——BASE h 与 ACTUAL h 比应 ≈1.2
//   P2 红点固定尺寸（R4-2）——PREVIEW 视觉尺寸 = BASE（不椭圆不放大）
//   P3 工具条按钮宽度参与缩放（R4-4）——PREVIEW ≈ ACTUAL（custom-select-trigger/fav-btn/create-btn）
//   P4 滑块 thumb 固定（R4-6）——slider 自身 transform 抵消祖先缩放（sx*ancSx≈1）
//   P5 允许/关闭按钮与上方横线同步（R4-1）——按钮 relToRow 三态一致
//   P6 设置页横线右缘不戳出容器（R4-5）——overflow 三态全 ≤1px
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
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`); };

// 三态测量器：同页 base → preview(renderAt 120) → actual(--ui-scale=1.2)，逐页
// snapFn 接受 snapArg（playwright evaluate 序列化不保留闭包，参数必须显式传）
async function measure(pageId, waitSel, snapFn, snapArg) {
  await p.evaluate((pid) => selectPage(pid), pageId);
  await p.waitForSelector(waitSel, { timeout: 15000 });
  await p.waitForTimeout(1500);
  const base = await p.evaluate(snapFn, snapArg);
  await p.evaluate(() => {
    document.documentElement.dataset.uiReflowing = '1';
    const R = window.__uiScaleReflow;
    R.collectUnits(); R.sampleTargets(); R.begin(); R.renderAt(120);
  });
  await p.waitForTimeout(400);
  const preview = await p.evaluate(snapFn, snapArg);
  await p.evaluate(() => {
    const R = window.__uiScaleReflow; if (R) R.teardown();
    delete document.documentElement.dataset.uiReflowing;
    document.documentElement.style.setProperty('--ui-scale', '1.2');
  });
  await p.waitForTimeout(500);
  const actual = await p.evaluate(snapFn, snapArg);
  // 还原
  await p.evaluate(() => { document.documentElement.style.setProperty('--ui-scale', ''); });
  await p.waitForTimeout(300);
  return { base, preview, actual };
}

// 侧栏 + 设置页（P1/P2/P4/P5/P6）
const sideSnap = () => {
  const g = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { y: +r.y.toFixed(2), h: +r.height.toFixed(2), w: +r.width.toFixed(2) }; };
  const items = [...document.querySelectorAll('.sidebar-nav .sidebar-item')].filter(i => i.getBoundingClientRect().height > 0);
  const sideItems = items.slice(0, 4).map(i => { const r = i.getBoundingClientRect(); return { h: +r.height.toFixed(2), y: +r.y.toFixed(1) }; });
  const dots = [...document.querySelectorAll('.sidebar-dot')].filter(d => d.getBoundingClientRect().height > 0);
  const dotRects = dots.map(d => { const r = d.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; });
  return { sideItems, dots: dotRects, count: { items: items.length, dots: dots.length } };
};
const m1 = await measure('account-settings', '#privacy-settings-list .theme-opt', sideSnap);
const ratio = (a, b) => (a && b && a.h > 0) ? (b.h / a.h).toFixed(2) : null;
if (m1.base.sideItems.length && m1.actual.sideItems.length) {
  check('P1 侧栏项高度随缩放(ACTUAL)', m1.actual.sideItems[0].h / m1.base.sideItems[0].h > 1.12,
    `BASE h=${m1.base.sideItems[0].h} → ACTUAL h=${m1.actual.sideItems[0].h} (×${ratio(m1.base.sideItems[0], m1.actual.sideItems[0])})`);
  if (m1.preview.sideItems.length) {
    check('P1 侧栏项高度预览随缩放(PREVIEW≈ACTUAL)', Math.abs(m1.preview.sideItems[0].h - m1.actual.sideItems[0].h) < 3,
      `PREVIEW h=${m1.preview.sideItems[0].h} vs ACTUAL h=${m1.actual.sideItems[0].h}（R4-7 采样禁 transition 后采样读到真实高度）`);
  }
} else check('P1 侧栏项高度随缩放', false, `侧栏项空 base=${m1.base.sideItems.length} actual=${m1.actual.sideItems.length}`);
// P2 红点：preview 视觉 = base（不放大不椭圆）
if (m1.base.dots.length && m1.preview.dots.length) {
  const b = m1.base.dots[0], pr = m1.preview.dots[0];
  check('P2 红点预览固定尺寸', Math.abs(pr.w - b.w) < 1.5 && Math.abs(pr.h - b.h) < 1.5 && Math.abs(pr.w - pr.h) < 1.5,
    `BASE ${b.w}×${b.h} → PREVIEW ${pr.w}×${pr.h}（不椭圆不放大）`);
} else check('P2 红点预览固定尺寸', false, `红点空 base=${m1.base.dots.length} preview=${m1.preview.dots.length}`);

// 设置页隐私行：允许/关闭按钮 relToRow 三态 + 横线右缘
const settingsSnap = () => {
  const prow = document.querySelector('#privacy-settings-list .settings-row');
  const pbtns = [...document.querySelectorAll('#privacy-settings-list .privacy-opts .theme-opt')].filter(b => b.getBoundingClientRect().height > 0);
  const pr = prow ? prow.getBoundingClientRect() : null;
  const pb = pbtns.length ? pbtns[0].getBoundingClientRect() : null;
  // 容器右缘（可见 client-page 内容区）
  const cp = document.querySelector('.client-page:not(.hidden)');
  const cRight = cp ? cp.getBoundingClientRect().right : null;
  // 全部带 border-top 的行元素右缘
  const lineEls = [...document.querySelectorAll('.settings-row, .settings-devices, .settings-section-title')]
    .filter(e => getComputedStyle(e).borderTopWidth !== '0px' && e.getBoundingClientRect().height > 0);
  const lines = lineEls.map(e => { const r = e.getBoundingClientRect(); return { right: +r.right.toFixed(1), overflow: cRight ? +(r.right - cRight).toFixed(1) : null }; });
  return {
    btnRelToRow: (pr && pb) ? +(pb.y - pr.y).toFixed(2) : null,
    btnY: pb ? +pb.y.toFixed(2) : null, rowY: pr ? +pr.y.toFixed(2) : null,
    containerRight: cRight ? +cRight.toFixed(1) : null, lines,
    maxOverflow: lines.length ? Math.max(...lines.map(l => Math.abs(l.overflow ?? 0))) : null,
  };
};
const m2 = await measure('account-settings', '#privacy-settings-list .theme-opt', settingsSnap);
check('P5 允许/关闭按钮 relToRow 三态同步', m2.base.btnRelToRow !== null && Math.abs(m2.base.btnRelToRow - m2.preview.btnRelToRow) < 1 && Math.abs(m2.base.btnRelToRow - m2.actual.btnRelToRow) < 1,
  `BASE ${m2.base.btnRelToRow} / PREVIEW ${m2.preview.btnRelToRow} / ACTUAL ${m2.actual.btnRelToRow}`);
check('P6 设置页横线不戳出（三态 maxOverflow≤1）', m2.base.maxOverflow !== null && m2.base.maxOverflow <= 1 && m2.preview.maxOverflow <= 1 && m2.actual.maxOverflow <= 1,
  `BASE ${m2.base.maxOverflow} / PREVIEW ${m2.preview.maxOverflow} / ACTUAL ${m2.actual.maxOverflow}（容器右 ${m2.base.containerRight}，行 ${m2.base.lines.length}）`);

// 滑块 thumb（P4）：slider 自身 transform 抵消祖先缩放
const sliderSnap = () => {
  const sl = document.getElementById('ui-scale-slider');
  if (!sl) return null;
  const r = sl.getBoundingClientRect();
  return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), hasAttr: sl.hasAttribute('data-ui-reflow-unit') };
};
const m3 = await measure('account-settings', '#ui-scale-slider', sliderSnap);
check('P4 滑块 thumb 固定尺寸单元', m3.base && m3.preview && m3.preview.w === m3.base.w,
  `BASE ${m3.base.w}×${m3.base.h} → PREVIEW ${m3.preview.w}×${m3.preview.h}（thumb 20px 恒定，不随预览缩放）`);

// 工具条按钮（P3）：resource-share 收藏/发布/排序 + browse-demands 排序/筛选
const btnSnap = (sels) => {
  const out = {};
  for (const [k, sel] of Object.entries(sels)) {
    const el = document.querySelector(sel);
    if (!el) { out[k] = null; continue; }
    const r = el.getBoundingClientRect();
    out[k] = { w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  }
  return out;
};
const postsSels = { favBtn: '.client-page:not(.hidden) .posts-fav-btn', createBtn: '.client-page:not(.hidden) .posts-create-btn', postsSort: '.client-page:not(.hidden) .posts-toolbar .custom-select-trigger' };
const demandSels = { demandSort: '.client-page:not(.hidden) .page-header-actions .custom-select-trigger', filterToggle: '.client-page:not(.hidden) .page-header-actions .filter-toggle' };
const m4 = await measure('resource-share', '.posts-toolbar', btnSnap, postsSels);
const m5 = await measure('browse-demands', '.client-page:not(.hidden) .page-header-actions .custom-select-trigger', btnSnap, demandSels);
for (const [k, sels, m] of [['收藏', postsSels, m4], ['发布', postsSels, m4], ['排序(广场)', postsSels, m4], ['排序(需求)', demandSels, m5], ['筛选', demandSels, m5]]) {
  const key = k === '收藏' ? 'favBtn' : k === '发布' ? 'createBtn' : k === '排序(广场)' ? 'postsSort' : k === '排序(需求)' ? 'demandSort' : 'filterToggle';
  const b = m.base[key], pr = m.preview[key], ac = m.actual[key];
  if (!b || !pr || !ac) { check(`P3 按钮「${k}」宽度参与缩放`, false, `null base=${!!b} prev=${!!pr} act=${!!ac}`); continue; }
  const prevScale = (pr.w / b.w).toFixed(2), actScale = (ac.w / b.w).toFixed(2);
  check(`P3 按钮「${k}」宽度参与缩放`, Math.abs(parseFloat(prevScale) - parseFloat(actScale)) < 0.12,
    `BASE ${b.w} → PREVIEW ${pr.w} (×${prevScale}) / ACTUAL ${ac.w} (×${actScale})`);
}

await browser.close();
const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} PASS`);
process.exit(fails ? 1 : 0);
