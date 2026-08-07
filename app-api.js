/**
 * API 层（目标分层：状态管理层下游）—— 全站唯一 fetch 封装
 *
 * 职责：
 *   - 自动带 X-Auth-Token（state.authToken，管理员接口凭此鉴权）
 *   - body 对象自动 JSON 序列化
 *   - 401 兜底：带令牌仍被拒 = 会话已死（过期/多端顶号），清本地会话 + 汇入登录通路
 *   - 网络错误统一识别：fetch 抛错（断线/被拒/超时/DNS）与非 JSON 响应（网关 502/代理错误页）
 *     一律归为 UI.NETWORK_ERROR（code='NETWORK_ERROR'）——前端据此弹明确中文提示，
 *     杜绝「Failed to fetch」英文裸错误。调用方 catch 里不用再判断英文消息。
 *   - fetch 挂死保护（v0.22.7）：无超时 fetch 在停滞 SW/异常网络下永不 settle——登录按钮
 *     「永远加载中」即此形态。AbortController 按 CONFIG.API_TIMEOUT_MS 超时中止，归入网络错误，
 *     调用方 finally 正常收口，不再无限转圈。
 *   - 业务错误统一抛 { message, code }（code = 后端 error() 稳定错误码）
 *
 * 依赖：state（app-state）、UI（constants）、clearSession（app-state）、ensureAuth（app-auth，运行时解析）。
 */
async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.authToken) headers['X-Auth-Token'] = state.authToken;
  const config = { ...options, headers };
  if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);
  config.signal = controller.signal;

  let res;
  try {
    res = await fetch(endpoint, config);
  } catch {
    // 网络层失败：fetch 对断线/被拒/超时/DNS 抛 TypeError 等 → 统一明确文案（网络错误捕获环节 1/4）
    clearTimeout(timer);
    const e = new Error(UI.NETWORK_ERROR);
    e.code = 'NETWORK_ERROR';
    throw e;
  }
  clearTimeout(timer); // fetch 已 settle，超时保护使命完成

  let data = {};
  try {
    data = await res.json();
  } catch {
    // 非 JSON 响应：网关 502/代理错误页等 → 按服务端不可达处理（网络错误捕获环节 2/4）
    const e = new Error(UI.NETWORK_ERROR);
    e.code = 'NETWORK_ERROR';
    throw e;
  }

  if (!res.ok) {
    // 401 兜底：带令牌仍被拒 = 会话已死（过期/多端顶号），必须清本地登录态并汇入登录通路，
    // 否则内存里 state.user 还在、ensureAuth 放行，页面只剩一句「加载失败」假装还登录着
    if (res.status === 401) {
      if (state.authToken) {
        state.authToken = null; state.user = null;
        clearSession();
      }
      if (state.view === 'client' && typeof ensureAuth === 'function') ensureAuth(); // user 已清空 → 这次真的会进登录页
    }
    const e = new Error(data.error || UI.ERROR_REQUEST_FAILED);
    e.code = data.code; // 后端 error() 带稳定 code，前端按 code 分支（不脆耦合中文 MSG）
    throw e;
  }
  return data;
}
