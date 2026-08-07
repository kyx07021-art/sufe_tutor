/**
 * API 层（目标分层：状态管理层下游）—— 全站唯一 fetch 封装
 *
 * 职责：
 *   - 自动带 X-Auth-Token（state.authToken，管理员接口凭此鉴权）
 *   - body 对象自动 JSON 序列化
 *   - 401 兜底：带令牌仍被拒 = 会话已死（过期/多端顶号），清本地会话 + 汇入登录通路
 *     （否则 state.user 还在、ensureAuth 放行，页面只剩「加载失败」假装还登录着）
 *   - 错误统一抛 { message, code }（code = 后端 error() 稳定错误码，前端按 code 分支，不脆耦合中文文案）
 *
 * 依赖：state（app-state 全局词法绑定）、UI（constants）、ensureAuth（app-auth，运行时解析）。
 */
async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.authToken) headers['X-Auth-Token'] = state.authToken;
  const config = { ...options, headers };
  if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);
  const res = await fetch(endpoint, config);
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) {
      if (state.authToken) {
        state.authToken = null; state.user = null;
        clearSession();
      }
      if (state.view === 'client' && typeof ensureAuth === 'function') ensureAuth(); // user 已清空 → 这次真的会进登录页
    }
    const e = new Error(data.error || UI.ERROR_REQUEST_FAILED);
    e.code = data.code;
    throw e;
  }
  return data;
}
