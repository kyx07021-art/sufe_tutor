/**
 * 移动端登录/注册验证码输入框布局几何回归（G5 / 规则 45 + 需求 AC）：
 * playwright 真实浏览器断言——375px 屏验证码行输入可视区够放 6 位数字 + 输入框顶到 label。
 * 背景：.form-label 固定 flex:0 0 116px + 列 gap 22px + 右缘按钮预留 padding-right:104px，
 * 把移动端验证码输入可视区挤到 33px（375px 屏实测），6 位验证码 + placeholder 全被吞
 * （用户反馈「输入框太窄吞字」）。AC-1 修复 = media 480px 内 .form-group:has(.code-input-wrap)
 * 收窄 gap + label 按内容宽，输入框顶到 label 拉满（可视区 33→124px）。
 * 用法：node test/verify-otp-input.mjs（需 playwright；不进 npm test glob）
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('playwright');
const port = 8953;
const dist = resolve(process.cwd(), 'dist');
const server = createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  if (u === '/api/auth/check') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ exists: true, role: 'student' })); return; }
  const file = resolve(dist, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
  if (!file.startsWith(dist + sep) && file !== dist) { res.statusCode = 403; res.end('Forbidden'); return; }
  if (existsSync(file)) { const t = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream'; res.setHeader('Content-Type', t); res.end(readFileSync(file)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(readFileSync(join(dist, 'index.html'))); }
});
await new Promise(r => server.listen(port, '127.0.0.1', r));
const browser = await chromium.launch();

const cases = [
  { name: 'mobile-375', width: 375, height: 667, minVisible: 110, minWrap: 200, maxGap: 10, minGap: 0 },
  // minGap:20 锁桌面列距 22px——AC-1 规则若被误移出 media 块泄漏到桌面，gap 变小即红（G2 牙齿）
  { name: 'desktop-1440', width: 1440, height: 900, minVisible: 80, minWrap: 180, maxGap: 30, minGap: 20 },
];
for (const vp of cases) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.width < 600, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  // 首访 onboarding 弹窗拦截点击：点遮罩关闭（closable 路径，Z-14-F1 教训）
  await page.evaluate(() => { const ov = document.querySelector('#modal-container .modal-overlay'); if (ov) ov.click(); }).catch(() => {});
  await page.waitForTimeout(300);
  await page.click('[data-action="auth.viewLogin"]');
  await page.waitForSelector('#login-identifier');
  await page.fill('#login-identifier', '13800138000');
  await page.waitForSelector('#login-password-group:not(.hidden)', { timeout: 8000 });
  await page.click('#login-switch-mode'); // 切验证码登录
  await page.waitForSelector('#login-code-group:not(.hidden)', { timeout: 8000 });
  await page.waitForTimeout(300);
  const geo = await page.evaluate(() => {
    const label = document.querySelector('#login-code-group .form-label');
    const wrap = document.querySelector('#login-code-group .code-input-wrap');
    const input = document.querySelector('#login-code');
    const lr = label.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const ir = input.getBoundingClientRect();
    const cs = getComputedStyle(input);
    return {
      labelRight: Math.round(lr.right), wrapX: Math.round(wr.x), wrapWidth: Math.round(wr.width),
      inputX: Math.round(ir.x), inputWidth: Math.round(ir.width),
      gapBetweenLabelAndInput: Math.round(ir.x - lr.right),
      visibleInput: Math.round(ir.width) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    };
  });
  assert.equal(errors.length, 0, `${vp.name}: 零 console/pageerror（实际 ${errors.length}）`);
  assert.ok(geo.visibleInput >= vp.minVisible,
    `${vp.name}: 输入可视区 ${geo.visibleInput}px 应 ≥ ${vp.minVisible}px（6 位验证码 + placeholder 可放，不再吞字）`);
  assert.ok(geo.wrapWidth >= vp.minWrap, `${vp.name}: 输入框宽 ${geo.wrapWidth}px 应 ≥ ${vp.minWrap}px`);
  assert.ok(geo.gapBetweenLabelAndInput <= vp.maxGap,
    `${vp.name}: 输入框左缘到 label 间距 ${geo.gapBetweenLabelAndInput}px 应 ≤ ${vp.maxGap}px（顶到 label）`);
  assert.ok(geo.gapBetweenLabelAndInput >= vp.minGap,
    `${vp.name}: 间距 ${geo.gapBetweenLabelAndInput}px 应 ≥ ${vp.minGap}px（锁桌面 label 116px 列距不泄漏 AC-1）`);
  assert.ok(geo.inputX <= geo.wrapX + 1, `${vp.name}: 输入框与 wrap 同左缘`);
  console.log(`✔ ${vp.name}: 可视区 ${geo.visibleInput}px / wrap ${geo.wrapWidth}px / gap ${geo.gapBetweenLabelAndInput}px`);
  await ctx.close();
}
await browser.close();
server.close();
console.log('验证码输入框布局几何：全部通过');
