/**
 * 测试专用 OTP 投递 stub —— 防真实发信（v1.4.12 起生产代码零 dummy，测试改为拦截全局 fetch）。
 *
 * 背景：server/otp.js deliverOtp 走真实代码路径（构造 push.spug.cc URL + 表单 body + 解析响应），
 * 不再有 OTP_PROVIDER='mock' 短路。测试 import 本模块即自动安装：
 *   - 拦截 push.spug.cc/sms|mail 的 fetch，返回「受理成功」假响应（{code:200, request_id}）；
 *   - 把最近一次发送请求（URL + 表单字段）捕获进 sent 数组，供测试取验证码明文
 *     （验证码只存在于捕获的请求 body 中，与生产响应绝不携带验证码的口径一致）；
 *   - 非 push.spug.cc 的 fetch 原样转发（不干扰其他网络行为）。
 *
 * 用法（测试文件 import 即可，无需额外配置）：
 *   import { lastOtpCode, resetOtpStub, lastOtpSend } from './_otp-stub.js';
 *   const code = lastOtpCode('+8613812345678'); // 最近一次发给该目标的验证码（stub 捕获 body 中的 code）
 */
const sent = [];
const SPUG_RE = /push\.spug\.cc\/(sms|mail)\//;
let failMode = null; // null=成功 | {status} 返回失败响应 | 'throw' 网络异常

const origFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (SPUG_RE.test(u)) {
    const body = {};
    if (init && init.body instanceof URLSearchParams) {
      for (const [k, v] of init.body) body[k] = v;
    }
    sent.push({ url: u, body });
    if (failMode === 'throw') throw new Error('network down (stub)');
    if (failMode) {
      // {status} → HTTP 非 200；{status:200, bodyCode, msg} → HTTP 200 受理但业务码非 200（spug 实名认证事故场景）
      const status = failMode.status || 500;
      const bodyCode = failMode.bodyCode != null ? failMode.bodyCode : status;
      return { status, json: async () => ({ code: bodyCode, msg: failMode.msg || 'stub 模拟失败' }) };
    }
    return {
      status: 200,
      json: async () => ({ code: 200, msg: '请求成功', request_id: 'stub-' + sent.length }),
    };
  }
  return origFetch(url, init);
};

/** 注入失败模式（发送失败回归测试用）：setOtpStubFail({status:500}) 或 setOtpStubFail('throw')；null 恢复成功 */
export function setOtpStubFail(mode) { failMode = mode; }

/** 最近一次发送给 target（'+86…' 或裸号均可）的验证码明文；无则 undefined */
export function lastOtpCode(target) {
  const bare = String(target || '').replace(/^\+86/, '');
  const hit = [...sent].reverse().find(s => s.body.to === bare);
  return hit ? hit.body.code : undefined;
}

/** 最近一次发送请求（{url, body}，断言请求形状用） */
export function lastOtpSend() {
  return sent[sent.length - 1];
}

/** 清空捕获（测试隔离） */
export function resetOtpStub() { sent.length = 0; }
