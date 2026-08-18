/**
 * 滑块拼图真人验证组件—— 独立验证浮窗 + 敏感操作门禁
 *
 * 成熟方案口径（调研结论，见 docs/0.26-认证与审核架构.md）：
 *   - 后端生成答案、前端渲染交互、后端校验，归一化偏移上报，一次性 token 防重放；
 *   - 前端只渲染与上报，不参与答案计算（正确答案由服务端保存，前端拿不到绝对值）。
 *
 * 内测落地（v1.4.13 清理特例后的最终形态）：
 *   - 完整动作输出接口 = openCaptchaModal({ onPass }) → onPass()（验证通过即执行被门禁拦下的动作）；
 *   - 【本地简化验证】答案由前端生成（缺口随机位置），校验走前端验证器：偏差 ≤ CAPTCHA_TOLERANCE
 *     即通过（大差不差放行，用户授权）——服务端防刷由 rate_limits 限流咽喉承担，拼图是纯人机交互门槛；
 *   - 图片留接口：背景当前为程序化渐变+噪点（无版权素材），未来接动态图片仅改 paintCaptcha 的
 *     背景绘制（drawImage 任意背景图 + 同源缺口块），接口签名不变。
 *   - 服务端图片化验证（后端生成答案/一次性 token/轨迹人机分析）属新功能待办，见 docs/backlog.md——
 *     当前前端自算答案，后端无 cutX 可独立校验，勿再写「切后端校验」死注释。
 *   - ⚠️ v1.4.13 曾删除轨迹收集（_captchaTrack）与 captchaId——若做后端人机判定（见 backlog 拼图待办），
 *     须按判定特征（时序 {t,x,y}/速度/停顿/抖动）重新设计恢复，勿直接从 git 历史捞旧格式。
 *
 * JS 只写 CSS 变量（--captcha-x 到共同祖先 .captcha-box，puzzle/fill/knob 全继承）与几何测量，
 * 滑块位移由 CSS transform 消费（合成器友好）。
 */

const CAPTCHA_W = 280, CAPTCHA_H = 120, SLIDER_W = 40, SLIDER_H = 40;
// 几何单源——
// 旋钮行程 = 画布宽 - 旋钮宽（画布/轨道同 280px）；缺口生成与拖拽 clamp 共用此值。
// 契约：缺口位置与旋钮偏移必须用同一把尺（CAPTCHA_MAX_X）归一化——分母不一致时右半缺口
// 误差恒超容差，校验必败。
const CAPTCHA_MAX_X = CAPTCHA_W - SLIDER_W; // 240：旋钮可移动行程（px）
const CAPTCHA_TOLERANCE = 0.08; // mock 验证器容差（归一化 ±8%）
let _captchaOnPass = null;
let _captchaTarget = 0;      // 缺口归一化位置（0~1，本地自算）——统一按 CAPTCHA_MAX_X 归一化
let _captchaOffset = 0;      // 当前滑块归一化偏移（0~1，/CAPTCHA_MAX_X，与 target 同坐标系）
let _captchaDrag = null;     // 拖拽中 { startClientX, startX, startT }
let _captchaTrack = [];      // 轨迹点 [{t,x,y}]（t=相对拖拽开始 ms，x/y=clientX/Y；v1.4.16 恢复供后端人机判定）
let _captchaIdStr = '';      // 本次挑战唯一标识（每轮 paint 重生成；后端人机判定一次性防重放）
let _captchaResetTimer = null; // 失败复位定时器（新拖拽即取消，防 420ms 复位打断在途拖拽）

function _randHex() {
  const b = new Uint8Array(3);
  crypto.getRandomValues(b);
  return '#' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * 打开拼图验证浮窗。
 * @param opts { title?, onPass? }
 *   onPass() —— 验证通过回调（执行被门禁拦下的实际动作）
 */
function openCaptchaModal({ title = UI.CAPTCHA_TITLE, onPass = null } = {}) {
  _captchaOnPass = onPass;
  openModal({
    title,
    cls: 'captcha-modal',
    // --captcha-x 统一挂共同祖先 .captcha-box（puzzle 与 track 是兄弟，CSS 变量按元素继承，
    // 挂 track 上 puzzle 拿不到 → 拖动小块滑块原位静止）。初始 0px 在此。
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
// 缺口形状（v1.4.16：正方形 → 多形状随机；外接框 40×40，R 为形状半径/半宽）
const GAP_SHAPES = ['square', 'circle', 'triangle', 'diamond', 'pentagon'];

/** 画缺口形状路径（以 (cx,cy) 为中心、r 为半径/半宽；fill 或 stroke 由调用方决定） */
function drawGapShape(ctx, cx, cy, r, shape) {
  ctx.beginPath();
  if (shape === 'circle') { ctx.arc(cx, cy, r, 0, Math.PI * 2); }
  else if (shape === 'square') { ctx.rect(cx - r, cy - r, r * 2, r * 2); }
  else if (shape === 'triangle') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r); ctx.closePath(); }
  else if (shape === 'diamond') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); }
  else { // pentagon（5 点正五边形）
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
}

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
  // 缺口位置（本地答案）——B2：按旋钮行程 CAPTCHA_MAX_X 归一化，
  // 与 _captchaOffset 同一坐标系（曾 /W 导致右半缺口恒差超容差必败）。左右各留边距，全域可达。
  const gapMin = 16, gapMax = CAPTCHA_MAX_X - 24; // 左缘 16px / 右缘 24px 边距（行程内）
  _captchaTarget = (gapMin + Math.random() * (gapMax - gapMin)) / CAPTCHA_MAX_X;
  const cutX = _captchaTarget * CAPTCHA_MAX_X, cutY = (H - SLIDER_H) / 2;
  // v1.4.16：缺口形状随机（多形状）；背景另画 2 个无效空缺（形状/高度不同）作干扰——拼图块只匹配有效缺口
  const shape = GAP_SHAPES[Math.floor(Math.random() * GAP_SHAPES.length)];
  const R = SLIDER_W / 2 - 4; // 形状半径（40 框内留边，圆/多边形不触框）
  _captchaIdStr = _captchaId(); // 每轮挑战唯一 id（后端人机判定一次性防重放）
  // 拼图块：矩形复制背景缺口区 → destination-in 按形状保留（非矩形块 = 背景原位裁剪成形状）
  const pz = document.getElementById('captcha-puzzle');
  if (pz) {
    const pctx = pz.getContext('2d');
    pctx.clearRect(0, 0, SLIDER_W, SLIDER_H);
    pctx.drawImage(cv, cutX, cutY, SLIDER_W, SLIDER_H, 0, 0, SLIDER_W, SLIDER_H);
    pctx.save();
    pctx.globalCompositeOperation = 'destination-in'; // 只保留形状内像素（背景原位裁剪）
    drawGapShape(pctx, SLIDER_W / 2, SLIDER_H / 2, R, shape);
    pctx.fill(); // ★ v1.4.17 修复：必须 fill 才裁剪成形状（此前只建路径 → 拼图块仍是矩形）
    pctx.restore();
  }
  // 背景有效缺口：destination-out 抠出形状 + 白描边可见
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  drawGapShape(ctx, cutX + SLIDER_W / 2, cutY + SLIDER_H / 2, R, shape);
  ctx.fill(); // ★ v1.4.17 修复：必须 fill 才抠出透明洞（此前只剩白线框、中央实心）
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 2;
  drawGapShape(ctx, cutX + SLIDER_W / 2, cutY + SLIDER_H / 2, R, shape);
  ctx.stroke();
  // 无效空缺 ×2（干扰）：形状与有效缺口不同（或高度偏移），位置避开有效缺口与彼此
  const fakeShapes = GAP_SHAPES.filter(s => s !== shape);
  const fakes = [];
  for (let i = 0; i < 2; i++) {
    let fx = 0, fy = 0, tries = 0;
    do {
      fx = 24 + Math.random() * (W - 64);
      fy = 10 + Math.random() * (H - 46); // 高度可变（不与有效缺口同行，增加"合不上"感）
      tries++;
    } while (tries < 20 && (Math.abs(fx - cutX) < 80 || fakes.some(f => Math.abs(f.x - fx) < 60)));
    if (tries >= 20) {
      // 随机约束耗尽：确定性左上/右下双槽兜底。几何保证：两槽与有效洞的垂直中心距
      // 34/44、彼此 78，均 > 形状直径 32 → 三洞像素级恒不重叠（随机约束 |fx-cutX|>=80
      // 与彼此 >=60 在 cutX 中部数学上不可满足；旧实现耗尽后两洞重叠 = 可见渲染缺陷，
      // 且破坏「三洞互不重叠」不变量——验证脚本连通域断言依赖该不变量）。
      fakes.length = 0;
      fakes.push({ x: 24, y: 6 }, { x: W - 64, y: 84 });
      break;
    }
    fakes.push({ x: fx, y: fy });
  }
  fakes.forEach((f, i) => {
    const fs = fakeShapes[i % fakeShapes.length];
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    drawGapShape(ctx, f.x + SLIDER_W / 2, f.y + SLIDER_H / 2, R, fs);
    ctx.fill(); // ★ v1.4.17 修复：无效空缺同样必须 fill 才抠出透明洞
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 2;
    drawGapShape(ctx, f.x + SLIDER_W / 2, f.y + SLIDER_H / 2, R, fs);
    ctx.stroke();
  });
  // 复位滑块与轨迹
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
  // --captcha-x 统一写共同祖先 .captcha-box——puzzle（track 兄弟）与 fill/knob（track 子）全继承
  const box = document.getElementById('captcha-box') || track;
  const max = CAPTCHA_MAX_X; // 几何单源（B2）
  const down = (e) => {
    if (knob.classList.contains('captcha--pass')) return;
    if (_captchaResetTimer) { clearTimeout(_captchaResetTimer); _captchaResetTimer = null; } // 失败复位在途：新拖拽即取消，防复位打断（B2 卡死修复）
    _captchaDrag = { startClientX: e.clientX, startX: _captchaOffset * max, startT: Date.now() };
    _captchaTrack = []; // 新一轮拖拽清空轨迹（人机判定只取本次拖拽）
    knob.setPointerCapture(e.pointerId);
    track.classList.add('captcha--dragging');
  };
  const move = (e) => {
    if (!_captchaDrag) return;
    const next = Math.max(0, Math.min(max, _captchaDrag.startX + (e.clientX - _captchaDrag.startClientX)));
    _captchaOffset = next / max;
    box.style.setProperty('--captcha-x', `${next}px`);
    // 轨迹收集（v1.4.16 后端人机判定）：时序点，cap 128 防刷屏
    if (_captchaTrack.length < 128) _captchaTrack.push({ t: Date.now() - _captchaDrag.startT, x: e.clientX, y: e.clientY });
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

/** 校验（本地简化验证器：归一化偏差 ≤ 容差即过——服务端防刷由 rate_limits 承担，见头部注释） */
async function verifyCaptcha() {
  const track = document.getElementById('captcha-track');
  const tip = document.getElementById('captcha-tip');
  const knob = document.getElementById('captcha-knob');
  if (!track || !tip || !knob) return;
  const diff = Math.abs(_captchaOffset - _captchaTarget);
  if (diff <= CAPTCHA_TOLERANCE) {
    // v1.5.0 后端人机判定：本地比对通过后提交轨迹；判定拒绝或服务不可达都走失败路径
    // （fail-closed：验证码是安全门，不通就不放行，用户重试一次即可）
    try {
      const r = await api('/api/captcha/verify', {
        method: 'POST',
        body: { captchaId: _captchaIdStr, offset: Number(_captchaOffset.toFixed(3)), track: _captchaTrack },
      });
      if (!r || !r.ok) { failCaptcha(track, tip, knob); return; }
    } catch (e) { failCaptcha(track, tip, knob); return; } // 判定服务不可达 = 不通过（fail-closed）
    knob.classList.add('captcha--pass');
    tip.textContent = UI.CAPTCHA_PASS;
    tip.classList.remove('captcha-tip--fail');
    tip.classList.add('captcha-tip--pass');
    const cb = _captchaOnPass;
    _captchaOnPass = null;
    setTimeout(() => {
      closeModal();
      if (cb) cb();
    }, 260);
    return;
  }
  // 本地比对未对准 / 后端人机判定拒绝 → 统一失败路径（抖动 + 复位 + 重滚缺口，
  // B2：失败不再卡在同一个难位——paintCaptcha 每轮新缺口 + 复位旋钮/轨迹）
  failCaptcha(track, tip, knob);
}

/** 验证失败统一收尾：抖动 + 复位 + 重滚新缺口（人机判定拒绝与本地比对失败共用） */
function failCaptcha(track, tip, knob) {
  knob.classList.add('captcha--fail');
  track.classList.add('captcha--shake');
  tip.textContent = UI.CAPTCHA_FAIL;
  tip.classList.add('captcha-tip--fail');
  if (_captchaResetTimer) clearTimeout(_captchaResetTimer);
  _captchaResetTimer = setTimeout(() => {
    _captchaResetTimer = null;
    const box = document.getElementById('captcha-box') || track;
    box.style.setProperty('--captcha-x', '0px');
    paintCaptcha(); // 重绘背景 + 重滚缺口 + 复位旋钮/轨迹（tip 复位）
    tip.textContent = UI.CAPTCHA_TIP;
    tip.classList.remove('captcha-tip--fail');
    knob.classList.remove('captcha--fail');
    track.classList.remove('captcha--shake');
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
