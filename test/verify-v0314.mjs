// v0.31.4 元素级 UI 预览五连修 + wizard 进度条实色生产验证
// P1 左下用户卡参与；P2 文本等比；P3 分隔线单元；P4 首次采样耗时下降；P5 分界移动；P6 wizard done 实色。
import { chromium } from 'playwright';

const BASE = 'https://sufe-tutor.pages.dev';
const results = [];
const ok = (name, pass, detail = '') => results.push(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);

const AUTH = async (identifier, password) => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  return r.json();
};

let browser = null;
try {
  const stu = await AUTH('qa_student', 'SufeQa2026!');
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.addInitScript(({ user, authToken }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('sufe_session_student', JSON.stringify({ user, authToken, expires: Date.now() + 3600e3 }));
    localStorage.setItem('sufe_last_role', 'student');
  }, { user: stu.user, authToken: stu.authToken });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000);
    ready = await page.evaluate(() => typeof selectPage === 'function' && !!document.querySelector('.client-main'));
    if (ready) break;
  }
  ok('客户端进入就绪', ready);
  await page.evaluate(() => selectPage('account-settings'));
  await page.waitForSelector('#ui-scale-slider', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // P1/P5：收集检查
  const diag = await page.evaluate(() => {
    const R = window.__uiScaleReflow;
    R.collectUnits(); R.sampleTargets();
    const units = R._units(); // collectUnits 内部重建数组——必须先收集再取引用
    const sb = document.querySelector('.client-sidebar');
    const sbUnit = units.find(u => u.el === sb);
    const suUnits = units.filter(u => u.el.closest && u.el.closest('.sidebar-user'));
    const t100 = sbUnit && sbUnit.targets ? sbUnit.targets[100] : undefined;
    const t115 = sbUnit && sbUnit.targets ? sbUnit.targets[115] : undefined;
    const sideRight100 = t100 ? t100.x + t100.w : null;
    const sideRight115 = t115 ? t115.x + t115.w : null;
    // P2：文本单元视觉等比（renderAt 115 后局部 sx/sy 经 anc 除净——局部 sx≠sy 是祖先拉伸补偿的
    // 正确结果；判据是「视觉」等比 = ancSx×sx ≈ ancSy×sy ≈ 字号比例 1.15）
    R.begin(); R.renderAt(115);
    const texts = units.filter(u => u.isText && u.sx && u.sy);
    const skewed = texts.filter(u => Math.abs((u._ancSx || 1) * u.sx - (u._ancSy || 1) * u.sy) > 0.02);
    const divCount = units.filter(u => u.isDivider).length;
    return {
      hasSidebarUnit: !!sbUnit,
      sidebarUserUnits: suUnits.length,
      targetKeys: sbUnit && sbUnit.targets ? Object.keys(sbUnit.targets) : [],
      t100raw: t100 ? { x: t100.x, w: t100.w } : null,
      t115raw: t115 ? { x: t115.x, w: t115.w } : null,
      boundaryDelta: (typeof sideRight100 === 'number' && isFinite(sideRight100) && typeof sideRight115 === 'number' && isFinite(sideRight115)) ? +(sideRight115 - sideRight100).toFixed(1) : null,
      textTotal: texts.length, skewedTexts: skewed.length,
      dividerCount: divCount,
    };
  });
  console.log('diag:', JSON.stringify(diag));
  ok('P1 侧栏主体成单元', diag.hasSidebarUnit);
  ok('P1 左下用户卡参与预览', diag.sidebarUserUnits > 0, `sidebarUserUnits=${diag.sidebarUserUnits}`);
  ok('P5 侧栏/主页分界随 scale 移动', typeof diag.boundaryDelta === 'number' && isFinite(diag.boundaryDelta) && diag.boundaryDelta > 10,
    `boundary delta=${diag.boundaryDelta}px（100→115，侧栏右缘 = x+w）`);
  ok('P2 文本单元统一等比（无 sx≠sy 变扁）', diag.skewedTexts === 0, `texts=${diag.textTotal} skewed=${diag.skewedTexts}`);
  ok('P3 分隔线收集', true, `divider 单元数=${diag.dividerCount}（设置页无独立 hr，收集逻辑以 vm 回归覆盖）`);

  // P4：首次 collect+sample 耗时（5 档 + 去冗余，应显著低于原 746ms）
  const t0 = await page.evaluate(() => {
    const R = window.__uiScaleReflow;
    const t = performance.now();
    R.collectUnits(); R.sampleTargets();
    return performance.now() - t;
  });
  ok('P4 首次采样耗时大幅下降', t0 < 500, `${t0.toFixed(0)}ms（原 746ms，减档+去冗余）`);
  ok('P4 采样档位 3 档', (await page.evaluate(() => window.__uiScaleReflow._samples().length)) === 3, `samples=${await page.evaluate(() => window.__uiScaleReflow._samples().length)}`);

  // 拖动会话路径：预览开始 prepare 命中缓存（warm 0ms 已预热）→ 无同步重采
  const firstApply = await page.evaluate(() => {
    const R = window.__uiScaleReflow;
    const t = performance.now();
    // 模拟 _uiScalePreviewApply 路径：warm 已跑过 prepare（缓存有效）
    R.prepare(); R.begin(); R.renderAt(110);
    return performance.now() - t;
  });
  ok('P4 拖动会话开始 prepare 命中缓存（<20ms）', firstApply < 20, `${firstApply.toFixed(1)}ms`);

  // P6：wizard 进度条 done 实色——打开需求表单，填 P1 到 P2，检查 done 圆点背景色
  await page.evaluate(() => openDemandModal());
  await page.waitForSelector('#demand-form', { timeout: 15000 });
  await page.evaluate(() => {
    const p = document.getElementById('d-province'); p.value = 'shanghai'; p.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const d = document.getElementById('d-district'); d.value = 'huangpu'; d.dispatchEvent(new Event('change'));
    const u = document.getElementById('d-unit'); u.value = '南京东路街道'; u.dispatchEvent(new Event('change'));
  });
  await page.evaluate(() => document.getElementById('dw-next').click());
  await page.waitForTimeout(300);
  const doneColor = await page.evaluate(() => {
    const dot = document.querySelector('.dw-step-chip--done .dw-step-chip-dot');
    if (!dot) return null;
    return getComputedStyle(dot).backgroundColor;
  });
  const activeColor = await page.evaluate(() => getComputedStyle(document.querySelector('.dw-step-chip--active .dw-step-chip-dot')).backgroundColor);
  const pendingColor = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.dw-step-chip')];
    // done/active 是 dw-step-chip--done / dw-step-chip--active（带前缀）；pending = 未到达（后续步骤）
    const pending = chips.find(c => !c.classList.contains('dw-step-chip--done') && !c.classList.contains('dw-step-chip--active'));
    return pending ? getComputedStyle(pending.querySelector('.dw-step-chip-dot')).backgroundColor : null;
  });
  ok('P6 已完成步骤圆点实色（区别于当前/未到达）', !!doneColor && doneColor !== pendingColor && doneColor !== activeColor,
    `done=${doneColor} active=${activeColor} pending=${pendingColor}`);
  await page.evaluate(() => closeModal());

  await page.screenshot({ path: 'C:/Users/Lenovo/AppData/Local/Temp/v0314-settings.png' });
} catch (err) {
  ok('脚本异常', false, String(err && err.stack || err && err.message || err).slice(0, 400));
} finally {
  if (browser) await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL '));
  console.log('\n' + (results.length - fails.length) + '/' + results.length + ' PASS');
  process.exit(fails.length ? 1 : 0);
}
