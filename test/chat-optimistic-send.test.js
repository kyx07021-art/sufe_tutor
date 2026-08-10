/**
 * F10（v0.27.0 网络层重构）—— 聊天乐观发送回归
 *
 * 需求（用户：前端操作延迟）：发消息目前等响应才渲染气泡（1 次 RTT 卡顿感），
 * 全站最高频写操作应乐观——点发送即本地插入临时气泡，批量 POST 落库后替换真实 id，失败回滚。
 *
 * 覆盖（脚手架 #chat-messages/#chat-input/#chat-send-btn/#chat-stage，api 桩可控 Promise）：
 *   - 乐观：api 未返回前气泡已插入（负临时 data-mid），输入框已清空
 *   - 收敛：api 返回 {messages:[{id,...}]} 后临时 data-mid 替换为真实 id、chatLastMsgId 更新
 *   - 回滚：api 拒绝（audit-flow 驳回/网络错）→ 临时气泡移除 + 输入恢复 + 暂存恢复 + toast
 *   - 批量体：POST body 为 { batch:[{kind,uploadId},...{kind:'text',body}] }（一次往返）
 *   - 发送在途轮询关窗（chatOptimisticSending）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-style.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously',
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener: () => {} }); // jsdom 缺省未实现 window.matchMedia
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval, Request: globalThis.Request,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext(`try { localStorage.setItem('sufe_returning', '1'); } catch (e) {}`, ctx);
  return { ctx, dom };
}

/** 脚手架聊天帧：注入发送链路所需 DOM + 会话态；api 由宿主可控桩注入 */
function scaffoldChat(ctx, dom) {
  const doc = dom.window.document;
  const main = doc.getElementById('client-main') || doc.body;
  const box = doc.createElement('div'); box.id = 'chat-messages';
  const input = doc.createElement('textarea'); input.id = 'chat-input'; input.value = '';
  const stage = doc.createElement('div'); stage.id = 'chat-stage';
  const btn = doc.createElement('button'); btn.id = 'chat-send-btn';
  main.appendChild(box); main.appendChild(input); main.appendChild(stage); main.appendChild(btn);
  vm.runInContext(`
    state.user = { id: 1, role: 'student' };
    chatConvId = 1;
    chatStaged = [];
    chatLastMsgId = 0;
    chatOptimisticSending = false;
    chatBumpConvPreview = () => {};   // 桩：不依赖会话列表/重渲染
    chatScrollToBottom = () => {};    // 桩：jsdom 无 box.scrollTo
  `, ctx);
}

test('乐观发送：api 未返回前气泡已插入（临时负 id）、输入已清空', async () => {
  const { ctx, dom } = makeCtx();
  scaffoldChat(ctx, dom);
  let resolveSend, capturedBody = null;
  ctx.api = (url, opts) => new Promise(res => { resolveSend = res; capturedBody = opts.body; });
  const doc = dom.window.document;
  doc.getElementById('chat-input').value = '你好';

  const p = vm.runInContext('sendChatMessage()', ctx);
  await new Promise(r => setTimeout(r, 0)); // 微任务落到 await api
  const bubbles = doc.querySelectorAll('#chat-messages .chat-msg');
  assert.equal(bubbles.length, 1, 'api 未返回时乐观气泡已插入');
  const mid = bubbles[0].dataset.mid;
  assert.ok(Number(mid) < 0, `临时气泡为负 data-mid（实际=${mid}）`);
  assert.ok(bubbles[0].textContent.includes('你好'), '气泡含消息文本');
  assert.equal(doc.getElementById('chat-input').value, '', '输入框已乐观清空');
  assert.ok(capturedBody, '已发出批量 POST');
  // 跨 realm 归一化（vm 对象原型 ≠ 宿主原型，deepStrictEqual 因原型不等失败——CLAUDE.md 教训）
  assert.deepEqual(JSON.parse(JSON.stringify(capturedBody.batch)), [{ kind: 'text', body: '你好' }], '批量体 = 单条文字（一次往返）');
  assert.equal(vm.runInContext('chatOptimisticSending', ctx), true, '发送在途轮询关窗');

  resolveSend({ messages: [{ id: 5, kind: 'text', name: '' }] });
  await p;
  assert.equal(vm.runInContext('chatOptimisticSending', ctx), false, '发送完成关窗复位');
  const settled = doc.querySelector('#chat-messages .chat-msg');
  assert.equal(settled.dataset.mid, '5', '响应后临时 data-mid 替换为真实 id');
  assert.equal(vm.runInContext('chatLastMsgId', ctx), 5, 'chatLastMsgId 更新防重复拉回');
});

test('乐观失败回滚：api 拒绝 → 气泡移除 + 输入恢复 + toast', async () => {
  const { ctx, dom } = makeCtx();
  scaffoldChat(ctx, dom);
  ctx.api = () => Promise.reject(Object.assign(new Error('审核驳回'), { code: 'AUDIT_REJECT' }));
  const doc = dom.window.document;
  doc.getElementById('chat-input').value = '你好';

  await vm.runInContext('sendChatMessage()', ctx);
  assert.equal(doc.querySelectorAll('#chat-messages .chat-msg').length, 0, '失败后乐观气泡移除');
  assert.equal(doc.getElementById('chat-input').value, '你好', '失败后输入恢复（可重试）');
  const toast = doc.querySelector('#toast-container');
  assert.ok(toast && toast.textContent.length, '失败 toast 弹出');
  assert.equal(vm.runInContext('chatOptimisticSending', ctx), false, '失败后关窗复位');
});

test('乐观去重：在途轮询已抢插真实气泡 → 发送成功移除临时气泡（防双气泡）', async () => {
  const { ctx, dom } = makeCtx();
  scaffoldChat(ctx, dom);
  let resolveSend;
  ctx.api = (url, opts) => {
    if (opts && opts.method === 'POST') return new Promise(res => { resolveSend = res; });
    return Promise.resolve({ messages: [] });
  };
  const doc = dom.window.document;
  doc.getElementById('chat-input').value = '你好';
  const p = vm.runInContext('sendChatMessage()', ctx);
  await new Promise(r => setTimeout(r, 0));
  const optimistic = doc.querySelector('#chat-messages .chat-msg');
  assert.ok(Number(optimistic.dataset.mid) < 0, '乐观临时气泡已插入');
  // 模拟在途轮询（发送发起前已发出、服务端 GET 排在 batch POST 后处理）抢插真实 id 气泡：
  // 轮询去重查 data-mid 因临时气泡还是负 id 而 miss → 插了真实气泡
  doc.querySelector('#chat-messages').insertAdjacentHTML('beforeend', `<div class="chat-msg" data-mid="5"></div>`);
  resolveSend({ messages: [{ id: 5, kind: 'text', name: '' }] });
  await p;
  const bubbles = [...doc.querySelectorAll('#chat-messages .chat-msg')];
  assert.equal(bubbles.length, 1, '发送成功后无双气泡（临时气泡被移除去重）');
  assert.equal(bubbles[0].dataset.mid, '5', '仅剩轮询抢插的真实气泡');
});

test('批量附件：暂存附件（uploadId）+ 文字一次 POST，乐观气泡逐条插入', async () => {
  const { ctx, dom } = makeCtx();
  scaffoldChat(ctx, dom);
  let resolveSend, capturedBody = null;
  ctx.api = (url, opts) => new Promise(res => { resolveSend = res; capturedBody = opts.body; });
  const doc = dom.window.document;
  doc.getElementById('chat-input').value = '正文';
  vm.runInContext(`
    chatStaged = [
      { id: 1, kind: 'image', uploadId: 10, name: 'a.jpg', dataUrl: 'data:image/jpeg;base64,AAA', ready: true },
      { id: 2, kind: 'file', uploadId: 11, name: 'b.pdf', dataUrl: 'data:application/pdf;base64,BBB', ready: true },
    ];
  `, ctx);

  const p = vm.runInContext('sendChatMessage()', ctx);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(doc.querySelectorAll('#chat-messages .chat-msg').length, 3, '2 附件 + 1 文字乐观气泡全插入');
  assert.equal(vm.runInContext('chatStaged.length', ctx), 0, '暂存区已乐观清空');
  assert.deepEqual(JSON.parse(JSON.stringify(capturedBody.batch)), [
    { kind: 'image', uploadId: 10 }, { kind: 'file', uploadId: 11 }, { kind: 'text', body: '正文' },
  ], '批量体 = 附件 uploadId + 文字（一次往返替代 2N+1 串行）');

  resolveSend({ messages: [
    { id: 6, kind: 'image', name: 'a.jpg' }, { id: 7, kind: 'file', name: 'b.pdf' }, { id: 8, kind: 'text', name: '' },
  ] });
  await p;
  const mids = [...doc.querySelectorAll('#chat-messages .chat-msg')].map(b => b.dataset.mid);
  assert.deepEqual(mids, ['6', '7', '8'], '真实 id 按批序替换临时 id');
  assert.equal(vm.runInContext('chatLastMsgId', ctx), 8, '取批内最大 id 防轮询重拉');
});
