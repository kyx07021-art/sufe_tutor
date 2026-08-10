/**
 * 滑块拼图真人验证组件（v0.26.0 C1/C2）—— 独立验证浮窗 + 敏感操作门禁
 *
 * 成熟方案口径（调研结论，见 docs/0.26-认证与审核架构.md）：
 *   - 后端生成答案、前端渲染交互、后端校验，归一化偏移上报，一次性 token 防重放；
 *   - 前端只渲染与上报，不参与答案计算（正确答案由服务端保存，前端拿不到绝对值）。
 *
 * 内测落地（完整动作输出接口 + 简单验证器）：
 *   - 完整动作输出接口 = openCaptchaModal({ onPass }) → onPass({ captchaId, offset, track })：
 *     captchaId 本次验证唯一标识、offset 归一化偏移（0~1）、track 轨迹点数组。
 *   - 【内测短路】答案由前端生成（缺口随机位置），校验走前端 mock 验证器：偏差 ≤ CAPTCHA_TOLERANCE
 *     即通过（大差不差放行，用户授权）。生产接入：切 verifyCaptcha 内注释的分支——
 *     调后端 POST /api/captcha/verify（服务端保存 captchaId→cutX、一次性校验、轨迹人机分析），
 *     前端不再自算答案。
 *   - 图片留接口：背景当前为程序化渐变+噪点（无版权素材），未来接动态图片仅改 paintCaptcha 的
 *     背景绘制（drawImage 任意背景图 + 同源缺口块），接口签名不变。
 *
 * JS 只写 CSS 变量（--captcha-x 到共同祖先 .captcha-box，puzzle/fill/knob 全继承）与几何测量，
 * 滑块位移由 CSS transform 消费（合成器友好）。v0.26.17：原写轨道上拼图块（track 兄弟）拿不到。
 */

const CAPTCHA_W = 280, CAPTCHA_H = 120, SLIDER_W = 40, SLIDER_H = 40;
const CAPTCHA_TOLERANCE = 0.08; // mock 验证器容差（归一化 ±8%）
let _captchaOnPass = null;
let _captchaTarget = 0;      // 缺口归一化位置（0~1，mock 自算；生产由后端下发）
let _captchaOffset = 0;      // 当前滑块归一化偏移（0~1）
let _captchaDrag = null;     // 拖拽中 { startClientX, startX }
let _captchaTrack = [];      // 轨迹点 [{t,x,y}]（未来人机分析用）

function _randHex() {
  const b = new Uint8Array(3);
  crypto.getRandomValues(b);
  return '#' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * 打开拼图验证浮窗。
 * @param opts { title?, onPass? }
 *   onPass({ captchaId, offset, track }) —— 验证通过回调（执行被门禁拦下的实际动作）
 */
function openCaptchaModal({ title = UI.CAPTCHA_TITLE, onPass = null } = {}) {
  _captchaOnPass = onPass;
  openModal({
    title,
    cls: 'captcha-modal',
    // v0.26.17 拼图块断线修复：--captcha-x 统一挂共同祖先 .captcha-box（puzzle 与 track 是兄弟，
    // CSS 变量按元素继承，原挂 track 上 puzzle 拿不到 → 拖动小块滑块原位静止，用户实证）。初始 0px 在此。
    body: `<div class="captcha-box" id="captcha-box" style="--captcha-x:0px">
      <canvas id="captcha-canvas" width="${CAPTCHA_W}" height="${CAPTCHA_H}"></canvas>
      <canvas id="captcha-puzzle" width="${SLIDER_W}" height="${SLIDER_H}" aria-hidden="true"></canvas>
      <div class="captcha-slider-track" id="captcha-track">
        <div class="captcha-slider-fill" id="captcha-fill"></div>
        <div class="captcha-slider-knob" id="captcha-knob" role="button" aria-label="${UI.CAPTCHA_ARIA}">➜</div>
      </div>
      <p class="captcha-tip" id="captcha-tip">${UI.CAPTCHA_TIP}</p>
    </div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>`,
  });
  paintCaptcha();
  bindCaptchaDrag();
}

/** 绘制背景（程序化渐变+噪点）与缺口；未来接动态图片只改此处背景绘制 */
function paintCaptcha() {
  const cv = document.getElementById('captcha-canvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  // 背景：随机双色渐变 + 噪点（无版权素材）
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, _randHex());
  g.addColorStop(1, _randHex());
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = `rgba(${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},${(Math.random() * 0.5 + 0.1).toFixed(2)})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.2, 1.2);
  }
  // 缺口位置（mock 答案；生产由后端下发 cutX）
  const maxX = W - SLIDER_W - 24;
  _captchaTarget = (16 + Math.random() * maxX) / W;
  const cutX = _captchaTarget * W, cutY = (H - SLIDER_H) / 2;
  // 拼图块（B4 修复：原只抠洞没有跟随滑块的拼图块）：把缺口区域背景复制到 puzzle canvas，
  // 滑块位移经 CSS 同源 --captcha-x 驱动 translateX 跟随（合成器只读，零重绘）。
  // v0.26.17：--captcha-x 由共同祖先 .captcha-box 提供（模板初始化 0px），puzzle 经继承跟随——
  // 原在 puzzle 自身 inline 设 0px 会以 inline 覆盖继承值，拼图块永远停原位（用户实证）。
  const pz = document.getElementById('captcha-puzzle');
  if (pz) {
    const pctx = pz.getContext('2d');
    pctx.clearRect(0, 0, SLIDER_W, SLIDER_H);
    pctx.drawImage(cv, cutX, cutY, SLIDER_W, SLIDER_H, 0, 0, SLIDER_W, SLIDER_H);
  }
  // 缺口：destination-out 抠出 + 白描边可见
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.fillRect(cutX, cutY, SLIDER_W, SLIDER_H);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(cutX + 1, cutY + 1, SLIDER_W - 2, SLIDER_H - 2);
  // 复位滑块与轨迹（v0.26.17：--captcha-x 统一写共同祖先 .captcha-box，puzzle/fill/knob 全部继承复位）
  _captchaOffset = 0; _captchaTrack = [];
  const track = document.getElementById('captcha-track');
  const box = document.getElementById('captcha-box') || track;
  box.style.setProperty('--captcha-x', '0px');
}

/** 拖拽绑定（pointer 事件统一鼠标/触摸；JS 只写 --captcha-x 与几何测量） */
function bindCaptchaDrag() {
  const knob = document.getElementById('captcha-knob');
  const track = document.getElementById('captcha-track');
  if (!knob || !track) return;
  // v0.26.17：--captcha-x 统一写共同祖先 .captcha-box——puzzle（track 兄弟）与 fill/knob（track 子）全继承
  const box = document.getElementById('captcha-box') || track;
  const max = CAPTCHA_W - SLIDER_W;
  const down = (e) => {
    if (knob.classList.contains('captcha--pass')) return;
    _captchaDrag = { startClientX: e.clientX, startX: _captchaOffset * max };
    knob.setPointerCapture(e.pointerId);
    track.classList.add('captcha--dragging');
  };
  const move = (e) => {
    if (!_captchaDrag) return;
    const next = Math.max(0, Math.min(max, _captchaDrag.startX + (e.clientX - _captchaDrag.startClientX)));
    _captchaOffset = next / max;
    box.style.setProperty('--captcha-x', `${next}px`);
    _captchaTrack.push({ t: Date.now(), x: e.clientX, y: e.clientY });
    if (_captchaTrack.length > 64) _captchaTrack.shift();
  };
  const up = () => {
    if (!_captchaDrag) return;
    _captchaDrag = null;
    track.classList.remove('captcha--dragging');
    verifyCaptcha();
  };
  knob.addEventListener('pointerdown', down);
  knob.addEventListener('pointermove', move);
  knob.addEventListener('pointerup', up);
  knob.addEventListener('pointercancel', up);
}

/** 校验（内测 mock 验证器：归一化偏差 ≤ 容差即过；生产切后端校验分支） */
async function verifyCaptcha() {
  const track = document.getElementById('captcha-track');
  const tip = document.getElementById('captcha-tip');
  const knob = document.getElementById('captcha-knob');
  if (!track || !tip || !knob) return;
  const diff = Math.abs(_captchaOffset - _captchaTarget);
  if (diff <= CAPTCHA_TOLERANCE) {
    // ============ 生产接入点（后端校验）============
    // const r = await api('/api/captcha/verify', { method: 'POST', body: { captchaId, offset: _captchaOffset, track: _captchaTrack } });
    // if (!r.ok) return failCaptcha(track, tip, knob);
    // ============ 内测 mock 验证器（大差不差即过）============
    knob.classList.add('captcha--pass');
    tip.textContent = UI.CAPTCHA_PASS;
    tip.classList.remove('captcha-tip--fail');
    tip.classList.add('captcha-tip--pass');
    const cb = _captchaOnPass;
    _captchaOnPass = null;
    setTimeout(() => {
      closeModal();
      if (cb) cb({ captchaId: _captchaId(), offset: Number(_captchaOffset.toFixed(3)), track: _captchaTrack });
    }, 260);
    return;
  }
  // 失败：抖动 + 复位（可重试）
  knob.classList.add('captcha--fail');
  track.classList.add('captcha--shake');
  tip.textContent = UI.CAPTCHA_FAIL;
  tip.classList.add('captcha-tip--fail');
  setTimeout(() => {
    knob.classList.remove('captcha--fail');
    track.classList.remove('captcha--shake');
    tip.textContent = UI.CAPTCHA_TIP;
    tip.classList.remove('captcha-tip--fail');
    _captchaOffset = 0;
    const box = document.getElementById('captcha-box') || track;
    box.style.setProperty('--captcha-x', '0px');
  }, 420);
}

function _captchaId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

// C2 敏感操作门禁 withCaptcha 已下沉到 app-ui.js（boot 共享层：登录/注册/签约/合同等各领域调用，
// 且 vm 测试普遍只加载 boot 不加载本文件——放此处会让 submitSigning 等测试 ReferenceError）。
// 本文件只提供 openCaptchaModal（验证浮窗本体），withCaptcha 经 typeof 检查引用它。
