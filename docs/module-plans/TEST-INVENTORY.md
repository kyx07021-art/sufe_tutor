# v2 测试资产盘点与新站测试策略（2026-08-22）

> 用户询问「原测试哪些能用/哪些过时/需哪些新测试」→ 实证盘点。基线：new-site 分支 node --test 1180/1180 全绿（31s）+ archtest 11 契约。

## 0. 盘点基线
- **196 个文件** = 193 `*.test.js` + 3 helper（`_css.js`/`_otp-stub.js`/`_test-secrets.js`）+ `architecture-v2.archtest.js`（11 契约）+ 6 个 `verify-*.mjs` 实机脚本 + 2 个 HTML fixture（captcha/csp-payload）。
- 运行器：`node --test "test/*.test.js"`（node 内置 runner，无 jest/vitest）；前端 v2 测试 = 直接 import ESM 渲染函数 + jsdom。

## 1. 三档分类（按新站模块映射）

### A 类直接复用（~35 文件，随 S0-S1 搬运原样走）
| 归属 | 测试文件 | 说明 |
|---|---|---|
| S0 | security/rategate/session/crypto/secrets/startup/danger-ops/json/parse/initdb/schema-meta/version/telemetry/cache | 安全咽喉+数据层机制，纯后端零前端依赖 |
| S0 | log/notif/otp/audit/text-audit/human(captcha 服务端)/reencrypt | 留档/通知/审核咽喉（otp 随 S1） |
| S0 | worker-static/hash-build/csp-strict/architecture(archtest) | 工具链/部署/CSP——**hash-build 随 hash-assets 删除改造**，csp-strict 四源锁保留 |
| S1 | auth/register/deactivate/avatar/profile/credential | 认证域搬运 |

### B 类改造复用（~50-60 文件，随域 B 类精简重写）
| 归属 | 测试文件 | 改造点 |
|---|---|---|
| S2 | chat×12 / conversation×3 | 搬运保留 + **删 signing 气泡**；临时会话全新测试 |
| S3 | demand×5 / subject / grade / region / address / price / browse | **单科目重写**（v2 数组模型）；删 intents/pushes/greeting |
| S4 | teacher×5 / match×2 / gaokao / chsi / rating / score / profile | 改造 + **匹配度全新测试**；删 signed 门禁断言 |
| S5 | contract×8 + contract-*（chain/ledger/revoked-rebuild/sentinel-parity/sign-compliance/sign-hardening） | **独立化改造**；存证链/乐观锁保留 |
| S6 | admin×8 / complaints / complaint / posts / reviews / review / settings(非 privacy) | 搬运改造；评价资格重定 |
| 工具链 | api×4 / build / v1-route-contract | api 契约**改新路由表**；v1 契约过时 |

### C 类废弃/重写（~60-70 文件）
| 原因 | 文件 | 处置 |
|---|---|---|
| 签约删除 | signing×5 + contract-signing-busy/sign-ui | 删除（S5 独立化已删签约） |
| awards 下线 | awards.test.js | 删除 |
| privacy 删除 | privacy-settings×2 | 删除（无访客浏览） |
| 访客面删除 | auth-guest-regression（访客浏览面） | 删访客断言，登录门禁保留 |
| **新前端换架构** | **49 个 v2 前端渲染/交互测试**（client/ui/modal/onboard/component/overlay/scrollbar/style/design/entry/filter/orb/chart/captcha/countdown/confirm/toast/refresh/initial/boot/my/form/tag/page/platform） | **测试本体废弃**（Vue 3 完全换架构）；**行为契约作新测试规格参考**（交互语义/被拦路径/几何断言） |
| 实机脚本重写 | verify-csp-strict / verify-captcha-render / verify-otp-input / verify-chat-layout / verify-teacher-profile | 统一重写为 **verify-staging-smoke 范式**（S0-25）；captcha 滑块像素验证经验保留 |

## 2. 新测试需求（按基元清单对齐）
| 模块 | 新测试 | 对应基元 |
|---|---|---|
| S0 | 新站 archtest 契约骨架（结构/CSP 四源/零裸值，变异负例） | S0-26 |
| S0 | NOTIFY_TYPES 契约校验变异（错 type/多余键拒写） | S0-15 |
| S2 | **临时会话状态机全链路**（init→sent→formal/配额/结束回归路人/负用例/变异） | S2-T8 |
| S3 | 单科目 CRUD/sanitize/门禁重写 + 迁移演练 | S3-16/17/18 |
| S4 | **匹配度 5 维度**（科目/方式/地区/报价/偏好权重、归一、聚合、null 语义、变异） | S4-13..20 |
| S5 | 合同独立化状态机/存证链改造（去签约断言） | S5-20 |
| S6 | 评价资格三条件（会话+往来+核验）/ 通知屏蔽偏好 | S6-R3/S6-S4 |
| 前端 | **Vue 3 组件测试框架**（决策点见 §3）+ M0 组件库动效/几何 + 各模块交互（对接 v2 行为契约） | M0-M9 |
| E2E | verify-staging-smoke 新站版（真实部署 health/登录/留档/通知全链路） | S0-25 |

## 3. 测试框架（2026-08-22 定案）
- **后端**：沿用 `node --test`（v2 零依赖零迁移成本；新站 shared/core 仍原生 ESM）。
- **前端（定案）**：**`node --test` + Playwright 实机**（M0 已验证模式：4 个 smoke-*.mjs 跑 Vite dev server/preview + 真实浏览器断言几何/交互/被拦路径 + CSP 生产验证）。**不引入 Vitest/jsdom**——jsdom 单元测试掩盖渲染缺陷（Q-6 教训：Playwright 自动滚动掩盖几何），Vue SFC 交互靠真实浏览器验证；纯函数/composable 逻辑用 node --test 直测。E2E 走 verify-staging-smoke 范式（S0-25）。
- **审查纪律**：每基元独立审计（含测试审查）+ G2 变异守护（还原修复→断言红）+ 被拦路径负用例 + 双 viewport 几何断言（G5）+ 对抗性验证（W43）。测试本身在审计范围（Q-6 教训：Playwright 自动滚动掩盖几何缺陷/断言只验 DOM 存在不验渲染）。

## 4. 执行机制
- 阶段三每个域基元接手时，先按本盘点对账该域测试（B 类改造/C 类删），再写新测试。
- 全量测试绿是每基元验收硬门槛（验收三条件·功能正常）。
