# 架构说明与搭积木指南

面向后续功能开发。目标：增删改查任何功能都像搭积木——每块积木职责单一、接口明确，加一个功能照着配方找文件即可。

## 分层总览

```
后端（Cloudflare Pages Worker + D1）
  _worker.js          路由层：纯分发（路径→handler）+ 限流 + 静态回退 + 留档包裹。不写业务。
  server/routes-*.js  关口层：鉴权(authUser/requireAdmin) + 参数白名单 + 归属/状态门禁 + 调数据层。不写裸 SQL（契约）。
  server/contract.js  合同状态机（自持关口 loadContractFor，同模式可复制到其他状态机实体）
  server/db.js        数据层：唯一写 SQL 的地方。JSON 列经 safeJsonArray 单点反序列化，
                      行经 mapXRow 映射器出门——路由层拿到的永远是结构化对象，零 JSON.parse。
  server/core.js      工具：json/error/authUser/requireAdmin/issueAuthToken/MSG/OTP 咽喉
  server/log.js       留档咽喉 logEvent（加密透明）——一切数据往来的全量审计
  server/notify.js    通知咽喉 notifyUser（吞错不碍业务）+ 广播 + 批删
  server/secrets.js   敏感配置网关（env 优先回落本地 secrets.js，公测迁移见 docs/secrets-plan.md）

前端（经典脚本，全局函数 + 内联 onclick；加载序见 index.html）
  constants.js        全部用户可见文案 + 业务枚举（服务端经 globalThis.APP_CONSTANTS 同读）
  region-data.js      省份政策数据单源（赋分组件/科目政策）
  app-display.js      显示层：纯函数（科目名/枚举查名/角色/省名/星级/分数单元/状态tag/墓碑用户名）。
                      任何「数据→展示文本」的逻辑只许写在这里，页面里不手写映射。
  app.js              壳与状态：导航/侧边栏/登录通路(ensureAuth)/装载器(loadInto)/各页面 enter
  app-chat.js / app-posts.js / app-region.js   功能子模块（同约定，可用 app.js 全局设施）
```

## 配方一：加一个「列表页」

1. `server/db.js`：一个 `dbGetXxx(db, ...)`（SQL + mapXxxRow 映射器；JSON 列过 safeJsonArray）
2. `server/routes-xxx.js`：一个 `handleGetXxx(db, url, req)`（authUser 门禁按需；公开页则免）
3. `_worker.js`：一行路由 `if (p === '/api/xxx' && method === 'GET') return await handleGetXxx(db, url, req);`
4. `index.html`：`<section class="client-page" data-page="xxx">` + 一个列表容器 `<div id="xxx-list">`
5. `app.js` ROLE_PAGES：一行配置 `{ id:'xxx', label: UI.PAGE_XXX, desc: ..., enter: loadXxx, auth: false? }`
6. `app.js`：`loadXxx()` = 一个 `loadInto('xxx-list', () => api('/api/xxx'), rows => rows.map(renderXxxCard).join(''), { empty: UI.XXX_EMPTY, pick: d => d.xxx })`；一个 `renderXxxCard(x)`（展示文本全走 DISP.*）
7. `constants.js`：PAGE_XXX / PAGE_XXX_DESC / XXX_EMPTY 三条文案

## 配方二：加一个「写操作」端点

1. `server/db.js`：数据层函数（写 SQL 只在此）
2. `server/routes-xxx.js`：handler = `authUser → 401`；参数白名单；归属/状态门禁（参照 loadOwnedDemand/loadContractFor 关口模式：失败返 `{ err }`，调用方一行拦截）；调数据层；`logEvent` 留档（必须 await）
3. `_worker.js`：一行路由
4. 前端：`api('/api/xxx', { method:'POST', body: {...目标id，勿带 userId...} })`；需登录的按钮处理函数首行 `if (!ensureAuth()) return;`
5. 副作用同步：成功后 `invalidate('teachers'|'contracts'|...)` 让相关缓存失效（见缓存协议）

## 配方三：改文案

只动 `constants.js` 的 UI 块。服务端文案同样在此（经 globalThis.APP_CONSTANTS.UI 读）。页面/模块里不许出现中文字面量（index.html 静态页头除外，且进页时按常量覆盖注入）。

## 硬性约定（违反 = 制造屎山）

- **身份只认令牌**：X-Auth-Token（authUser 解析）。接口不收自报 userId/username 作身份；body/query 里只许出现「目标 id」（归属由服务端硬校验）。
- **数据形状单点**：JSON 列反序列化只在 db.js（safeJsonArray）；mapper 是唯一序列化/反序列化出口。路由层/前端零 JSON.parse。mapper 里每个空值语义要盯紧（`x || 0` 会把「未填」变成 0，该保留 null 就 `x != null ? x : null`）。
- **状态机赢家模式**：并发可触发的状态迁移用「条件 UPDATE ... WHERE status=旧态」+ `res.meta.changes > 0` 判定，通知/台账/留档等副作用只由赢家执行。
- **workerd 里一切副作用 async 必须 await**（或 waitUntil）——悬浮 Promise 会被响应结束掐断，无报错无声无息。
- **DDL 幂等 + 升级双保险**：新表 CREATE IF NOT EXISTS；改列既进 DDL 又进 ensureColumns（CREATE 永不升级旧表）。
- **显示逻辑归 app-display.js**：枚举查名/映射/格式化出现第二处即违规，收进 SUFE_DISPLAY。
- **装载走 loadInto**：loading/空态/错误/reveal 四件套不许再手写（结构特殊的聊天页除外）。
- **登录通路唯一**：需要身份的操作经 ensureAuth（selectPage 的 auth 标记 + 写按钮守卫 + api 401 兜底三处汇入同一函数）。
- **留档咽喉**：logEvent 统一入口，detail 自动加密、敏感键自动脱敏。

## 缓存协议（前端）

`state.*` 缓存（allTeachers / myContracts / myDemands ...）遵循「动作后失效」：任何会改变数据的操作成功后调 `invalidate(key)`（置空对应缓存），下次读取自然重拉。红点轮询与页面读取共享同一缓存，不各拉各的。

## 上线清单

1. `node --check` 全部改过的 js；后端 `node --input-type=module --check < 文件`
2. commit + push（Git 自动部署；DNS 抽风重试 3 次/60s，不上去 `npm run deploy` 兜底）
3. curl /api/health + 版本号验证 + 改动点冒烟
4. 发版本公告（admin 令牌 → broadcast；文案走 UTF-8 文件 payload，规则见 CLAUDE.md 部署纪律）
