/**
 * 经途·伴学信息门户 - Cloudflare Pages Worker 入口（编排层）
 * 本文件只做编排：CORS 预检 → 静态回退 → 初始化 → 体积闸门 → 限流 → 路由分发 → 留档包装。
 * 限流（security.rateGate）、CORS/安全头（security.*）、请求体解析（util.parseBody）、
 * 身份守卫（security.requireUser/requireAdmin）均为咽喉层实现，本文件不承载业务策略。
 *
 * 绑定: env.DB = D1 业务库；env.LOG_DB = 可选独立留档库；env.LEDGER_DB = 可选独立合同台账库
 * 安全: server/ 与 docs/ 目录随静态资源上传但在此统一 404，防源码公开访问
 * 留档: routeApi 的应答经 logRequest 留档——仅写操作与失败请求（读/轮询流量不入留档，见 log.js）
 */
import { initDb } from './src/server/core/db.js';
import { json, error, errorMsg, parseBody } from './src/server/core/util.js';
import { MSG } from './src/shared/codes.js';
import { CONFIG } from './src/shared/config.js';
import { productionReady, notReadyResponse } from './src/server/core/startup.js';
import { recordRequestMetric, flushMetrics } from './src/server/core/telemetry.js';
import { rateGate, corsPreflight, applySecurityHeaders } from './src/server/core/security.js';
import { initLogDb, bindLogDb, logRequest, logDropStats } from './src/server/core/log.js'; // 收口：health 暴露留档失败计数（logDropStats 死导出消除）
import { bindTextAuditEnv } from './src/server/core/text-audit.js';
import { initLedgerTable, bindLedgerDb } from './src/server/domains/contract/schema.js'; // server/contract.js 死 shim 已删，直引真源
import { auditBeforeWrite } from './src/server/core/audit-flow.js'; // v0.26.0 E：高频轻量日常审核断点

// ============ 内容哈希资产直通 ============
// 构建管线（scripts/build.mjs）产出 dist/assets/* 内容哈希名；HTML 已携带绝对 /assets/* 引用，
// worker 零改写直通；/assets/* immutable 由 _headers 静态层承担。

// API 分发：声明式路由表（架构 v2）。批量只读/健康检查/保活为编排层特殊路由。
import { createRouter } from './src/server/router.js';
import { routes as apiRoutes } from './src/server/app.js';

let dispatchApi = null;
export async function routeApi(db, p, method, body, url, req, env) { // 导出供测试穿透路由接线
  if (!dispatchApi) {
    dispatchApi = createRouter([
      ...apiRoutes,
      {
        method: 'POST', path: '/api/batch',
        handler: async c => handleBatch(c.db, c.body, c.url, c.req, c.env),
      },
      {
        method: 'GET', path: '/api/health',
        handler: c => {
          const gate = productionReady(c.env);
          return json({ status: gate.ok ? 'ok' : 'not-ready', ready: gate.ok, checks: gate.checks, timestamp: new Date().toISOString(), logDrop: logDropStats() }, gate.ok ? 200 : 503); // 收口：留档失败量级可观测（isolate 内累计）
        },
      },
      {
        method: 'GET', path: '/api/keepalive',
        handler: async c => { await keepD1Warm(c.env); return json({ status: 'ok' }); },
      },
    ]);
  }
  return dispatchApi({ db, p, method, body, url, req, env });
}

// LOW-1：health/keepalive 是探活端点（独立保活 Worker cron + 发版脚本 readiness 检查），
// 豁免 rateGate——探活永不 429，也不消耗探活 IP 的用户流量 global 桶（300/min 共享桶被探活挤占
// 会确定性误伤该 IP 的真实用户请求；探活端点本身零用户数据面，无滥用面）。
const PROBE_PATHS = new Set(['/api/health', '/api/keepalive']);

// 公开列表边缘缓存（用户实测：游客 7s 出列表 / 教师列表 20s / 进模块拉表单 8s——D1 冷实例
// 偶发 ~6s 慢往返按 worker 实例隔离，keepalive 只热它所在实例，用户请求路由到其他实例仍冷）。
// 公开列表（帖子）命中边缘缓存零碰 D1，跨用户共享、冷实例也秒开。
// 一致性：TTL 30s 自愈（公开列表低频变更，发布/审核后 30s 内可见）。
// 【外部审查 1101 修】仅匿名请求参与缓存（无 X-Auth-Token）——登录用户请求的响应含 per-user
// 字段（posts.liked/favorited），共享缓存跨用户下发即泄露；
// 访客请求无 per-user 数据，是冷启动缓存的目标受众。登录用户走实时 routeApi 保私有正确。
// 无 caches 环境（本地 dev / vm 测试）回落直取（可用性 fallback，不改变鉴权与数据）。
// evaluation: /api/posts (posts/api.js authUser optional) still returns 200 to anonymous
// requests, so the cache write gate (status===200) can fire -> cache is alive, retained.
// /api/teachers is now login-gated (requireUser, consistent with the demand
// plaza ); anonymous 401 means the cache write gate never fires, so its predicate branch
// was removed as dead logic. /api/demands (demand/api.js requireUser) is likewise login-gated;
// anonymous 401 means the cache write gate never fires -> dead branch, removed from the
// predicate (interface login-visible; if the frontend later stops anonymous access to
// posts, remove the whole block).
const PUBLIC_LIST_TTL_S = 30;
export function isAnonymous(request) {
  return !request.headers.get('X-Auth-Token');
}
export function isPublicListCacheable(p, url) {
  if (p === '/api/posts') return true;                    // 资料广场（公开，authUser optional）
  return false;
}

// （v0.27.0 网络层重构）：公开列表边缘缓存读 helper——主请求路径与 /api/batch 子请求共用。
// 命中返回解析后的 JSON data（object），miss/读异常返回 null（可用性 fallback，回落正常 handler，绝不 500）。
// 生产实证铁律（v0.26.9）：workerd Cache API 的 match 响应 body 流有锁定/不可重复读风险，
// 一律 text() 读一次重建 json，勿 clone/重复读原流。
async function readPublicListCache(url) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (!cache) return null;
  try {
    const cached = await cache.match(new Request(url));
    if (cached && cached.status === 200 && (cached.headers.get('content-type') || '').includes('application/json')) {
      const text = await cached.text();
      if (text) return JSON.parse(text);
    }
  } catch { /* 缓存读失败：回落正常 handler（不 500） */ }
  return null;
}

// 补（v0.27.0 审计）：公开列表边缘缓存写 helper——/api/batch 子请求 miss 后写回。
// 直接 await put（生产实证 waitUntil 异步写 → 紧随请求 miss）：text 极小毫秒级完成，
// 响应返回时缓存已就绪，下一个请求必命中。写失败静默（缓存是加速层，不影响主响应）。
async function writePublicListCache(url, jsonText) {
  const apiCache = typeof caches !== 'undefined' ? caches.default : null;
  if (!apiCache) return;
  try {
    const headers = new Headers();
    headers.set('content-type', 'application/json; charset=UTF-8');
    headers.set('Cache-Control', `public, s-maxage=${PUBLIC_LIST_TTL_S}`);
    await apiCache.put(new Request(url), new Response(jsonText, { status: 200, headers }));
  } catch { /* 缓存写失败静默：不影响主响应 */ }
}

// （v0.27.0 网络层重构）：批量只读端点——一次鉴权 + N 个子 GET 并发。
// 设计（调研：API batching / BFF 聚合）：客户端 prefetch/域刷新/多模块首载把 N 个独立 GET
// 合并为 1 次往返——HTTP/1.1 下免浏览器 6 连接队列串行，HTTP/2 下减 worker 调用与 D1 往返；
// 子请求仍走 routeApi（复用公开列表边缘缓存 + 各 handler 校验）；authUser 经 reqCtx 记忆化
// 共享 1 次 D1 鉴权；单子请求失败不阻断其余（结果带独立 status）。
// 写操作禁止入 batch——写路径仍走单请求，保证错误码/toast/二次认证/留档语义。
// 安全：子请求与直接 GET 权限面完全一致（不升级权限），batch 只省往返不改变路由语义。
// 批量读上限单源：src/shared/config.js CONFIG.BATCH_GET_MAX（前端 dhBatchGet 按同值分块，杜绝整批超限 400）。
// 读不到（异常环境）→ 0 = 整批拒绝（fail-closed，绝不放宽超限）；CONFIG 已由本文件
// 顶部直接 import 共享常量，恒在——勿再加「|| 16」复制兜底（改值双源漂移）。
const BATCH_MAX = CONFIG.BATCH_GET_MAX;
async function handleBatch(db, body, url, req, env) {
  const gets = body && Array.isArray(body.gets) ? body.gets : null;
  if (!gets || !gets.length || gets.length > BATCH_MAX) return errorMsg('INVALID_PARAMS', 400);
  const paths = gets.map(g => String(g));
  if (!paths.every(p => p.startsWith('/api/') && !/\s/.test(p) && p.length < 300)) {
    return errorMsg('INVALID_PARAMS', 400); // 只允许 /api/ 相对路径（防外域/协议相对/注入）
  }
  // auth/check 是存在性探测端点，自带限流桶（RATE_LIMITS.check）；batch 子请求不经 rateGate，
  // 放行会以批量 GET 放大 ~32 倍探测速率绕过限流——禁止该路径入 batch，保持直接 GET 为唯一入口。
  // 加固：判定与 handleBatch 子请求路由同解析器（new URL().pathname，router 精确匹配），消除
  // split 字符串比较 vs 路由 URL 解析的类不一致（安全审查）；显式尾部斜杠 + 点段归一化变体同拦
  const blockedAuthCheck = p => {
    let pathname = p.split(/[?#]/)[0];
    try { pathname = new URL(pathname, url.origin).pathname; } catch { /* 非法串保持原样比较 */ }
    return pathname === '/api/auth/check' || pathname === '/api/auth/check/';
  };
  if (paths.some(blockedAuthCheck)) return errorMsg('INVALID_PARAMS', 400);
  const results = await Promise.all(paths.map(async sub => {
    try {
      const subUrl = new URL(sub, url.origin);
      // 匿名公开列表子请求命中边缘缓存 → 零 D1 直返（与主请求路径同款）
      if (isAnonymous(req) && isPublicListCacheable(subUrl.pathname, subUrl)) {
        const hit = await readPublicListCache(subUrl);
        if (hit) return { path: sub, status: 200, data: hit };
      }
      const res = await routeApi(db, subUrl.pathname, 'GET', {}, subUrl, req, env);
      const data = await res.json();
      // 审计补：匿名公开列表 miss 子请求写回边缘缓存——否则访客预取全走批量时
      // 边缘缓存永不被预热（冷启动收益被绕过），后续直连 GET 才温。await put 保响应返回即就绪。
      if (res.status === 200 && isAnonymous(req) && isPublicListCacheable(subUrl.pathname, subUrl)) {
        await writePublicListCache(subUrl, JSON.stringify(data));
      }
      return { path: sub, status: res.status, data };
    } catch {
      return { path: sub, status: 500, data: { error: MSG.SERVER_ERROR } };
    }
  }));
  return json({ results });
}

// D1 保活（v0.22.8 + v0.25.16 重构单点）：对业务/留档/台账三库轻查询 SELECT 1。
// v0.26.13 评估（D2，见 docs/backlog.md）：initDb schema 版本判断（v0.26.12）已把冷 isolate 首击
// 从 25s 降到 <1.7s，keepalive 原「首击唤醒」职责不再必要；保留为防极端空闲的保底保险
// （全部 isolate 回收 + D1 连接冷时首次查询仍多几百 ms）。调用方：① scheduled 事件——Pages 无
// 原生 cron 触发器，wrangler.toml [triggers] 对 Pages 不生效（2026 实测 API/CLI 均无法注册，见
// 会话），由独立保活 Worker（keepalive-worker/，wrangler cron 触发）打 /api/keepalive 代为唤醒；
// ② /api/keepalive 路由。保活失败静默，不影响主流程。
function keepD1Warm(env) {
  try {
    const ping = db => (db ? db.prepare('SELECT 1').run().catch(() => {}) : Promise.resolve());
    return Promise.all([ping(env.DB), ping(env.LOG_DB), ping(env.LEDGER_DB)]).catch(() => {});
  } catch { return Promise.resolve(); } // 绑定缺失/同步抛错全兜底：保活失败静默，绝不影响主流程
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let p = url.pathname;
    try { p = decodeURIComponent(p); } catch { /* 非法编码保持原样 */ } // 防 %73erver 式编码绕过路径前缀检查

    // v1.5.0 生产 Release Gate：生产运行时缺任一必需 Secret/仍处 mock 配置 → API 全部 503。
    // 静态资源照常服务（发版脚本 curl /api/health 判 ready）。本地 dev/测试无 CF_PAGES_* 信号，不受影响。
    if (p.startsWith('/api/')) {
      const gate = productionReady(env);
      if (!gate.ok) { recordRequestMetric({ path: p, status: 503 }); return applySecurityHeaders(notReadyResponse(gate), p); }
    }

    // CORS preflight（网安咽喉单点）：仅对 /api/ 路径应答——非 API 敏感路径的 OPTIONS 一律 404（网安审计：曾绕过敏感路径黑名单）
    if (request.method === 'OPTIONS') {
      if (!p.startsWith('/api/')) return new Response('Not Found', { status: 404 });
      return applySecurityHeaders(corsPreflight(), p);
    }

    // 非 API 请求 → 静态文件。敏感路径一律 404：源码目录 server/（含敏感配置 server/secrets.js）、docs/、
    // 版本控制与构建残留（.git/、.wrangler/）、包清单（package*.json / node_modules/）、
    // 配置残留（wrangler.toml / robots.txt / sitemap.xml，网安报告 F-01d 收口）
    if (!p.startsWith('/api/')) {
      // 路径遍历纵深防御（2026-08-09 审计 F-2）：点段一律 404——线上 CDN 边缘已拒（实测 400），
      // worker 侧再加一道，防未来边缘规范化行为变化后 server/ 源码泄露（p 此处已 decodeURIComponent）
      if (p.includes('..')) return applySecurityHeaders(new Response('Not Found', { status: 404 }), p);
      if (p.startsWith('/server/') || p.startsWith('/server') || p.startsWith('/docs/') || p.startsWith('/docs') ||
          p === '/secrets.js' ||
          p.startsWith('/.git/') || p.startsWith('/.wrangler/') || p.startsWith('/node_modules/') ||
          p === '/package.json' || p === '/package-lock.json' || p.endsWith('.md') ||
          p === '/wrangler.toml' || p === '/robots.txt' || p === '/sitemap.xml' ||
          p.startsWith('/.claude/') || p.startsWith('/.github/') || p === '/.claude' || p === '/.github') { // 本地配置/CI 目录不入静态面（网安审计）
        return applySecurityHeaders(new Response('Not Found', { status: 404 }), p);
      }
      const res = await env.ASSETS.fetch(request);
      // HTML documents (incl. SPA fallback): the HTML already carries content-hashed asset references
      // (from the build), so the worker passes it through verbatim with zero rewriting. ETag/304 is
      // handled natively by ASSETS (no rewriting -> no ETag drift; the worker no longer self-holds).
      // 304 响应无 content-type：按路径推断（/、/index.html、SPA 无扩展名路由均为 HTML）
      const ct = res.headers.get('content-type') || '';
      const isHtml = res.ok
        ? ct.includes('text/html')
        : /\.html?$/i.test(p) || !/\.[a-zA-Z0-9]{1,6}$/.test(p);
      // SPA 回退冒充守卫（生产事故：请求已删旧 chunk /assets/<name>.js → ASSETS 平台层回退
      // index.html 200 text/html → 浏览器把 HTML 当脚本执行报 "'text/html' is not a valid
      // JavaScript MIME type."）。凡带真实文件扩展名（.js/.css/图片…）的路径却收到 HTML 响应
      // = 回退冒充，一律真 404，绝不把 HTML 喂给 <script src>/<link>。真实资产响应 content-type
      // 非 html，本守卫零误伤。
      if (isHtml && !/\.html?$/i.test(p) && /\.[a-zA-Z0-9]{1,6}$/.test(p)) {
        return applySecurityHeaders(new Response('Not Found', { status: 404 }), p);
      }
      return applySecurityHeaders(res, p);
    }

    // 首次请求时初始化数据库（业务库 + 可选独立留档库 + 可选独立合同台账库）。
    // Promise 挂载防并发双跑（网安报告 F-09）：initDb 内部是多个 await 序列，布尔标志存在空窗，
    // Promise 化后同一 isolate 内所有请求共享同一初始化。失败置空允许下次请求重试
    if (!env._dbInited) {
      env._dbInited = initDb(env.DB, env)
        .then(() => (env.LOG_DB ? initLogDb(env.LOG_DB) : undefined))
        .then(() => initLedgerTable(env.LEDGER_DB || env.DB))
        .catch(e => { env._dbInited = null; throw e; });
      bindLogDb(env); // 管理员配置经 secrets 网关读取（只读 env：Worker Secrets / .dev.vars，fail-closed 零仓库明文）
      bindLedgerDb(env);
      bindTextAuditEnv(env); // 文本审核咽喉（text-audit）：v1.5.0 语义层缺密钥/异常拒绝写入（fail-closed）
    }
    await env._dbInited;

    const db = env.DB;
    // 限流闸门前置 parseBody——rateGate 不消费 body（参数预留），超限请求在 body
    // 被读取解析前直接 429（1.1MB 大 body 的 DoS 放大消除：限流拒绝不再为读 body 付带宽/CPU）。
    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    if (!PROBE_PATHS.has(p)) {
      if (!(await rateGate(ip, p, request.method, null, Date.now(), db))) {
        recordRequestMetric({ path: p, status: 429, rateLimited: true });
        return applySecurityHeaders(errorMsg('RATE_LIMITED', 429), p);
      }
    }

    // 体积炸弹防护在 util.parseBody（Content-Length 短路 + 流式硬上限），失败 413 在此转响应
    let body = {};
    try { body = await parseBody(request); }
    catch (e) {
      if (e && e.status === 413) { recordRequestMetric({ path: p, status: 413 }); return applySecurityHeaders(errorMsg('PAYLOAD_TOO_LARGE', 413), p); }
      body = {};
    }

    const t0 = Date.now(); // D：请求耗时（留档 duration_ms，可观测性）
    try {
      // v0.26.0 E2 高频轻量日常审核断点：内容域写请求途中统一过监听断点（数据副本 + 上下文入队列 →
      // 审核节点）。v0.30.0（）起节点为门牌合规 规则层（AUDIT_MAP 抽取自由文本字段交
      // auditFreeText），命中详细门牌号 → 400 reject。驳回文案走上传过程自身的 toast（api 调用方
      // catch 已 showToast(err.message) 原样弹出，无需额外 toast 通路）。审核缺配置/异常拒绝写入。
      const audit = await auditBeforeWrite({ path: p, method: request.method, body, ip, userId: null });
      if (audit.reject) {
        recordRequestMetric({ path: p, status: 400, durationMs: Date.now() - t0 });
        // 审核拒绝是「写 + 400」最该留档的事件（log.js 契约：非 GET 与失败请求入留档），
        // 原早退分支漏 logRequest 致审核事件在 activity_log 不可见——补统一落库点（同成功路径口径）
        ctx.waitUntil(flushMetrics(db));
        ctx.waitUntil(logRequest(db, { method: request.method, path: p, body, status: 400, req: request, durationMs: Date.now() - t0 }));
        return applySecurityHeaders(error(audit.reject, 400, audit.code), p);
      }
      // 公开列表边缘缓存：GET 公开列表命中缓存 → 零 D1 零留档直接返回（冷启动治本）；
      // miss 走正常 handler 后把响应写入边缘缓存（waitUntil 托管，30s TTL 自愈）。
      // 【命中读 text 重建，catch 回落 routeApi】：workerd Cache API 的 match 响应 body 流
      // 有锁定/不可重复读风险（生产实证 clone 后仍 500、durationMs 4ms）——改为 text() 读一次
      // 重建 json 响应；任何缓存读异常都回落正常 handler（绝不 500，可用性 fallback）。
      const apiCache = typeof caches !== 'undefined' ? caches.default : null;
      // 匿名门（外部审查 1101）：仅访客请求参与公开列表缓存——登录请求含 per-user 字段，走实时
      const publicList = request.method === 'GET' && isAnonymous(request) && isPublicListCacheable(p, url);
      if (publicList && apiCache) {
        const cachedData = await readPublicListCache(url);
        if (cachedData) { recordRequestMetric({ path: p, status: 200, durationMs: Date.now() - t0 }); return applySecurityHeaders(json(cachedData), p); }
      }
      const res = await routeApi(db, p, request.method, body, url, request, env); // env 供保活等需多绑定端点
      if (publicList && apiCache && res.status === 200) {
        let text = null;
        try {
          text = await res.text(); // 读一次消费 body（下面用 text 重建返回，避免二次读原流）
          const headers = new Headers(res.headers);
          headers.set('Cache-Control', `public, s-maxage=${PUBLIC_LIST_TTL_S}`);
          // 直接 await put（不用 ctx.waitUntil fire-and-forget）：text 极小毫秒级完成，且保证
          // 响应返回时缓存已就绪——下一个请求必命中；生产实证 waitUntil 异步写导致响应先返回、
          // 紧随的请求 miss 走 D1（冷启动又现）
          await apiCache.put(new Request(url), new Response(text, { status: res.status, headers }));
        } catch { /* 缓存写失败静默：text 保持 null 走原 res */ }
        if (text !== null) {
          try { return applySecurityHeaders(json(JSON.parse(text)), p); } catch { /* 文本异常：回落原 res */ }
        }
      }
      // 数据版本戳（静默数据层）已删除——写操作不再 bump 数据域版本。
      // 会话缓存已整体迁至客户端（app-datahub.js）：服务端读缓存（v0.22.5/8 按身份分桶）
      // 随 v0.23.0 删除——同身份重复读由客户端缓存覆盖（60s TTL + 8s 版本探测刷新），
      // per-user 数据在浏览器侧天然按会话隔离，跨用户零泄露面更小。
      // 留档改 ctx.waitUntil 托管（v0.25.106）：响应路径不再等待留档写库——每写请求省 1 次 D1 往返
      // （登录 6.4s→~4.4s，网络层架构债专项第一步）。workerd 的 ctx.waitUntil 是官方保活通道，
      // 保证留档完成（非悬浮 Promise；历史 0 留档事故是裸 await 后响应结束被掐断，waitUntil 正确托管）。
      // logRequest 内部吞错，留档失败绝不阻断响应。
      // logRequest 兼作本请求全部留档的统一落库点（业务 logEvent 队列 + 本条访问留档一次 batch）
      const finalMs = Date.now() - t0;
      recordRequestMetric({ path: p, status: res.status, durationMs: finalMs });
      ctx.waitUntil(flushMetrics(db));
      ctx.waitUntil(logRequest(db, { method: request.method, path: p, body, status: res.status, req: request, durationMs: finalMs }));
      return applySecurityHeaders(res, p);
    } catch (err) {
      console.error('API Error:', err); // 细节只留服务端日志
      recordRequestMetric({ path: p, status: 500, durationMs: Date.now() - t0 });
      ctx.waitUntil(flushMetrics(db));
      await logRequest(db, { method: request.method, path: p, body, status: 500, req: request, durationMs: Date.now() - t0 });
      return applySecurityHeaders(errorMsg('SERVER_ERROR', 500), p); // 回显脱敏：不回传 err.message
    }
  },
  // D1 保活（v0.22.8 + v0.25.16）：逻辑收敛到 keepD1Warm 单点（与 /api/keepalive 路由共用）。
  // Pages 无原生 cron 触发，本 handler 实际由独立保活 Worker 的 cron 打 /api/keepalive 代为驱动；
  // 保留 scheduled 入口以兼容未来 Workers 直部署场景。
  async scheduled(event, env, ctx) {
    await keepD1Warm(env);
  },
};
