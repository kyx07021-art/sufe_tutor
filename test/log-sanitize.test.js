/**
 * 网安报告 F-06 —— log.js 敏感键剔除回归（留档/兜底脱敏第一道关）：
 * pass/salt/secret/token/code$/fileData/avatar/body/contact/wechat/email 一律 [redacted]，
 * 嵌套对象与数组递归、深层截断、非对象原样。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../server/log.js';

const SENSITIVE = ['password', 'passwd', 'salt', 'secret', 'token', 'verifyCode', 'fileData', 'avatar', 'body', 'contact', 'wechat', 'email'];

test('全部敏感键脱敏，普通键保留', () => {
  const input = { password: 'x', name: '正常字段', title: '标题' };
  const out = sanitize(input);
  assert.equal(out.password, '[redacted]');
  assert.equal(out.name, '正常字段');
  assert.equal(out.title, '标题');
  for (const k of SENSITIVE) {
    assert.equal(sanitize({ [k]: 'v' })[k], '[redacted]', `键 ${k}`);
  }
});

test('code 后缀键脱敏（verifyCode/otpCode/statusCode——保守策略：凡 code 结尾一律红）', () => {
  assert.equal(sanitize({ otpCode: '123456' }).otpCode, '[redacted]');
  assert.equal(sanitize({ inviteCode: 'ABC123' }).inviteCode, '[redacted]');
  assert.equal(sanitize({ statusCode: 200 }).statusCode, '[redacted]'); // 保守脱敏：误伤不泄露
});

test('嵌套对象与数组递归脱敏', () => {
  const out = sanitize({ a: { password: 'x', list: [{ token: 't' }, 'ok'] } });
  assert.equal(out.a.password, '[redacted]');
  assert.equal(out.a.list[0].token, '[redacted]');
  assert.equal(out.a.list[1], 'ok');
});

test('深度 >4 截断为 [deep]（防循环引用爆栈）', () => {
  let root = {};
  let cur = root;
  for (let i = 0; i < 6; i++) { cur.child = {}; cur = cur.child; }
  // depth 从 0 计，第 6 层（depth 5）截断：root.child×5 后为 [deep]
  assert.equal(sanitize(root).child.child.child.child.child, '[deep]');
});

test('null/undefined/标量/数组空原样', () => {
  assert.equal(sanitize(null), null);
  assert.equal(sanitize(undefined), undefined);
  assert.equal(sanitize(42), 42);
  assert.equal(sanitize('text'), 'text');
  assert.deepEqual(sanitize([]), []);
});
