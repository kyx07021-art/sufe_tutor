# v2 旧壳 award UI 死路清理评估（#104 收口批）

> 本文档是**只读评估产物**，不实施任何删除。v2 旧前端仍是生产（sufe-tutor.pages.dev 线上跑 v2），
> 新站（new-frontend）未替换。**所有 src/client 删除动作归 v2 下线扫尾，需用户定案后再执行。**
> 本文给出分步清理清单：每步的断线风险、回滚边界、执行时机（现在可安全删 / 必须等 v2 下线）。

## 1. 目的与范围

- 服务端 awards 域已由 **S6-A5** 全面下线（全部路由删除，`awards/api.js routes=[]`），
  但 v2 旧前端仍残留 award UI 引用（admin 奖项审核页 + teacher 档案奖项展示 + `AWARD_STATUS` 枚举 + 34 个 `AWARD_*` 文案键 + 若干测试）。
- 本任务盘点完整调用链、消费面与测试依赖，产出清理方案。
- **不改任何文件**，只产出本文档 + 报告。

## 2. 服务端现状（S6-A5 已下线，本任务不重复处理）

| 位置 | 状态 |
|---|---|
| `src/server/domains/awards/api.js` | `routes = []`，全部 handler（create/get/delete/adminAwards/adminAwardProof/adminAwardAction）已删 |
| `src/server/domains/awards/repo.js` / `schema.js` | 仅注释留档，`teacher_awards` 表不再创建 |
| `src/server/domains/admin/repo.js:20` | `COUNT_TABLES` 已移除 `teacher_awards` |
| `src/server/domains/teacher/repo.js` | `award_count` 子查询已删；schema 无 `award_count` 列 → mapper（:90/:153/:163）恒兜底 `0` |
| 服务端通知 | **无任何 award 通知类型字面量**（`NOTIFY_TYPES` 注册表无 `AWARD_*` 项；服务端全仓 `grep AWARD` 实证零命中）——不会再 emit `AWARD_APPROVED/REJECTED` |
| 管理统计 | `/api/admin/stats` 响应**不再含 `awardsPending`**（handler 仅返 verificationsPending/reviewsPending 等） |

## 3. 调用链盘点

### 3.1 链 A：admin 奖项审核 UI（**生产仍挂载但每个端点都 404**）

- **页面注册**：`admin/index.js:77` `registerPage({ id: 'admin-awards', …, enter: () => actions.loadAdminAwards() })` —— admin 侧边栏仍显示「奖项审核」入口。
- **页面骨架**：`shell.js:143-152` `admin-awards` page body + 状态筛选 select（消费 `AWARD_STATUS` + `AWARD_STATUS_PENDING/APPROVED/REJECTED` 三键）。
- **data-action 委托**：`admin/index.js` ACTION_MAP
  - `:19` `admin.submitAwardReject` → `doAwardAction(id,'reject')`
  - `:21` `admin.viewAwardProof` → `viewAwardProof(id)`
  - `:22` `admin.approveAward` → `approveAward(id)`
  - `:23` `admin.rejectAwardModal` → `rejectAwardModal(id)`
- **筛选 change**：`admin/index.js:98` `admin.filterAwards` → `loadAdminAwards(el.value)`
- **函数块**：`admin/actions.js:577-647`（注释 + 8 个函数）
  - `loadAdminAwards`（:580）→ `GET /api/admin/awards`（已删 → 404）
  - `awardStatusTag`（:593，非导出）→ 消费 `AWARD_STATUS`
  - `renderAdminAwardRow`（:599）→ 消费 `AWARD_STATUS` + `ADMIN_AWARD_*`/`AWARD_STATUS_*`/`AWARD_REJECTED_NOTE_PREFIX`
  - `viewAwardProof`（:619）→ `GET /api/admin/awards/:id/proof`（已删 → 404）
  - `approveAward`（:625）/ `rejectAwardModal`（:632）/ `doAwardAction`（:633）→ confirm 流程
  - `performAwardAction`（:642）→ `POST /api/admin/awards/:id/action`（已删 → 404）
- **统计行**：`admin/actions.js:64` `[TEXT.ADMIN_STAT_AWARDS_PENDING, t.awardsPending]` —— 服务端已无 `awardsPending` → 管理统计页渲染「待发奖学金 **undefined**」（**生产可见的实时小 bug**）。

### 3.2 链 B：teacher 档案奖项展示（**生产 openProfilePanel 路径仍调用，端点已删 → 静默 404 空操作**）

- **入口**：`teacher/actions.js:123` `loadAwards(userId)` 于 `openProfilePanel` 内调用。
- **函数**：`teacher/actions.js:134-140` `loadAwards` → `GET /api/teacher/awards?userId=`（已删；`catch { /* silent */ }` 吞错 → 无用户可见影响）。
- **渲染**：`teacher/render.js:100-105` `renderProfileAwardsCard`（唯一消费者 = `loadAwards`）。
- **徽章**：`teacher/render.js:36` 教师卡 `award_count` 徽章（`AWARD_SECTION_TITLE` + `AWARD_COUNT_BADGE`）——服务端恒返 0（列已删、mapper 兜底 0）→ **该分支永不为真，永不渲染**（数据级死分支）。
- **无添加奖项表单**：教师侧无任何 award 添加入口（`AWARD_ADD_BTN`/`AWARD_TITLE_LABEL` 等表单键零消费即为证据）。

### 3.3 链 C：`AWARD_STATUS` 枚举（`enums.js:341`）

- 定义：`src/shared/enums.js:341` `export const AWARD_STATUS = { PENDING, APPROVED, REJECTED }`。
- 消费点：
  - `shell.js:12` import + `:147-149`（admin-awards 筛选 select 三个 option）
  - `admin/actions.js:19` import + `:594-596`（`awardStatusTag`）+ `:612`（PENDING 按钮显隐）
- **1101 断线风险**：单独删除 `AWARD_STATUS` 会断 `shell.js` 与 `admin/actions.js` 的 import（ESM 导入缺失）。**必须与 3.1 的 admin-awards 页面代码同 commit 删除。**

### 3.4 链 D：`text.js` `AWARD_*` 文案键（共 34 个）

**零消费死键（13 个）**——`src/client` + `test` 全仓无任何引用：

| 键 | 行号 |
|---|---|
| `NOTIF_AWARD_REJECTED` | :170 |
| `AWARD_ADD_BTN` / `AWARD_TITLE_LABEL` / `AWARD_TITLE_PLACEHOLDER` | :824 / :825 / :826 |
| `AWARD_ISSUER_LABEL` / `AWARD_ISSUER_PLACEHOLDER` / `AWARD_DATE_LABEL` / `AWARD_DATE_PLACEHOLDER` | :827 / :828 / :829 / :830 |
| `AWARD_PROOF_LABEL` / `AWARD_PROOF_HINT` | :831 / :832 |
| `AWARD_SUBMITTED` / `AWARD_EMPTY` / `AWARD_DELETE_CONFIRM` | :836 / :838 / :839 |

**测试专用键（1 个）**——生产零消费，仅陈旧测试用例引用：

| 键 | 行号 | 引用 |
|---|---|---|
| `NOTIF_AWARD_APPROVED` | :169 | 仅 `test/notif-structured.test.js:132`（`notifTypeText` 经 `TEXT['NOTIF_'+type]` 动态解析字面量 `'AWARD_APPROVED'`） |

> `NOTIF_AWARD_APPROVED` 生产零消费（服务端已不 emit），删键必须与删该测试用例同 commit（见 §4）。

**有消费但仅被 award 死路引用的键（20 个）**（生产消费）：

| 键 | 行号 | 消费点 |
|---|---|---|
| `ADMIN_STAT_AWARDS_PENDING` | :579 | `admin/actions.js:64` 统计行（服务端已无字段 → 实时显示 undefined） |
| `PAGE_ADMIN_AWARDS` / `PAGE_ADMIN_AWARDS_DESC` | :629 / :630 | `shell.js:143` + `admin/index.js:77` |
| `AWARD_SECTION_TITLE` / `AWARD_COUNT_BADGE` | :823 / :837 | `teacher/render.js:36` 徽章（永不渲染） |
| `AWARD_STATUS_PENDING` / `APPROVED` / `REJECTED` | :833 / :834 / :835 | `shell.js:147-149` + `admin/actions.js:594-596` |
| `AWARD_REJECTED_NOTE_PREFIX` | :840 | `admin/actions.js:607` |
| `ADMIN_AWARD_APPROVE` / `REJECT` / `REJECT_HINT` / `REJECT_REQUIRED` / `PROOF_VIEW` / `NONE` | :842 / :843 / :844 / :845 / :846 / :847 | `admin/actions.js` award 函数块 |
| `ADMIN_AWARD_TEACHER_LABEL` / `APPROVE_CONFIRM` / `REJECT_CONFIRM` / `REJECT_PLACEHOLDER` | :854 / :856 / :857 / :858 | `admin/actions.js` award 函数块 |
| `ADMIN_AWARD_PROOF` | :1142 | `admin/actions.js:622` |

> **另注（非 `AWARD_*` 键，小写盲区）**：`MODULE_INFO['admin-awards']`（:695）是 text.js 内另一枚被 award 死路消费的键——键名小写 `admin-awards`、无 `AWARD_*` 前缀，`grep 'AWARD_'` 兜不住（与 `renderProfileAwardsCard` 同型）。消费方 `router.js:148/169` 按 `pageId` 查 `TEXT.MODULE_INFO[pageId]`，仅 admin-awards 页头 i 按钮触发；Step 4 删页后成孤儿，归入 Step 4 删除清单（Step 4 键数 17 → 18，§6 C 同步）。

## 4. 测试依赖矩阵

| 测试文件 | 依赖内容 | 删除 award 后影响 |
|---|---|---|
| `test/admin-client-actions.test.js:10` | import `renderAdminAwardRow, loadAdminAwards, viewAwardProof, approveAward, rejectAwardModal, doAwardAction`；U-3d 用例 :466-575（8 个用例，:466/:477/:489/:503/:523/:537/:554/:565） | 删函数 → import 1101 断全文件；**须删 import 子项 + U-3d 用例**（其余 import 保留） |
| `test/admin-panel-registry.test.js:16,54,66` | `'admin-awards'` 在 `ADMIN_MANAGEMENT_PAGES` 页表 + U-2 enter 链路 `['admin-awards', actions.loadAdminAwards]`（:66） | 删页 + 函数 → 断言红；**须同步删页表项 + loader pair** |
| `test/admin-pages-registry.test.js:27` | `'admin-awards'` 在 `EXPECTED` 页表（含 `enter` 必须为函数断言） | 删页 → 断言红；**须同步删页表项** |
| `test/cache-invalidate-guard.test.js:19-20` | import `performAwardAction`（与 `performVerifAction` 同行）→ Q-3b-F3b/F3c 用例（:90-110） | 删函数 → import 1101 断全文件；**须删 `performAwardAction` import + F3b/F3c 用例**；**`performVerifAction` + F3d/F3e 保留**（核验域非 award） |
| `test/notif-structured.test.js:132` | `['AWARD_APPROVED', { title: '数学竞赛' }, '你的荣誉奖项「数学竞赛」已通过审核，将展示在你的教师主页。']` 用例（`notifBodyText` → `notifTypeText` 经 `TEXT['NOTIF_'+type]` 解析；期望值为硬编码字符串） | 删 `NOTIF_AWARD_APPROVED` 键 → 该用例断言红（未知类型返回空串）；**须同步删该用例** |
| `test/audit-flow.test.js:44` + `test/s0-18-audit-flow.test.js:206` | `isContentWrite('/api/teacher/awards','POST') === false`（锁死前缀为「非内容写」） | **不受影响**——锁定的是服务端 audit 前缀，与前端 award 代码无关，保留 |
| `test/verify-admin-panel.mjs:29` | PAGES 数组含 `['admin-awards', 'admin-awards-list']`（生产实机验证脚本，遍历全部管理页；不进 npm test glob） | 删 admin-awards 页 → 点击不存在侧栏页项必 fail；**须删该 PAGES 条目**（与 Step 4/5 同批） |
| `test/onboarding-tour.test.js:137` | fetch mock 含 `/^\/api\/teacher\/awards\?userId=/`（返 `{awards:[]}`） | **不受影响（mock 变死）**——Step 3 删 `loadAwards` 后该 mock 不再被命中，无破坏 |
| `test/css-restructure.test.js:47` | 锁 `features/teacher.css` 含 `.award-`（CSS 不在清理范围） | **不受影响**——CSS 不删；但 Step 3/5 后 `.award-badge`（teacher.css:231）成死 CSS；`admin.css:104` `.verif-admission-img, .award-proof-img` 共享选择器的 `.award-proof-img` 成死半段（规则因 `.verif-admission-img` 保留），记入 v2 下线扫尾（见 §7） |

## 5. 清理方案（分步清单）

> 按「每步一个原子变更、整块回滚不心疼」拆分（W27b）。执行时机分三档：**A=现在可安全删**（零行为变化或修复实时 bug）、**B=现在可删但触实时模板（可选，建议并 v2 下线）**、**C=必须等 v2 下线**（实时页面/侧边栏仍挂载）。

### Step 1 —— 【A，现在安全】删 13 个零消费死键 + 1 个测试专用键 + 陈旧测试用例

- `text.js`：删 `NOTIF_AWARD_REJECTED`(:170)、`NOTIF_AWARD_APPROVED`(:169，测试专用)、`AWARD_ADD_BTN`(:824)、`AWARD_TITLE_LABEL`(:825)、`AWARD_TITLE_PLACEHOLDER`(:826)、`AWARD_ISSUER_LABEL`(:827)、`AWARD_ISSUER_PLACEHOLDER`(:828)、`AWARD_DATE_LABEL`(:829)、`AWARD_DATE_PLACEHOLDER`(:830)、`AWARD_PROOF_LABEL`(:831)、`AWARD_PROOF_HINT`(:832)、`AWARD_SUBMITTED`(:836)、`AWARD_EMPTY`(:838)、`AWARD_DELETE_CONFIRM`(:839)。共 14 行。
- `test/notif-structured.test.js`：删 :132 `AWARD_APPROVED` 用例（与 `NOTIF_AWARD_APPROVED` 键同批）。
- **断线风险**：低（生产全零消费；唯一测试用例同步删）。回滚 = 还原 14 键 + 1 用例（同一 commit）。

### Step 2 —— 【A，现在安全】修 admin 统计页「待发奖学金 undefined」实时 bug

- `admin/actions.js:64`：删 `[TEXT.ADMIN_STAT_AWARDS_PENDING, t.awardsPending],` 行。
- `text.js:579`：删 `ADMIN_STAT_AWARDS_PENDING` 键。
- **断线风险**：低；行为变化 = 管理统计页去掉一行乱码（服务端已无该字段，属 bug 修复，可独立于 v2 下线执行）。回滚 = 还原行 + 键。

### Step 3 —— 【B，现在可删但触实时模板，可选】teacher 奖项展示死分支

- `teacher/actions.js:123`：删 `loadAwards(userId);` 调用；删 :134-140 `loadAwards` 函数。
- `teacher/render.js:100-105`：删 `renderProfileAwardsCard`（唯一消费者是 `loadAwards`，随之成零引用死导出）。
- `teacher/actions.js:13`：import 删 `renderProfileAwardsCard` 符号（与 renderTeacherCard/renderProfilePanel/renderProfileReviewsCard 等同行）。
- `teacher/render.js:36`：删 `award_count` 徽章三元分支；`text.js:823/837` 删 `AWARD_SECTION_TITLE`/`AWARD_COUNT_BADGE`。
- `teacher/render.js:83`：删 `#profile-awards` 死容器（`<div class="profile-awards" id="profile-awards"></div>`；唯一填充方 = 已删 `loadAwards` → actions.js:138 `document.querySelector('#modal-container .profile-awards')`）。
- **断线风险**：中——删 `render.js` 导出而不删 `teacher/actions.js:13` import 符号 → ESM import 1101（W32 第一类，import 符号缺失）。端点已删、静默 catch、徽章数据恒 0 → 行为零变化。**但** `openProfilePanel` 与教师卡模板是生产实时路径——删除会触碰实时模板；若追求最小生产 churn，可并入 Step 5 的 v2 下线批。回滚 = 还原 actions.js 调用+函数、render.js 导出+徽章分支、import 符号、render.js:83 死容器、text.js 两键。

### Step 4 —— 【C，v2 下线，原子组】admin-awards 页 + `AWARD_STATUS` + 18 个消费键

**必须同 commit**（W27b 全滚）：单独删任一环即断线。

- `admin/index.js`：删 :77 `registerPage('admin-awards')`；ACTION_MAP 删 :19/21/22/23 四条；:98 `filterAwards` 分支。
- `shell.js`：删 :143-152 `admin-awards` page body；:12 import 删 `AWARD_STATUS`。
- `admin/actions.js`：删 :577-647 award 函数块；:19 import 删 `AWARD_STATUS`。
- `enums.js:341`：删 `AWARD_STATUS`。
- `text.js`：删 `PAGE_ADMIN_AWARDS`(:629)、`PAGE_ADMIN_AWARDS_DESC`(:630)、`AWARD_STATUS_PENDING/APPROVED/REJECTED`(:833-835)、`AWARD_REJECTED_NOTE_PREFIX`(:840)、`ADMIN_AWARD_APPROVE/REJECT/REJECT_HINT/REJECT_REQUIRED/PROOF_VIEW/NONE`(:842-847)、`ADMIN_AWARD_TEACHER_LABEL`(:854)、`ADMIN_AWARD_APPROVE_CONFIRM`(:856)、`ADMIN_AWARD_REJECT_CONFIRM`(:857)、`ADMIN_AWARD_REJECT_PLACEHOLDER`(:858)、`ADMIN_AWARD_PROOF`(:1142)、`MODULE_INFO['admin-awards']`(:695，小写键、无 `AWARD_` 前缀，`grep 'AWARD_'` 兜不住——router.js:148/169 按 pageId 查 `TEXT.MODULE_INFO[pageId]`，仅 admin-awards 页头 i 按钮触发，删页后成孤儿)。共 18 键。
- **断线风险**：中间态不可运行（`AWARD_STATUS` 独立删 → shell/admin import 1101；页在而枚举无 → 模板红）。**行为变化**：admin 侧边栏移除「奖项审核」入口（该页当前点入即 404，属已坏页面移除，产品决策归 v2 下线）。回滚 = 整组还原。

### Step 5 —— 【C，v2 下线】测试同步（与 Step 4 同批）

- `test/admin-client-actions.test.js`：:10 import 删 6 个 award 函数；删 U-3d 用例块（:466-575）。
- `test/admin-panel-registry.test.js`：`ADMIN_MANAGEMENT_PAGES` 删 `'admin-awards'`（:16）；U-2 enter 链路页表删 `'admin-awards'`（:54）；loader pair 删 `['admin-awards', actions.loadAdminAwards]`（:66）。
- `test/admin-pages-registry.test.js`：`EXPECTED` 删 `'admin-awards'`（:27）。
- `test/cache-invalidate-guard.test.js`：:19-20 import 删 `performAwardAction`（保留 `performVerifAction`）；删 Q-3b-F3b/F3c 用例（:90-110，保留 F3d/F3e）。
- `test/verify-admin-panel.mjs`：:29 PAGES 数组删 `['admin-awards', 'admin-awards-list']`（生产实机验证脚本，删页后不删条目则点击不存在侧栏页项必 fail）。
- **断线风险**：若 Step 4 先删函数而本步未同步，import 1101 断测试（verify-admin-panel 则为侧栏页项缺失 fail）。**必须与 Step 4 同一 commit**。

## 6. 分类汇总

| 分类 | 内容 | 理由 |
|---|---|---|
| **A · 现在可安全删**（零行为变化 / 修实时 bug） | 13 个零消费死键 + `NOTIF_AWARD_APPROVED`（test-only，随 notif-structured 测试用例同删）；admin 统计「待发奖学金」行 + 键 | 生产零消费 / 服务端字段已删、删即修「undefined」显示 bug |
| **B · 现在可删但触实时模板（可选，建议并 v2 下线）** | teacher `loadAwards` 调用+函数、`renderProfileAwardsCard`、`award_count` 徽章分支 + `AWARD_SECTION_TITLE`/`AWARD_COUNT_BADGE` | 端点已删、徽章恒不渲染 → 行为零变化；但触碰生产实时模板，最小 churn 则延迟 |
| **C · 必须等 v2 下线（原子组）** | admin-awards 页（注册/骨架/委托/筛选）+ 8 个 award 函数 + `AWARD_STATUS` 枚举 + 18 个消费键（另 3 个消费键分别在 Step 2/3）+ 4 个测试文件 + `verify-admin-panel.mjs` 脚本同步 | 页面仍挂载于 admin 侧边栏（点入 404 的已坏页）；删除是产品决策；`AWARD_STATUS` 有 1101 import 约束，必须整组同滚 |

**关键约束**：`AWARD_STATUS` 与 admin-awards 页代码是**强耦合**（shell + admin/actions 两处 import）；任何一步删它而不同步删消费方即触发 ESM import 1101。Step 4+5 必须作为单一原子 commit 执行。

## 7. 验证清单（执行时）

- [ ] 全量测试绿（含同步后的 4 个测试文件 + notif-structured）。
- [ ] `npm run test:arch:v2` 绿（契约 6 等不受影响；admin feature `onLoad` 契约若断言页数需同步调整）。
- [ ] 全仓 `grep AWARD_STATUS` 零命中（enums/shell/admin 三方同清）。
- [ ] 全仓 `grep 'award_count'` 仅剩 `teacher/repo.js` mapper 兜底（或连兜底一并清理，属服务端，另行定案）。
- [ ] 全仓 `grep 'AWARD_' src/client` 零命中（34 键全清）。
- [ ] 全仓 `grep 'renderProfileAwardsCard' src/client` 零命中（Step 3 删 import 符号 + render.js 导出；兜混合大小写盲区——`grep 'AWARD_'` 大小写敏感查不到此混合大小写符号）。
- [ ] 全仓 `grep 'admin-awards' src/client` 零命中（覆盖 shell 页体 / admin/index 页注册 / admin/actions 容器 id / text.js `MODULE_INFO` 键全链路）。
- [ ] 全仓 `grep 'profile-awards' src/client` 零命中（Step 3 删 render.js:83 死容器后）。
- [ ] 留意小写 `.award-` CSS 类（`features/teacher.css` 的 `.award-*` 规则 + `admin.css:104` `.award-proof-img` 死半段）——CSS 不在清理范围不删，但 Step 3/5 后成死 CSS，记入 v2 下线扫尾。
- [ ] `test/verify-admin-panel.mjs`（PAGES 已删 admin-awards 条目后）生产实机遍历余 12 管理页全绿。
- [ ] `test/audit-flow.test.js` + `test/s0-18-audit-flow.test.js` 保持绿（锁定服务端死前缀，与前端清理无关）。
- [ ] 陈旧注释清理（Step 3/4 后）：`admin/actions.js:2`（模块描述删 `awards`）、`admin/actions.js:420`（删 `performAwardAction/` 引述，保留 `performVerifAction`）、`admin/index.js:20`（U-3d award ACTION_MAP 注释随块删）、`admin/index.js:93`（change 委托注释删「U-3d: admin awards status filter」子句）。
- [ ] build + hash-assets 无漂移（P17）。

## 8. 参考

- 服务端下线源：`src/server/domains/awards/api.js`（S6-A5 注释）。
- 新站定位：`docs/v2-reuse-boundary.md`（awards 按新站定位裁剪；`domains/awards/` 三件套）。
- 新前端无 award 荣誉奖项系统（`new-frontend` 的 `awards` 字段是 B2 科目获奖文本，非本系统，勿混淆）。
