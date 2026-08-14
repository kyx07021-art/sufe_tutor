/**
 * app-datahub.js — 会话数据层（状态管理层下游、领域层上游）
 *
 * 加载序（见 index.html）：app-api 之后、领域层之前；共享层最后。
 *
 * 职责：
 *   - 会话内存缓存：Map<endpoint, {domain, data, fetchedAt}>。加载器经 dhGet 读取：
 *     缓存命中（保底 TTL 内）即返、miss 才发请求 → 切 tab 秒开、零重复请求；
 *   - 静默预取：登录进客户端后 dhPrefetch(role) 按角色并行预取各 tab 默认视图，
 *     allSettled 静默失败，切 tab 时缓存 miss 自动回退按需加载（预取绝不卡任何页面）；
 *   - 数据版本探测：startVersionProbe 每 VERSION_PROBE_MS 轮询 /api/data-version，
 *     域计数变化 → 只重拉该域已缓存的 key（dhRefreshDomain），静默刷新缓存不碰 DOM——
 *     「数据库有更新 → 8s 内缓存变新」，切入 tab 时自然拿到新数据；标签页隐藏暂停；
 *   - 写失效：app-state 的 invalidate() 协议路由到此（dhInvalidateDomain）；
 *     登出经 registerLogoutReset 自注册清缓存停探测。
 *
 * 依赖：api（app-api）、CONFIG（app-state 全局词法绑定，契约：CONFIG 只由 app-state 声明，此处禁止重复声明）。
 * 缓存按 endpoint（含 query）分 key——天然 per-user（浏览器内存按会话隔离）、
 * 跨用户零泄露（客户端侧缓存本就每人一份）。非 GET 一律不入口（datahub 只服务读）。
 */

// 会话缓存：endpoint -> { domain, data, fetchedAt }
const dhCache = new Map();
// 在途请求去重：endpoint -> Promise（预取与默认 tab 首次加载并发同 key 共享一个请求）
const dhInflight = new Map();
// 域 → 重挂函数[]：探测刷新替换缓存数组后，把模块别名（chatConvList/postsList/state.*）重新指向
// 新数组——否则就地变更（已读/点赞/预览）作用在游离旧数组上、缓存保留变更前的值（审计 M1 结构性修复）
const dhRebinders = new Map();
// 版本探测基线：domain -> counter（首次 tick 只建基线，之后逐域对比变化）
let dhLastVersions = {};
let dhProbeTimer = null;
// 会话代次：登出/401 自增；在途请求回落后若代次不符则丢弃（旧账户数据不得残留进缓存，审计 m1）
let dhEpoch = 0;
// 缓存键数上限：搜索变体等键只增不减，超过淘汰最旧（审计 m2）
const DH_MAX_KEYS = 40;
// 上次运行的应用版本（localStorage）：版本校验基线，见 dhCheckAppVersion
const DH_VERSION_KEY = 'sufe_app_version';

/** 同步窥探：缓存命中且未过保底 TTL 返回 data，否则 null（供 loadInto 决定跳过 loader 直出） */
function dhPeek(endpoint) {
  const e = dhCache.get(endpoint);
  if (!e) return null;
  if (Date.now() - e.fetchedAt > CONFIG.DH_TTL_MS) { dhCache.delete(endpoint); return null; }
  return e.data;
}

/** 数据就绪判定：缓存命中或请求在途 → 跳过 loader（页面打开即预取，用户首访模块时
 *  预取仍在途也不闪转圈，fetcher 走 dhGet 共享在途请求，微任务内即渲染） */
function dhReady(endpoint) {
  return dhPeek(endpoint) !== null || dhInflight.has(endpoint);
}

/** 主读取口：缓存命中即返；miss 发请求并缓存；并发同 key 共享在途请求（forceRefresh 绕过缓存） */
async function dhGet(endpoint, { domain = 'misc', forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const hit = dhPeek(endpoint);
    if (hit !== null) return hit;
  }
  if (dhInflight.has(endpoint)) return dhInflight.get(endpoint);
  const epoch = dhEpoch;
  const p = api(endpoint).then(data => {
    if (epoch !== dhEpoch) return data; // 会话已切换：不写入缓存（旧账户数据不得残留）
    dhCache.set(endpoint, { domain, data, fetchedAt: Date.now() });
    dhCapCache();
    return data;
  });
  dhInflight.set(endpoint, p);
  try { return await p; } finally { dhInflight.delete(endpoint); }
}

/**
 * B2/F3：批量读主入口——一次往返拉 N 个 key（服务端 /api/batch 并发，
 * 一次鉴权 + 公开列表边缘缓存复用）。prefetch/域刷新/多模块首载的「N 个独立 GET」合并为 1 次往返。
 *
 * 去重与 single-flight 兼容：
 *   - 已缓存键（TTL 内）跳过直出；forceRefresh 绕过缓存
 *   - 在途键（dhGet 或另一批量已发起）共享同一 Promise（await 后入结果）
 *   - 缺键经一次 apiBatch 拉取；每个 key 注册 dhInflight，期间 dhGet 对同 key 共享批量结果
 * 结果：返回 Map<path, data>（仅成功键）；失败键不入（调用方 allSettled/回退按需加载语义）。
 * 会话代次：epoch 不符不写入缓存（旧账户数据不得残留）。
 */
async function dhBatchGet(entries, { forceRefresh = false } = {}) {
  const list = entries.map(e => (typeof e === 'string' ? { path: e, domain: 'misc' } : e));
  const out = new Map();
  const epoch = dhEpoch;
  const toFetch = [];
  const seen = new Set(); // 同一 key 在 entries 中重复只拉一次（结果集可多键合并）

  for (const { path, domain } of list) {
    if (!forceRefresh) {
      const hit = dhPeek(path);
      if (hit !== null) { out.set(path, hit); continue; }
    }
    if (dhInflight.has(path)) {
      try { out.set(path, await dhInflight.get(path)); } catch { /* 在途失败：该 key 不入结果 */ }
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    toFetch.push({ path, domain });
  }

  if (toFetch.length) {
    const resolvers = new Map();
    for (const { path } of toFetch) {
      const pr = new Promise((res, rej) => resolvers.set(path, { res, rej }));
      pr.catch(() => {}); // 标记已处理：fire-and-forget（dhPrefetch 不 await）场景子键失败不产生未处理拒绝
      dhInflight.set(path, pr);
    }
    let results = new Map();
    // B-2：单域缓存键可超服务端批量上限（teachers 域按 ?userId= 分键累积、
    // 搜索 query 变体键），一次全发 → 服务端整批 400 → dhRefreshDomain ok=false 静默持续失败、
    // 列表长期陈旧（dhTouchAll 又给全缓存续期永不过期）。按 CONFIG.BATCH_GET_MAX 分块逐块拉取合并。
    const chunkSize = CONFIG.BATCH_GET_MAX || 16;
    try {
      for (let i = 0; i < toFetch.length; i += chunkSize) {
        const chunk = toFetch.slice(i, i + chunkSize);
        const part = await apiBatch(chunk.map(t => t.path));
        for (const [k, v] of part) results.set(k, v);
      }
    } catch (e) {
      // 任一块整体网络失败：清理全部未消费 inflight + 拒绝等待者（已成功块路径仍在 inflight，
      // 一并清理由调用方按需回退；失败键不写入缓存，陈旧基线保留下轮重试）
      for (const { path } of toFetch) { dhInflight.delete(path); resolvers.get(path).rej(e); }
      throw e; // 批量整体网络失败：调用方回退按需加载
    }
    for (const { path, domain } of toFetch) {
      dhInflight.delete(path);
      const r = results.get(path);
      const pr = resolvers.get(path);
      if (r && r.status === 200) {
        if (epoch === dhEpoch) { dhCache.set(path, { domain, data: r.data, fetchedAt: Date.now() }); dhCapCache(); }
        out.set(path, r.data);
        pr.res(r.data);
      } else {
        const e = new Error((r && r.data && r.data.error) || UI.ERROR_REQUEST_FAILED);
        e.code = (r && r.data && r.data.code) || 'BATCH_FAILED';
        pr.rej(e);
      }
    }
  }
  return out;
}

/** 缓存键数上限：超过 DH_MAX_KEYS 淘汰最旧（搜索变体等不随域刷新过期，须显式封顶） */
function dhCapCache() {
  if (dhCache.size <= DH_MAX_KEYS) return;
  const entries = [...dhCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  for (const [k] of entries.slice(0, dhCache.size - DH_MAX_KEYS)) dhCache.delete(k);
}

/** 失效某域全部缓存（写操作后经 invalidate() 协议路由到这里） */
function dhInvalidateDomain(domain) {
  for (const [k, v] of dhCache) if (v.domain === domain) dhCache.delete(k);
}

/** 全量清空（登出/换账号/401/发版）；会话代次推进使在途请求不再写入旧账户数据 */
function dhInvalidateAll() {
  dhCache.clear();
  dhEpoch++;
}

/** 版本更新强清缓存（「版本更新之后强行清洗缓存」，简单粗暴）。
 *  机制：localStorage 记上次运行版本；与 APP_CONSTANTS.APP_VERSION 不一致（发版/回滚）
 *  → dhInvalidateAll 整体作废（清空缓存 + 推进代次，在途旧数据丢弃）→ 覆写新版本号。
 *  调用点：① 模块加载时（boot 落版本基线）；② 每次版本探测 tick（运行中的标签页
 *  发版后 8s 内自愈——旧代码会话里缓存的旧形态数据不泄入新版本渲染）。
 *  与 dhProbeTick（数据版本域计数）分工：探测管「数据变了」，本校验管「代码变了」；
 *  两者都住在 app-datahub 单点，不散落别处。 */
function dhCheckAppVersion() {
  try {
    const cur = String((globalThis.APP_CONSTANTS || {}).APP_VERSION || '');
    if (!cur) return;
    const prev = localStorage.getItem(DH_VERSION_KEY);
    if (prev && prev !== cur) dhInvalidateAll(); // 版本切换：会话缓存整体作废（数据形态可能不兼容）
    localStorage.setItem(DH_VERSION_KEY, cur);
  } catch { /* 存储不可用：跳过版本校验 */ }
}

/**
 * 按角色预取清单：endpoint → 域（与 app-shell ROLE_PAGES 各 tab 默认视图一一对应；
 * 新增选项卡默认视图时同步此处，否则切过去仍是按需加载）
 */
const DH_PREFETCH = {
  student: [
    ['/api/student/demands?scope=mine', 'demands'],
    ['/api/teachers', 'teachers'],
    ['/api/contracts/my', 'contracts'],
    ['/api/conversations', 'chat'],
    ['/api/notifications', 'notifications'],
    // B6（用户反馈「挂机后点模块仍现场拉表单」）：设置页四表单并入预取——
    // sessions/privacy/username-status/creds 归 account 域，登录即后台预取，进设置页秒开；
    // 写操作（改用户名/绑定/隐私/撤销设备）后 invalidate('account') 失效（app-state CACHE_DOMAINS 同口径）
    ['/api/auth/sessions', 'account'],
    ['/api/privacy-settings', 'account'],
    ['/api/user/username/status', 'account'],
    ['/api/user/creds', 'account'],
  ],
  teacher: [
    ['/api/student/demands?scope=for-teacher', 'demands'],
    ['/api/demand-pushes', 'demands'],
    ['/api/teachers', 'teachers'],
    ['/api/posts?sort=new', 'posts'], // 审计 m1：loadPosts 恒带 sort=new，无 query 的预取键永不命中
    ['/api/contracts/my', 'contracts'],
    ['/api/conversations', 'chat'],
    ['/api/notifications', 'notifications'],
    // B6：设置页四表单并入预取（account 域）——见 student 注释
    ['/api/auth/sessions', 'account'],
    ['/api/privacy-settings', 'account'],
    ['/api/user/username/status', 'account'],
    ['/api/user/creds', 'account'],
  ],
  admin: [
    ['/api/admin/stats', 'admin'],
    ['/api/admin/users?role=student', 'admin'],
    ['/api/admin/users?role=teacher', 'admin'],
    ['/api/admin/reviews', 'admin'],
    ['/api/admin/contracts', 'contracts'], // 合同数据归 contracts 域：合同变动（含学生/教师侧签约）一并静默重拉
    ['/api/posts', 'posts'],               // 资料管理页同教师广场端点，归 posts 域
    ['/api/feedbacks', 'admin'],
    // B6：admin 设置页四表单并入预取（account 域）
    ['/api/auth/sessions', 'account'],
    ['/api/privacy-settings', 'account'],
    ['/api/user/username/status', 'account'],
    ['/api/user/creds', 'account'],
  ],
  // 访客（未登录预览）也预取公开数据——进入网页瞬间静默加载所有内容，
  // 与所在模块无关；版本探测同步启用保持公开列表新鲜
  'student-guest': [
    ['/api/student/demands', 'demands'], // 需求广场（公开，无 scope）
    ['/api/teachers', 'teachers'],
    ['/api/posts?sort=new', 'posts'],
  ],
  'teacher-guest': [
    ['/api/student/demands', 'demands'],
    ['/api/teachers', 'teachers'],
    ['/api/posts?sort=new', 'posts'],
  ],
};

/** 静默预取：登录进客户端后调用；B2/F3改批量——DH_PREFETCH 全键一次 /api/batch 往返
 *  （9-13 个独立 GET → 1）。失败静默（单键失败不阻断其余；整体失败回退按需加载——预取绝不卡任何页面）。
 *  返回值由 Promise.allSettled 数组改为 Map<path,data>（调用方均不消费，只作 fire-and-forget）。 */
function dhPrefetch(role) {
  const keys = DH_PREFETCH[role] || [];
  return dhBatchGet(keys.map(([endpoint, domain]) => ({ path: endpoint, domain }))).catch(() => new Map());
}

/** 模块别名重挂注册：探测刷新替换缓存数组后，把模块级变量重新指向新数组。
 *  否则就地变更（已读/点赞/预览）作用在游离旧数组上、缓存保留变更前的值（审计 M1）。
 *  由各领域模块在加载时登记自己的重挂函数。 */
function dhOnDomainRefresh(domain, fn) {
  if (typeof fn !== 'function') return;
  if (!dhRebinders.has(domain)) dhRebinders.set(domain, []);
  const list = dhRebinders.get(domain);
  if (!list.includes(fn)) list.push(fn);
}

/** 静默重拉某域全部已缓存 key（域计数变化时触发）；只刷缓存不碰 DOM——切 tab 时自然拿到新数据。
 *  B2/F4改批量：域内已缓存 key 一次 /api/batch forceRefresh（N+1 → 1 往返）。
 *  返回是否全部成功：失败域由 dhProbeTick 保留旧基线、下轮重试（审计 m5）。
 *  成功后执行该域的重挂函数（模块别名回到新缓存数组）。 */
async function dhRefreshDomain(domain) {
  const entries = [...dhCache.entries()].filter(([, v]) => v.domain === domain);
  if (!entries.length) return true;
  const paths = entries.map(([k]) => k);
  let ok = false;
  try {
    const fetched = await dhBatchGet(paths.map(p => ({ path: p, domain })), { forceRefresh: true });
    ok = paths.every(p => fetched.has(p));
  } catch { ok = false; }
  const fns = dhRebinders.get(domain);
  if (fns) for (const fn of fns) { try { fn(); } catch { /* 重挂失败不影响主流程 */ } }
  return ok;
}

let dhProbeBusy = false; // 防重入（审计 m6）：interval 与 visibilitychange 并发 tick 互斥
// B6（用户反馈「后台静默加载无效：挂机十分钟后点模块仍现场拉表单」）：版本探测成功后给全缓存续期——
// 探测正常 = 数据版本一致（本地缓存仍新鲜），保底 TTL 不再因挂机过期，进任何模块都秒开；
// 探测停摆/失败时保留 DH_TTL_MS(60s) 兜底防陈旧。数据域变化仍由 dhRefreshDomain 重拉不冲突。
function dhTouchAll() {
  const now = Date.now();
  for (const e of dhCache.values()) e.fetchedAt = now;
}
async function dhProbeTick() {
  if (dhProbeBusy) return;
  if (typeof document !== 'undefined' && document.hidden) return; // 标签页隐藏：不探测不重拉
  dhProbeBusy = true;
  try {
    dhCheckAppVersion(); // 发版探测：版本变了 → 整体作废缓存（运行中标签页 8s 内自愈）
    let versions;
    try { versions = (await api('/api/data-version')).versions || {}; }
    catch { return; } // 探测失败静默，保留上次基线（不误触发全量重拉）
    dhTouchAll(); // B6：探测成功 = 版本一致，全缓存续期（挂机期间数据未变则缓存长期有效）
    const next = {};
    for (const [domain, counter] of Object.entries(versions)) {
      next[domain] = counter;
      const prev = dhLastVersions[domain];
      if (prev === undefined) continue; // 首次见：只建基线
      if (counter === prev) continue;
      const ok = await dhRefreshDomain(domain);
      if (!ok) next[domain] = prev; // 刷新失败：保留旧基线，下轮重试
    }
    dhLastVersions = next;
  } finally {
    dhProbeBusy = false;
  }
}

/** 启动版本探测：立即 tick 建基线，随后按 CONFIG.VERSION_PROBE_MS 轮询；登录进客户端后调用 */
function startVersionProbe() {
  if (dhProbeTimer) return;
  dhProbeTick().catch(() => {});
  dhProbeTimer = setInterval(() => dhProbeTick().catch(() => {}), CONFIG.VERSION_PROBE_MS);
}

function stopVersionProbe() {
  if (dhProbeTimer) { clearInterval(dhProbeTimer); dhProbeTimer = null; }
}

// 标签页回到前台：立即探测一次（不等下一轮 setInterval，恢复即时性）
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && dhProbeTimer) dhProbeTick().catch(() => {});
  });
}

// 登出复位（app-state registerLogoutReset 协议）：停探测 + 清会话缓存，防上一账户残留
if (typeof registerLogoutReset === 'function') {
  registerLogoutReset(() => { stopVersionProbe(); dhInvalidateAll(); });
}

// boot：立即落版本基线（新开页面缓存本为空，作废是 no-op，纯记版本）
dhCheckAppVersion();
