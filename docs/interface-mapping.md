# 新前端接口映射表（AG-6）

> 需求 AG-6 产物：标准业务接口清单（docs/frontend-decoupling.md §1）× 新前端页面层级（0/A/B/C，ADR 0003 §2）。每个页面/组件标注消费接口（端点/方法/登录门禁/响应字段/接口帽标记）。
> 门禁缩写：**公开** = 无令牌可调（authUser 放行列表）；**登录** = requireUser（X-Auth-Token）；**角色** = requireUser + role；**cap** = 需 capToken（confirmDangerOtp 消费）。接口帽态：✅已接入 / 🧢接口帽（占位+data-cap 标记）/ ⏸蓝图暂缓（不入路由）。

---

## 0 落地页（landing，公开）

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| 教师广场横廊 | `GET /api/teachers` → `{teachers}` | 公开 | ✅ |
| 需求大厅片段 | `GET /api/student/demands` → `{demands}`（访客视角） | 公开 | ✅ |
| 帖子/资源片段 | `GET /api/posts?sort=new` → `{posts}` | 公开 | ✅ |
| 登录/注册入口 | （跳认证视图，无接口） | — | ✅ |

## 认证视图（login-register，公开）

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| 登录（密码） | `POST /api/auth/login` → `{user, authToken}` | 公开 | ✅ |
| 登录（验证码） | `POST /api/auth/login/code` → `{user, authToken}` | 公开 | ✅ |
| 账号探测 | `GET /api/auth/check?identifier=` → `{exists, role}` | 公开 | ✅ |
| 注册（学生/教师） | `POST /api/auth/register` → `{user, authToken}` | 公开 | ✅ |
| 教师邀请码 | `POST /api/auth/check-invite` → `{ok}` | 公开 | ✅ |
| 验证码请求 | `POST /api/auth/otp/request` → `{ok}` | 公开 | ✅ |
| 滑块验证码 | `POST /api/captcha/verify` | 公开 | ✅ |

## A 学生客户端

### A1 教师广场

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| 教师列表 | `GET /api/teachers` → `{teachers}`（verified/price_min/rating/time_slots/credential_image） | 公开（学生登录标匹配度） | ✅ |
| 需求上下文（匹配度） | `GET /api/student/demands?scope=mine` → `{demands}` | 角色 student | ✅ |

### A1.1 教师名片 / A1.1.1 教师详情

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| 教师详情 | `GET /api/teacher/profile?userId=` → `{profile}`（含 `signed` 签约门禁标志） | 登录 | ✅ |
| 评价列表 | `GET /api/reviews?teacherUserId=` → `{reviews}` | 公开 | ✅ |
| 奖学金列表 | `GET /api/teacher/awards?userId=` → `{awards}`（他人仅 approved） | 公开 | ✅ |
| 提交评价 | `POST /api/reviews` → 写路径 | 登录 + student | ✅ |

### A2 我的需求

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| 我的需求列表 | `GET /api/student/demands?scope=mine` → `{demands}`（pending_intents 徽标） | 角色 student | ✅ |
| 新建/编辑需求 | `POST /api/student/demands` / `PUT /api/student/demands/:id` | 角色 student | ✅ |
| 删除需求 | `DELETE /api/student/demands/:id` | 角色 student | ✅ |
| 重开需求 | `POST /api/student/demands/:id/reopen` | 角色 student | ✅ |
| 意向教师列表 | `GET /api/demands/:id/intents` → `{teachers}` | 登录 + 所有者 | ✅ |
| 接受/拒绝意向 | `POST /api/intents/:id/resolve` | 角色 student + 归属 | ✅ |

### A2.1.1 详情 → A2.1.2 编辑（复用上述 + 定向推送）

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| 定向推送 | `POST /api/demand-pushes` → 写路径 | 角色 student | ✅ |

### A3 关系管理（= C1 复用，见下）

## B 教师客户端

### B1 需求广场

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| 需求大厅 | `GET /api/student/demands?scope=for-teacher` → `{demands}` | 角色 teacher | ✅ |
| 提交意向 | `POST /api/demands/:id/intents` | 角色 teacher + 接单资格 | ✅ |
| 推送列表 | `GET /api/demand-pushes` → `{pushes}` | 角色 teacher | ✅ |
| 响应推送（接受建会话） | `POST /api/demand-pushes/:id/resolve` | 角色 teacher + 资格 | ✅ |

### B2 我的信息（教师档案）

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| 档案读取（预填） | `GET /api/teacher/profile` → `{profile}` | 角色 teacher | ✅ |
| 档案保存（四区全量） | `POST /api/teacher/profile` | 角色 teacher | ✅ |
| 核验状态四态 | `GET /api/teacher/verify-status` | 角色 teacher | ✅ |
| 学信网验证码 | `POST /api/teacher/verify-chsi` | 角色 teacher | ✅ |
| 录取通知书上传 | `POST /api/teacher/verify-admission` | 角色 teacher | ✅ |

### B3 资料广场（= A1 教师广场列表 + 帖子，教师侧视角）

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| 帖子列表 | `GET /api/posts?sort=&q=` → `{posts}` | 公开（登录标 liked） | ✅ |
| 发帖 | `POST /api/posts` | 角色 teacher | ✅ |
| 点赞/收藏 | `POST /api/posts/:id/like`、`/favorite` | 登录 | ✅ |
| 我的收藏 | `GET /api/posts/favorites/mine` | 登录 | ✅ |
| 删帖 | `DELETE /api/posts/:id` | 登录（owner/管理员） | ✅ |

## C 共用客户端

### C1 关系管理（学生 A3 / 教师共用）

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| 关系列表 | `GET /api/conversations` → `{conversations}`（unread_count/last_body） | 登录 | ✅ |

### C1.1 关系卡片（会话选择栏）

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| 标记已读 | `POST /api/conversations/:id/read` | 登录 + 参与方 | ✅ |

### C2 会话页

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| C2.1 消息历史 | `GET /api/conversations/:id/messages` → `{messages, conversation}` | 登录 + 参与方 | ✅ |
| 增量轮询 | `GET /api/conversations/:id/messages?sinceId=` | 登录 + 参与方 | ✅ |
| 发送批次 | `POST /api/conversations/:id/messages`（batch + clientKey 幂等） | 登录 + 参与方 | ✅ |
| 附件上传 | `POST /api/uploads`（XHR）→ `{id}` | 登录 | ✅ |
| 附件取消/删除 | `DELETE /api/uploads/:id` | 登录 + 归属 | ✅ |
| 附件取回 | `GET /api/conversations/:id/messages/:mid/attachment` | 登录 + 参与方 | ✅ |
| C2.4 发起签约 | `GET /api/conversations/:id/bindable-demands?phase=signing` → `{demands}`；`POST /api/conversations/:id/signing` | 登录 + 参与方 | ✅ |
| 响应签约 | `POST /api/signing-requests/:id/respond`（accept 须 cap） | 登录 | ✅ |
| C2.5 起草合同 | `GET /api/conversations/:id/bindable-demands?phase=contract`；`POST /api/contracts` | 登录 + 参与方 | ✅ |
| 合同列表 | `GET /api/contracts/my` → `{contracts}` | 登录 | ✅ |
| 签署（双签） | `POST /api/contracts/:id/sign` | 登录 + **cap** | ✅ |
| 撤销/取消 | `POST /api/contracts/:id/revoke`、`DELETE /api/contracts/:id` | 登录 + **cap** | ✅ |
| 修改正文 | `PUT /api/contracts/:id`（version 乐观锁） | 登录 + 参与方 | ✅ |
| 台账验证 | `GET /api/contracts/:id/verify` | 登录 + 参与方 | ✅ |

### C3 通知侧边栏

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| 通知列表 | `GET /api/notifications` → `{notifications}` | 登录 | ✅ |
| 单条已读 | `POST /api/notifications/:id/read` | 登录 | ✅ |
| 全部已读 | `POST /api/notifications/read-all` | 登录 | ✅ |

### C4 更多侧边栏

| 组件 | 接口 | 门禁 | 帽 |
|---|---|---|---|
| C4.1 设置（隐私） | `GET/POST /api/privacy-settings` | 登录 | ✅ |
| 设置（账户） | `GET /api/user/creds`、`GET /api/user/username/status`、`POST /api/user/username`（cap）、`POST /api/user/avatar`、`POST /api/auth/phone|email/bind` | 登录（cap 标注处） | ✅ |
| 设置（设备） | `GET /api/auth/sessions`、`POST /api/auth/sessions/revoke` | 登录 | ✅ |
| 注销账户 | `POST /api/user/deactivate` | 登录 + **cap** | ✅ |
| C4.2 关于 | （版本探针 `GET /api/data-version` 可选） | 公开 | ✅ |
| C4.3 反馈 | `POST /api/feedbacks`；我的反馈 `GET /api/feedbacks/mine`、`GET /api/complaints/mine`；投诉候选 `GET /api/complaints/recent?target=`、`/candidates?target=&q=`；提交投诉 `POST /api/complaints` | 登录 | ✅ |
| 二次认证 | `POST /api/auth/re-auth` → `{capToken}`（全部 cap 操作的共同前置） | 登录 | ✅ |

## 管理端（admin 客户端，全部 requireAdmin + cap 标注）

| 模块 | 接口 | cap |
|---|---|---|
| 统计/仪表盘 | `GET /api/admin/stats`、`/dashboard`、`/traffic?range=` | — |
| 用户管理 | `GET /api/admin/users?role=&q=`；封禁/解封 `POST /api/admin/users/:id/ban` | ban cap |
| 需求管理 | `GET /api/admin/demands?cursor=`；删除 `DELETE /api/admin/demands/:id` | — |
| 评价审核 | `GET /api/admin/reviews?status=`；`POST /api/admin/reviews/:id/approve|reject`；`DELETE :id` | — |
| 内容审核 | `GET /api/admin/content?type=`；`POST /api/admin/content/:type/:id/action` | cap |
| 合同管理 | `GET /api/admin/contracts`；`DELETE /api/admin/contracts/:id` | cap |
| 奖学金审核 | `GET /api/admin/awards?status=`；`/awards/:id/proof`；`POST /api/admin/awards/:id/action` | cap |
| 教师认证核验 | `GET /api/admin/verifications?status=`；`POST /api/admin/verifications/:id/action` | cap |
| 教师认证开关 | `POST /api/admin/teachers/:id/verify` | cap |
| 帖子管理 | （复用 posts 域：`GET /api/posts`、`DELETE /api/posts/:id`） | 删帖 cap |
| 反馈单 | `GET /api/feedbacks`；`POST /api/feedbacks/:id/resolve`；`GET /api/complaints`；`POST /api/complaints/:id/resolve` | — |
| 邀请码 | `POST /api/admin/invite` → `{code}`；`GET /api/admin/invites`；`DELETE /api/admin/invites/:code` | — |
| 广播 | `POST /api/notifications/broadcast` | cap |

---

## 覆盖对账

- **全部 16 组业务能力**（T-5 §2）已映射到页面/组件：账号体系→认证视图+设置；教师档案→B2；需求→A2/B1；推送→A2/B1；评价/奖学金→A1.1；聊天/签约/合同→C2；帖子→B3/A1；通知→C3；投诉反馈→C4.3；隐私→C4.1；管理端 11 模块→admin。
- **接口帽 🧢 当前清单**：暂无（本次全部 ✅）——预留模式已定义（ADR 0004 §4），未来新增页面/未就绪能力走 `data-cap` 标记。
- **后端能力缺口提示**（T-3 孤儿接口）：`POST /api/teacher/awards`（教师提交奖项）、`PUT /api/reviews/:id`（评价编辑）服务端已具备，新前端如需可于对应页面接入（非本次范围）。
- **跨面一致性**：本表接口路径/门禁/形状与 docs/frontend-decoupling.md §1 逐条一致（同源生成，无新增假设）。
