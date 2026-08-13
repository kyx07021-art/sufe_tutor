// v0.31.0 任务三生产验证：需求表单 wizard 分步走查（7 页/进度条/逐页校验/编辑回填）
// QA 固定账户；临时需求验证后删除，不污染生产。登录一次复用令牌（限流纪律）。
import { chromium } from 'playwright';

const BASE = 'https://sufe-tutor.pages.dev';
const results = [];
const ok = (name, pass, detail = '') => results.push(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);

const AUTH = async (identifier, password) => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (r.status !== 200) throw new Error(`login ${identifier} failed: ${r.status} ${await r.text()}`);
  return r.json();
};
const J = h => ({ ...h, 'Content-Type': 'application/json' });

let createdId = null, stuTok = null;
let browser = null;

try {
  const stu = await AUTH('qa_student', 'SufeQa2026!');
  stuTok = stu.authToken;
  ok('登录 qa_student', true, `student=${stu.user.id}`);

  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.addInitScript(({ user, authToken }) => {
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    localStorage.setItem('sufe_session_student', JSON.stringify({ user, authToken, expires: Date.now() + 3600e3 }));
    localStorage.setItem('sufe_last_role', 'student');
  }, { user: stu.user, authToken: stuTok });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 等客户端进入（懒加载全局就绪 + 会话恢复完成）：轮询 openDemandModal 可用
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1200);
    ready = await page.evaluate(() => typeof openDemandModal === 'function' && !!document.querySelector('.sidebar, .client-main'));
    if (ready) break;
  }
  ok('客户端进入就绪', ready, '');

  // 打开新建需求表单
  await page.evaluate(() => openDemandModal());
  await page.waitForSelector('#demand-form', { timeout: 15000 });

  const steps = await page.evaluate(() => [...document.querySelectorAll('#demand-form .dw-step')].length);
  ok('wizard 渲染 7 步', steps === 7, `steps=${steps}`);
  const active1 = await page.evaluate(() => +document.querySelector('#demand-form .dw-step.dw-step--active').dataset.step);
  ok('初始 P1 激活', active1 === 1, `active=${active1}`);
  const chips = await page.evaluate(() => document.querySelectorAll('#dw-stepper .dw-step-chip').length);
  ok('步进器 7 芯片', chips === 7, `chips=${chips}`);

  // P1 校验：无省份点下一步 → 不前进
  await page.evaluate(() => document.getElementById('dw-next').click());
  await page.waitForTimeout(300);
  const after1 = await page.evaluate(() => +document.querySelector('#demand-form .dw-step.dw-step--active').dataset.step);
  const toast1 = await page.evaluate(() => (document.querySelector('.toast, .app-toast, [class*=toast]') || {}).textContent || '');
  ok('P1 缺省份拦截（停留 P1 + toast）', after1 === 1 && /请选择省份/.test(toast1), `active=${after1} toast=${toast1.trim().slice(0, 20)}`);

  // 选上海 → 地址 picker 出现 → 填区/镇 → 下一步到 P2
  await page.evaluate(() => {
    const p = document.getElementById('d-province'); p.value = 'shanghai'; p.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(400);
  const addrVisible = await page.evaluate(() => !document.getElementById('d-address-section').classList.contains('hidden'));
  const hasPicker = await page.evaluate(() => !!document.getElementById('d-district'));
  ok('上海 → 地址 picker 显示（不 gate 教学方式）', addrVisible && hasPicker, `visible=${addrVisible} picker=${hasPicker}`);

  await page.evaluate(() => {
    const d = document.getElementById('d-district'); d.value = 'huangpu'; d.dispatchEvent(new Event('change'));
    const u = document.getElementById('d-unit'); u.value = '南京东路街道'; u.dispatchEvent(new Event('change'));
  });
  await page.evaluate(() => document.getElementById('dw-next').click());
  await page.waitForTimeout(300);
  const step2 = await page.evaluate(() => +document.querySelector('#demand-form .dw-step.dw-step--active').dataset.step);
  ok('P1 校验通过 → P2', step2 === 2, `active=${step2}`);
  // P2 选线下（new 表单默认第一项=online，服务端对线上需求清空 address——地址端到端要存活必须选线下）
  await page.evaluate(() => {
    const m = document.getElementById('d-method'); m.value = 'offline'; m.dispatchEvent(new Event('change'));
  });

  // 一路 Next 到 P7：P3 需填年级、P4 勾科目，P5/P6 可空
  await page.evaluate(() => document.getElementById('dw-next').click()); await page.waitForTimeout(250); // → P3
  await page.evaluate(() => {
    const g = document.getElementById('d-grade'); g.value = 'senior1'; g.dispatchEvent(new Event('change'));
  });
  await page.evaluate(() => document.getElementById('dw-next').click()); await page.waitForTimeout(250); // → P4
  const step4 = await page.evaluate(() => +document.querySelector('#demand-form .dw-step.dw-step--active').dataset.step);
  ok('P3 年级校验通过 → P4', step4 === 4, `active=${step4}`);
  await page.evaluate(() => document.getElementById('dw-next').click()); await page.waitForTimeout(250); // P4 未勾科目 → 拦截
  const step4b = await page.evaluate(() => +document.querySelector('#demand-form .dw-step.dw-step--active').dataset.step);
  ok('P4 缺科目拦截', step4b === 4, `active=${step4b}`);
  await page.evaluate(() => {
    const cb = [...document.querySelectorAll('#d-subjects input')].find(c => c.value === 'math');
    if (cb) cb.checked = true;
  });
  await page.evaluate(() => document.getElementById('dw-next').click()); await page.waitForTimeout(250); // → P5
  await page.evaluate(() => document.getElementById('dw-next').click()); await page.waitForTimeout(250); // → P6
  await page.evaluate(() => document.getElementById('dw-next').click()); await page.waitForTimeout(250); // → P7
  const step7 = await page.evaluate(() => +document.querySelector('#demand-form .dw-step.dw-step--active').dataset.step);
  const submitVisible = await page.evaluate(() => !document.getElementById('d-submit').classList.contains('hidden'));
  const nextHidden = await page.evaluate(() => document.getElementById('dw-next').classList.contains('hidden'));
  ok('走到 P7 且提交按钮出现', step7 === 7 && submitVisible && nextHidden, `active=${step7} submit=${submitVisible} nextHidden=${nextHidden}`);

  // Back 回退 → P6
  await page.evaluate(() => document.getElementById('dw-back').click()); await page.waitForTimeout(250);
  const step6 = await page.evaluate(() => +document.querySelector('#demand-form .dw-step.dw-step--active').dataset.step);
  ok('Back 回 P6', step6 === 6, `active=${step6}`);
  await page.evaluate(() => document.getElementById('dw-next').click()); await page.waitForTimeout(250); // 回 P7

  // P7 填联系方式提交
  await page.evaluate(() => {
    document.getElementById('d-parent-contact').value = '13800138000';
    document.getElementById('d-student-contact').value = '13900139000';
    document.getElementById('d-info').value = 'wizard 生产验证临时需求';
  });
  await page.screenshot({ path: 'C:/Users/Lenovo/AppData/Local/Temp/wizard-p7.png' });
  await page.evaluate(() => document.getElementById('d-submit').click());
  await page.waitForTimeout(2500);
  const toastSub = await page.evaluate(() => (document.querySelector('.toast, .app-toast, [class*=toast]') || {}).textContent || '');
  ok('提交成功 toast', /提交成功|发布成功|已提交/.test(toastSub), `toast=${toastSub.trim().slice(0, 30)}`);
  await page.waitForTimeout(500);

  // 服务端确认创建（按 additional_info 关键词查我的需求）
  const mine = await (await fetch(BASE + '/api/student/demands?scope=mine', { headers: J({ 'X-Auth-Token': stuTok }) })).json();
  const list = mine.demands || mine || [];
  const created = [...list].find(d => (d.additional_info || '').includes('wizard 生产验证临时需求'));
  ok('服务端创建成功', !!created, created ? `id=${created.id} grade=${created.student_grade} addr=${created.address}` : '未找到');
  if (created) createdId = created.id;

  // 编辑回填：打开编辑 → 回 P1 + 地址预选
  if (createdId) {
    await page.evaluate((id) => { openDemandModal(id); }, createdId);
    await page.waitForSelector('#demand-form', { timeout: 15000 });
    await page.waitForTimeout(600);
    const editActive = await page.evaluate(() => +document.querySelector('#demand-form .dw-step.dw-step--active').dataset.step);
    const editAddr = await page.evaluate(() => document.getElementById('d-address').value);
    const editGrade = await page.evaluate(() => document.getElementById('d-grade').value);
    ok('编辑回填回 P1 + 地址/年级预选', editActive === 1 && editAddr === '黄浦区·南京东路街道' && editGrade === 'senior1',
      `active=${editActive} addr=${editAddr} grade=${editGrade}`);
    const editDistrict = await page.evaluate(() => document.getElementById('d-district').value);
    ok('地址 picker 区预选', editDistrict === 'huangpu', `district=${editDistrict}`);
    await page.screenshot({ path: 'C:/Users/Lenovo/AppData/Local/Temp/wizard-edit.png' });
    await page.evaluate(() => closeModal());
  }
} catch (err) {
  ok('脚本异常', false, String(err && err.message || err).slice(0, 120));
} finally {
  if (browser) await browser.close();
  // 清理：删除临时需求（复用令牌，不重登）
  if (createdId && stuTok) {
    const d = await fetch(BASE + '/api/student/demands/' + createdId, { method: 'DELETE', headers: J({ 'X-Auth-Token': stuTok }) });
    if (d && !d.ok) console.log('cleanup demand ' + createdId + ': ' + d.status);
  }
  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL '));
  console.log('\n' + (results.length - fails.length) + '/' + results.length + ' PASS');
  process.exit(fails.length ? 1 : 0);
}
