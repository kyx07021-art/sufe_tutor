# 新站接口契约（interfaces.md · 接口帽骨架）

> 前后端并行的共同契约（三层工作流 §12.3 接口帽三原则）。本文件开工前为**骨架**（清单 + 状态）；阶段二由主会话逐条签发详细「请求形状 + 期望响应形状」，并维护每条的就绪状态。
>
> **状态标记**：
> - `v2-ready` = v2 已有接口，考古搬运或按新模型微调即可，可先按 v2 形状接入
> - `new` = 全新能力（v2 无），后端新写，前端先接接口帽 dummy
> - `cap` = 前端本轮不做、仅预留接口帽（contract 前端组件不写）
>
> **三条纪律**：①按业务能力命名，不按页面/模块命名；②形状 = 语义化数据，不夹页面组织；③前端→本文件→后端单向依赖，跨模块改接口必须主会话重签。

## 1. 认证与会话（C5 + 上边栏）

| # | 业务能力 | 出处 | 方法+路径（方向） | 门禁 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| I-01 | 发送验证码 | C5 / 注册登录 | POST /api/auth/otp | 公开 | v2-ready | OTP 通道考古搬运（DAILY_MAX/per-IP） |
| I-02 | 验证码登录 | 登录 | POST /api/auth/login | 公开 | v2-ready | normalizeIdentifier 保留 |
| I-03 | 注册 | 注册 | POST /api/auth/register | 公开 | v2-ready | 需单科目新模型无关 |
| I-04 | 登出 | 上边栏 | POST /api/auth/logout | 登录 | v2-ready | — |
| I-05 | 恢复当前用户 | 上边栏/路由守卫 | GET /api/auth/me | 登录 | v2-ready | 401 → 引导登录 |
| I-06 | 二次身份验证（验证码+拼图） | C5 身份认证组件 | POST /api/auth/verify | 登录+capToken | v2-ready | 形状按计划书 C5 确认（手机/邮箱/密码三选二 + 拼图） |
| I-07 | 滑动拼图验证 | C5 | POST /api/captcha/verify | 公开 | v2-ready | human-check.js 考古搬运 |

## 2. 用户与设置（C4 设置）

| # | 业务能力 | 出处 | 方法+路径 | 门禁 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| I-08 | 获取用户设置 | C3.1 设置窗口 | GET /api/settings | 登录 | v2-ready | — |
| I-09 | 更新用户设置 | 设置窗口 | PUT /api/settings | 登录 | v2-ready | — |
| I-10 | 修改用户名 | 设置窗口 | PUT /api/settings | 登录 | v2-ready | F7 前端状态同步 |
| I-11 | 修改头像 | 设置窗口 | PUT /api/settings | 登录 | v2-ready | 上传自动居中裁切最大圆（前端） |
| I-12 | 绑定联系方式 | 设置窗口 | PUT /api/settings | 登录 | v2-ready | 手机/邮箱 |
| I-13 | 设备管理 | 设置窗口 | GET/DELETE /api/settings/devices | 登录 | v2-ready | — |
| I-14 | 注销账户 | 设置窗口 | POST /api/settings/deactivate | 登录+capToken | v2-ready | 危险操作 |

## 3. 关系管理（C1）

| # | 业务能力 | 出处 | 方法+路径 | 门禁 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| I-15 | 拉取关系图 | C1 关系管理 | GET /api/my-relations | 登录 | v2-ready | AI-7 考古；前端需关系类型（会话/合同）+ 虚线数 |
| I-16 | 结束会话/关系 | C2 更多功能 | POST /api/conversations/:id/close | 登录+capToken | v2-ready | AI-1 考古；计划书「有合同则灰掉」由前端判合同关系 |

## 4. 会话（C2，最重）

| # | 业务能力 | 出处 | 方法+路径 | 门禁 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| I-17 | 会话列表 | C2.3 选择栏 | GET /api/conversations | 登录 | v2-ready | 未读/最后消息/已结束标记 |
| I-18 | 会话消息 | C2 会话区 | GET /api/conversations/:id/messages | 登录+参与方 | v2-ready | 轮询 data-mid/seq 去重保留 |
| I-19 | 发送文本 | C2 输入框 | POST /api/conversations/:id/messages | 登录+参与方 | v2-ready | — |
| I-20 | 发送图片 | C2 附件 | POST /api/conversations/:id/messages | 登录+参与方 | v2-ready | 附件净化保留 |
| I-21 | 发送文件 | C2 附件 | POST /api/conversations/:id/messages | 登录+参与方 | v2-ready | 同上 |
| I-22 | 标记已读 | C2 红点 | POST /api/conversations/:id/read | 登录+参与方 | v2-ready | 红点消失语义按计划书 |
| I-23 | **发起临时会话** | C2 会话区逻辑 | POST /api/conversations/temp | 登录 | **new** | 大厅对任意用户发消息；响应含 temp 状态/配额 |
| I-24 | **临时会话配额与转正式** | C2 会话区逻辑 | （并入消息接口/会话详情） | 登录+参与方 | **new** | 限 1 条 → 对方回复转正式；前端提示文本驱动 |
| I-25 | 用户详情（发消息前置） | A1.2「发消息」/大厅 | GET /api/users/:id/profile | 登录 | v2-ready | 联系方式永不公开（删 signed 门禁） |

## 5. 通知（C3）

| # | 业务能力 | 出处 | 方法+路径 | 门禁 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| I-26 | 通知列表 | C3 浮窗 | GET /api/notifications | 登录 | v2-ready | 系统/用户事件 |
| I-27 | 通知已读 | C3 红点 | POST /api/notifications/read | 登录 | v2-ready | 退出浮窗静默消失 |
| I-28 | 屏蔽系统通知 | C3 复选钮 | PUT /api/settings | 登录 | v2-ready | notif-pref 考古 |

## 6. 教师广场（A1）

| # | 业务能力 | 出处 | 方法+路径 | 门禁 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| I-29 | 教师列表（排序+筛选） | A1 广场 | GET /api/teachers | 登录 | v2-ready（改造） | 排序：匹配度/评分/经验/报价；筛选：科目/性别/性格/报价区间；**响应须含命中数字段** |
| I-30 | 教师详情 | A1.1/A1.2 | GET /api/teachers/:id/profile | 登录 | v2-ready | 名片四层+详情三栏数据；联系方式永不公开 |
| I-31 | 教师评价/评分 | A1.2 | GET /api/reviews | 登录 | v2-ready | 精选评价 + 评分分布 |
| I-32 | **匹配度** | A1 排序项 | （字段级，并入 I-29 响应） | — | **new** | 新匹配度算法；排序/筛选命中数依赖 |

## 7. 需求（A2/B1）

| # | 业务能力 | 出处 | 方法+路径 | 门禁 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| I-33 | 我的需求列表 | A2 | GET /api/demands/mine | 登录 | v2-ready（改造） | 单科目新模型 |
| I-34 | 需求广场列表（排序+筛选） | B1 | GET /api/demands | 登录 | v2-ready（改造） | 排序：匹配度/报价；筛选：科目/性别/报价区间 |
| I-35 | 创建需求 | A2.2 | POST /api/demands | 登录 | v2-ready（改造） | **单科目**：年级/科目/方式/赋分/地址/时间/偏好 |
| I-36 | 更新需求 | A2.2 编辑 | PUT /api/demands/:id | 登录+归属 | v2-ready（改造） | 同上 |
| I-37 | 删除需求 | A2.2 | DELETE /api/demands/:id | 登录+归属 | v2-ready | — |
| I-38 | 需求详情 | A2.1 详情 | GET /api/demands/:id | 登录 | v2-ready | — |

## 8. 教师端（B2）

| # | 业务能力 | 出处 | 方法+路径 | 门禁 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| I-39 | 教师资料获取 | B2 编辑页 | GET /api/teacher/profile | 登录+教师 | v2-ready | — |
| I-40 | 教师资料更新 | B2 编辑页 | PUT /api/teacher/profile | 登录+教师 | v2-ready | — |
| I-41 | 学信网核验 | B2 核验门 | POST /api/teacher/verify-chsi | 登录+教师 | v2-ready | — |
| I-42 | 录取通知书核验 | B2 核验门 | POST /api/teacher/verify-admission | 登录+教师 | v2-ready | — |
| I-43 | 核验状态 | B2 核验门 | GET /api/teacher/verify-status | 登录+教师 | v2-ready | 四态 none/pending/approved/rejected |

## 9. 合同（预留接口帽，前端本轮不写）

| # | 业务能力 | 出处 | 方法+路径 | 门禁 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| I-44 | 合同列表/详情 | 关系图/会话预留 | GET /api/contracts | 登录 | cap | 后端 S5 独立化做；前端 M4 加号上拉栏不放选项 |
| I-45 | 起草合同 | 计划书 C2.4（草稿） | POST /api/contracts | 登录+capToken | cap | 全字段自填、不绑需求；接口帽预留形状 |
| I-46 | 签署/撤销/存证校验 | 计划书 C2.4 | POST /api/contracts/:id/* | 登录+capToken | cap | 独立化后端实现，前端后续接入 |

## 10. 管理端（S6）

| # | 业务能力 | 出处 | 方法+路径 | 门禁 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| I-47..55 | 管理端各能力（用户/需求/教师认证/内容审核/反馈单/邀请码/通知广播） | 管理端 | /api/admin/* | admin | v2-ready | 考古精简，接口帽随 S6 盘点补齐 |

## 11. 状态汇总（开工前）

- **v2-ready**：I-01..22, 25-28, 30-31, 33-43, 47-55（大部分现成，考古搬运 + 新模型微调）
- **new（前端先接帽 dummy）**：I-23 临时会话、I-24 配额转正式、I-29 命中数字段、I-32 匹配度
- **cap（前端不写）**：I-44..46 合同

> 阶段二签发动作：对每条 v2-ready 接口核对 v2 形状与新模型差异（单科目/无联系方式/临时会话），对 new 接口设计 dummy 形状，cap 接口记录预留形状。签发后每条更新为 `ready`（形状冻结），后端实现完成前前端一律接接口帽。

## 12. new 接口 dummy 形状定稿（阶段二签发，2026-08-22 六点）

> 形状按计划书表现设计；两端（前端接口帽 / 后端实现）都以本节为准。后端实现完成前，前端一律接本形状的 dummy。v2-ready 接口的形状核对（与新模型差异）随各模块拆解结果签发。

### I-23 发起临时会话（new · cap）
```
POST /api/conversations/temp
Auth: 登录
body: { targetUserId: int, firstMessage: string ≤ 1000 }
200: { conversationId: int, status: 'temp'|'active', quotaRemaining: int /* 0|1，发起方发首条后为 0 */ }
409: 已存在正式会话 → 返回既有会话 { conversationId, status:'active' }
404: 目标用户不存在 / 非发消息前置用户详情
```
语义：大厅「发消息」→ 无既有会话则生成临时会话；发起方发首条消息后 `quotaRemaining:0`（前端输入框消失，物理阻止更多消息）；对方回复后 `status:'active'`（正式会话，双方提示文本驱动）。发起后对方会话列表不显示，直到对方回复。

### I-24 临时会话配额与转正式（new · 并入会话/消息接口）
```
GET /api/conversations/:id  → 200 含 { convStatus: 'temp'|'active'|'closed' }
POST /api/conversations/:id/messages → 200 含 { tempQuota: 0|1, convStatus }
   （temp 下发起方第 2 条：403 TEMP_QUOTA_EXHAUSTED，服务端兜底；前端输入框消失为主防线）
```
语义：前端 C2.6 提示文本由 `convStatus + tempQuota` 驱动（「当前为临时会话，在对方回复前，你最多可发送1条消息」/「对方最多可发送1条消息，你回复后将建立正式会话」/「你们已完成互发消息」）。

### I-29 教师列表响应（v2-ready 改造 · 加字段）
```
GET /api/teachers?sort=match|rating|exp|price&order=asc|desc&filters={subjects[],gender,personalities[],priceMin,priceMax}
200: { items: [{ teacherId, name(教师名), avatar, rating, reviewCount, priceMin, priceMax,
                subjects: [{subject, score, full, awards[]}], bio, region,
                matchScore: int /* 0-100，新匹配度 */, matchCount: int /* 筛选命中数 */ }], total }
```
语义：`sort=price` 按 `(priceMin+priceMax)/2` 中间价；筛选命中 → 命中数分组重排（命中数高的组在前，组内按排序偏好）。

### I-32 新匹配度（new · 字段级，S4 实现）
```
matchScore 0-100：学生需求 vs 教师资料——科目匹配/授课方式/地区可及/报价区间/偏好性格命中加权。
matchCount：筛选维度（科目/性别/性格/报价区间）中命中的个数。
```
排序 `sort=match` 按 matchScore 降序；筛选后按 matchCount 分组。

## 13. 阶段二契约定案（模块拆解反馈签发，2026-08-22）

### I-06 二次身份验证（定案形状）
```
POST /api/auth/verify
Auth: 登录 + 场景（capToken 由调用方流程提供）
body: { credential: { type: 'otp'|'password', value: string },
        captchaVerified: true }   // 拼图已先经 I-07 验证置位（前端状态）
200: { verified: true } | 401/403
```
定案理由：计划书 C5「确认按钮只在验证码和拼图都通过之后亮起」→ 拼图先行 I-07 验证，灰态判据 = 凭证完整（验证码 6 位 / 密码非空）+ 拼图已通过；I-06 提交只带凭证，验证码/密码合法性服务端判定。

### I-05 恢复当前用户（加字段）
```
GET /api/auth/me
200: { user: { id, username, role, avatar, 教师名?, ...,
              contactMasks: { phone: boolean, email: boolean } } }
```
定案理由：M6-3 默认认证方式判定（有手机→手机验证码/仅邮箱→邮箱/永不默认密码）。**只给布尔不给值**（联系方式永不公开红线）。

### openIdentityAuth 对外签名（M6-11 契约）
`openIdentityAuth({ onVerified })` —— 供结束关系等 capToken 二次认证场景呼出；成功回调 onVerified()，取消/失败不回调。

### OTP 冷却常量归属
进新站全局单源（后端 shared/config 对应物），M6-5 引用；不散落裸值。

## 14. 阶段二契约定案（M3 反馈签发）

### 合同边处理（M3 决策 2）
关系图本轮**只渲染会话边**，不渲染合同边（合同前端组件本轮不写，用户定案）；M3-01 边模型只建会话边、忽略 `relation.signing`。I-15 响应中的 `signing` 字段**保留不下发**给 M3 消费，但传给 M4（「有合同则结束会话按钮灰掉」判断用，计划书 C2.4）。

### z-order token
关系图层级 token（底板 0/虚线 1/头像 2/卡 3）由 M3-02 模块内定值，不上提 M0。

## 15. 阶段二契约定案（S3/M5/M9 反馈签发，2026-08-22）

### S3 需求域定案（S3-0）
①联系方式整列删除（不存储，用户自行在会话中提供）②teaching_method 三态 online/offline/both ③target_type 由 subject 派生 ④display_id 删除 ⑤demand_intents/demand_pushes 归 S2 统一删除（被临时会话取代）⑥status 收敛 open/closed。
I-33~38 更新：创建/更新需求 body 含 subject(单科目)/grade/province/teaching_method/current_score/address_area/expected_time/preferred_tags/preferred_gender/budget/additional_info；联系方式字段不存在。

### M9 D2 跨模块共享组件裁决
①排序筛选第二三上边栏机制（M7-04..13 与 M9-B1-3..5 双消费）→ **落 M0 共享组件**（走 §3.4 解冻程序补进 M0）②教师详情卡三栏结构（M7-18..21 与 M9-B2-3 双消费）→ **落 M0 共享组件**③头像居中裁切最大圆（M5-09 与 M9-B2-6 双消费）→ **M0 共享工具**。M0 完成后由主会话按解冻程序补这三件。

### M5 反馈匿名身份模型（公开接口）
新增公开接口（无需身份验证硬约束）：
```
POST /api/feedbacks      // 匿名提交：body { kind: bug|suggestion|report, title, content, contact?, attrs{} }
GET  /api/feedbacks/mine // 匿名工单：header/query 传 clientToken（客户端本地生成 UUID 存 sessionStorage）
```
匿名身份 = 客户端生成 clientToken 随请求传参；登录用户可用同一接口（user id 优先）。后端 S6 实现。

### I-26/I-27/I-28 形状（M5 消费）
I-26 GET /api/notifications → { items: [{ id, type, title, content, created_at, is_read, avatar_src: 'user'|'system' }] }
I-27 POST /api/notifications/read（body {ids} 单条）/ POST /api/notifications/read-all（批量）
I-28 屏蔽系统通知 = PUT /api/settings { blockSystemNotifications: boolean }（服务端过滤下发）

## 16. 阶段二契约定案（S1/S5 反馈签发，2026-08-22）

### S1 决策点
D1 C5 verify = I-06（§13 已签，POST /api/auth/verify，credential + captchaVerified，三选二组合签发一次性 capToken）。
D2 设备管理路径**保留 v2** `GET /api/auth/sessions` + `POST /api/auth/sessions/revoke`（auth 域实现，I-13 指向此处；前端 M5-11 接入）。
D3 遗留一次性迁移（migrateLegacyRoles/rebuildTables/sanitizeUsernames/cleanLegacyAuthTokenColumns）**删除**（生产 D1 已终态，W1）。
D4 otp/credential 核心**归 S1**（S0 不重复）。
邀请码门控保留搬运（新站教师注册需邀请码，产品如需放开另行定案）。

### S5 合同独立化
①contracts 独立表，删 stage/signing_status/demand_id/initiator_user_id/message_id/responded_at/price/签约 schedule；保留合同字段 + hourly_rate 泛化 rate（四档计费）②状态机 contract_status ∈ {signing, signed} + revoked 标记 ③conversation_id 可空历史关联、FK 不级联删合同（独立存证）④capToken 二次认证入起草（I-45）⑤存证链 ledger 保留（AI-4a 终态版）⑥NOTIFY_TYPES 删签约 3 键、保合同 6 键。

## 17. 阶段二契约定案（S2/S4 反馈签发，2026-08-22）

### S4 决策点
D1 匹配度需求上下文 = 服务端取该学生**最近一条 open 需求**；无需求 match=null 不参与排序（前端零传参）。
D2 经验 = teacher_profiles 新增 **experience_years** 列（教师可编辑、公开下发）。
D3 匹配度权重初值（总和 100，S4-13 微调）：科目 35 / 地区 25 / 报价 20 / 方式 10 / 偏好 10（性格 5+性别 5）。
D4 教师名 = teacher_profiles 新增 **teacher_name** 列（可编辑、公开、空回退 username）。
D5 报价排序 = 中间价 (min+max)/2、单边用单边、双 null 置后；列表门禁 = 登录。

### S2 临时会话（temp）契约
I-23 发起：POST /api/conversations/temp → 已存在 formal（active/closed）reopen 复用；已存在 temp 复用；无 → 新建 init 行（temp_initiator=me）。响应 { conversationId, status, tempStatus, tempInitiatorId, iAmInitiator, quota }。
I-24 状态机：init（仅发起方可见可发、配额 1）→ 首条落库事务→sent（接收方可见+红点+可回复、发起方 409 TEMP_QUOTA_EXCEEDED）→ 接收方回复→formal（temp_status→NULL、temp_initiator 保留=wasTemp，前端推导三条提示文本）。
I-17 列表：init 仅发起方显（0 消息也显）/接收方 init 隐藏、sent 显；响应行含 tempStatus/tempInitiatorId/quota。
I-18 详情：init 非发起方 404（防存在性泄露）。
I-16 适配：temp close = 删除会话行（FK 级联）+ 零通知；formal 照旧 close 级联+CONVERSATION_CLOSED。temp close 保留 capToken。

### S6 定案（2026-08-22）
通知核心咽喉（notifyUser/建表/读/已读）归 **S0**；S6 管理面=广播+批删+类型重登记。评价资格（R3 新信任模型）= 三方会话存在 + 双方往来消息各≥1 + 教师核验 approved。**awards 不上线**（W1 删，通知类型去 AWARD_*）；**privacy 设置删除**（无访客浏览，W1）。屏蔽偏好 = users.notify_broadcast_muted 列 + `PUT /api/settings { notifyBroadcastMuted }`（布尔，广播类渲染过滤）。

## 18. 登录/注册归属裁决（M1-M3 复核发现，2026-08-22）
计划书无独立登录/注册页；唯一认证载体 = **C5 身份认证浮窗（M6）**。裁决：**不建独立登录/注册页面模块**。M6 C5 浮窗扩为三场景（登录 I-02 / 注册 I-03 / 敏感操作二次验证 I-06 verify 三选二）。M2 边界「登录注册页面归 M1」修正为：认证载体 = M6 openIdentityAuth 三场景；authStore（M2-10）提供登录/注册动作；401 兜底（M2-12）+ 路由守卫（M2-09）重定向 openIdentityAuth；落地页两按钮（M1-03）触发。M6 补 M6-13 注册模式基元（角色选择+邀请码门控+I-03）。

### M9 复核 v3 钉死（2026-08-22）
匹配度响应字段统一 **matchScore**（0-100）/ **matchCount**（筛选命中数）——I-29 为准，S4/M9 拆解表述对齐；M7-12/13（命中分组纯函数 + 即时应用/动效重播）上提 M0 泛化（维度表驱动，M7 四维/M9 三维双消费）。

## 19. 接口形状签发（I-01..46 权威形状，2026-08-22 主会话签发）

> 依据 = 接口盘点 agent 草案 + S0-S6 拆解定案。裁决：①I-06 响应补 capToken（会话绑定一次性，调用方流程携带）②settings 收敛单一 `GET/PUT /api/settings`（部分更新按字段分支）+ `POST /api/settings/deactivate` ③I-25 保留 v2 路径 `GET /api/users/:id`。状态：I-01..43 = **ready**（接口可调，前端模块开发接入）；I-44..46 = **cap**（前端本轮不写，合同组件不建）。

### 认证（I-01..07，M6 消费，ready）
- **I-01** `POST /api/auth/otp/request` 公开｜`{ channel:'sms'|'email', target, scene? }`→`{ok}`｜per-IP 限流/60s/日限/三振
- **I-02** `POST /api/auth/login/code` 公开｜`{ identifier, code, deviceId? }`→`{user:{id,username,role,avatar},authToken}`｜验码先行/banned·deactivated 验码后分支
- **I-03** `POST /api/auth/register` 公开（teacher 须 inviteCode）｜`{username,password,role,inviteCode?,otpChannel,phone?|email?,code,agreeAgreement,agreePrivacy,deviceId?}`→`{user,authToken,message}`｜绑定失败回滚零孤儿
- **I-04** `POST /api/auth/logout` 登录｜→`{ok}`｜吊销令牌+清 capToken
- **I-05** `GET /api/auth/me` 登录｜→`{user:{id,username,role,avatar,teacherName?,contactMasks:{phone,email}}}`｜teacherName 空回退 username（前端）
- **I-06** `POST /api/auth/verify` 登录｜`{credential:{type:'otp'|'password',value},captchaVerified:true}`→`{verified:true,capToken}`｜**capToken 签发（裁决①）**；三选二组合；无绑通道剔除
- **I-07** `POST /api/captcha/verify` 公开｜`{captchaId,offset?,track[10-2000点]}`→`{ok,score}`｜PASS_SCORE 常量/防重放/留档不翻转

### 用户与设置（I-08..14，M5 消费，ready）
- **I-08** `GET /api/settings` 登录｜→`{user:{id,username,avatar,role,contactMasks},usernameStatus:{canChange,cooldownMs},blockSystemNotifications,notifyBroadcastMuted,devices:[{session_id,label,created_at,expires_at,current}]}`（收敛端点，裁决②）
- **I-09** `PUT /api/settings` 登录｜部分更新按字段分支：`{username,capToken}`｜`{avatar:dataURL}`｜`{channel:'phone'|'email',target,code}`｜`{blockSystemNotifications}`｜`{notifyBroadcastMuted}`→`{ok,username?,phone?,email?脱敏}`
- **I-10** `PUT /api/settings{username,capToken}` 登录+capToken｜7 天冷却/占用 409/墓碑前缀禁
- **I-11** `PUT /api/settings{avatar:dataURL}` 登录｜位图白名单/≤AVATAR_MAX_BYTES/前端已裁切
- **I-12** `PUT /api/settings{channel,target,code}` 登录｜验码先行/占用 409/脱敏回显
- **I-13** `GET /api/auth/sessions`+`POST /api/auth/sessions/revoke{sessionId}` 登录｜列表零 token/revokedSelf 前端登出
- **I-14** `POST /api/settings/deactivate{capToken}` 登录+capToken（admin 禁）｜清联系方式四列释放唯一索引（AE-1）/用户名墓碑

### 关系与会话（I-15..25，M3/M4 消费，ready）
- **I-15** `GET /api/my-relations` 登录｜`{relations:[{conversationId,status,tempStatus,tempInitiatorId,other:{id,role,name,avatar},last,signing|null}]}`｜signing 传 M4（合同灰掉）不供 M3 渲染
- **I-16** `POST /api/conversations/:id/close{capToken}` 参与方+capToken｜temp=删行零通知 / formal=级联收束（进行中合同 revoked+需求释放+CONVERSATION_CLOSED）/幂等短路
- **I-17** `GET /api/conversations` 登录｜行含 tempStatus/tempInitiatorId/quota/otherName（teacher_name 优先）｜init 仅发起方显/sent 接收方显
- **I-18** `GET /api/conversations/:id/messages?sinceId=N` 参与方（temp init 非发起方 404）｜`{conversation:{...temp 字段},messages:[{id,sender_user_id,kind:'text'|'image'|'file'|'contract',name,body,thumb,created_at}]}`｜sinceId=0 取最近 N 条
- **I-19/20/21** `POST /api/conversations/:id/messages` 参与方（closed 403）｜`{batch:[{kind:'text',body,clientKey}|{uploadId,clientKey}]}`→`{messages, tempQuota?, convStatus?}`｜temp 状态机并发送路径（init→sent 单 batch 原子）/clientKey 幂等/同批重复 uploadId 整批拒
- **I-22** `POST /api/conversations/:id/read` 参与方｜已读游标推最新
- **I-23** `POST /api/conversations/temp` 登录｜`{targetUserId,firstMessage≤1000}`→`{conversationId,status,tempStatus,tempInitiatorId,iAmInitiator,quota}`｜formal 已存在→reopen 复用 / temp 已存在→复用 / 无→init 新建
- **I-24** 并入 I-17/18/19（quota/convStatus/tempStatus）｜TEMP_SEND_QUOTA=1 config 单源
- **I-25** `GET /api/users/:id` 登录｜`{user:{id,username,role,avatar,name?}}`｜保留 v2 路径（裁决③）；封禁且未注销视同不存在；联系方式永不公开

### 通知（I-26..28，M5 消费，ready）
- **I-26** `GET /api/notifications` 登录｜`{notifications:[{id,type,title,content,created_at,is_read,avatar_src}]}`｜服务端按 blockSystemNotifications/notifyBroadcastMuted 过滤
- **I-27** `POST /api/notifications/:id/read` + `POST /api/notifications/read-all` 登录｜归属硬约束（0 行不报错）
- **I-28** 并入 I-09（blockSystemNotifications/notifyBroadcastMuted 布尔）

### 教师广场（I-29..32，M7 消费，ready）
- **I-29** `GET /api/teachers?sort=match|rating|exp|price&order=asc|desc&filters={subjects[],gender,personalities[],priceMin,priceMax}` 登录｜`{items:[{teacherId,name(teacher_name),avatar,rating,reviewCount,priceMin,priceMax,subjects:[{subject,score,full,awards[]}],bio,region,experienceYears,matchScore,matchCount,teachingMethod,timeSlots,personalityTags,verified,chsiVerified}],total}`｜price 中间价排序/match 降序/命中分组重排
- **I-30** `GET /api/teachers/:id/profile` 登录｜全字段（见 S4-06）｜wechat/email/real_name/credential_image 永不下发
- **I-31** `GET /api/reviews?teacherUserId` 登录｜`{reviews:[{id,rating,comment,status,reviewerName,created_at}],mine}`｜门禁 R3（会话+往来+核验 approved）
- **I-32** 并入 I-29（matchScore/matchCount）｜权重 科目35/地区25/报价20/方式10/偏好10 单源 config

### 需求（I-33..38，M8/M9 消费，ready）
- **I-33** `GET /api/demands/mine` 登录+student｜行形状见下（单科目）｜status open/closed
- **I-34** `GET /api/demands?sort=match|price&order&filters={subjects[],gender,priceMin,priceMax}` 登录｜行含 studentName/studentAvatar + 对应当前教师 matchScore/matchCount｜B1 排序筛选
- **I-35** `POST /api/demands` 登录+student｜`{subject,grade,province,teachingMethod:'online'|'offline'|'both',currentScore?,addressArea?,expectedTime?,preferredTags?,preferredGender?,budgetMin,budgetMax,additionalInfo?}`→`{id,message}`｜单科目/非线下许可省强制 online/门牌全局断点
- **I-36** `PUT /api/demands/:id` 归属｜同 I-35 覆盖式｜closed 不可改（DEMAND_STATE_INVALID）
- **I-37** `DELETE /api/demands/:id` 归属｜无「已签约禁删」门禁（合同不绑需求）
- **I-38** `GET /api/demands/:id` 登录｜单科目行形状+studentName/studentAvatar
- 行形状：`{id,user_id,subject,targetType(派生),grade,province,teachingMethod,currentScore,currentScoreFull,addressArea,expectedTime,preferredTags,preferredGender,budgetMin,budgetMax,additionalInfo,status,createdAt}`

### 教师端（I-39..43，M9 消费，ready）
- **I-39** `GET /api/teacher/profile` 登录+teacher｜本人全字段（含 wechat/email/real_name/credential_image/teacher_name/experienceYears）｜他人访问 403
- **I-40** `PUT /api/teacher/profile` 登录+teacher｜同 I-39 部分省略=保留原值｜teacher_name 可编辑/experience_years 非负整数钳
- **I-41** `POST /api/teacher/verify-chsi{code:/^[A-Za-z0-9]{12,16}$/}` 登录+teacher｜→`{ok,status:'pending',provider}`｜已通过 409 禁反复
- **I-42** `POST /api/teacher/verify-admission{image:dataURL}` 登录+teacher｜jpeg/png/webp magic bytes/≤CREDENTIAL_MAX_BYTES/svg 拒
- **I-43** `GET /api/teacher/verify-status` 登录+teacher｜`{status:'none'|'pending'|'approved'|'rejected',provider?,verifyType?}`｜rejected 可重提

### 合同（I-44..46，S5 独立化，**cap** 前端本轮不写）
- **I-44** `GET /api/contracts` + `GET /api/contracts/:id` 登录｜行含 contractStatus 'signing'|'signed'+revoked/conversationId 可空/rate 泛化/version
- **I-45** `POST /api/contracts` 登录+**capToken**｜`{conversationId?,method,plan,rate,schedule,location,payMethod,payMethodOther?,firstLessonDate?,trialPay?,trialPayOther?,capToken}`→`{id,message}`｜删 demandId/阶段推进
- **I-46** `POST /api/contracts/:id/sign`｜`POST /api/contracts/:id/revoke`｜`PUT /api/contracts/:id{contractMd,version}`（乐观锁 409）｜`DELETE /api/contracts/:id`（单方回退）｜`GET /api/contracts/:id/verify`（只读豁免门禁）——全部 参与方+capToken（verify 只读）
