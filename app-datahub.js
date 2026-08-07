/**
 * app-datahub.js — 会话数据层（v0.23.0 静默数据层；目标分层：状态管理层下游、领域层上游）
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

/** 同步窥探：缓存命中且未过保底 TTL 返回 data，否则 null（供 loadInto 决定跳过 loader 直出） */
function dhPeek(endpoint) {
  const e = dhCache.get(endpoint);
  if (!e) return null;
  if (Date.now() - e.fetchedAt > CONFIG.DH_TTL_MS) { dhCache.delete(endpoint); return null; }
  return e.data;
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

/** 全量清空（登出/换账号/401）；会话代次推进使在途请求不再写入旧账户数据 */
function dhInvalidateAll() {
  dhCache.clear();
  dhEpoch++;
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
  ],
  teacher: [
    ['/api/student/demands?scope=for-teacher', 'demands'],
    ['/api/demand-pushes', 'demands'],
    ['/api/teachers', 'teachers'],
    ['/api/posts?sort=new', 'posts'], // v0.23.1 审计 m1：loadPosts 恒带 sort=new，无 query 的预取键永不命中
    ['/api/contracts/my', 'contracts'],
    ['/api/conversations', 'chat'],
    ['/api/notifications', 'notifications'],
  ],
  admin: [
    ['/api/admin/stats', 'admin'],
    ['/api/admin/users?role=student', 'admin'],
    ['/api/admin/users?role=teacher', 'admin'],
    ['/api/admin/reviews', 'admin'],
    ['/api/admin/contracts', 'contracts'], // 合同数据归 contracts 域：合同变动（含学生/教师侧签约）一并静默重拉
    ['/api/posts', 'posts'],               // 资料管理页同教师广场端点，归 posts 域
    ['/api/feedbacks', 'admin'],
  ],
};

/** 静默预取：登录进客户端后调用；allSettled——任何单键失败静默，绝不阻断其余/任何页面 */
function dhPrefetch(role) {
  const keys = DH_PREFETCH[role] || [];
  return Promise.allSettled(keys.map(([endpoint, domain]) => dhGet(endpoint, { domain })));
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
 *  返回是否全部成功：失败域由 dhProbeTick 保留旧基线、下轮重试（审计 m5）。
 *  成功后执行该域的重挂函数（模块别名回到新缓存数组）。 */
async function dhRefreshDomain(domain) {
  const entries = [...dhCache.entries()].filter(([, v]) => v.domain === domain);
  if (!entries.length) return true;
  const results = await Promise.allSettled(entries.map(([k, v]) => dhGet(k, { domain, forceRefresh: true })));
  const fns = dhRebinders.get(domain);
  if (fns) for (const fn of fns) { try { fn(); } catch { /* 重挂失败不影响主流程 */ } }
  return results.every(r => r.status === 'fulfilled');
}

let dhProbeBusy = false; // 防重入（审计 m6）：interval 与 visibilitychange 并发 tick 互斥
async function dhProbeTick() {
  if (dhProbeBusy) return;
  if (typeof document !== 'undefined' && document.hidden) return; // 标签页隐藏：不探测不重拉
  dhProbeBusy = true;
  try {
    let versions;
    try { versions = (await api('/api/data-version')).versions || {}; }
    catch { return; } // 探测失败静默，保留上次基线（不误触发全量重拉）
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
