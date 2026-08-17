/**
 * B0 api core：唯一网络出口。覆盖请求封装、401 死令牌处理、GET 重试、
 * 批量读与 XHR 上传通道。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { state } from '../src/client/core/state.js';
import {
  api, apiBatch, apiUpload, setEnsureAuth, setSessionBootValidating, sessionBootValidating,
} from '../src/client/core/api.js';

const dom = new JSDOM('<!doctype html><html></html>', { url: 'http://localhost/' });
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => { calls.push({ url: String(url), opts }); return handler(String(url), opts, calls.length); };
  return calls;
}

test('api 成功：携带令牌与 JSON 化 body，返回解析结果', async () => {
  state.authToken = 'TOK_OK';
  const calls = mockFetch(async (url, opts) => {
    assert.equal(url, '/api/ping');
    assert.equal(opts.headers['X-Auth-Token'], 'TOK_OK');
    assert.equal(opts.headers['Content-Type'], 'application/json');
    assert.equal(opts.body, '{"a":1}');
    return { ok: true, status: 200, json: async () => ({ ok: true, data: { a: 1 } }) };
  });
  const data = await api('/api/ping', { method: 'POST', body: { a: 1 } });
  assert.deepEqual(data, { ok: true, data: { a: 1 } });
  assert.equal(calls.length, 1);
  state.authToken = null;
});

test('api 非 2xx：透出服务端 code 与错误文案，不重试', async () => {
  const calls = mockFetch(async () => ({
    ok: false, status: 400, json: async () => ({ error: 'bad input', code: 'VALIDATION' }),
  }));
  await assert.rejects(api('/api/nope', { method: 'POST' }), err => {
    assert.equal(err.code, 'VALIDATION');
    assert.equal(err.message, 'bad input');
    return true;
  });
  assert.equal(calls.length, 1);
});

test('api GET 网络抖动按配置重试，POST 不重试', async () => {
  let n = 0;
  const calls = mockFetch(async () => {
    n++;
    if (n === 1) throw new TypeError('connection reset');
    return { ok: true, status: 200, json: async () => ({ ok: true, attempt: n }) };
  });
  const data = await api('/api/get-retry');
  assert.equal(data.attempt, 2);
  assert.equal(calls.length, 2);

  let postN = 0;
  mockFetch(async () => { postN++; throw new TypeError('reset'); });
  await assert.rejects(api('/api/post', { method: 'POST' }), err => err.code === 'NETWORK_ERROR');
  assert.equal(postN, 1);
});

test('apiBatch 合并结果；401 清会话、触发 ensureAuth', async () => {
  globalThis.localStorage.setItem('sufe_session_student', JSON.stringify({ authToken: 'TOK_OLD', user: { role: 'student' }, expires: Date.now() + 99999 }));
  state.authToken = 'TOK_OLD';
  state.user = { role: 'student' };
  state.view = 'client';
  setSessionBootValidating(false);
  let ensured = 0;
  setEnsureAuth(() => { ensured++; });

  mockFetch(async () => ({ ok: true, status: 200, json: async () => ({
    ok: true,
    results: [
      { path: '/api/a', status: 200, data: { v: 1 } },
      { path: '/api/b', status: 401, data: { code: 'UNAUTHORIZED' } },
    ],
  }) }));
  const map = await apiBatch(['/api/a', '/api/b']);
  assert.equal(map.get('/api/a').data.v, 1);
  assert.equal(map.get('/api/b').status, 401);
  assert.equal(state.authToken, null);
  assert.equal(state.user, null);
  assert.equal(globalThis.localStorage.getItem('sufe_session_student'), null);
  assert.equal(ensured, 1);
  setEnsureAuth(null);
  state.view = 'landing';
});

test('sessionBootValidating 抑制 401 死链重定向，setter 正常工作', () => {
  setSessionBootValidating('yes');
  assert.equal(sessionBootValidating, true);
  setSessionBootValidating(0);
  assert.equal(sessionBootValidating, false);
});

class FakeXHR {
  constructor() {
    this.upload = {};
    this.headers = {};
    this.status = 200;
    this.response = null;
    this.responseText = '';
    this.sentBody = null;
    FakeXHR.last = this;
  }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  send(body) {
    this.sentBody = body;
    queueMicrotask(() => {
      if (FakeXHR.mode === 'progress') this.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
      else if (FakeXHR.mode === 'success') this.onload();
      else this.onerror();
    });
  }
}

test('apiUpload 走唯一 XHR 上传通道并回报进度', async () => {
  const prev = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXHR;
  FakeXHR.mode = 'progress';
  const progress = [];
  const p = apiUpload({ kind: 'chat', fileData: 'data:image/png;base64,xx', fileName: 'a.png' }, v => progress.push(v));
  await new Promise(r => queueMicrotask(r)); // 让 send 先以 progress 模式触发一次 onprogress
  FakeXHR.last.response = { ok: true, url: '/u/1.png' };
  FakeXHR.last.onload();
  const data = await p;
  assert.equal(FakeXHR.last.method, 'POST');
  assert.equal(FakeXHR.last.url, '/api/uploads');
  assert.equal(FakeXHR.last.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(FakeXHR.last.sentBody), { kind: 'chat', fileData: 'data:image/png;base64,xx', fileName: 'a.png' });
  assert.deepEqual(progress, [0.5]);
  assert.deepEqual(data, { ok: true, url: '/u/1.png' });
  globalThis.XMLHttpRequest = prev;
});

test('apiUpload 401 与网络错误：死链清会话 / 明确错误码', async () => {
  const prev = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXHR;
  state.authToken = 'TOK_UP';
  state.user = { role: 'student' };
  globalThis.localStorage.setItem('sufe_session_student', 'x');
  FakeXHR.mode = 'success';
  FakeXHR.last = null;
  let p = apiUpload({ kind: 'chat', fileData: 'x' });
  FakeXHR.last.status = 401;
  FakeXHR.last.response = { error: 'expired', code: 'AUTH' };
  await assert.rejects(p, err => err.code === 'AUTH');
  assert.equal(state.authToken, null);
  assert.equal(globalThis.localStorage.getItem('sufe_session_student'), null);

  FakeXHR.mode = 'fail';
  p = apiUpload({ kind: 'chat', fileData: 'x' });
  await assert.rejects(p, err => err.message.includes('网络连接失败'));
  globalThis.XMLHttpRequest = prev;
});
