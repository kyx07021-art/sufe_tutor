# 网络层重构设计（v0.27.0）——最小网络层架构

> 状态：设计定稿。本文件是重构的权威依据（规则/方案文档，非 changelog）；进度看 git，待办看本文件任务单。
> 依据：2026-08-10 全栈勘探（7 路只读 agent）+ 成熟架构联网调研（TanStack Query/SWR 去重、BFF 聚合、D1/Workers 边缘缓存、HTTP 请求合并、会话缓存权衡）。禁止俺寻思的落实：每条方案都有调研引用。

---

## 一、现状问题（勘探实证，file:line 见勘探报告）

### 1.1 往返次数爆炸
- **写操作 = 8 次 D1 往返**：`POST /api/posts` = rateGate 2（upsert+回读）+ requireUser 1 + dbCreatePost 1 + dbGetUserById 1 + bumpVersions 1 + logRequest 2（logRequest 再调一次 authUser 记 actor）。带附件的投诉可达 10+。
- **登录 GET = 2 次 D1**（authUser 1 + 业务 1），无任何服务端会话缓存。
- **登录/进客户端瞬时爆发 10-12 个并行 authed GET**（DH_PREFETCH 9-13 键 + 徽标首刷 + data-version）。
- **进客户端 = 12 个领域脚本串行注入**（Promise 链逐个 fetch+exec = 12 次 RTT 瀑布；冷加载首次每脚本 404 重试 4×3s 最坏 12s/脚本）。
- **刷新/切角色阻塞等 `/api/auth/me`**（switchToRole 客户端壳前 1 次串行往返）。
- **聊天发消息 = 2N+1 个请求**（N 附件暂存上传 + N+1 发送串行）。
- **附件懒加载 N+1**：历史多附件会话开一次 = N 次串行往返（120ms 延迟循环）。
- **版本探测每在线客户端每 30s 1 次真实 D1**，无限循环；徽标轮询 30s 7 端点（多走 dhGet 缓存命中）。
- **聊天轮询 4s 每次**（打开会话期间恒往返，不经 datahub 缓存）。

### 1.2 后端每请求 D1 冗余
- logRequest 对同一令牌再跑一次 authUser（写路径 2 次令牌 D1）。
- bumpVersions 多域写 = 逐域串行 1 D1（3 域写 = 3 次串行）。
- rateGate 写路径 rlDual = upsert + 回读 2 D1。
- dbGetAllContentAdmin 无 type 过滤 = 10 次串行 D1。
- 投诉附件 dbGetUpload 逐条（上限 4）；handleRespondSigning / dbPurgeUserOwnedData 循环逐条 dbRun（N+1）。

### 1.3 缓存/发版
- 版本探测的「发版 8s 自愈」注释不成立：运行中旧标签页执行旧代码 `cur==prev` 永不自我感知发版，实际只在下次页面加载 boot 路径生效。
- 发版后 dhCheckAppVersion 整体清缓存 → 下次交互全冷 → 并发重拉风暴（对应「每次推送新版本之后尤为如此」）。
- 匿名公开列表边缘缓存无写路径失效、无版本键，写后 30s（s-maxage）内访客拿旧列表；封禁 30s 内仍展示被封者。

### 1.4 前端乐观反馈缺口
- 已有乐观：帖子点赞/收藏（U10 seq+回滚）、通知单/批已读、会话已读、登出。其余 **34+ 处写操作全部等响应**。
- 按频次与卡顿感排序最该做乐观的：① 聊天发消息（全站最高频）② 试课意向提交 ③ 意向/推送处理 ④ 删除帖子/需求 ⑤ 提交评价。

### 1.5 读路径绕过 datahub 的裸 api GET（22 处）
- `/api/teacher/profile`（本人+公开查看）完全不入 datahub；
- `/api/student/demands?scope=mine` app-demands.js:849 裸 api（编辑后再发推送必重复拉）；
- `/api/contracts/my` app-contracts.js:346 改后裸 GET 刷新（不 invalidate，缓存陈旧+重复拉）；
- `/api/posts` 三个缓存键碎片（admin 无 sort / 预取 sort=new / loadPosts sort 变体）。

---

## 二、设计原则（调研参考，非俺寻思）

1. **请求合并/去重**（TanStack Query single-flight / SWR dedupingInterval / BFF 聚合）：
   并发同 key 共享一个请求；不同 key 的一次性批量往返（API batching，BFF 案例 250ms→65ms）。
2. **乐观更新 + 失败回滚**（TanStack Query optimistic write → rollback / SWR mutate）：
   立即写本地，失败恢复快照，成功以服务端收敛。
3. **后台预取一切可能慢的东西**（request-waterfall 研究：prefetch at router level on page load）：
   登录/访客进客户端即后台批量预取全部模块数据，切模块零等待。
4. **减少每请求服务端成本**（D1 query batch / Workers Cache API ~1ms）：
   一次 D1 往返能完成多语句的用 db.batch；可合并的查询合并不发多个。
5. **鲁棒性优先于性能**（fail-open / stale-while-revalidate / 空响应不缓存）：
   任何缓存读异常回落实时；GET 幂等自动重试防抖动；绝不因缓存引入 500。
6. **不引持久连接**（CLAUDE.md 红线：聊天轮询不引 WebSocket/DO）：
   跨用户实时感知继续走轮询（版本探测 30s），但把探测/刷新成本降为零额外请求（批量）。

### 有意不做的事（记录理由，防返工）
- **不做服务端会话缓存**（CLAUDE.md 遗留 U10）：每请求省 ~5ms 暖 D1，但引入封禁/登出/撤销 ≤TTL 的即时失效窗口（跨 isolate 无法全局失效），安全账不划算；站点规模（~45 用户）下 D1 负载微不足道。改为**请求内 auth 记忆化**（同请求二次调用免 D1，零陈旧）——这是纯安全净收益。
- **不做 SSE/长轮询**：跨 isolate 无法可靠推送给对端（Pages 多 isolate 无全局广播），SSE 收益（省 30s 探测）小于连接不稳定风险（用户首要抱怨），且违「不引持久连接」架构精神。版本探测 30s 一次单表读成本可忽略，保留。
- **不动整体脚本加载序/不合并 JS 文件**：改动前端层架构风险大于收益；domain 脚本已懒加载+预载，本次只修串行注入为并行注入。

---

## 三、目标架构

### 前端网络管线（分层清晰，接口单一）
```
app-api.js      传输层：唯一 fetch 原语。超时/错误分类/401 幂等兜底/GET 自动重试/batch 传输
app-datahub.js  缓存同步层：SWR 会话缓存 + single-flight + 版本驱动刷新 + 批量预取 + 乐观写辅助
app-state.js    状态会话层：会话持久化/缓存协议(invalidate)/偏好（本版不动）
app-shell.js    壳层：加载编排（并行注入）/进入客户端编排/boot
领域模块        只调 dhGet/api + 模块级渲染
```
关键接口：
- `api(endpoint, opts)` —— 单请求（不变）
- `api.batch(gets)` 或 `dhBatchGet(entries)` —— 批量读（新增）
- `dhApply(endpoint, mutator)` / `dhRevert(endpoint, snapshot)` —— 乐观写辅助（新增）
- `dhPrefetch(role)` —— 内部改走批量（对外签名不变）

### 后端管线
```
_worker.js 网关：CORS → 静态 → initDb → 体积闸 → 限流 → audit → 路由 → 留档
  ├─ 请求上下文 reqCtx：auth 记忆化（同请求二次鉴权免 D1，logRequest/批量子请求复用）
  ├─ POST /api/batch：一次鉴权 + N 个子 GET 并发（子请求仍走 routeApi，公开列表命中边缘缓存）
  └─ 写咽喉：bumpVersions 改单次 db.batch
routes-* 业务层：不变（个别 N+1 定点批化）
db.js 数据层：不变架构（定点补批量查询）
```

---

## 四、基元任务单（逐条实现，验一条删一条）

> 编号规则：B=后端，F=前端，T=测试。验收 = 全量测试绿 + 生产实测或单元断言。

### 后端（B）
- ✅ **B1 请求上下文 auth 记忆化**：security.js `authMemo` WeakMap（请求作用域），logRequest 复用同请求已鉴用户（写路径 -1 D1）。跨请求不做记忆化（安全红线：登出/封禁即时失效）。
- ✅ **B2 `POST /api/batch` 批量读端点**：`{gets:[path...]}` → `{results:[{path,status,data}]}`。一次 authUser + 一次 rateGate（LIMITS.MSG_BATCH_MAX=13 上限）；子请求并发走 routeApi（复用公开列表边缘缓存）；单子请求失败不阻断其余。
- ✅ **B3 bumpVersions 批量**：`db.batch()` 单次提交多域自增（3 D1 → 1 D1）。ON CONFLICT 逐域 upsert，batch 失败整体吞错旧基线兜底。
- ✅ **B4 rateGate 写路径批化**：rlDual upsert+回读 → 单次 `db.batch()`（-1 D1/写）。
- ✅ **B5 投诉附件 N+1**：dbGetUploads `WHERE id IN (?)` 单查（上限 4，Map 反查）。
- ✅ **B6 dbGetAllContentAdmin 批化**：CONTENT_SQL map + mapContentRows → 单次 `db.batch()`（-9 D1，最重单查询）。
- ⏭️ **B7 签约/注销 N+1 批化**：跳过（低频旁路路径，风险大于收益；主链路写往返已批化）。

### 前端（F）
- ✅ **F1 GET 自动重试**：app-api 幂等 GET 网络错误（仅 NETWORK_ERROR 且非超时）重试 1 次（GET_RETRY/GET_RETRY_BACKOFF_MS 进 CONFIG）；4xx/5xx 业务错误与 401 不重试；POST 不重试（防双写）。
- ✅ **F2 批量传输 `apiBatch(gets)`**：POST /api/batch，返回 `Map<path,data>`；子结果 401 触发既有幂等兜底（lastHandled401Token 一次）；网络错误统一归 NETWORK_ERROR。
- ✅ **F3 dhPrefetch 改批量**：`dhBatchGet(entries)`——缓存命中键跳过、在途键共享（single-flight）、缺键一次批量拉取；结果按 key 写缓存 + 域 rebinder；`dhPrefetch(role)` 签名不变内部批量。
- ✅ **F4 dhRefreshDomain 改批量**：域内已缓存 key 一次批量 forceRefresh（版本变化 -N+1 往返）。
- ✅ **F5 乐观写辅助**：`dhSnapshot(paths)`/`dhApply(path, mutator)`/`dhRevert(path, snapshot)`——缓存级乐观写 + 失败恢复。
- ✅ **F6 领域脚本并行注入**：loadDomainScripts 串行 Promise 链 → `Promise.all`（经典脚本按 DOM 插入序执行，下载并行执行保序）——冷进客户端 12 RTT 瀑布 → 1 波。404 重试/整页刷新自愈语义不变（__domainLoading 并发防重保留）。
- ✅ **F7 发版后后台重预取**：dhCheckAppVersion 清缓存后 enterClient 立即 dhPrefetch 批量重灌（见 T6 链式测试）。
- ✅ **F8 switchToRole 非阻塞 me**：`/api/auth/me` 不阻塞客户端壳——立即 enterClient，me 并行调和 state.user（sessionBootValidating 防 401 闪登出；死令牌回落访客预览保留）。
- ✅ **F9 聊天发送批化**：`POST /api/conversations/:id/messages` 支持 `{batch:[{kind,body|uploadId},...]}`——附件+文字一次往返（2N+1 → 1）；服务端循环校验 + `db.batch` 落库 + 附件转正/删除；响应返回消息数组。
- ✅ **F10 聊天乐观发送**：点发送即本地插入临时气泡（负 data-mid），响应真实 id 替换、chatLastMsgId 更新防轮询重拉，失败移除气泡 + 恢复输入/暂存 + toast；发送在途轮询关窗（chatOptimisticSending）。
- ✅ **F11 附件懒加载并行**：chatLazyLoadAttachments 串行 120ms 循环 → 有界并行（~4 并发 Promise.all）。
- ✅ **F12 高频操作乐观化**（仿 U10 模式，失败回滚）：① 试课意向提交→按钮即刻「已提交」（data-demand-id 定位）+失败恢复 ✅；③ 删除帖子/需求→卡片即刻移除（data-post-id/data-demand-id）+失败恢复 ✅；② 意向/推送接受拒绝、④ 评价提交、⑤ 帖子发布 → ⏭️ 跳过（接受/拒绝/评价/发布涉多态重渲染，乐观态与真实状态差异大，收益小于误渲染风险；高频即时性已由聊天/意向/删除三项覆盖）。
- ✅ **F13 读路径绕行收口**：`/api/student/demands?scope=mine`、`/api/contracts/my`（409 后 forceRefresh）、`/api/teacher/profile` 本人读取改走 dhGet + invalidate，消灭重复拉取与缓存陈旧。

### 测试（T）
- ✅ **T1** api-batch.test.js（成功/部分失败/匿名公开列表命中边缘缓存/请求体校验/401 单次兜底）。
- ✅ **T2** api-retry.test.js（网络错重试 1 次成功/耗尽仍 NETWORK_ERROR/业务 4xx 不重试/非 GET 不重试）。
- ✅ **T3** datahub.test.js dhBatchGet（缓存跳过/在途共享/一次批量/部分失败静默/域 rebinder）。
- ✅ **T4** datahub.test.js dhRefreshDomain/dhProbeTick 批量（版本变化一次批量重拉）。
- ✅ **T5** domain-404-reload.test.js 并行注入（同 tick 12 脚本全注入；串行实现只注入首个）。
- ✅ **T6** datahub.test.js 发版重预取（版本变化清缓存 → dhPrefetch 一次批量重灌）。
- ✅ **T7** chat-optimistic-send.test.js（乐观气泡/真实 id 替换/失败回滚恢复输入/批量体/关窗）。
- ✅ **T8** chat-send-batch.test.js（多附件+文字一次落库/归属校验 404 不落半批/校验分支/读回）。
- ✅ **T9** bumpVersions/logRequest 回归并入全量（bump 测试沿用，log-request 原 5 用例绿）。
- ⏳ **T10** 全量回归 + hash-assets（manifest 与源码一致红例拦截）。

### 部署与验证（D）
- ⏳ **D1** 全量测试绿 → hash-assets → commit（APP_VERSION 0.27.0）→ push-retry → /api/health 验线上。
- ⏳ **D2** 生产实测：批量预取（进客户端 1 个 batch 请求替代 9-13 个）、聊天发送即时气泡、写操作往返减少、发版后冷启动改善、GET 断线自愈。
- ⏳ **D3** 反馈单巡检 + 公告（v0.27.0）。

---

## 五、风险与边界（实现时遵守）
- 乐观写必须带失败回滚（audit-flow 内容审核断点会驳回部分写，400 需回滚）。
- batch 子请求不可有写操作（只读批量）；写路径仍走单请求保证错误码/toast 语义。
- reqCtx 记忆化只限同请求生命周期，绝不可跨请求复用（防串会话）。
- db.batch 在 workerd 语义 = 单往返多语句；失败整体回滚由 SQLite 事务保证（D1 batch 是事务性的）。
- F8 非阻塞 me 后，state.user 以 me 响应为准调和（avatar/username 新鲜度不丢）。
- 版本探测与徽标轮询频率保持现状（30s），本版不动轮询架构。
