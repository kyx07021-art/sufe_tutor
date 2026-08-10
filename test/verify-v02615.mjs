// v0.26.15 生产前端验证（L1 裸号验证码登录 / L2 页脚间距 / L3 无地区 select + 大陆文案）——playwright 连生产
import { chromium } from 'playwright';

const BASE = 'https://sufe-tutor.pages.dev';
const results = [];
const ok = (name, pass, detail = '') => results.push(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('dialog', d => d.dismiss().catch(() => {}));

// 全局防干扰：关新手引导 + 隐藏一切弹层覆盖（onboard 引导/tour/提示浮层）
async function clearOverlays() {
  await page.evaluate(() => {
    try { if (typeof skipTour === 'function') skipTour(); } catch { /* 不存在则忽略 */ }
    for (const el of document.querySelectorAll('.modal, .modal-overlay, #modal-container, .onboard-tour, [class*="onboard"], [class*="tour"]')) {
      if (el && el.style) el.style.display = 'none';
    }
    // 关闭 openModal 生成的覆盖层：modal-container 是挂载点，直接隐藏其全部子层
    const mc = document.getElementById('modal-container');
    if (mc) mc.style.display = 'none';
  });
}

await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 90000 });
await clearOverlays();

// —— 打开登录页 ——
const viewOk = await page.evaluate(() => { if (typeof showView === 'function') { showView('login'); return true; } return false; });
if (!viewOk) await page.click('[onclick="showView(\'login\')"]').catch(() => {});
await page.waitForSelector('#login-identifier', { state: 'visible', timeout: 30000 });
await page.waitForTimeout(600);

// —— L2：页脚两个交互点间距 ——
try {
  const r = await page.$$eval('.auth-footer--split a', els => els.map(e => {
    const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), text: e.textContent };
  }));
  if (r.length === 2) {
    const gap = r[1].x - (r[0].x + r[0].w);
    const sameRow = Math.abs(r[0].y - r[1].y) < 4;
    ok('L2 页脚两交互点同排且有间距', sameRow && gap >= 10, `「${r[0].text}」→「${r[1].text}」间距 ${gap}px`);
  } else ok('L2 页脚两交互点', false, `找到 ${r.length} 个链接`);
  ok('L2 分隔点 .sep 存在', (await page.$('.auth-footer--split .sep')) !== null);
} catch (e) { ok('L2 页脚', false, e.message); }

// —— L3a：登录页无地区 select ——
ok('L3 登录页无地区 select', (await page.$('.phone-prefix-select, #login-prefix')) === null, '无 select');

// —— L1：输用户名 → 改裸大陆号 → 点验证码登录 ——
let l1 = {};
try {
  await page.fill('#login-identifier', 'qa_student');
  await page.waitForTimeout(1500); // 账户探测（loginAccountValid=true）
  l1.hintUsername = (await page.textContent('#login-username-hint').catch(() => '')).slice(0, 40);
  await page.fill('#login-identifier', '13812345678'); // 改成裸大陆号（登录页无前缀选择器）
  await page.waitForTimeout(1500); // 号码探测返回（exists:false → 正确门控 loginAccountValid=false）
  l1.hintPhone = (await page.textContent('#login-username-hint').catch(() => '')).slice(0, 40);
  await page.click('#login-switch-mode');
  await page.waitForTimeout(900);
  l1.toast = (await page.textContent('.toast, #toast').catch(() => '') || '').slice(0, 60);
  l1.codeVisible = await page.isVisible('#login-code-group').catch(() => false);
  ok('L1 裸号切换验证码模式不误报「用户名账户请使用密码登录」', !l1.toast.includes('用户名账户'), `toast=${JSON.stringify(l1.toast)}`);
} catch (e) { ok('L1 裸号切换', false, e.message); }
console.log('  [L1] 用户名阶段hint:', JSON.stringify(l1.hintUsername), '| 号码阶段hint:', JSON.stringify(l1.hintPhone), '| toast:', JSON.stringify(l1.toast), '| 验证码组可见:', l1.codeVisible);

// —— L3b：绑定浮窗无地区 select + 大陆文案（直接调全局 openPhoneBindModal）——
try {
  const modalOk = await page.evaluate(() => { if (typeof openPhoneBindModal === 'function') { openPhoneBindModal(); return true; } return false; });
  await page.waitForTimeout(800);
  const bs = await page.evaluate(() => {
    const mc = document.getElementById('modal-container');
    const root = mc ? mc : document;
    const sel = root.querySelector('.phone-prefix-select, #bind-prefix');
    const input = root.querySelector('#bind-phone');
    return { hasSelect: !!sel && sel.tagName === 'SELECT', phonePlaceholder: input ? input.placeholder : null, hasAnyPrefix: !!root.querySelector('#bind-prefix') };
  });
  ok('L3 绑定浮窗无地区 select', modalOk && !bs.hasSelect, JSON.stringify(bs));
  ok('L3 手机号输入框 placeholder 标注大陆', !bs.phonePlaceholder || bs.phonePlaceholder.includes('中国大陆'), `placeholder=${bs.phonePlaceholder}`);
} catch (e) { ok('L3 绑定浮窗', false, e.message); }

console.log('\n=== 验证结果 ===');
console.log(results.join('\n'));
await browser.close();
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
