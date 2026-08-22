# v2 复用边界盘点

> 需求 RB（2026-08-22）：新站重写的前置分析。把 v2 代码仓库全部资产按 **A（直接复用）/ B（改造复用）/ C（丢弃）** 三档分类，供新站开发与三层工作流引用。
> 本文是**边界清单**，不是实现文档；改造点如何落具体由新站需求单驱动。
> 修订记录：RB-4 独立审计 FAIL（9 处：根 server/ 目录遗漏、路径/实体错误、reviews 归属矛盾、scripts/docs 补漏、联系方式基线描述等）→ 按 W29 重做修正版。

## 1. 判定标准

| 档 | 判定 | 迁移动作 |
|---|---|---|
| **A 直接复用** | 与业务模型无关的基础设施、方法论、接口契约；新站模型下语义不变 | 整体迁入，零改动或仅改站名/项目名 |
| **B 改造复用** | 核心数据表/业务能力，保留但需按新站模型调整（删签约、合同独立、单科目需求、联系方式永不公开） | 迁入后按新模型改造，改造点逐条列出 |
| **C 丢弃** | 与新站模型冲突的旧机制、旧前端、历史/一次性文档 | 不迁入；随 v2 收尾删除或封存 |

## 2. 总览

| 资产组 | A 直接复用 | B 改造复用 | C 丢弃 |
|---|---|---|---|
| 安全与认证咽喉 | ✅ 整体 | — | — |
| 根 server/ 基础设施 | ✅ 整体 | — | — |
| 数据层基础设施 | ✅ 整体 | — | — |
| 留档/通知/审核咽喉 | ✅ 整体 | — | — |
| 共享单源 | ✅ 整体 | region-data 按新站地区调整 | — |
| 用户体系 | ✅ users + auth 域 | — | — |
| 沟通基础设施 | ✅ conversations/messages + chat 域核心 | — | chat 域签约气泡（含 messages kind CHECK 迁移）、bindable-demands 端点 |
| 需求域 | — | ✅ student_demands + demand 域 | contracted 状态机 |
| 合同域 | — | ✅ signing_contracts → 合同独立 | signing stage/台账 |
| 教师域 | — | ✅ teacher 域（删联系方式门禁） | — |
| 评价域 | — | ✅ reviews 域（评价资格判定重定） | dbIsContracted |
| 投诉/帖子/设置/通知 | ✅ | awards 按新站定位裁剪 | — |
| 管理端 | — | ✅ admin 域按新模型裁剪 | 签约管理 |
| 匹配度 | — | — | ✅ 旧 degree 计算（大改） |
| 前端 | 设计原则（文案单源/data-action 委托/CSS 变量） | — | ✅ src/client/ 全部 + web/ 资产 |
| 测试体系 | ✅ 范式/分片/verify 脚本机制 | 测试本体按新站重写 | 旧业务测试 |
| 部署管线 | ✅ 整体 | — | — |
| 文档 | ✅ 契约/工作流/接口清单 | architecture.md 按新站改写 | 历史合规记录、v2 工作文档 |

## 3. A 类：新站地基（整体迁入）

> 迁入顺序建议：A1→A2→A3→A4→A5 先行（安全/根 server/ 基础设施/数据/留档/单源是地基），A6 业务表随后，A7/A8/A9 工具链与文档随工程推进。

### A1 安全与认证咽喉
位置：`src/server/core/{security,session,crypto,danger-ops}.js`
- X-Auth-Token 会话体系：`authUser`/`requireUser`/`requireAdmin`、role 门禁、deactivated 判定。
- 令牌 SHA-256 摘要落库，永不明文；`capToken` 二次认证（danger-ops：签发/消费/重认证）。
- 限流双路径（内存 + D1 语义一致、三振/封禁、`authRateBatch`、OTP per-IP 桶）。
- CORS/安全响应头（`SECURITY_HEADERS`）、敏感路径 404、500 回显脱敏、`fail-closed` 密钥链（无密钥拒绝写入）。
- 联系方硬脱敏、token mask。
- 复用方式：**整体照搬**。新站用户体系不变，安全模型逐字节继承。

### A2 根 server/ 基础设施
位置：根 `server/{db,secrets,version,human-check,chsi,telemetry,startup,reencrypt}.js`（注意：在仓库根 `server/`，不是 `src/server/`）
- `db.js`：数据访问兼容出口，全部 11 个域 `api.js` 共同 import 的读写入口。
- `secrets.js`：fail-closed 密钥链（只读 env，crypto/db/otp/text-audit 消费），仓库零明文密钥。
- `version.js`：版本号表 init/bump；`human-check.js`：captcha 校验 handler；`chsi.js`：Chsi（学信网）env 绑定。
- `telemetry.js`：遥测；`startup.js`：release gate（密钥完备性校验，fail-closed 全站 503 兜底）。
- `reencrypt.js`：密钥轮换分片机制（游标分片，供后续轮换复用）。
- 配套运维脚本：`scripts/reencrypt-production.sh`（cursor 续跑循环，驱动 reencrypt 轮换），随 A2 保留。
- 复用方式：**整体照搬**（新站如不涉学信网核验，`chsi.js` 可删）。

### A3 数据层基础设施
位置：`src/server/core/{db,json}.js` + `src/server/app.js`/`router.js` 编排 + 全部 `domains/*/schema.js` 的迁移机制 + `src/server/core/util.js` 响应构造
- `SCHEMA_VERSION` 门控 + bump 纪律（schema 变更与版本号同 commit，漏 bump = 迁移永不执行）。
- 幂等迁移：`CREATE IF NOT EXISTS` / `PRAGMA` 探测再 `ALTER` / `ensureColumns` 单源。
- `safeJsonArray` 反序列化单点；mapper 单点 + 出口剥私密字段 + `price` null 语义。
- 时间戳库内 UTC 契约；声明式路由（`routeApi` 零手写 if）；`error(json)/ok` 响应构造（非空错误码）。
- 复用方式：**整体照搬**。新站所有域三件套（schema/repo/api）沿用此机制。

### A4 留档 / 通知 / 审核咽喉
位置：`src/server/core/{log,notify,audit-flow,text-audit,credential,otp}.js`
- `logEvent` 留档：detail 加密、敏感键剔除、await 纪律、dropped 计数暴露缺口。
- 通知 `{type,params}` 结构化落库 + `NOTIFY_TYPES` 注册表校验（错 type/多余键拒绝写入）；notifications 表 DDL 在 `core/notify.js`。
- `text-audit` 内容审核 fail-closed（未配置/超时/网络异常 → 拒绝写入）。
- `credential`：电话/邮箱 `normalizeIdentifier` + 唯一索引；`otp`：DAILY_MAX 滚动窗口 + per-IP 限流 + 已送达即成功。
- 复用方式：**整体照搬**。新站通知/留档/审核直接使用，删除 v2 特有通知类型后重新登记注册表。

### A5 共享单源
位置：`src/shared/{config,codes,enums,region-data}.js`
- 数值/限额/限流单源 `config`；错误码非空 `codes`；状态/角色枚举 `enums`。
- `region-data`：地区数据可整体迁入，按新站省份/地区定义微调（B 档边界，默认 A 迁入）。
- 复用方式：**整体照搬**。新站继续「裸数字/裸中文零散落」禁令。

### A6 核心业务表直接复用
| 资产 | 位置 | 说明 |
|---|---|---|
| users 表 + auth 域 | `domains/auth/` 三件套 | 用户/注册/登录/OTP/设备管理/注销/管理员。新站用户体系不变 |
| conversations/messages + chat 域核心 | `domains/chat/` 三件套 | 会话 CRUD、消息轮询（data-mid/seq 去重）、附件上传净化、会话重启 reopen、结束关系 close、`/api/my-relations` 关系清单。**新站「沟通基础设施」正是这一套**。例外：`bindable-demands` 端点（签约下拉数据源）在 B2② 删除 |
| notifications 通知表 | `core/notify.js`（随 A4） | 结构化渲染 |
| complaints / posts / settings 域 | 对应三件套 | 投诉工单、资料广场、设置。语义与新站模型兼容 |

### A7 质量方法论 / 测试范式
- 验收三条件 + A1-G5 通用审计契约（已上提全项目 CLAUDE.md）。
- `test/` 分片机制（`scripts/gen-shards.mjs`/根 `run-shards.sh`）+ 变异守护方法论（G2）。
- `test/verify-*.mjs` 浏览器实机验证范式（CSP 四路拦截/captcha 像素/聊天布局几何/OTP 输入/教师档案/admin 面板）。
- `scripts/verify-staging-smoke.mjs`：真实部署产物 + Playwright 冒烟范式。
- `architecture-v2.archtest.js` 契约测试范式：新站建立自己的契约清单（结构契约 + 有牙齿断言 + 变异负例）。
- `.github/workflows/ci.yml` CI 管线。
- 复用方式：**范式整体迁移**，测试本体按新站重写（C 档）。

### A8 部署管线
| 资产 | 位置 | 说明 |
|---|---|---|
| worker 编排 | 根 `_worker.js` | 路由分发/静态回退/HTML 改写/体积闸门/SPA 回退冒充守卫 |
| 安全头 | 根 `_headers` | CSP 四源（meta/_headers/SECURITY_HEADERS/fixture 逐字一致）、immutable 资产 |
| 内容哈希资产管线 | 根 `hash-assets.mjs` + `manifest.js` | 版本化 URL + immutable |
| 构建/部署 | `scripts/build.mjs` + `scripts/deploy.sh` | dist 唯一部署对象 |
| 推送/公告 | 根 `push-retry.sh` + `announce.sh` | 无限重试后台线程、公告门控（版本探针双匹配） |
| 工具层 | `scripts/wrangler-d1.mjs`、`scripts/d1-migration-drill.mjs`、`scripts/rollback-drill.mjs`、`scripts/validate-prod-data.mjs` | 生产 D1 工具共享层、迁移/回滚演练 |
| 配置 | 根 `wrangler.toml` + 仓库外 `keepalive-worker/` | D1 绑定、保活 |

- 复用方式：**整体照搬**，改站名/项目名/D1 绑定。新站沿用「Pages + Workers + D1」模型（v2 已验证成熟）。

### A9 标准接口契约文档（新站换壳接入点）
| 资产 | 用途 |
|---|---|
| `docs/frontend-decoupling.md` | 标准业务接口清单（端点/方法/门禁/响应形状/正交判定）——新前端任意位置接入的接法 |
| `docs/interface-mapping.md` | 接口 × 页面层级映射表 |
| `docs/new-frontend-3-tier-workflow.md` | 三层并行开发工作流（模块 agent/idea/审计） |
| `docs/project-new-frontend.md` | 新前端全局基础文档（网站目的/后端架构/样式设计/基元清单） |
| `docs/delivery-workflow-design.md` | 交付工作流设计（五阶段 + 标准审计套件 + 验证深度清单） |
| `docs/architecture.md` | v2 架构契约（新站架构设计的参考基线，按新站改写） |
| `docs/新前端需求.md` | **用户主笔的新站需求文档**——新站组件契约/页面层级真源，新站开发最高优先级引用 |

## 4. B 类：改造复用

> 改造点都源于用户定案的新站模型：**删签约；合同独立、不绑需求、全字段自填；需求一科目一条；联系方式永不公开；匹配度大改。**

### B1 需求域（改造量最大）
位置：`domains/demand/` 三件套 + `src/client/core/match.js`（匹配度）
- **保留**：需求 CRUD、归属/状态门禁、`sanitizeDemand` 输入归一、`safeJsonArray` mapper、联系方式硬脱敏。
- **改造①**：需求**一科目一条**——`target_subjects` 数组列 → 单科目语义（表结构/接口/校验同步改）。
- **改造②**：删 `contracted`/`revoked` 签约状态机——需求不再被签约推进，状态收敛为 开放/关闭 之类终态。
- **改造③**：匹配度机制大改——旧 `match.js` degree 计算整体丢弃（C），按新模型重设计。

### B2 合同域（独立化）
位置：`domains/contract/` 三件套 + `signing_contracts` 表
- **保留**：合同起草/签署/撤销的门禁与版本乐观锁范式、正文加密（`encryptField`）与渲染、`versionDomainOf` 缓存失效、`rebuildFullMd` 重拼。
- **改造①**：`signing_contracts` 简化为合同独立表——删 `stage` 层级、`signing_status`、签约字段（price/schedule/method 按需并入或删除）。
- **改造②**：合同**不绑定需求、不绑定签约**——删 `demand_id` 绑定逻辑与 `bindable-demands?phase=contract` 入口（`chat/api.js` 定义、`contract/api.js` 注册路由），全字段自填。
- **改造③**：`dbIsContracted`（`reviews/repo.js`）随签约一起删除——**联系方式永不公开**。v2 基线：学生联系方式公开列表脱敏、本人可见、**签约后向对方教师披露**；教师联系方式在 `teacher/api.js` signed 后下发。一律改为永不公开，用户自行在会话中提供。
- **改造④**：`contract_ledger` 台账/存证链评估——若新站合同不涉资金，可简化为本地存证或不保留（C 档候选）。

### B3 教师域
位置：`domains/teacher/` 三件套
- **保留**：教师资料补全、学信网/录取核验（四态）、审核门禁、`mapTeacherProfileRow` 单源解密。
- **改造**：删「signed 才下发 wechat/email」门禁（`handleGetProfile` 中 `dbIsContracted` 分支）——联系方式永不公开。

### B4 评价域
位置：`domains/reviews/` 三件套
- **保留**：评价展示/状态机/显示映射（`reviewStatusMeta`）。
- **改造**：评价资格判定重定——v2 以 `dbIsContracted`（签约门槛）为发表评价的前置（`reviews/api.js` `REVIEW_CONTRACT_ONLY`）；删签约后需改以新站信任模型（如：关系活跃/沟通成立/对方真实身份）为资格依据。

### B5 管理端
位置：`domains/admin/` 三件套
- **保留**：管理员鉴权、用户/需求/评价/教师认证/内容审核/反馈单管理。
- **改造**：按新模型裁剪（删签约/合同旧管理入口，按新需求与合同域调整）。

### B6 奖学金域（按新站定位裁剪）
位置：`domains/awards/` 三件套
- 能力保留；是否随新站上线、审核流程形态由新站需求单定。

## 5. C 类：丢弃

| 资产 | 位置 | 为什么丢 |
|---|---|---|
| 全部签约链路 | chat 域 signing_request/signing_response 气泡 + contract 域发起/确认签约 + `chat.plusSigning`/`plusDraft` 相关 UI 逻辑。**含 messages 表 `kind` CHECK 约束移除**（chat/schema.js 需全表重建 + `SCHEMA_VERSION` bump） | 用户定案删除签约阶段 |
| `contracted` 需求状态机 | demand 域 + reviews 域 `dbIsContracted`（评价门槛判定一并重定，归 B4） | 需求不再被签约推进 |
| 联系方式门禁逻辑 | teacher/api.js `signed` 分支 | 联系方式永不公开 |
| 旧匹配度计算 | `src/client/core/match.js` degree 计算 | 匹配度机制大改 |
| 全部 v2 前端 | `src/client/` 全部 + `web/index.html` + `web/theme-init.js` + `web/async-css.js` + CSS 资产 + `hand-mask*.png` | 用户换壳 Vue3+Vite 重写 |
| v2 特有测试本体 | `test/*.test.js`（旧业务断言） | 随前端/业务重写，测试范式保留（A7） |
| 历史合规记录 | 网安复测报告 ×2、合同电子签署合规方案 | v2 特有历史记录，封存不进新站 |
| v2 工作文档 | `docs/backlog.md`、`docs/csp-inline-audit.md`、`docs/secrets-plan.md`、`docs/text-audit.md` | v2 专项工作/规划文档，留存 v2 仓库、不迁新站 |
| 一次性维护脚本 | `scripts/release-deactivated-creds.mjs` | 一次性存量清理，无迁移价值 |
| 旧通知类型/旧文案键 | 通知注册表 + `text.js` 中签约相关键 | 随签约/合同重塑清理 |

## 6. 新站接入指引（三层工作流衔接）

1. **地基先行**：A1→A2→A3→A4→A5 整体迁入后即获得可运行的后端骨架（健康检查/登录/留档/通知全可用）。
2. **接口帽用法**：新前端并行搭建时，对未就绪接口用接口帽组件（标「业务能力名 + 期望响应形状」，返回 dummy），接 A9 清单（`frontend-decoupling.md`/`interface-mapping.md`）找接入点。
3. **跨栈契约**：CSP 四源逐字一致、文案单源、`{type,params}` 通知结构化、域三件套——新站架构契约清单从 A7 范式重建。
4. **改造项（B 类）是唯一允许动既有代码的地方**：逐项独立基元 + 独立审计，FAIL 回滚（沿用 v2 工作流）。
5. **数据迁移**：users/conversations/messages 直接沿用（A6）；student_demands/signing_contracts 改造前先做只读校验与迁移演练（沿用 `d1-migration-drill.mjs` 模式）。删 messages kind 中签约类型需全表重建 + bump，走两阶段部署。

## 7. 风险提示

- **重写最怕丢 A 类**：安全咽喉（A1）、根 server/ 基础设施（A2）、数据层迁移机制（A3）、留档/通知/审核（A4）、单源哲学（A5）是 v2 多年踩坑沉淀的地基，必须整体迁入新站第一层，禁止「先搭起来以后再补」。
- **B 类改造严禁顺手带进 C 类残留**：删签约链路时沿上下游清干净（旧状态机/旧门禁/旧文案键/旧测试/messages kind CHECK），不留 fallback（规则 W1）。
- **C 类前端原则仍复用**：文案单源、data-action 委托、CSS 变量单源、JS 只切类——这些设计原则以新站组件契约（`docs/新前端需求.md` + ADR 0002/0003/0004）形式继承，代码本体不迁。
