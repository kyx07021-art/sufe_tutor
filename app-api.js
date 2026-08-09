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
 *     「永远加载中」即此形态。超时归入网络错误，调用方 finally 正常收口，不再无限转圈。
 *   - v0.22.9 修正盲区：超时覆盖「fetch + 响应体读取」全程（竞速计时器，而非仅 AbortController——
 *     实证 abort 信号在 fetch 解析后不会传播到 res.json()，body 流停滞会永久挂起）。服务端
 *     若已回响应头但 body 停滞（如 logRequest 写库卡住），现仍会被超时掐断并归网络错误。
 *   - 业务错误统一抛 { message, code }（code = 后端 error() 稳定错误码）
 *
 * 依赖：state（app-state）、UI（constants）、clearSession（app-state）、ensureAuth（app-auth，运行时解析）。
 */
async function api(endpoint, options = {}) {
  const sentToken = state.authToken; // A1 审计（v0.25.104）：请求发起时刻的令牌——401 兜底只对「当前令牌」的请求生效
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.authToken) headers['X-Auth-Token'] = state.authToken;
  const config = { ...options, headers };
  if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);

  // 挂死保护：AbortController 掐断 fetch；竞速计时器兜底 body 读取停滞（v0.22.9 覆盖全程）。
  // 超时统一归网络错误，请求不再无限转圈。
  const controller = new AbortController();
  config.signal = controller.signal;
  const timeoutErr = new Error(UI.NETWORK_ERROR);
  timeoutErr.code = 'NETWORK_ERROR';
  let timer = null;

  let res, data = {};
  try {
    data = await Promise.race([
      (async () => {
        res = await fetch(endpoint, config);
        return await res.json();
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(timeoutErr); }, CONFIG.API_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    clearTimeout(timer);
    if (err === timeoutErr) throw timeoutErr; // 整段请求超时（fetch 或 body 停滞）
    // fetch/body 读取失败：断线/被拒/超时/DNS/网关非 JSON → 统一明确文案（网络错误捕获环节 1/4 + 2/4）
    const e = new Error(UI.NETWORK_ERROR);
    e.code = 'NETWORK_ERROR';
    throw e;
  }
  clearTimeout(timer); // 请求全程已 settle（fetch + body 读取），超时保护使命完成

  if (!res.ok) {
    // 401 兜底：带令牌仍被拒 = 会话已死（过期/多端顶号），必须清本地登录态并汇入登录通路，
    // 否则内存里 state.user 还在、ensureAuth 放行，页面只剩一句「加载失败」假装还登录着
    if (res.status === 401) {
      // A1 审计（v0.25.104，B2 跨角色误删根因）：兜底必须校验该 401 属于「当前令牌」——登出→登录
      // 另一角色的过渡窗口里，旧角色在途请求（徽标轮询 30s/慢接口）落回 401 时 state.authToken 已是
      // 新令牌，原逻辑按响应时刻 state.user.role 清键会把新角色会话误删并踢出新登录。
      // 发起令牌≠当前令牌 → 旧请求的 401 只作废自己（数据随新令牌走），不清任何会话。
      if (sentToken && state.authToken === sentToken) {
        const role = state.user ? state.user.role : ''; // v0.23.1：只清该角色会话，另一角色保留
        state.authToken = null; state.user = null;
        clearSession(role);
        // v0.23.0/v0.23.1 静默数据层：401 会话失效统一走 runLogoutResets——与登出同口径，
        // 清会话缓存 + 停版本探测（datahub 自注册）+ 各领域模块级数组残留（_notifList/
        // chatConvList/state.myDemands 等），防旧账户数据残留到新账户登录后被读到
        if (typeof runLogoutResets === 'function') runLogoutResets();
      }
      if (state.view === 'client' && typeof ensureAuth === 'function') ensureAuth(); // user 已清空 → 这次真的会进登录页
    }
    const e = new Error(data.error || UI.ERROR_REQUEST_FAILED);
    e.code = data.code; // 后端 error() 带稳定 code，前端按 code 分支（不脆耦合中文 MSG）
    throw e;
  }
  return data;
}
