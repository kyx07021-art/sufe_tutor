# 架构 v2 目标与任务单

> 本文件是本轮架构重构的独立任务单，不并入 CLAUDE.md（那里是另一个 agent 的在手任务）。
> 原则：第一性原理设计，允许大刀阔斧重写；每一步以「全量测试绿 + 生产可用」为边界，不保留向后兼容。

## 0. 第一性原理结论（目标形态）

- **不引入框架，不引入运行时依赖**。前端用原生 ES Modules + 动态 import；后端继续 Cloudflare Pages Worker + D1。
- **引入一个极薄的构建步骤**（esbuild：worker 单文件打包 + 前端 ESM code-splitting + 资产哈希），产出 `dist/`，部署对象永远是 `dist/`。源码不再随部署包上传，也根除「敏感目录黑名单」这类补救型设计。
- **接口契约由结构保证，不靠人记**：路由声明表、错误码、通知结构、schema 注册表、事件动作注册表，五类契约集中且可测试。
- **用户可见文案只活在客户端**；服务端只回 `{ code, params }` 错误码和结构化通知，客户端负责渲染中文。服务端不再 import 客户端常量文件制造副作用。
- **每个业务域自持**：域 = `schema.js`（表/迁移）+ `repo.js`（SQL/映射）+ `api.js`（HTTP handler）。SQL 只出现在 repo，mapper 是序列化唯一出口。
- **前端每个功能域自持**：域 = 页面描述 + 渲染器 + 动作处理器，经统一 registry 挂载；事件一律委托，禁内联 `onclick` / 内联 style。
- **所有 fail-open / mock / 内测直通清空**；缺配置即启动失败或拒绝请求（fail-closed）。

### 目标目录

```
代码仓库/
  src/
    shared/
      codes.js          # 错误码 + 结构化通知类型（唯一共享契约）
      enums.js          # STATUS / 业务枚举 id
      config.js         # 跨栈数值配置（限额、TTL、断点、轮询等）
    server/
      entry.js          # worker default export（只做装配，不含路由）
      app.js            # 声明式路由表 + 域注册
      router.js         # 路径参数匹配 / 方法分发（唯一实现）
      http.js           # parseBody/json/error/安全头/CORS（唯一实现）
      core/
        security.js     # authUser/requireUser/rateGate
        crypto.js       # 哈希/摘要/AES/密钥派生
        session.js      # 令牌签发/会话
        db.js           # D1 连接 + 迁移编排（无业务 SQL）
        log.js          # 留档
        notify.js       # 结构化通知
        audit.js        # 内容审核咽喉
        telemetry.js    # 观测指标聚合
      domains/
        auth/            # schema.js + repo.js + api.js
        teacher/
        demand/
        chat/
        contract/
        admin/
        posts/
        complaints/
        reviews/
        awards/
        settings/
    client/
      app.js             # 唯一入口：装配 core + 注册 features
      core/
        router.js        # 视图切换/页面注册
        state.js         # 唯一状态 store + 缓存协议
        api.js           # 唯一 fetch 封装
        dom.js           # escHtml/事件委托/组件壳
        ui.js            # modal/toast/加载/表单原语
        anim.js          # 动画钩子（只切 class）
        datahub.js       # 会话数据层
        onboard.js       # 新手引导
      features/
        auth/            # index.js + render.js + actions.js + text.js（超 300 行再拆）
        teacher/
        student/
        chat/
        contract/
        admin/
        posts/
        complaints/
        region/
        settings/
      constants/
        text.js          # 全部用户可见文案（唯一）
        region-data.js   # 地区/政策数据（唯一）
      styles/
        tokens.css       # 设计令牌
        base.css         # reset/排版/通用组件
        features/*.css   # 每域一文件
  web/
    index.html           # 唯一 HTML：一个 module 入口 + 静态壳
    assets/              # 图片/字体
  test/                  # node:test（架构测试 + 单测 + jsdom/Playwright 冒烟）
  scripts/
    build.mjs            # esbuild 构建 + 资产哈希 + manifest
    deploy.sh            # build → dist → wrangler pages deploy dist
  docs/adr/              # 架构决策记录（取代代码里的历史日志注释）
  dist/                  # 构建产物（唯一部署对象）
```

## 任务单

### P0 基线冻结与目标规格

- **P0-1 冻结基线**
  - 操作对象：`代码仓库` git 仓库、`test/*.test.js`、`manifest.js`。
  - 期望改写方式：等其他 agent 的工作树收口 commit 后，全量测试转绿，打 tag `v2-baseline`；此后架构重构只在独立分支进行，每完成一条任务合入一次，禁止与 R4 半成品混在同一 commit。

- **P0-2 建立 ADR 与架构规格**
  - 操作对象：新增 `docs/adr/0001-architecture-v2.md`、`docs/adr/README.md`；重写 `docs/architecture.md`。
  - 期望改写方式：把目标目录、依赖方向（`features → core → shared`；`domains → core → shared`）、五类契约、文件拆分阈值（如单文件 >300 行必须拆）、错误处理口径写成规范；旧文档只留「现状记录」，标记 v1 历史，不作为现行规则。

- **P0-3 建立构建与部署管线**
  - 操作对象：新增 `scripts/build.mjs`、`scripts/deploy.sh`；改造 `hash-assets.mjs` 的职责；`wrangler.toml`/`package.json`。
  - 期望改写方式：esbuild 把 `src/server/entry.js` 打成单文件 `dist/_worker.js`；前端 `src/client/app.js` 以 `--splitting --format=esm` 产出哈希 chunk；CSS/静态资源复制并哈希；`index.html` 引用构建产物；`npm run deploy` = build + `wrangler pages deploy dist`。删除「worker 改写 HTML 引用」「黑名单防源码外泄」等补救逻辑的职责，源码不再进 dist。

- **P0-4 架构契约测试先于重构**
  - 操作对象：新增 `test/architecture.test.js`。
  - 期望改写方式：可执行断言：`router` 以外禁止出现 `p === '/api/...'` 路由判断；`repo.js` 以外禁止 `db.prepare/db.batch`；`api.js` 以外禁止 `fetch(`；前端 `features/*` 禁内联 `onclick`/`style=`；文案模块以外禁止中文字面量；`_worker.js`/`entry.js` 不 import 业务域实现。测试先落红，重构过程中逐条变绿。

### P1 后端模块化

- **P1-1 常量拆分**
  - 操作对象：根 `constants.js`（约 2142 行）、`server/constants.js`（约 348 行）、全部 `import '../constants.js'` 副作用消费点。
  - 期望改写方式：
    1. `src/shared/config.js`：跨栈数值（TTL/限额/断点/轮询）唯一源。
    2. `src/shared/enums.js`：STATUS 与业务枚举 id 唯一源。
    3. `src/shared/codes.js`：错误码与通知类型唯一源。
    4. 服务端不再 `globalThis.APP_CONSTANTS` 副作用注入，改显式 import；删除服务端里的用户可见中文，只回 `code`。
    5. 客户端文案在 P2 阶段迁入 `src/client/constants/text.js`；过渡期内客户端文案仍由旧文件承担，但服务端先解耦。

- **P1-2 声明式路由表**
  - 操作对象：`_worker.js`（590 行，72 条 if 路由）、`server/routes-*.js`。
  - 期望改写方式：新增 `src/server/router.js`，路由声明为 `{ method, path, handler, auth, rate, cache }[]`，path 支持 `/:id`；域模块 export 自己的 `routes` 数组，`src/server/app.js` 汇总；`_worker.js` 最终只剩 fetch 装配：解析 → 限流 → 路由 → 留档。删除 `idMatch` 及所有手写正则匹配。

- **P1-3 抽出核心咽喉**
  - 操作对象：`server/util.js`、`server/security.js`、`server/crypto.js`、`server/session.js`、`server/log.js`、`server/notify.js`、`server/audit-flow.js`、`server/text-audit.js`、`server/danger-ops.js`、`server/credential.js`、`server/otp.js`。
  - 期望改写方式：归入 `src/server/core/`，每个文件只 export 明确的公共 API；内部实现收敛单点。删除 `audit-flow` 的 dummy/随机驳回残留接口，只保留 L1 确定性门牌审核 + 可配置 L2（P3 再定 fail-closed 语义）。

- **P1-4 db.js 按域拆分**
  - 操作对象：`server/db.js`（2189 行，33 处 CREATE TABLE、21 处 ensureColumns）。
  - 期望改写方式：拆成 `src/server/domains/<域>/schema.js` + `repo.js`。域清单：auth（users/sessions/invites/credentials/otp）、teacher（profiles/verifications/reviews）、demand（demands/intents/pushes）、chat（conversations/messages/uploads）、contract（contracts/ledger/signing）、admin（feedbacks/logs/rate_limits/metrics）、posts、complaints、awards、settings/notifications。`core/db.js` 只做迁移编排：收集所有域 schema → 版本化迁移 → 幂等加列；业务 SQL 与 mapper 全部下沉域 repo。

- **P1-5 后端测试适配**
  - 操作对象：全部 `test/*.test.js` 中直接 import `server/db.js` 或路由文件的用例。
  - 期望改写方式：测试改走 `src/server/app.js` 的 `routeApi` 与域 repo 出口；迁移测试验证每个域的 schema 注册与幂等；旧路径 import 全部删除。全量测试与生产冒烟必须与重构前行为一致。

### P2 前端去经典脚本化

- **P2-1 单入口 + 动态 import**
  - 操作对象：`index.html`（981 行脚本装载）、`app-shell.js`（域脚本懒加载）、`app-datahub.js`。
  - 期望改写方式：`index.html` 只留 `web/index.html` 壳 + `<script type="module" src="/app.js">`；`app.js` 按页面动态 `import()` 对应 feature；删除 `loadInto` 脚本标签注入、DOMContentLoaded 时序补偿、`DOMAIN_FILES`/重试装载器等「加载顺序工程」。

- **P2-2 核心层显式化**
  - 操作对象：`app-state.js`、`app-api.js`、`app-ui.js`、`app-anim.js`、`app-onboard.js`、`app-display.js`。
  - 期望改写方式：重写为 `src/client/core/*.js` ESM 模块，export 明确 API；`app-display` 纯函数并入各 feature 的 `display.js` 或保留共享 `core/display.js`（凡两个域共用才放 core）。删除全局变量依赖，所有状态经 `core/state.js`。

- **P2-3 功能域模块化**
  - 操作对象：`app-demands.js`（1522 行）、`app-teachers.js`、`app-pages.js`、`app-chat.js`、`app-contracts.js`、`app-admin.js`、`app-posts.js`、`app-region.js`、`app-complaints.js`、`app-auth.js`、`app-otp.js`、`app-captcha.js`。
  - 期望改写方式：每个域按「页面描述 / 渲染器 / 动作处理 / 域文案」拆成 ≤300 行的文件，通过 registry 注册；渲染只产出 DOM 或安全模板字符串（全部经 escHtml），不产出带 inline handler/style 的字符串。动作统一 `data-action="域.动作"` 由根容器事件委托分发。

- **P2-4 文案与数据单源**
  - 操作对象：`constants.js` UI 块、`region-data.js`、`app-display.js`。
  - 期望改写方式：`src/client/constants/text.js` 按域分节存全部用户可见文案；`region-data.js` 迁 `src/client/constants/region-data.js`；所有枚举显示映射只在 feature 的 `display.js` 出现一次。服务端通知改为 `{ type, params }`，客户端按 type 渲染。

- **P2-5 CSS 重组**
  - 操作对象：`style.css`（2536 行）、`style-chat.css`、`style-posts.css`、`style-region.css`、`glass.css`。
  - 期望改写方式：先抽 `tokens.css`（颜色/圆角/阴影/间距/字号），再按 feature 分文件；保留「JS 只切 class、动画只在 CSS」铁律；删除为旧 inline handler 服务的状态 class 冗余。

- **P2-6 前端测试重构**
  - 操作对象：所有 jsdom 经典脚本装载测试、Playwright 冒烟、`test/lazy-load.test.js`、`test/refresh-restore.test.js` 等时序型测试。
  - 期望改写方式：改为直接 import feature 模块测试渲染与动作；时序测试升级为「动态 import 成功后挂载」断言；保留 Playwright 真实浏览器冒烟覆盖关键路径（登录、教师列表、需求发布、聊天、合同、管理端）。

### P3 安全收口（与 P2 完成顺序耦合，CSP 需等 P2）

- **P3-1 清空 mock / fail-open / 内测直通**
  - 操作对象：`server/chsi.js`（mock 直通 approved、thirdparty 未配置直通 approved）、`server/audit-flow.js`（300ms fail-open）、`server/text-audit.js`（L2 未配置跳过）、`server/secrets.js`（内测明文回落）、`server/db.js` 的 `provider DEFAULT 'mock'` 与种子管理员、`app-auth.js`/`app-pages.js` 的「模拟核验」前端分支。
  - 期望改写方式：chsi 只保留 `manual` 真实路径（第三方 API 未签约就不存在 thirdparty 分支）；审核 L2 未配置时明确返回「服务未配置」并拒绝写入，超时即拒绝，不做预算内放行；密钥只从 Worker Secrets 读取，缺任何必需密钥启动自检直接失败；数据库默认 provider 改为 `manual`；管理员初始凭据改为首次部署一次性生成/强制轮换。

- **P3-2 CSP / CORS / 事件注入面**
  - 操作对象：`server/constants.js` 安全头、`_headers`、`src/server/core/http.js`。
  - 期望改写方式：CSP 去掉 `script-src 'unsafe-inline'` 与 `style-src 'unsafe-inline'`（P2 完成后才有条件）；CORS 改白名单域 + 显式方法，不再 `*`；所有 HTML 模板继续强 escHtml，事件全部走委托。上线前用 Playwright 做一次「注入 payload 不执行」回归。

- **P3-3 密钥轮换与密文重加密**
  - 操作对象：`server/crypto.js`、`server/db.js` 加解密调用、D1 存量密文。
  - 期望改写方式：新增一次性重加密任务（admin 触发或构建期脚本）：读旧 `FIELD_ENC_KEY/LOG_ENCRYPT_KEY` → 解密 → 新密钥加密 → 原子换列；完成后废弃旧密钥并删除仓库内明文 `APP_SECRETS`。写路径保持 fail-closed，读路径对轮换窗口做两钥重试。

- **P3-4 生产 Release Gate**
  - 操作对象：新增 `src/server/core/startup.js`，`/api/health` 扩展 readiness。
  - 期望改写方式：启动自检：必需 Secrets 齐全、无 mock provider、管理员默认口令已轮换、审计 L2 配置满足生产策略、邀请码门控按公测状态正确；未通过则部署/健康检查显式失败。发布脚本在 deploy 后调用 readiness，不绿不允许发公告。

- **P3-5 安全复审**
  - 操作对象：上一轮授权测试报告对应的全部整改项。
  - 期望改写方式：重构完成后跑一轮外部授权渗透复测；报告输出到 `docs/`，发现项按「契约缺失」归类回填 ADR 和架构测试。

### P4 管理员观测面板

- **P4-1 指标数据层**
  - 操作对象：`server/log.js`、`server/db.js` 留档表、新增 `src/server/domains/admin/telemetry.js`。
  - 期望改写方式：logRequest 同时聚合写入指标表（按 5 分钟桶：请求量、状态码分布、慢请求、限流命中、按域/按 IP 汇聚），原始明细继续加密留档；D1 读负载低，管理员查询走聚合表而非扫明细。

- **P4-2 观测 API**
  - 操作对象：`server/routes-admin.js` 的 stats/traffic/logs。
  - 期望改写方式：新增 `/api/admin/dashboard` 一次返回 KPI + 24h 趋势 + 待办队列计数 + 异常事件摘要；旧 stats/traffic 接口合并或删除，管理端只消费 dashboard + 按需明细。

- **P4-3 面板 UI**
  - 操作对象：`app-admin.js` 待办页、新增 `src/client/features/admin/dashboard.js`。
  - 期望改写方式：信息密度按「先看结论、再看异常、需要才钻明细」三层呈现；KPI 卡、趋势线、待办队列、日志异常列表分区；所有数值带同环比/阈值标色；删除平铺大表默认视图。样式走 `features/admin.css`。

### P5 注释与文档清洗

- **P5-1 历史注释 → ADR**
  - 操作对象：全仓「v0.x/v1.x 修复」「生产实证」「审计 N-xx」等历史叙述注释。
  - 期望改写方式：逐文件清扫，历史事件只留 ADR 条目（编号 + 结论 + 契约影响），代码注释只保留「为什么这样写 / 违反直觉的警示」。CLAUDE.md 同步瘦身为现行规则集。

- **P5-2 契约文档化**
  - 操作对象：`docs/architecture.md`、`docs/design-principles.md`。
  - 期望改写方式：只描述现行结构、接口、依赖方向和「怎么加一个功能」，删除 v1 演进叙述；与 `test/architecture.test.js` 一一对应，文档写什么测试就验什么。

### P6 发布切换

- **P6-1 全量回归 + 存量数据校验**
  - 操作对象：全量测试、生产 D1 副本、QA 账户。
  - 期望改写方式：全测试绿；在 D1 副本上跑迁移和重加密演练；QA 学生/教师走完注册、验证、发需求、聊天、签约、评价、投诉全链路；admin 走完审核、广播、日志、设备管理。

- **P6-2 发布与回滚**
  - 操作对象：`scripts/deploy.sh`、域名与 D1 绑定、公告流程。
  - 期望改写方式：先发 staging 域名冒烟，再切生产；保留上一个 dist 版本和 D1 备份，失败一键回滚旧 dist + 回滚迁移；发布后按现行规则做健康检查、反馈巡检和公告。

## 依赖顺序（关键路径）

```
P0（基线/规格/构建）
  → P1（后端域化）
  → P2（前端模块化，P2-3 完成前 P3-2 不能落地）
  → P3（安全收口）
  → P4（观测面板）
  → P5（文档清洗）
  → P6（发布切换）
```

P3-1 的 mock/fail-open 清除不依赖前端，可在 P1 完成后先行；P3-2 必须等 P2-3/P2-4 完成（否则删 unsafe-inline 会白屏）。
