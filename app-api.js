/**
 * API 层（目标分层：状态管理层下游）—— 全站唯一 fetch 封装
 *
 * 职责：
 *   - 自动带 X-Auth-Token（state.authToken，管理员接口凭此鉴权）
 *   - body 对象自动 JSON 序列化
 *   - 401 兜底：带令牌仍被拒 = 会话已死（过期/多端顶号），清本地会话 + 汇入登录通路。
 *     幂等（v0.26.13 D3）：同一死令牌的并发在途 401 只处理一次——首个清会话+汇登录后，后续
 *     同令牌 401 整体跳过，杜绝 clearSession/runLogoutResets/showView('login') 重复执行风暴
 *     （生产实证：会话失效后徽标轮询+预取并发 21 个 GET 401 同刻落地，全走兜底会重渲染登录页 21 次）。
 *   - 网络错误统一识别：fetch 抛错（断线/被拒/超时/DNS）与非 JSON 响应（网关 502/代理错误页）
 *     一律归为 UI.NETWORK_ERROR（code='NETWORK_ERROR'）——前端据此弹明确中文提示，
 *     杜绝「Failed to fetch」英文裸错误。调用方 catch 里不用再判断英文消息。
 *   - fetch 挂死保护（v0.22.7）：无超时 fetch 在停滞 SW/异常网络下永不 settle——登录按钮
 *     「永远加载中」即此形态。超时归入网络错误，调用方 finally 正常收口，不再无限转圈。
 *   - v0.22.9 修正盲区：超时覆盖「fetch + 响应体读取」全程（竞速计时器，而非仅 AbortController——
 *     实证 abort 信号在 fetch 解析后不会传播到 res.json()，body 流停滞会永久挂起）。服务端
 *     若已回响应头但 body 停滞（如 logRequest 写库卡住），现仍会被超时掐断并归网络错误。
 *   - F1（v0.27.0 网络层重构）：幂等 GET 网络抖动自动重试——fetch 瞬断/DNS/被拒等快速网络错
 *     短退避重试 1 次自愈（根治「连接不稳定」弹错误 toast）；超时（20s 停滞）不重试（已等太久
 *     重试更糟）；业务 4xx/5xx/401 不重试（不可重放）。
 *   - F2（v0.27.0）：批量只读传输 apiBatch——一次往返拉 N 个 GET（服务端 /api/batch 并发），
 *     prefetch/域刷新/多模块首载的往返合并；子结果 401 复用同一幂等兜底。
 *   - 业务错误统一抛 { message, code }（code = 后端 error() 稳定错误码）
 *
 * 依赖：state（app-state）、UI（constants）、clearSession（app-state）、ensureAuth（app-auth，运行时解析）。
 */
// D3（v0.26.13）401 兜底幂等键：已处理过 401 的令牌。同一死令牌的并发在途 401 只清一次会话、
// 只跳一次登录；令牌换新后（重新登录）新令牌的 401 重新走兜底——每个令牌至多处理一次，无需手动复位。
let lastHandled401Token = null;

// F8（v0.27.0 网络层重构）：boot 令牌验证期标志——switchToRole 并行 /me 验证阶段，401 的
// ensureAuth（弹登录）由 /me catch 统一接管走 guest 预览回落，避免预取批量 401 抢先弹登录页
// 与 guest 回落竞态。经典脚本共享全局词法环境，app-auth 直接置位/复位。验证期外（运行中会话
// 失效）仍 ensureAuth 汇登录（语义不变）。无令牌/登出空态 401 不受影响。
let sessionBootValidating = false;

// A1/D3 兜底（v0.27.0 从 api() 抽出供 apiBatch 子结果复用）：死令牌会话清理 + 汇登录，幂等键防风暴。
// 只处理「发起令牌 === 当前令牌」的 401——登出→登录另一角色的过渡窗口里旧在途 401 不清新会话。
function handleDeadToken(sentToken) {
  const alreadyHandledDeadToken = sentToken && sentToken === lastHandled401Token;
  if (alreadyHandledDeadToken) return;
  if (sentToken) lastHandled401Token = sentToken; // 无令牌请求（已登出空态 401）不占幂等键：每次仍尝试汇登录
  if (sentToken && state.authToken === sentToken) {
    const role = state.user ? state.user.role : ''; // v0.23.1：只清该角色会话，另一角色保留
    state.authToken = null; state.user = null;
    clearSession(role);
    // v0.23.0/v0.23.1 静默数据层：401 会话失效统一走 runLogoutResets——与登出同口径，
    // 清会话缓存 + 停版本探测（datahub 自注册）+ 各领域模块级数组残留（_notifList/
    // chatConvList/state.myDemands 等），防旧账户数据残留到新账户登录后被读到
    if (typeof runLogoutResets === 'function') runLogoutResets();
  }
  if (state.view === 'client' && typeof ensureAuth === 'function' && !sessionBootValidating) ensureAuth(); // user 已清空 → 这次真的会进登录页（boot 验证期由 /me catch 回落 guest 预览）
}

async function api(endpoint, options = {}) {
  const sentToken = state.authToken; // A1 审计（v0.25.104）：请求发起时刻的令牌——401 兜底只对「当前令牌」的请求生效
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.authToken) headers['X-Auth-Token'] = state.authToken;
  const config = { ...options, headers };
  if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);

  // F1（v0.27.0）：幂等 GET 重试循环。重试仅限快速网络错误（NETWORK_ERROR 且非超时）；
  // 超时/业务错误 break。重试共享同一 sentToken（401 幂等语义不变）。
  const retries = !config.method || config.method === 'GET' ? CONFIG.GET_RETRY : 0;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, CONFIG.GET_RETRY_BACKOFF_MS));
    try {
      return await doRequest(endpoint, config, sentToken);
    } catch (err) {
      lastErr = err;
      // 仅「快速网络错」（code=NETWORK_ERROR 且非超时）重试；超时/业务错误/401（code 可缺省）一律不重试
      if (!(err && err.code === 'NETWORK_ERROR') || (err && err.isTimeout)) break;
      if (retries === 0) break;                               // 非 GET：写路径不重试（防双写）
      // NETWORK_ERROR（快速网络错）：下一轮重试自愈
    }
  }
  throw lastErr;
}

// 单请求执行（含超时竞速 + 错误分类 + 401 兜底）。挂死保护：AbortController 掐断 fetch；
// 竞速计时器兜底 body 读取停滞（v0.22.9 覆盖全程）。超时统一归网络错误，请求不再无限转圈。
async function doRequest(endpoint, config, sentToken) {
  const controller = new AbortController();
  config.signal = controller.signal;
  const timeoutErr = new Error(UI.NETWORK_ERROR);
  timeoutErr.code = 'NETWORK_ERROR';
  timeoutErr.isTimeout = true; // F1：区分超时与快速网络错（超时不重试）
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
    if (res.status === 401) handleDeadToken(sentToken);
    const e = new Error(data.error || UI.ERROR_REQUEST_FAILED);
    e.code = data.code; // 后端 error() 带稳定 code，前端按 code 分支（不脆耦合中文 MSG）
    throw e;
  }
  return data;
}

// F2（v0.27.0 网络层重构）：批量只读传输——一次往返拉 N 个 GET（服务端 /api/batch 并发执行，
// 一次鉴权 + 公开列表边缘缓存复用）。返回 Map<path, {status, data}>。
// 失败语义：外层网络错误归 NETWORK_ERROR（与 api 同口径，调用方 catch 同 toast）；
// 子结果 401 触发 handleDeadToken 幂等兜底（同死令牌只清一次会话）；其余非 200 子结果
// 由调用方按 path 自行处理（prefetch 本就 allSettled 静默语义）。
async function apiBatch(gets) {
  if (!gets || !gets.length) return new Map();
  const sentToken = state.authToken;
  const data = await api('/api/batch', { method: 'POST', body: { gets } });
  const map = new Map();
  for (const r of (data.results || [])) {
    map.set(r.path, { status: r.status, data: r.data });
    if (r.status === 401) handleDeadToken(sentToken); // 子 401：复用幂等兜底（首个触发，后续跳过）
  }
  return map;
}
