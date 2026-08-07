# 架构说明与搭积木指南

面向后续功能开发。目标：增删改查任何功能都像搭积木——每块积木职责单一、接口明确，加一个功能照着配方找文件即可。

## 分层总览（v0.21.0 重构后）

```
后端（Cloudflare Pages Worker + D1）—— 七层咽喉，_worker 只做编排
  _worker.js           编排层：路由分发 + 静态回退 + 体积闸门 + 初始化编排 + 留档包装。不写业务策略。
  server/constants.js  常量配置层：MSG/STATUS/业务常量/限额 LIMITS/限流 RATE_LIMITS/安全头（数值单源）
  server/util.js       工具层：json/error 响应、dbAll/dbGet/dbRun、ensureColumns 幂等加列、genCode、UA 标签
  server/crypto.js     加密咽喉：PBKDF2 哈希 / SHA-256 令牌摘要 / AES-GCM 原语 / 密钥派生单点（deriveKey）
                       / 字段加密 encryptField / 留档加密 encryptDetail
  server/security.js   网安咽喉：authUser / requireUser / requireAdmin 守卫 / 限流（内存+D1 双写）/ CORS / 安全头
  server/session.js    账户凭证：issueAuthToken / capToken / listSessions / revokeSession / getSessionByToken
  server/db.js         数据层：业务表 SQL 唯一。JSON 列 safeJsonArray 单点反序列化，行经 mapXxxRow 出门
  server/log.js        留档咽喉 logEvent（detail 加密透明）+ logRequest 兜底 + queryLog 检索
  server/notify.js     通知咽喉 notifyUser（吞错不碍业务）+ 广播 + 批删
  server/contract.js   合同状态机 + 存证台账（哈希链，覆写域：台账 SQL 自持本模块，CLAUDE.md 有意决定）
  server/routes-*.js   业务逻辑：requireUser 守卫 → 归属/状态门禁 → 数据层 → logEvent/notifyUser 副作用

前端（经典脚本，全局函数 + 内联 onclick；加载序见 index.html 底部 script 注释）
  constants.js         用户可见文案 + 业务枚举 + THEME/LG + CONFIG（数值单源）
  region-data.js       省份政策数据单源（赋分组件/科目政策）
  app-display.js       显示层：纯函数（科目名/枚举查名/角色/省名/星级/分数/状态 tag/墓碑用户名）。DISP.*
  共享层：
    app-state.js       状态管理层：state 唯一源 + 会话持久化 + 缓存协议(invalidate) + 偏好存取 + 登出复位注册表
    app-api.js         fetch 封装：自动令牌头 / 401 兜底汇入登录通路 / {message, code} 错误
    app-anim.js        动画函数层：pill 滑动 / 卡片浮入 / Toast / 自定义下拉开闭定位 / 键盘可达
    app-ui.js          外观层：escHtml/fmtDateTime / 头像 / 加载件 / 弹窗壳 / 自定义下拉 DOM / 图片查看压缩 / 确认·二次认证原语
    app-onboard.js     新手引导层（明确依赖登录态，ONBOARD_STEPS 注册表可扩充）
  领域层：app-region（地区赋分）/ app-posts（资料共享+反馈，md 编辑器）/ app-chat / app-contracts /
          app-admin / app-demands（需求/意向/推送/匹配度）/ app-teachers（教师/个人信息栏/评价）/ app-pages（设置/关于/档案编辑）
  壳层（最后加载）：
    app-shell.js       视图切换 / 侧边栏 / ROLE_PAGES 注册表 / loadInto 装载器 / 红点徽标 / 通知页 / 初始化
    app-auth.js        登录通路 ensureAuth / 注册 / 登录 / 登出 / 访客模式
```

## 配方一：加一个「列表页」

1. `server/db.js`：一个 `dbGetXxx(db, ...)`（SQL + mapXxxRow 映射器；JSON 列过 safeJsonArray）
2. `server/routes-xxx.js`：一个 `handleGetXxx(db, url, req)`（requireUser 门禁按需；公开页则免）
3. `_worker.js`：一行路由 `if (p === '/api/xxx' && method === 'GET') return await handleGetXxx(db, url, req);`
4. `index.html`：`<section class="client-page" data-page="xxx">` + 一个列表容器 `<div id="xxx-list">`
5. `app-shell.js` ROLE_PAGES：一行配置 `{ id:'xxx', label: UI.PAGE_XXX, desc: ..., enter: loadXxx, auth: false? }`
6. 领域文件：`loadXxx()` = `loadInto('xxx-list', () => api('/api/xxx'), rows => rows.map(renderXxxCard).join(''), { empty: UI.XXX_EMPTY, pick: d => d.xxx })`；一个 `renderXxxCard(x)`（展示文本全走 DISP.*）
7. `constants.js`：PAGE_XXX / PAGE_XXX_DESC / XXX_EMPTY 三条文案

## 配方二：加一个「写操作」端点

1. `server/db.js`：数据层函数（写 SQL 只在此）
2. `server/routes-xxx.js`：handler = `requireUser(db, req, role)` → 归属/状态门禁 → 数据层；`logEvent` 留档（必须 await）
3. `_worker.js`：一行路由
4. 前端：`api('/api/xxx', { method:'POST', body: {...目标id，勿带 userId...} })`；需登录的按钮处理函数首行 `if (!ensureAuth()) return;`
5. 副作用同步：成功后 `invalidate('teachers'|'contracts'|...)` 让相关缓存失效

## 配方三：改文案 / 改数值

- 用户可见文案：只动 `constants.js` 的 UI 块（服务端经 globalThis.APP_CONSTANTS.UI 读，MSG 同源）。
- 服务端校验/限额：只动 `server/constants.js`（MSG / LIMITS / RATE_LIMITS / SECURITY）。
- 前端交互参数（断点/轮询/防抖/图片尺寸等）：只动 `constants.js` CONFIG 块。
- 页面/模块里不许出现中文/裸数字字面量（index.html 静态页头除外，且进页时按常量覆盖注入）。

## 硬性约定（违反 = 制造屎山）

- **身份只认令牌**：X-Auth-Token（security.requireUser 解析）。接口不收自报 userId/username 作身份；body/query 里只许出现「目标 id」（归属由服务端硬校验）。
- **数据形状单点**：JSON 列反序列化只在 db.js（safeJsonArray）；mapper 是唯一序列化/反序列化出口。路由层/前端零 JSON.parse。mapper 里每个空值语义要盯紧（`x || 0` 会把「未填」变成 0，该保留 null 就 `x != null ? x : null`）。
- **状态机赢家模式**：并发可触发的状态迁移用「条件 UPDATE ... WHERE status=旧态」+ `res.meta.changes > 0` 判定，通知/台账/留档等副作用只由赢家执行；合同修改乐观锁用自增 version（秒级 updated_at 不可靠）。
- **workerd 里一切副作用 async 必须 await**（或 waitUntil）——悬浮 Promise 会被响应结束掐断，无报错无声无息。
- **显示逻辑归 app-display.js**：枚举查名/映射/格式化出现第二处即违规，收进 DISP。
- **装载走 loadInto**：loading/空态/错误/reveal 四件套不许再手写（结构特殊的聊天页除外）。
- **登录通路唯一**：需要身份的操作经 ensureAuth（selectPage 的 auth 标记 + 写按钮守卫 + api 401 兜底三处汇入同一函数）。
- **数值单源**：一切裸数字（限流/限额/交互参数/动画时长）只进 constants.js CONFIG 或 server/constants.js，跨模块同语义限定额复用同一常量。
- **网安补丁并入主线**：历轮网安审计的补丁（令牌摘要、capToken 二次认证、门牌守卫、svg 黑名单、体积闸门、脱敏、安全头）都以咽喉层接口形式存在，新代码从设计之初走这些咽喉，不许另起旁路绕过。

## 缓存协议（前端）

`state.*` 缓存（allTeachers / myContracts / myDemands ...）遵循「动作后失效」：任何会改变数据的操作成功后调 `invalidate(key)`（置空对应缓存），下次读取自然重拉。红点轮询与页面读取共享同一缓存，不各拉各的。

## 上线清单

1. `node --check` 全部改过的 js；后端 `node --input-type=module --check < 文件`；`npm test`（34 用例）
2. commit + push（Git 自动部署；DNS 抽风重试 3 次/60s，不上去 `npm run deploy` 兜底）
3. curl /api/health + 版本号验证 + 改动点冒烟
4. 发版本公告（admin 令牌 → broadcast；文案走 UTF-8 文件 payload，规则见 CLAUDE.md 部署纪律）
