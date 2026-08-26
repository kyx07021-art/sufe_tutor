/**
 * ZK: 全站图片详情查看器（lightbox 大图）——占屏大图 + 全屏灰化遮罩 + 点击遮罩/Esc 关闭 +
 * body 滚动锁（计次恢复）+ 单例去重（F3）+ 三个接入点（P1 管理员录取通知书 / P2 奖学金凭证 /
 * P3 通用 openImageViewer——聊天/投诉两调用点由既有 chat-bubble-restyle / complaint 测试锁定）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openImageViewer, closeImageViewer, closeAllModals } from '../src/client/core/ui.js';
import { state } from '../src/client/core/state.js';
import { _dhResetForTests } from '../src/client/core/datahub.js';
import { GLASS_CSS } from './_css.js';
import { viewAwardProof, loadAdminVerifications, viewAdmissionImage } from '../src/client/features/admin/actions.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 1, role: 'admin', username: 'admin_sufe' };
  state.authToken = 'tok-admin';
  return dom;
}
function teardown() {
  closeAllModals(); // closes the ZK lightbox if open (modal-container + body-lock + Esc listener)
  delete globalThis.document; delete globalThis.window; delete globalThis.MutationObserver; delete globalThis.fetch;
}

test('ZK-1 占屏几何：modal-overlay.image-viewer-modal + image-viewer-img + CSS 规则落位 + 零内联样式', () => {
  const dom = setup();
  openImageViewer('data:image/png;base64,AAA');
  const host = dom.window.document.getElementById('modal-container');
  const overlay = host.querySelector('.modal-overlay.image-viewer-modal');
  assert.ok(overlay, 'lightbox overlay 出现（复用 .modal-overlay 宿主）');
  const img = overlay.querySelector('img.image-viewer-img');
  assert.ok(img, '大图 img.image-viewer-img');
  assert.equal(img.getAttribute('src'), 'data:image/png;base64,AAA', 'src 正确');
  assert.ok(!overlay.getAttribute('style') && !img.getAttribute('style'), 'overlay/img 零内联 style（CSP style-src-attr none）');
  assert.ok(!/style=/.test(host.innerHTML), 'lightbox DOM 零 style 属性');
  // 几何/遮罩规则落位（glass.css 单源，token 消费）
  assert.match(GLASS_CSS, /\.modal-overlay\.image-viewer-modal\s*\{[^}]*z-index:\s*400/, 'overlay z-index 400 高于 modal(200)');
  assert.match(GLASS_CSS, /\.modal-overlay\.image-viewer-modal\s*\{[^}]*background:\s*var\(--g-modal-dim\)/, '遮罩色走 --g-modal-dim 单源 token');
  assert.match(GLASS_CSS, /img\.image-viewer-img\s*\{[^}]*max-width:\s*92vw/, '大图 max-width 92vw');
  assert.match(GLASS_CSS, /img\.image-viewer-img\s*\{[^}]*max-height:\s*88vh/, '大图 max-height 88vh');
  assert.match(GLASS_CSS, /img\.image-viewer-img\s*\{[^}]*object-fit:\s*contain/, 'object-fit contain 居中');
  assert.match(GLASS_CSS, /body\.image-viewer-lock\s*\{[^}]*overflow:\s*hidden/, 'body 滚动锁规则');
  teardown();
});

test('ZK-1 点击遮罩关闭、点击图片本身不关', () => {
  const dom = setup();
  openImageViewer('data:image/png;base64,AAA');
  const host = dom.window.document.getElementById('modal-container');
  const overlay = host.querySelector('.image-viewer-modal');
  const img = overlay.querySelector('img');
  img.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.ok(dom.window.document.querySelector('.image-viewer-modal'), '点图片不关（target === img ≠ root）');
  overlay.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.ok(!dom.window.document.querySelector('.image-viewer-modal'), '点周边灰化区关闭');
  teardown();
});

test('ZK-1 Esc 关闭', () => {
  const dom = setup();
  openImageViewer('data:image/png;base64,AAA');
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.ok(!dom.window.document.querySelector('.image-viewer-modal'), 'Esc 关闭 lightbox');
  teardown();
});

test('ZK-1 body 滚动锁：打开加锁、关闭解锁、closeAllModals 全局解锁', () => {
  const dom = setup();
  openImageViewer('data:image/png;base64,AAA');
  assert.ok(dom.window.document.body.classList.contains('image-viewer-lock'), '打开后 body 加锁');
  closeImageViewer();
  assert.ok(!dom.window.document.body.classList.contains('image-viewer-lock'), '关闭后解锁');
  // closeAllModals（登出/路由切换路径）须顺带关掉 lightbox 并解锁
  openImageViewer('data:image/png;base64,BBB');
  assert.ok(dom.window.document.body.classList.contains('image-viewer-lock'), '重开再加锁');
  closeAllModals();
  assert.ok(!dom.window.document.body.classList.contains('image-viewer-lock'), 'closeAllModals 解锁 body');
  assert.ok(!dom.window.document.querySelector('.image-viewer-modal'), 'closeAllModals 清掉 lightbox');
  teardown();
});

test('ZK-1 单例去重：连续开两次只挂一层（F3）', () => {
  const dom = setup();
  openImageViewer('data:image/png;base64,AAA');
  openImageViewer('data:image/png;base64,BBB');
  const host = dom.window.document.getElementById('modal-container');
  assert.equal(host.querySelectorAll('.image-viewer-modal').length, 1, '只一层 viewer');
  const img = host.querySelector('.image-viewer-img');
  assert.equal(img.getAttribute('src'), 'data:image/png;base64,AAA', '第一次的 src 保留（二次调用被去重忽略）');
  teardown();
});

test('ZK-2/3 P1+P2：管理员录取通知书 / 奖学金凭证走新 lightbox', async () => {
  const dom = setup();
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/admin/awards/66/proof')) {
      return { ok: true, status: 200, json: async () => ({ dataUrl: 'data:image/png;base64,PROOF' }) };
    }
    return { ok: true, status: 200, json: async () => ({ verifications: [{ id: 88, username: '教师戊', user_id: 9, verify_type: 'admission', verify_code: '', status: 'pending', created_at: '2026-08-01 12:00:00', verified_at: null, school: '', level: '', major: '', enrollment_status: '', enroll_year: '', admission_image: 'data:image/png;base64,ADM' }] }) };
  };
  // P2: viewAwardProof
  await viewAwardProof(66);
  let viewer = dom.window.document.querySelector('.modal-overlay.image-viewer-modal');
  assert.ok(viewer, 'P2 奖学金凭证走 lightbox');
  assert.ok(viewer.querySelector('img.image-viewer-img').getAttribute('src').includes('PROOF'), 'P2 凭证图渲染');
  closeImageViewer();
  // P1: viewAdmissionImage（先加载列表填 _verifListCache，再点预览）
  _dhResetForTests();
  const list = document.createElement('div');
  list.id = 'admin-verifications-list';
  document.body.appendChild(list);
  await loadAdminVerifications();
  viewAdmissionImage(88);
  viewer = dom.window.document.querySelector('.modal-overlay.image-viewer-modal');
  assert.ok(viewer, 'P1 录取通知书走 lightbox');
  assert.ok(viewer.querySelector('img.image-viewer-img').getAttribute('src').includes('ADM'), 'P1 原图渲染');
  teardown();
});

test('ZK-4 P3：聊天图片气泡点击走 openImageViewer（新 lightbox）', async () => {
  const dom = setup();
  state.user = { id: 1, role: 'teacher', username: '甲' };
  const { chatOpenImage } = await import('../src/client/features/chat/actions-misc.js');
  const { chat } = await import('../src/client/features/chat/chat-state.js');
  chat.convId = 9;
  const img = dom.window.document.createElement('img');
  img.dataset.full = '1';
  img.src = 'data:image/jpeg;base64,CHAT';
  await chatOpenImage(42, img);
  const viewer = dom.window.document.querySelector('.modal-overlay.image-viewer-modal');
  assert.ok(viewer, '聊天图片走新 lightbox');
  assert.ok(viewer.querySelector('img.image-viewer-img').getAttribute('src').includes('CHAT'), '聊天原图渲染');
  teardown();
});
