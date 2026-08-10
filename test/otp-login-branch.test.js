/**
 * v0.26.16 外部审查补漏（L1 残留断线）—— requestOtpCode 登录分支裸大陆号「发送验证码」回归：
 *
 * 背景：toggleLoginMode 已改用 classifyIdentifier 放行裸号切验证码模式（v0.26.14），但
 * requestOtpCode 登录分支原以 validatePhone 门控（要求 +86 前缀），裸大陆号在「发送验证码」
 * 一步仍被拦 → toast「请输入有效的手机号或邮箱」、target 空、不发请求——「切一段留一段」，
 * 用户实证场景（输用户名改裸号后验证码登录）最终目标不可达。修复 = 登录分支改 classifyIdentifier
 * + 前端 normalize（裸大陆号补 +86），与后端 server/otp.js normalizeIdentifier 同语义。
 *
 * 覆盖：裸大陆号 → target='+86'+号码 发码（不拦）/ 带 +86 前缀 → 原样 / 用户名 → 拦并提示 /
 * 邮箱 → channel='email' 原样发码。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx(identifierValue) {
  const calls = { api: [], toast: [] };
  const sandbox = {
    console,
    SUFE_DISPLAY: {},
    document: {
      getElementById(id) {
        const map = {
          'login-send': { disabled: false },
          'login-code': { focus() {} },
          'login-identifier': { value: identifierValue },
        };
        return map[id] || null;
      },
    },
    api: async (...a) => { calls.api.push(a); return { mockCode: '123456' }; },
    showToast: (msg) => { calls.toast.push(msg); },
    bindCountdown: () => {},
  };
  vm.createContext(sandbox);
  for (const f of ['constants.js', 'app-state.js', 'app-otp.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), sandbox, { filename: f });
  }
  return { ctx: sandbox, calls };
}

test('裸大陆号发送验证码：不拦，target 补 +86 发码', async () => {
  const { ctx, calls } = makeCtx('13812345678');
  await vm.runInContext(`requestOtpCode('login', 'sms')`, ctx);
  assert.equal(calls.api.length, 1, '发出 OTP 请求（未被格式门控拦截）');
  assert.equal(calls.api[0][1].body.target, '+8613812345678', '裸大陆号补 +86（与后端 normalizeIdentifier 对齐）');
  assert.equal(calls.api[0][1].body.channel, 'sms');
  assert.ok(!calls.toast.some(t => t.includes('请输入有效的手机号或邮箱')), '不弹格式错误提示');
});

test('带 +86 前缀：target 原样', async () => {
  const { ctx, calls } = makeCtx('+8613812345678');
  await vm.runInContext(`requestOtpCode('login', 'sms')`, ctx);
  assert.equal(calls.api.length, 1);
  assert.equal(calls.api[0][1].body.target, '+8613812345678', '已带前缀不重复补');
});

test('用户名：被拦并提示（验证码只发给手机/邮箱账户）', async () => {
  const { ctx, calls } = makeCtx('qa_student');
  await vm.runInContext(`requestOtpCode('login', 'sms')`, ctx);
  assert.equal(calls.api.length, 0, '用户名不发 OTP 请求');
  assert.ok(calls.toast.some(t => t.includes('请输入有效的手机号或邮箱')), '弹格式提示');
});

test('邮箱：channel=email 原样发码', async () => {
  const { ctx, calls } = makeCtx('stu@sufe.edu.cn');
  await vm.runInContext(`requestOtpCode('login', 'sms')`, ctx);
  assert.equal(calls.api.length, 1);
  assert.equal(calls.api[0][1].body.target, 'stu@sufe.edu.cn');
  assert.equal(calls.api[0][1].body.channel, 'email', '邮箱自动走 email 通道');
});
