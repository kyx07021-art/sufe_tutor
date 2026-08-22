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
