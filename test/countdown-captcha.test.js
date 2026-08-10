/**
 * v0.26.0 前端组件测试（B1 倒计时 / C1 滑块拼图 / C2 门禁 / B4 登录结构）
 *
 * 覆盖：
 *   - formatCountdown：智能单位（>1 天向下取整 x 天、<1 天 >1 分 x 时 x 分、<1 分 x 秒）；
 *   - bindCountdown：按钮灰化 + 文案随单位切换 + 到期复原（防 interval 永续）；
 *   - openCaptchaModal：独立验证浮窗渲染（canvas/轨道/滑块/提示），onPass 回调；
 *   - withCaptcha：存在且经 openCaptchaModal 拦截；
 *   - 登录页五合一结构：唯一输入框 login-identifier、密码组/验证码组初始隐藏、切换小字。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

function bootCtx(dom, extra = {}) {
  const w = dom.window;
  return vm.createContext({
    window: w, document: w.document, localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console, fetch: extra.fetch || (async () => ({ ok: true, status: 200, json: async () => ({}) })),
    setTimeout, clearTimeout, setInterval, clearInterval, Request, AbortController, performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } }, requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    crypto: w.crypto,
    ...extra,
  });
}

function load(ctx, files) {
  for (const f of files) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
}

// ---------------- B1 formatCountdown（纯函数，无需 DOM） ----------------
test('formatCountdown：智能单位（天/时分/秒向下取整）', () => {
  // 直接加载 app-ui.js 拿全局函数
  const dom = new JSDOM('<html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/', runScripts: 'dangerously' });
  const ctx = bootCtx(dom);
  load(ctx, ['constants.js', 'app-display.js', 'app-state.js', 'app-anim.js', 'app-ui.js']);
  const f = vm.runInContext('formatCountdown', ctx);
  assert.equal(f(7 * 24 * 3600 * 1000 + 5000), '7天', '>1 天向下取整 x 天');
  assert.equal(f(3 * 3600 * 1000 + 25 * 60 * 1000 + 9000), '3时25分', '<1 天向下取整 x 时 x 分');
  assert.equal(f(25 * 60 * 1000 + 9000), '25分', '>1 分 <1 小时仅 x 分');
  assert.equal(f(45 * 1000 + 500), '45秒', '<1 分向下取整 x 秒');
  assert.equal(f(0), '', '已到时不显示');
  assert.equal(f(-100), '', '负数归零');
});

// ---------------- B1 bindCountdown ----------------
test('bindCountdown：按钮灰化 + 文案更新 + 到期复原；NaN endAt 不启动（防 interval 永续）', async () => {
  const dom = new JSDOM('<html><body><button id="b">发送验证码</button><div id="modal-container"></div></body></html>', { url: 'http://localhost/', runScripts: 'dangerously' });
  const ctx = bootCtx(dom);
  load(ctx, ['constants.js', 'app-display.js', 'app-state.js', 'app-anim.js', 'app-ui.js']);
  const btn = dom.window.document.getElementById('b');
  const stop = vm.runInContext(`bindCountdown(document.getElementById('b'), { endAt: ${Date.now() + 2600}, runningText: '{time}后可再次发送验证码' })`, ctx);
  assert.equal(btn.disabled, true, '倒计时中按钮灰化');
  assert.ok(btn.textContent.includes('秒后'), '文案含秒倒计时');
  assert.ok(!btn.textContent.includes('{time}'), '占位符已替换');
  stop(); // 提前停
  assert.equal(btn.disabled, false, '停止后复原可点');
  // NaN endAt 防御：不启动（interval 不挂起）
  const btn2 = dom.window.document.createElement('button');
  dom.window.document.body.appendChild(btn2);
  const stop2 = vm.runInContext(`bindCountdown(document.getElementById('b'), { endAt: NaN })`, ctx);
  stop2();
  assert.equal(btn.disabled, false, 'NaN endAt 不灰化不挂起');
});

// ---------------- C1 openCaptchaModal 渲染 + onPass ----------------
test('openCaptchaModal：独立验证浮窗（canvas/轨道/滑块/提示）+ 完整动作输出接口', async () => {
  const dom = new JSDOM('<html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/', runScripts: 'dangerously' });
  // jsdom 无 canvas 2d 上下文 → stub 返回链式空对象
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {}, fillStyle: '', save: () => {}, restore: () => {},
    globalCompositeOperation: '', strokeRect: () => {}, lineWidth: 0, strokeStyle: '',
    clearRect: () => {}, drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(6400) }),
  });
  const ctx = bootCtx(dom);
  load(ctx, ['constants.js', 'app-display.js', 'app-state.js', 'app-anim.js', 'app-ui.js', 'app-otp.js', 'app-captcha.js']);
  let passed = null;
  vm.runInContext(`openCaptchaModal({ onPass: (r) => { window.__captchaResult = r; } })`, ctx);
  const container = dom.window.document.getElementById('modal-container');
  assert.ok(container.querySelector('#captcha-canvas'), 'canvas 拼图区渲染');
  assert.ok(container.querySelector('#captcha-puzzle'), '拼图块 canvas 渲染（B4 修复：跟随滑块移动）');
  assert.ok(container.querySelector('#captcha-track'), '滑块轨道渲染');
  assert.ok(container.querySelector('#captcha-knob'), '滑块渲染');
  assert.ok(container.querySelector('.captcha-tip'), '提示渲染');
  // 关闭后 onPass 清空
  vm.runInContext('closeModal()', ctx);
  assert.equal(container.innerHTML, '', '验证浮窗可关闭');
  void passed;
});

// B4 回归（用户反馈：滑块只能滑到左边一半 + 拼图块没渲染）：
// 拖拽写入 --captcha-x、命中缺口验证通过（onPass 完整动作输出）、拖偏失败复位
test('B4 拼图交互：拖拽更新 --captcha-x + 命中缺口验证通过 + 拖偏失败复位', async () => {
  const dom = new JSDOM('<html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/', runScripts: 'dangerously' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {}, fillStyle: '', save: () => {}, restore: () => {},
    globalCompositeOperation: '', strokeRect: () => {}, lineWidth: 0, strokeStyle: '',
    clearRect: () => {}, drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(6400) }),
  });
  const ctx = bootCtx(dom);
  load(ctx, ['constants.js', 'app-display.js', 'app-state.js', 'app-anim.js', 'app-ui.js', 'app-otp.js', 'app-captcha.js']);
  const drag = (toX) => vm.runInContext(`(() => {
    const ME = window.MouseEvent; // jsdom vm 上下文无 MouseEvent 全局，走 window
    const knob = document.getElementById('captcha-knob');
    knob.dispatchEvent(new ME('pointerdown', { clientX: 0, bubbles: true }));
    knob.dispatchEvent(new ME('pointermove', { clientX: ${toX}, bubbles: true }));
    knob.dispatchEvent(new ME('pointerup', { clientX: ${toX}, bubbles: true }));
  })()`, ctx);
  // 通过路径：拖到缺口位置
  vm.runInContext(`window.__passed = null; window.__got = null; openCaptchaModal({ onPass: (r) => { window.__passed = true; window.__got = r; } })`, ctx);
  const target = vm.runInContext(`Math.round(_captchaTarget * 240)`, ctx);
  drag(target);
  // v0.26.17：--captcha-x 统一写共同祖先 .captcha-box（puzzle 与 track 是兄弟，原挂 track 上拼图块
  // 拿不到 → 拖动小块滑块原位静止，用户实证）。knob/fill（track 子）与 puzzle（track 兄弟）全继承 box。
  const trackX = vm.runInContext(`document.getElementById('captcha-box').style.getPropertyValue('--captcha-x')`, ctx);
  assert.equal(trackX, target + 'px', '拖拽写入 --captcha-x 到共同祖先 .captcha-box（滑块位移）');
  // 断线回归：拼图块不得设自身 inline --captcha-x（inline 覆盖继承值 → 永远停在起点）
  const puzzleInline = vm.runInContext(`document.getElementById('captcha-puzzle').style.getPropertyValue('--captcha-x')`, ctx);
  assert.equal(puzzleInline, '', '拼图块无自身 inline --captcha-x（走 box 继承跟随，防原位静止）');
  await new Promise(r => setTimeout(r, 350)); // verifyCaptcha pass 260ms 关闭
  assert.equal(dom.window.__passed, true, '命中缺口 → 验证通过 onPass 调用');
  assert.ok(dom.window.__got && typeof dom.window.__got.offset === 'number' && dom.window.__got.captchaId && Array.isArray(dom.window.__got.track), '完整动作输出接口 {captchaId, offset, track}');
  // 失败路径：拖偏 → 不通过 + 滑块复位
  vm.runInContext(`window.__passed = false; openCaptchaModal({ onPass: () => { window.__passed = true; } })`, ctx);
  const t2 = vm.runInContext(`Math.round(_captchaTarget * 240)`, ctx);
  drag(Math.min(240, Math.max(10, t2 + 130))); // 明显偏离
  await new Promise(r => setTimeout(r, 500)); // fail 420ms 复位
  assert.equal(dom.window.__passed, false, '拖偏 → 不通过');
  const resetX = vm.runInContext(`document.getElementById('captcha-box').style.getPropertyValue('--captcha-x')`, ctx);
  assert.equal(resetX, '0px', '失败后滑块复位到起点（box 共同祖先）');
});

// ---------------- B2（v0.27.2 用户反馈：空缺老是左边 / 右边必败 / 试多卡死） ----------------
// 根因：缺口 _captchaTarget 用 /W(280) 归一化、旋钮 _captchaOffset 用 /240（CAPTCHA_MAX_X）归一化——
// 两把尺，cutX>134px 的右半缺口实际对齐误差恒 > 容差 → 必败。修后统一按 CAPTCHA_MAX_X 归一化。
test('B2 全域可达 + 右半缺口对齐即过：gap 边缘落在行程内，右侧缺口校验通过', async () => {
  const dom = new JSDOM('<html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/', runScripts: 'dangerously' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    createLinearGradient: () => ({ addColorStop: () => {} }), fillRect: () => {}, fillStyle: '', save: () => {}, restore: () => {},
    globalCompositeOperation: '', strokeRect: () => {}, lineWidth: 0, strokeStyle: '', clearRect: () => {}, drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(6400) }),
  });
  const ctx = bootCtx(dom);
  load(ctx, ['constants.js', 'app-display.js', 'app-state.js', 'app-anim.js', 'app-ui.js', 'app-otp.js', 'app-captcha.js']);
  const drag = (toX) => vm.runInContext(`(() => { const ME = window.MouseEvent; const knob = document.getElementById('captcha-knob'); knob.dispatchEvent(new ME('pointerdown', { clientX: 0, bubbles: true })); knob.dispatchEvent(new ME('pointermove', { clientX: ${toX}, bubbles: true })); knob.dispatchEvent(new ME('pointerup', { clientX: ${toX}, bubbles: true })); })()`, ctx);
  vm.runInContext(`window.__passed = false; openCaptchaModal({ onPass: () => { window.__passed = true; } });`, ctx);
  // 缺口归一化按行程 CAPTCHA_MAX_X（与旋钮同坐标系）：gap 像素位恒在 [16, CAPTCHA_MAX_X-24] 行程内
  const [gapMin, gapMax, maxX] = vm.runInContext(`(Math.round(_captchaTarget * CAPTCHA_MAX_X) >= 16 && Math.round(_captchaTarget * CAPTCHA_MAX_X) <= CAPTCHA_MAX_X - 24) ? [16, CAPTCHA_MAX_X - 24, CAPTCHA_MAX_X] : [0,0,0]`, ctx);
  assert.equal(maxX, 240, 'CAPTCHA_MAX_X = 240（画布宽-旋钮宽）');
  assert.ok(gapMin > 0 && gapMax < 240, `缺口生成在行程 [16, 216] 内（全域可被旋钮 0-240 到达）`);
  // 右半缺口（0.85 → 204px）：旧实现 204/240=0.85 vs 204/280=0.729 → 差 0.121>0.08 必败
  vm.runInContext(`_captchaTarget = 0.85;`, ctx);
  const rightPx = vm.runInContext(`Math.round(_captchaTarget * CAPTCHA_MAX_X)`, ctx);
  assert.ok(rightPx > 180, `右半缺口像素位=${rightPx}px`);
  drag(rightPx);
  await new Promise(r => setTimeout(r, 350));
  assert.equal(dom.window.__passed, true, '右半缺口对齐 → 校验通过（坐标系统一，不再必败）');
});

test('B2 失败重滚缺口：拖偏失败后目标重滚（新挑战）+ 旋钮复位到 0', async () => {
  const dom = new JSDOM('<html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/', runScripts: 'dangerously' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    createLinearGradient: () => ({ addColorStop: () => {} }), fillRect: () => {}, fillStyle: '', save: () => {}, restore: () => {},
    globalCompositeOperation: '', strokeRect: () => {}, lineWidth: 0, strokeStyle: '', clearRect: () => {}, drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(6400) }),
  });
  const ctx = bootCtx(dom);
  load(ctx, ['constants.js', 'app-display.js', 'app-state.js', 'app-anim.js', 'app-ui.js', 'app-otp.js', 'app-captcha.js']);
  const drag = (toX) => vm.runInContext(`(() => { const ME = window.MouseEvent; const knob = document.getElementById('captcha-knob'); knob.dispatchEvent(new ME('pointerdown', { clientX: 0, bubbles: true })); knob.dispatchEvent(new ME('pointermove', { clientX: ${toX}, bubbles: true })); knob.dispatchEvent(new ME('pointerup', { clientX: ${toX}, bubbles: true })); })()`, ctx);
  vm.runInContext(`window.__passed = false; openCaptchaModal({ onPass: () => { window.__passed = true; } });`, ctx);
  const t1 = vm.runInContext(`_captchaTarget`, ctx);
  const id1 = vm.runInContext(`_captchaIdStr`, ctx);
  drag(5); // 明显偏离 → 必败
  await new Promise(r => setTimeout(r, 500)); // fail 420ms 复位 + 重滚
  const resetX = vm.runInContext(`document.getElementById('captcha-box').style.getPropertyValue('--captcha-x')`, ctx);
  assert.equal(resetX, '0px', '失败后旋钮复位到起点');
  const t2 = vm.runInContext(`_captchaTarget`, ctx);
  const id2 = vm.runInContext(`_captchaIdStr`, ctx);
  assert.notEqual(t2, t1, '失败后缺口重滚（新挑战，不再卡在同一个难位）');
  assert.notEqual(id2, id1, '失败后 captchaId 重生成（生产后端按挑战取值）');
  assert.equal(dom.window.__passed, false, '拖偏不通过');
});

// ---------------- C2 withCaptcha 门禁 ----------------
test('withCaptcha：存在并经 openCaptchaModal 拦截 action（生产门禁入口）', () => {
  const dom = new JSDOM('<html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/', runScripts: 'dangerously' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {}, fillStyle: '', save: () => {}, restore: () => {},
    globalCompositeOperation: '', strokeRect: () => {}, lineWidth: 0, strokeStyle: '',
    clearRect: () => {}, drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(6400) }),
  });
  const ctx = bootCtx(dom);
  load(ctx, ['constants.js', 'app-display.js', 'app-state.js', 'app-anim.js', 'app-ui.js']);
  assert.equal(typeof vm.runInContext('withCaptcha', ctx), 'function', 'withCaptcha 在 boot 共享层');
  // 无 openCaptchaModal（未加载 captcha）→ 防御直通 action（测试/异常环境）
  let ran = false;
  vm.runInContext(`withCaptcha(() => { window.__ran = true; })`, ctx);
  assert.equal(dom.window.__ran, true, 'captcha 未就绪时直通 action');
  // 加载 captcha 后 → 走 openCaptchaModal（action 被拦截不立即执行）
  load(ctx, ['app-otp.js', 'app-captcha.js']);
  dom.window.__ran2 = false;
  vm.runInContext(`withCaptcha(() => { window.__ran2 = true; })`, ctx);
  assert.equal(dom.window.__ran2, false, 'captcha 就绪后 action 被门禁拦截（通过 onPass 才执行）');
  assert.ok(dom.window.document.getElementById('modal-container').querySelector('#captcha-canvas'), '拦截后弹出拼图浮窗');
});

// ---------------- B4 登录页五合一结构 ----------------
test('登录页五合一：唯一输入框 + 密码组/验证码组初始隐藏 + 切换小字', () => {
  const html = readFileSync('./index.html', 'utf8');
  assert.ok(html.includes('id="login-identifier"'), '唯一输入框 login-identifier');
  assert.ok(html.includes('请输入用户名/手机号/邮箱'), '占位文案');
  assert.ok(html.includes('id="login-password-group"'), '密码组存在');
  assert.ok(html.includes('id="login-code-group"'), '验证码组存在');
  assert.ok(html.includes('onclick="requestOtpCode(\'login\',\'sms\')"'), '登录验证码发送按钮');
  assert.ok(html.includes('id="login-switch-mode"'), '页脚切换小字');
  assert.ok(!html.includes('id="login-username"'), '旧单一用户名输入框已移除');
});
