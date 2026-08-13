// v0.31.5 生产验证（P1-P4）：
//  P1 预览基数：base=105 时 renderAt(110) 预览元素大小 ≈ 真实 commit 110 大小
//  P2 按钮与分割线同步：预览态按钮相对分割线距离 ≈ 实际态
//  P3 地址入 P2 授课方式：仅上海+线下显示必填，线上不要求地址
//  P4 下拉接按钮组件：排序/筛选项下拉 computedStyle = 标准按钮玻璃面（透明磨砂+12px+btn-h）
// 登录限流纪律（v0.29.0 教训）：三振 IP 封禁 15min，多 isolate 各持内存计数，轮询重试会打不同 isolate
// 各自计满续封——只登录 2 次（student 一次做 P1-P3，teacher 一次做 P4），429 即退出等满窗口一次性重跑。
import { chromium } from 'playwright';
const BASE = 'https://sufe-tutor.pages.dev';
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
}

const login = async (identifier) => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'SufeQa2026!' }),
  });
  if (r.status === 200) return r.json();
  if (r.status === 429) { console.log(`[login ${identifier}] 429 限流窗口未过——静置 15min 后重跑，禁止轮询（每次超限都可能续封）`); process.exit(3); }
  console.log('login', identifier, r.status, await r.text()); process.exit(1);
};

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const newPage = async (user, authToken, role, extra = {}) => {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('dialog', d => d.dismiss().catch(() => {}));
  await p.addInitScript(({ user, authToken, role, extra }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem(`sufe_session_${role}`, JSON.stringify({ user, authToken, expires: Date.now() + 3600e3 }));
    localStorage.setItem('sufe_last_role', role);
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
  }, { user, authToken, role, extra });
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(1000);
    if (await p.evaluate(() => typeof selectPage === 'function' && !!document.querySelector('.client-main'))) return p;
  }
  throw new Error('页面就绪超时');
};

// ============ P1/P2/P3：qa_student（一次会话）============
{
  const { authToken, user } = await login('qa_student');
  const p = await newPage(user, authToken, 'student', { sufe_ui_scale: '105' }); // 基数 105%

  // --- P1/P2：设置页 UI 预览基数 ---
  await p.evaluate(() => selectPage('account-settings'));
  await p.waitForSelector('#ui-scale-slider', { timeout: 15000 });
  await p.waitForTimeout(2500);
  const preview = await p.evaluate(() => {
    const R = window.__uiScaleReflow;
    R.collectUnits(); R.sampleTargets();
    R.begin(); R.renderAt(110);
    const g = (sel) => {
      const el = document.querySelector(sel); if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const row = document.querySelector('#privacy-settings-list .settings-row');
    const btn = document.querySelector('#privacy-settings-list .theme-opt');
    const rb = row.getBoundingClientRect(), bb = btn.getBoundingClientRect();
    return { btn: g('#privacy-settings-list .theme-opt'), row: g('#privacy-settings-list .settings-row'), relBtnVsBorder: +(bb.y - rb.y).toFixed(1) };
  });
  await p.evaluate(() => {
    const R = window.__uiScaleReflow;
    if (R) R.teardown();
    document.documentElement.style.setProperty('--ui-scale', '1.10');
  });
  await p.waitForTimeout(700);
  const actual = await p.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel); if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const row = document.querySelector('#privacy-settings-list .settings-row');
    const btn = document.querySelector('#privacy-settings-list .theme-opt');
    const rb = row.getBoundingClientRect(), bb = btn.getBoundingClientRect();
    return { btn: g('#privacy-settings-list .theme-opt'), row: g('#privacy-settings-list .settings-row'), relBtnVsBorder: +(bb.y - rb.y).toFixed(1) };
  });
  check('P1 按钮预览大小 ≈ 实际（base105→110）', preview.btn && actual.btn && Math.abs(preview.btn.w - actual.btn.w) <= 2 && Math.abs(preview.btn.h - actual.btn.h) <= 2,
    `预览 ${preview.btn.w}x${preview.btn.h} vs 实际 ${actual.btn.w}x${actual.btn.h}`);
  check('P1 行宽预览 ≈ 实际（box 单元插值）', preview.row && actual.row && Math.abs(preview.row.w - actual.row.w) <= 2 && Math.abs(preview.row.h - actual.row.h) <= 2,
    `预览 ${preview.row.w}x${preview.row.h} vs 实际 ${actual.row.w}x${actual.row.h}`);
  check('P2 按钮↔分割线相对距离预览 ≈ 实际', Math.abs(preview.relBtnVsBorder - actual.relBtnVsBorder) <= 2,
    `预览 ${preview.relBtnVsBorder}px vs 实际 ${actual.relBtnVsBorder}px`);
  // 恢复默认比例，避免影响后续页面
  await p.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1'));

  // --- P3：需求表单地址入 P2 ---
  await p.evaluate(() => selectPage('my-demands'));
  await p.waitForTimeout(2000);
  await p.evaluate(() => { if (typeof openDemandModal === 'function') openDemandModal(null); });
  await p.waitForSelector('#demand-form .dw-step', { timeout: 10000 });
  const wiz = await p.evaluate(() => {
    const doc = document;
    const step2 = doc.querySelector('#demand-form .dw-step[data-step="2"]');
    const step1 = doc.querySelector('#demand-form .dw-step[data-step="1"]');
    const addrInStep2 = step2 ? !!step2.querySelector('#d-address-section') : false;
    const addrInStep1 = step1 ? !!step1.querySelector('#d-address-section') : false;
    const out = { addrInStep2, addrInStep1, steps: [] };
    const active = () => [...doc.querySelectorAll('#demand-form .dw-step.dw-step--active')].map(s => +s.dataset.step);
    const prov = doc.getElementById('d-province');
    prov.value = 'shanghai';
    if (typeof onDemandProvinceChange === 'function') onDemandProvinceChange();
    demandWizardNext();
    out.steps.push(active());
    const sec = doc.getElementById('d-address-section');
    out.onlineHidden = sec.classList.contains('hidden');
    demandWizardNext();
    out.steps.push(active());
    demandWizardGoTo(2);
    const method = doc.getElementById('d-method');
    method.value = 'offline';
    if (typeof toggleAddressField === 'function') toggleAddressField();
    out.offlineShown = !sec.classList.contains('hidden');
    out.addrRequired = doc.getElementById('d-address').required;
    demandWizardNext();
    out.steps.push(active());
    return out;
  });
  check('P3 地址区已移入 P2（授课方式页）', wiz.addrInStep2 && !wiz.addrInStep1, `P2=${wiz.addrInStep2} P1=${wiz.addrInStep1}`);
  check('P3 上海+线上不要求地址（P2 放行到 P3）', wiz.steps[0][0] === 2 && wiz.onlineHidden && wiz.steps[1][0] === 3, `steps=${JSON.stringify(wiz.steps)} onlineHidden=${wiz.onlineHidden}`);
  check('P3 上海+线下地址区显示必填 + 缺地址拦截', wiz.offlineShown && wiz.addrRequired && wiz.steps[2][0] === 2, `shown=${wiz.offlineShown} required=${wiz.addrRequired} steps=${JSON.stringify(wiz.steps)}`);
  await p.close();
}

// ============ P4：qa_teacher 需求大厅下拉 = 按钮观感 ============
{
  const { authToken, user } = await login('qa_teacher');
  const p = await newPage(user, authToken, 'teacher');
  await p.evaluate(() => selectPage('browse-demands'));
  await p.waitForSelector('#demands-list .list-card', { timeout: 15000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { if (typeof toggleDemandFilters === 'function') toggleDemandFilters(); });
  await p.waitForTimeout(600);
  const p4 = await p.evaluate(() => {
    const cs = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return { cls: String(el.className).slice(0, 55), bg: s.backgroundColor, radius: s.borderRadius, frost: s.backdropFilter || s.webkitBackdropFilter,
        h: Math.round(r.height), color: s.color };
    };
    // 注意：DOM 里有 教师页+需求页 两个 .page-header-actions（隐藏页 display:none h=0），
    // 排序下拉选择器必须限定到可见页（否则命中隐藏页头的 h=0 元素）
    const sort = document.querySelector('.client-page:not(.hidden) .page-header-actions .custom-select-trigger');
    const filt = document.querySelector('#demand-filter-panel .filter-group .custom-select-trigger');
    const cardBtn = document.querySelector('#demands-list .list-card .btn-soft');
    return { sort: cs(sort), filter: cs(filt), cardBtn: cs(cardBtn) };
  });
  const btnLike = (c) => c && c.bg === 'rgba(0, 0, 0, 0)' && c.radius === '12px' && c.h >= 36 && c.frost && c.frost.includes('blur');
  check('P4 排序下拉 = 标准按钮玻璃面（透明+12px+磨砂+btn高）', btnLike(p4.sort), `bg=${p4.sort && p4.sort.bg} r=${p4.sort && p4.sort.radius} h=${p4.sort && p4.sort.h} frost=${p4.sort && p4.sort.frost}`);
  check('P4 筛选项下拉 = 标准按钮玻璃面', btnLike(p4.filter), `bg=${p4.filter && p4.filter.bg} r=${p4.filter && p4.filter.radius} h=${p4.filter && p4.filter.h}`);
  check('P4 卡片按钮（试课意向）仍标准玻璃面', btnLike(p4.cardBtn), `bg=${p4.cardBtn && p4.cardBtn.bg} r=${p4.cardBtn && p4.cardBtn.radius} h=${p4.cardBtn && p4.cardBtn.h}`);
  check('P4 排序/筛选项与卡片按钮同族（同透明同圆角）',
    p4.sort && p4.cardBtn && p4.sort.bg === p4.cardBtn.bg && p4.sort.radius === p4.cardBtn.radius,
    `sort(${p4.sort && p4.sort.bg}/${p4.sort && p4.sort.radius}) vs card(${p4.cardBtn && p4.cardBtn.bg}/${p4.cardBtn && p4.cardBtn.radius})`);
  await p.close();
}

await browser.close();
const failed = results.filter(r => !r.pass);
console.log(`\n===== ${results.length - failed.length}/${results.length} PASS =====`);
process.exit(failed.length ? 1 : 0);
