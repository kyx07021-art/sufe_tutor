# 架构说明与搭积木指南（v2 · arch-v2 分支）

面向后续功能开发。目标：增删改查任何功能都像搭积木——每块积木职责单一、接口明确。

**本文档与 `test/architecture-v2.archtest.js` 的 10 条架构契约一一对应（V-3-2a）**：每条契约在下文有对应章节；「文档提及的契约均能在测试中找到」由 V-3-2c 的互检断言锁住，防文档漂移。

## 分层总览（v2）

```
构建/部署：scripts/build.mjs → dist/（唯一部署对象）；hash-assets.mjs → manifest.js（内容哈希资产清单）
  _worker.js（esbuild 打包 dist/_worker.js）只做编排：路由分发/静态回退/HTML 改写/体积闸门/初始化

后端（src/server/）—— 七层咽喉 + 业务域自持，_worker 不写业务策略
  core/                 咽喉层：util（工具/响应构造）→ crypto（加密：哈希/令牌摘要/AES/密钥派生）→
                        security（网安：authUser/requireUser/限流/CORS/安全头）→ session（令牌签发/capToken）→
                        log/notify（留档/通知）→ audit-flow/text-audit/danger-ops/credential/otp
  domains/<域>/        业务域自持三件套（契约 2）：schema.js（DDL/ensureColumns/迁移）· repo.js（SQL 唯一，mapper 单点）· api.js（handler + routes 数组）
  app.js               声明式路由表拼接：域 routes + 特殊路由（契约 3）
  router.js            路由分发器；core/db.js = 域 schema 编排（纯 120 行），根 server/db.js = 域拆分后的兼容 re-export
  src/shared/          config（CONFIG/LIMITS/RATE_LIMITS/SECURITY，数值单源）/enums/codes/region-data（前后端共享）

前端（src/client/ + web/）—— constants 数据单源 → core 共享层 → features 领域层 → 壳
  src/client/constants/  text.js（用户可见文案单源）· theme.js · region-data.js（re-export，真单源在 shared，契约 9）
  src/client/core/      state/api/ui/dom/anim/captcha/datahub/display/match/chart/router/about/ui-scale-reflow 等共享层
  src/client/features/<域>/  领域层：index.js + actions/render（显示映射在域 display.js 或 core/display.js，跨域共用）
  src/client/app.js     ESM 入口（全静态导入，chunk 由 esbuild 自动分包）
  web/index.html        干净 ESM 壳（契约 7）：theme-init.js + CSS 分层（契约 10）+ async-css.js + module 入口
```

加载序（web/index.html）：`theme-init.js` → CSS 分层（tokens→base→features→responsive→glass，域样式异步）→ `async-css.js` → ESM 入口 `/assets/app.js`。

## 契约清单（10 条，archtest 逐条锁定）

| # | 契约 | 本章节 |
|---|------|--------|
| 1 | 构建契约：build.mjs 存在，deploy 指向 dist | [契约 1](#契约-1构建契约) |
| 2 | 后端域自持：domains/<域>/{schema,repo,api} 三件套 | [契约 2](#契约-2后端域自持) |
| 3 | 声明式路由：routeApi 只装配，无 if 路由 | [契约 3](#契约-3声明式路由) |
| 4 | SQL 边界：业务路由/编排层无 db.prepare | [契约 4](#契约-4sql-边界) |
| 5 | 前端模块自持：client/core + features | [契约 5](#契约-5前端模块自持) |
| 6 | 前端边界：fetch 只在 api.js；零内联事件/样式属性；零 &lt;style&gt; 注入；零中文文案 | [契约 6](#契约-6前端边界) |
| 7 | web/index.html 干净 ESM 壳：无内联脚本/事件/样式 | [契约 7](#契约-7esm-壳) |
| 8 | web/index.html 严格 meta CSP | [契约 8](#契约-8严格-meta-csp) |
| 9 | region-data 单源：SUFE_REGIONS 唯一定义于 shared | [契约 9](#契约-9region-data-单源) |
| 10 | CSS 分层加载序：tokens→base→features→responsive→glass | [契约 10](#契约-10css-分层加载序) |

## 契约 1：构建契约

`scripts/build.mjs` 是唯一构建入口，输出到 `dist/`（`npm run build` / `npm run deploy` 只部署 dist）。它做：esbuild 打包 `_worker.js`（连 server/ 与 manifest.js 成单文件）→ esbuild 分包客户端 ESM 到 `dist/assets/` → 拷贝 web/ 资产 → 生成 `dist/index.html`（web/index.html 的 module 入口替换为哈希名；V-4-1h 起 v2 直接作为站点入口）→ 自检（worker bundle 体积、无源码相对 import、可被 Node import）。

`node hash-assets.mjs` 生成 `manifest.js`（内容哈希资产清单：base 名 → 哈希名），**commit 前必须重跑**（规则 54）。manifest.js 是唯一产物勿手改。

## 契约 2：后端域自持

业务按域拆分，每域 `src/server/domains/<域>/` 自持三件套，接口统一：
- `schema.js`：DDL/ensureColumns/迁移（`createStatements`/`ensureColumns`/`migrate` 统一接口）；幂等（CREATE IF NOT EXISTS；加列 PRAGMA 探测再 ALTER）。
- `repo.js`：业务表 SQL 唯一落点，mapper 单点反序列化（JSON 列 safeJsonArray），出口剥私密字段、price 保留 null 语义。
- `api.js`：该域全部 handler + 自持 `routes` 数组（路由声明表），app.js 只拼接域 routes + 特殊路由。

当前域：auth/teacher/demand/chat/contract/admin/posts/complaints/reviews/awards/settings。

## 契约 3：声明式路由

路由只在 `src/server/app.js` 的 `routes` 表 + `_worker.js` routeApi 里的特殊路由（batch/health/keepalive）。`routeApi` 内零手写 `if (p === '/api/...')`。加新 API = 在所属域 api.js 的 routes 数组加一条声明，不碰编排层。

## 契约 4：SQL 边界

业务 SQL 只在 `domains/*/repo.js`。`_worker.js` 除保活（keepD1Warm）外不直接 db.prepare；旧 `server/routes-*.js` 文件也不直接写 SQL（已域拆分，仅为 re-export shim）。

## 契约 5：前端模块自持

前端分 `src/client/core/`（共享层）+ `src/client/features/`（领域层）+ `src/client/constants/`（数据单源）。领域功能 = core 复用 + 域内自持，严禁在共享层堆领域特例。核心模块无全局变量依赖（ESM 化），加载序由 web/index.html 单一入口控制。

## 契约 6：前端边界

- `fetch` 只在 `core/api.js`（自动令牌头 / 401 兜底 / {message, code} 错误），领域层零直接 fetch。
- core/features 全文件零内联事件/样式属性（onload/onclick/style=）零 `<style>` 元素注入（CSP style-src-elem 'self' 硬约束）——动态样式只能走 CSS 自定义属性数据通道（`el.style.setProperty('--x', v)`，视觉声明全在 CSS）。
- core/features 零中文文案（用户可见文案只在 constants/text.js；代码注释也避免中文——archtest 整文件扫描）。

## 契约 7：ESM 壳

web/index.html 是干净壳：唯一入口 `<script type="module" src="/assets/app.js">`，零内联 script/事件属性/样式属性。首绘无 FOUC 由 `theme-init.js`（外部 classic 脚本）承担；异步 CSS 用 `data-async-css` + `async-css.js` media 交换，零 onload 内联。

## 契约 8：严格 meta CSP

web/index.html 页级严格 CSP：`script-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'`（最小化声明，无 default-src）。与 `_headers` 站点级策略（V-4-1h h5a 起镜像同姿态：`script-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; frame-ancestors 'none'`；API 层 `SECURITY_HEADERS`/config.js 同姿态）取交集：v2 内联 script/`<style>` 元素被拦，CSSOM 数据通道保留（style-src-attr，ui-modal cssText 承重）。v1 壳已随 V-4-1h 删除，`_headers` 已一并收口。**严禁为省事在 v2 加回 unsafe-inline 或声明 default-src 收紧 data:/blob:**。

## 契约 9：region-data 单源

省份/科目/地址政策数据唯一真源在 `src/shared/region-data.js`（`export const SUFE_REGIONS`，服务端 demand/teacher 域与前端共同复用）。前端入口 `src/client/constants/region-data.js` 是纯 re-export（保持分层入口）。**严禁在别处重定义 SUFE_REGIONS 或硬编码省份列表**。

## 契约 10：CSS 分层加载序

样式按 tokens（设计令牌）→ base（重置+跨域组件）→ features/*（域样式，chat/posts/region 异步化）→ responsive（响应式）→ glass（玻璃引擎）层叠。web/index.html 的 stylesheet link 必须保持此相对顺序（V-2-5b 铁律）——乱序会破坏覆盖语义。JS 只切类（open/close），零内联样式，动画全在 CSS 呈现层。

## 硬性约定（架构灵魂，违反 = 制造屎山）

- **身份只认令牌**：X-Auth-Token（security.requireUser 守卫），废除自报 userId。body/query 只许「目标 id」，归属由服务端硬校验。
- **数据形状单点**：JSON 列反序列化只在 repo mapper（safeJsonArray），路由层/前端零 JSON.parse；mapper 空值语义盯紧（该保留 null 就 `x != null ? x : null`）。
- **状态机赢家模式**：并发状态迁移用「条件 UPDATE + changes>0 判定」，副作用（通知/台账/留档）只由赢家执行；合同修改用 version 乐观锁。
- **workerd 副作用纪律**：一切副作用 async 必须 await/waitUntil——悬浮 Promise 被响应结束掐断。
- **显示逻辑单源**：枚举查名/映射/格式化只在域 display.js 或 core/display.js，出现第二处即违规。
- **登录通路唯一**：ensureAuth（selectPage auth 标记 + 写按钮守卫 + api 401 兜底三处汇入同一函数）。
- **数值单源**：一切裸数字（限流/限额/交互参数/动画时长）只进 `src/shared/config.js`（CONFIG/LIMITS/RATE_LIMITS/SECURITY，前后端共享），禁止散落。
- **加密/审核咽喉 fail-closed**：无密钥/加密失败/审核不可用一律拒绝写入，绝不静默放行。
- **网安补丁并入主线**：历轮审计补丁（令牌摘要、capToken、门牌守卫、svg 黑名单、体积闸门、脱敏、安全头）都以咽喉层接口存在，新代码走咽喉，不许另起旁路。

## 缓存协议（前端）

`datahub`/`state` 缓存遵循「动作后失效」：任何会改变数据的操作成功后调 `invalidate(key)`（置空对应缓存），下次读取自然重拉。红点轮询与页面读取共享同一缓存。

## 配方一：加一个「列表页」

1. `src/server/domains/xxx/api.js`：routes 数组加 `{ method:'GET', path:'/api/xxx', handler }`（requireUser 门禁按需）。
2. `src/server/domains/xxx/repo.js`：`dbGetXxx(db, ...)`（SQL + mapper；JSON 列过 safeJsonArray）。
3. `src/client/features/xxx/`：域模块 index.js 注册页，actions.js 的加载器 = 调 `api('/api/xxx')` → `renderXxxCard`。
4. `src/client/constants/text.js`：PAGE_XXX / XXX_EMPTY 文案（用户可见文案单源）。
5. 显示映射（状态→文本/枚举查名）只在 `features/xxx/display.js`（跨域共用则 core/display.js）。

## 配方二：加一个「写操作」端点

1. `repo.js`：写 SQL 只在此；`api.js` handler = 守卫 → 归属/状态门禁 → 数据层 → 副作用（logEvent/notify，必须 await；并发用赢家模式）。
2. 前端：`api('/api/xxx', { method:'POST', body:{...目标id，勿带 userId...} })`；需登录的按钮处理函数首行 `if (!ensureAuth()) return;`。
3. 副作用同步：成功后 `invalidate('teachers'|'contracts'|...)`。
4. 危险操作（注销/撤销/签约）走 capToken 二次认证。

## 配方三：改文案 / 改数值

- 用户可见文案：只动 `src/client/constants/text.js`（服务端经共享 codes/config 读同源）。
- 校验/限额：只动 `src/shared/config.js`（CONFIG / LIMITS / RATE_LIMITS / SECURITY）。
- 交互参数（断点/轮询/防抖/动画时长）：只进 CONFIG，页面/模块零裸数字。

## 上线检查清单

1. `node hash-assets.mjs`（manifest 与源码一致）→ `npm test` → `npm run test:arch` → `npm run build` 全绿。
2. commit + push（Git 自动部署；github 抽风用 push-retry.sh 后台线程）。
3. curl /api/health 验线上 + 反馈单巡检。
4. 渲染/安全改动交付前手动跑浏览器验证（`node test/verify-csp-strict.mjs` / `node test/verify-captcha-render.mjs`）。
