/**
 * 动画函数层（目标分层：动画函数层）—— 全站动画/开闭时序/悬浮定位 单点
 *
 * 铁律（CLAUDE.md 前端渲染/动画）：开闭状态管理与动画彻底解耦——本层只切类 + 动画事件收尾，
 * 零内联样式操作（悬浮卡 fixed 定位是唯一例外：left/top 需 JS 测量，其余交给 CSS 类）。
 * 毛玻璃子树做 transform 动画必须走纯 transform 的 animation（复刻 modal-in），禁用 transition。
 *
 * 包含：
 *   - 选中块滑动（glidePill/syncPillOnce，rAF 逐帧追真实布局，真值依赖）
 *   - 卡片浮入（revealObserver/initReveals，错峰延迟单源 CONFIG）
 *   - Toast（创建节点 → CSS 类定位/入场 → 定时切退场类 → 移除）
 *   - 自定义下拉开闭（toggleCustomSelect/closeAllCustomSelects/positionCustomSelectPanel + 全局监听）
 *   - 通用交互监听（[role=button] 键盘可达 a11y）
 *
 * 依赖：state/DISP/UI/CONFIG（app-state 词法绑定）、DISP（app-display）；运行时引用 app-ui 的组件。
 */

// ============================================================
// 选中块滑动（侧边栏大黑块 + 沟通页会话选中块共用；容器须 position:relative，pill 为直接子元素。
// 选中项自身有展开动效，故用 rAF 逐帧追真实布局，保证指示块与退让的栏目严格同步）
// ============================================================
function syncPillOnce(pill, container, itemSel) {
  if (!pill || !container) return;
  const a = container.querySelector(itemSel + '.active');
  if (!a) { pill.style.opacity = '0'; return; }
  pill.style.opacity = '1';
  pill.style.top = a.offsetTop + 'px';
  pill.style.height = a.offsetHeight + 'px';
}
function glidePill(pill, container, itemSel, dur = CONFIG.GLIDE_MS) {
  if (!pill || !container) return;
  const t0 = performance.now();
  const step = now => {
    syncPillOnce(pill, container, itemSel);
    if (now - t0 < dur) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// 全局窗口缩放：重对齐侧边栏指示块；沟通页若已挂载也同步（其自行定义 syncChatPill）
window.addEventListener('resize', () => {
  syncPillOnce(document.getElementById('sidebar-pill'), document.getElementById('sidebar-nav'), '.sidebar-item');
  if (typeof syncChatPill === 'function') syncChatPill();
});

// ============================================================
// 卡片浮入（通知/需求/教师信息卡统一动效）：打开栏目即播、滚进视口再播；
// --reveal-delay 按序错峰，从下往上浮入。不 unobserve：卡片滚出视口即复位，滚回重播。
// 预热 backdrop-filter 合成层（opacity 0.01 强制合成路径，消除"先灰后艳"）——唯一的 JS 样式写入
// ============================================================
const revealObserver = ('IntersectionObserver' in window) ? new IntersectionObserver(es => {
  es.forEach(e => {
    if (e.isIntersecting) {
      const el = e.target;
      el.style.transition = 'none';
      el.style.opacity = '0.01';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = '';
        el.style.opacity = '';
        el.classList.add('revealed');
      }));
    } else {
      e.target.classList.remove('revealed');
    }
  });
}, { threshold: 0.06 }) : null;

const revealWatched = new Set(); // 观察中节点登记簿：initReveals 先释放已脱离 DOM 的旧节点（observer 从不 unobserve 会强引用分离树造成泄漏）
function initReveals(root) {
  if (!root) return;
  if (revealObserver) {
    for (const old of revealWatched) {
      if (!old.isConnected) { revealObserver.unobserve(old); revealWatched.delete(old); }
    }
  }
  const items = [...root.querySelectorAll('.list-card, .notif-item, .post-card')];
  items.forEach((el, i) => {
    el.classList.add('reveal');
    el.style.setProperty('--reveal-delay',
      `${CONFIG.REVEAL_DELAY_BASE + Math.min(i * CONFIG.REVEAL_DELAY_STEP, CONFIG.REVEAL_DELAY_MAX)}ms`);
  });
  void root.offsetHeight; // v0.22.8：一次布局读统一提交全部卡片的隐藏态（原逐卡 offsetHeight 是
  // 列表渲染期强制重排热点——50 卡 = 50 次同步布局；CSS 变量写入本就零布局，读完一次即够）
  if (revealObserver) items.forEach(el => { revealObserver.observe(el); revealWatched.add(el); });
  else items.forEach(el => el.classList.add('revealed'));
}

// ============================================================
// Toast：全站轻提示。CSS 类承担定位/入场动画；JS 只增删节点 + 定时切退场类（v0.21.0 重构：原内联 cssText 已下沉）
// ============================================================
function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast glass glass--float';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast--out'); // CSS transition 退场
    setTimeout(() => toast.remove(), CONFIG.TOAST_FADE_MS);
  }, CONFIG.TOAST_MS);
}

// ============================================================
// 自定义下拉开闭 + 悬浮定位（组件 DOM 构建在 app-ui.js；此处管开闭状态与 fixed 锚定）
// 面板挂 body 后 fixed 定位：以触发器 rect 计算坐标（脱离玻璃 isolation 堆叠上下文，永不被卡片盖住）
// ============================================================
function toggleCustomSelect(wrap) {
  if (!wrap) return;
  const wasOpen = wrap.classList.contains('open');
  closeAllCustomSelects();
  if (!wasOpen) {
    positionCustomSelectPanel(wrap);
    wrap.classList.add('open');
    if (wrap._customPanel) wrap._customPanel.classList.add('open');
  }
}
function closeAllCustomSelects() {
  document.querySelectorAll('.custom-select.open').forEach(w => {
    w.classList.remove('open');
    if (w._customPanel) w._customPanel.classList.remove('open');
  });
}
function positionCustomSelectPanel(wrap) {
  const panel = wrap._customPanel, trig = wrap.querySelector('.custom-select-trigger');
  if (!panel || !trig) return;
  const r = trig.getBoundingClientRect();
  panel.style.left = `${r.left}px`;
  panel.style.top = `${r.bottom + 6}px`;
  panel.style.width = `${r.width}px`;
}
/* 悬浮卡 fixed 锚定（v0.25.19 审计 G-14：教师端/学生端匹配度明细卡原两处重复定位，抽单点）。
   挂 body 的 fixed 卡以触发按钮 rect 定位（left 对齐 + 下缘 offset）；listEl 可选——几何上限随按钮下缘差收缩。 */
function positionFloatCard(btn, card, listEl) {
  if (!btn || !card) return;
  const r = btn.getBoundingClientRect();
  card.style.left = `${r.left}px`;
  card.style.top = `${r.bottom + CONFIG.MAX_MATCH_DETAIL_OFFSET}px`;
  if (listEl) listEl.style.maxHeight = `${CONFIG.MATCH_DETAIL_MAX_HEIGHT}px`;
}
// 滚动即收起（fixed 面板不跟随滚动；capture 捕获所有滚动容器，但面板自身滚动除外——否则一滚面板就收）
document.addEventListener('scroll', e => {
  if (e.target.closest && e.target.closest('.custom-select-panel')) return;
  closeAllCustomSelects();
}, { capture: true, passive: true });

// 点空白处收起；点选项写回原生 select 并派发 change（内联 onchange 照常触发）
document.addEventListener('click', e => {
  const opt = e.target.closest('.custom-option');
  if (opt) {
    const panel = opt.closest('.custom-select-panel');
    const wrap = panel && panel._wrap;
    const sel = wrap && wrap.querySelector('select');
    if (sel) {
      if (sel.value !== opt.dataset.value) {
        sel.value = opt.dataset.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      wrap.classList.remove('open');
      if (wrap._customPanel) wrap._customPanel.classList.remove('open');
      if (typeof syncCustomSelectText === 'function') syncCustomSelectText(sel);
    }
    return;
  }
  if (!e.target.closest('.custom-select') && !e.target.closest('.custom-select-panel')) closeAllCustomSelects();
});

// 键盘可达：非 button 的 [role=button]（头像/用户名/等第 pill 等 span 控件）用 Enter/Space 触发其 onclick，补齐 a11y
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const t = e.target;
  if (t && t.getAttribute && t.getAttribute('role') === 'button' && t.tagName !== 'BUTTON' && t.hasAttribute('onclick')) {
    e.preventDefault();
    t.click();
  }
});
