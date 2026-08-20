# ADR 0003 — 新前端认证与路由横切面设计

- 状态：**已接受**（2026-08-21，用户授权主会话自主定案）
- 前置：ADR 0001（架构 v2）、ADR 0002（Vue 3 + Vite）、需求 T 解耦度报告（docs/frontend-decoupling.md，标准业务接口清单）
- 范围：新前端（经世知途·信息门户平台）的认证流 + 路由系统横切面设计。**与后端契约逐条一致**（下表全部接口见 T-5 报告 §1）。

---

## 1. 认证流设计

### 1.1 令牌生命周期

后端契约（真源）：
- 登录：`POST /api/auth/login`（密码）/ `POST /api/auth/login/code`（验证码）→ `{ user, authToken }`。登录前探测 `GET /api/auth/check?identifier=` → `{exists, role}`。
- 注册：`POST /api/auth/register` → `{ user, authToken }`（学生单表单 / 教师三步向导 + 邀请码 `POST /api/auth/check-invite`）。
- 会话验证：`GET /api/auth/me` → `{ user }`（角色恢复）。
- 身份：所有业务接口经 `X-Auth-Token` 请求头（api() 单点注入）；401 = 令牌失效/缺失。

**设计**：
1. **登录成功** → 令牌 + user 存入认证状态（`authStore`），随后：
   - 主存 `sessionStorage`（当前标签会话）；
   - 用户勾选「记住我」→ 追加 `localStorage` + `expires = now + CONFIG.TOKEN_TTL_MS`（令牌自身仍可能被服务端注销，本地过期仅是兜底清理）。
2. **会话恢复（启动/刷新）** → 依次读 `localStorage`（未过期）→ `sessionStorage` → 有令牌则 `GET /api/auth/me` 验证 → 按 `user.role` 进入角色客户端；`/api/auth/me` 401 → 清态回落地页。
3. **登出** → `POST /api/auth/logout`（幂等，无令牌也返 ok）+ 清本地双存储 + 重置全局状态。
4. **会话过期路径**：令牌被 `revoke`/注销/超时 → 任一 API 401 → **统一 401 兜底**（见 1.3）。

### 1.2 角色路由（登录门禁）

角色字面量共享单源 `ROLES = { STUDENT, TEACHER, ADMIN }`（src/shared/enums.js，契约 4 合法复用）。新前端页面注册表：

| 角色 | 可进入 |
|---|---|
| 访客（无令牌） | 0 落地页 + 浏览公开列表（教师广场/需求大厅/帖子，公开接口 authUser 放行） |
| student | A 客户端（教师广场/我的需求/关系管理）+ AB 共用 |
| teacher | B 客户端（需求广场/我的信息/资料广场）+ AB 共用 |
| admin | 管理端 11 模块 + AB 共用（角色独立客户端） |

页面级门禁在路由守卫统一执行（未登录访问受保护页 → 弹登录视图，不整页跳转）。

### 1.3 401 兜底（唯一入口）

任何 API 401（含 `/api/batch` 子请求）→ 单点 `handleDeadToken()`：
1. 清本地双存储 + 认证状态（防陈旧 UI 停留）；
2. 执行登出清理（停止轮询/定时器/监听器）；
3. 视图切回登录/落地页 + 提示「登录已过期」。

**这是唯一登录判定通道**（对齐项目「登录通路唯一」契约：selectPage auth 标记 + 写按钮守卫 + api 401 兜底三处汇入同一函数）。

### 1.4 二次认证（capToken）

危险操作（注销/撤销/签约/签署/封禁/删除内容等，见 T-5 §1 各接口 capToken 门禁）：
1. 触发操作 → `confirm` 弹确认 + 输入密码 → `POST /api/auth/re-auth`（`{password}`）→ `{ capToken }`；
2. 携带 `capToken` 调用目标接口；
3. 服务端 `confirmDangerOtp` 消费即删（一次性），前端逐次新签发（不缓存复用）。

### 1.5 设备管理 / 注销

- 设备列表：`GET /api/auth/sessions` → `{ sessions }`（含 current 标记）；撤销：`POST /api/auth/sessions/revoke`（`{sessionId}`）。
- 注销账户：`POST /api/user/deactivate`（capToken）→ 成功后自动登出（F7：本地状态与 UI 立即同步，不停留陈旧界面）。
- 绑定手机/邮箱：`POST /api/auth/phone/bind`、`/email/bind`（OTP）；读取 `GET /api/user/creds`（脱敏）。

---

## 2. 路由系统设计

### 2.1 页面层级蓝图 ↔ 视图注册表

新前端页面层级（用户蓝图 0/A/B/C）与标准业务接口能力映射（详见 AG-6 接口映射表，此处只定路由结构）：

```
0       落地页（landing）                    [公开]
A       学生客户端
  A1     教师广场         A1.1 教师名片      A1.1.1 教师详情
  A2     我的需求         A2.1 需求卡片      A2.1.1 详情 → A2.1.2 编辑
  A3     关系管理（AB 共用 C1 复用）
B       教师客户端
  B1     需求广场
  B2     我的信息
  B3     资料广场
AB 共用
  C0     LOGO
  C1     关系管理        C1.1 关系卡片
  C2     会话页          C2.1 普通气泡 / C2.2 特殊气泡 / C2.3 会话选择栏
                        C2.4 发起签约 / C2.5 起草合同 / C2.6 更多侧边栏
  C3     通知侧边栏
  C4     更多侧边栏      C4.1 设置 / C4.2 关于 / C4.3 反馈
```

### 2.2 URL 语义取舍（决策）

- **结论：纯状态路由（无 history API 路径），不做 URL 深链。**
- 理由：
  1. 后端接口路径零页面组织词（T-5 §3 实证）——URL 反映页面结构无契约约束，纯前端选择；
  2. 本项目是**登录后重、分享场景弱**的工具型客户端：会话页/需求详情无公开可分享面，深链价值低；
  3. 极简动效目标：视图切换走内存状态 + `<Transition>` 过渡，无 URL 变化 → 零路由竞态（v2 的 SPA 回退/刷新恢复问题不复存在）；
  4. 刷新恢复 = 恢复登录态 + 回到默认页（`getLastPage` 式记忆可选，纯前端增强）。
- 取舍：放弃「刷新停留在当前页」的精确深链；接受「刷新回默认页」（可记忆上次页）。
- **若未来需要分享链接**：为单个公开页面（教师名片/帖子）加 query 参数路由即可，核心客户端不动。

### 2.3 路由实现（Vue Router 选型 vs 自建）

- **选 Vue Router（createWebHashHistory 或 memory history）+ 布局映射**，不裸写自建路由：
  - Vue Router 是成熟、受维护的路由库（规则 5 优先成熟库）；本项目路由是**角色门禁 + 嵌套布局（客户端壳 → 页面）**的标准问题域，Vue Router 的嵌套路由 + 守卫钩子（`beforeEach` 角色门禁 + `afterEach` 状态清理）直接覆盖；
  - history 模式：**memory 历史**（无 URL）符合 2.2 决策；若需要 URL 语义，hash 模式（`#/a1`）零服务端配置（纯静态无 `_redirects` 依赖）。
  - 备选：**最终实现可二选一**——①memory history（纯状态，零 URL）②hash history（`#/` 前缀，刷新可恢复页面）。**定案倾向 memory history + 记忆上次页**（最简、零 URL 竞态、极简动效契合）。
- 路由表结构（示意，最终以 AG-6 映射表为准）：

```
landing        /                    [公开]
login-register login-view            [公开]
student        /student             [requireAuth(ROLES.STUDENT)]
  A1 browse-teachers
  A1.1.1 teacher-detail
  A2 my-demands
  A2.1.1 demand-detail
  A2.1.2 demand-edit
teacher        /teacher             [requireAuth(ROLES.TEACHER)]
  B1 browse-demands
  B2 my-info
  B3 resource-share
shared         /shared              [requireAuth(任意角色)]
  C1 relations
  C2 conversations (+ C2.4/C2.5 modals)
  C3 notifications
  C4 settings / about / feedback
admin          /admin               [requireAuth(ROLES.ADMIN)] 11 模块
```

### 2.4 路由守卫（横切关注点）

- `beforeEach`：未登录访问受保护路由 → 重定向 login-view（保留目标，登录后回跳可选）；角色不匹配 → 重定向默认页。
- `afterEach`：离开会话/轮询页 → 停止该页后台任务（轮询定时器/监听器，防泄漏）。
- 布局切换：`student/teacher/admin` 共享「客户端壳」（侧栏 + 顶栏 + 通知/更多侧边栏），壳内 `router-view` 承载页面——壳只在角色级变化时重挂（AB 共用页不重挂）。

### 2.5 会话过期与路由联动

401 兜底（1.3）清态后：当前路由若受保护 → 重定向 landing + 弹「重新登录」。与 Vue Router 守卫协同（`authStore.token === null` 即视为访客态）。

---

## 3. 与后端契约一致性核对

| 本设计引用 | 后端契约（T-5 §1） |
|---|---|
| 令牌注入 X-Auth-Token | 全部业务接口（§1.1-1.12）登录门禁 |
| /api/auth/me 会话恢复 | §1.1 GET |
| /api/auth/check 探测 | §1.1 GET |
| /api/auth/login · /login/code · /register | §1.1 POST ×3 |
| /api/auth/logout | §1.1 POST |
| /api/auth/re-auth → capToken | §1.1 POST |
| /api/auth/sessions · /sessions/revoke | §1.1 GET/POST |
| /api/user/deactivate（capToken） | §1.1 POST |
| /api/auth/phone|email/bind、/api/user/creds | §1.1 POST/GET |
| 公开浏览（访客放行接口） | §1.2/1.3/1.7 各 authUser 公开列表 |
| /api/batch 子请求 401 | §1.11 POST |

**无本设计引用之外的契约假设**；所有路径/形状/门禁与 T-5 报告逐条一致。
