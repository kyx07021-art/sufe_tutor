# 前端解耦度评估报告（frontend-decoupling）

> 需求 T（2026-08-21 执行）产物：前端整体重做前的解耦度评估——盘点标准业务接口层，验证前后端正交性。
> 评估方法：4 个只读 agent 并行扫描（T-1 前端消费面 / T-2 服务端路由面 / T-3 接口对账 / T-4 共享模块耦合面），主会话整合定稿。全部证据链为文件:行号。
> 基线：APP_VERSION 2.0.0 @ commit 5a092b5（arch 11/11、build 绿、manifest 一致、工作区干净）。

---

## 0. 结论速览

| 判据 | 结论 |
|---|---|
| 前后端正交性 | **达成**——「后端结构不依赖前端组织、前端结构不受后端制约」成立 |
| 深耦合 | **无**——无一条需接口化改造的深耦合点 |
| 1101 级断线（前端调服务端无） | **零** |
| 孤儿接口（服务端有前端无） | 10 条，全部为可保留业务能力 / 运维接口 |
| 轻-中耦合残留 | 6 处形状失配（S-1..S-6，S-3/S-5 有意保留）+ 4 处共享耦合（M1-M4）→ 拆 T-6-F1..F7 收口 |
| 新前端换壳 | 仅需接入「标准业务接口」即可完整运行，任意位置可接入 |

**核心判据回执**：每个业务能力均有独立标准接口（提交需求 = `POST /api/student/demands`、更新档案 = `POST /api/teacher/profile`、呼出列表 = `GET /api/teachers|/api/student/demands|/api/posts` 等）；后端接口路径/形状/门禁零隐含前端页面组织（无模块名/侧栏序/页面 id 路径段）；前端页面组织（侧栏/模块归并/多列/入口变化）纯前端自持，后端零感知。

---

## 1. 标准业务接口清单（前端消费面，T-1）

覆盖实证（grep 全量）：`fetch(` 唯一在 `core/api.js:43`；`XMLHttpRequest` 唯一在 `core/api.js:100`（apiUpload）；`api(` 调用点 **97 处**、`dhGet(` **30 处**、`dhPrefetch(` 2 处、`apiUpload({` 2 处、`apiBatch(` 1 处——领域层零直接 fetch，全部落在 `core/api.js` 单点网络封装。

按业务能力分 16 组（每组 = 一组自洽的标准接口，可放任意位置接入）。门禁来源 = 各域 `api.js` handler 内 `requireUser`/`requireAdmin`/`authUser`；「登录用户」= X-Auth-Token 令牌。

### 1.1 账号体系（auth 域 · `domains/auth/api.js`）

| 方法 | 路径 | 业务能力 | 门禁 | 请求体关键字段 | 响应字段 | 消费点 |
|---|---|---|---|---|---|---|
| GET | `/api/auth/check?identifier=` | 登录前账号探测 | 公开 | — | `{exists, role}` | auth/actions.js:79-83 |
| POST | `/api/auth/login` | 密码登录 | 公开 | `{identifier, password, deviceId}` | `{user, authToken}` | auth/actions.js:153-156 |
| POST | `/api/auth/login/code` | 验证码登录 | 公开 | `{identifier, code, deviceId}` | `{user, authToken}` | auth/actions.js:150-156 |
| POST | `/api/auth/register` | 注册（学生单表单/教师三步向导） | 公开 | `{username,password,role,deviceId,agree*,phone\|email,code,otpChannel,inviteCode}` | `{user, authToken}` | auth/actions-register.js:150-152 |
| GET | `/api/auth/me` | 会话启动验证/角色恢复 | 登录 | — | `{user}` | auth/flow.js:66-72 |
| POST | `/api/auth/re-auth` | 二次认证（危险操作取 capToken） | 登录 | `{password}` | `{capToken}` | core/ui-modal.js:105-109 |
| POST | `/api/auth/logout` | 登出 | 登录 | `{}` | — | auth/actions.js:169 |
| POST | `/api/auth/otp/request` | 请求短信/邮件验证码 | 公开 | `{channel, target, scene}` | `{ok}` | auth/actions-otp.js:72-79 |
| POST | `/api/auth/phone/bind` | 绑定手机号 | 登录 | `{phone, code}` | `{message, phone(脱敏)}` | auth/actions-otp.js:144-150 |
| POST | `/api/auth/email/bind` | 绑定邮箱 | 登录 | `{email, code}` | `{message, email(脱敏)}` | auth/actions-otp.js:144-150 |
| POST | `/api/auth/check-invite` | 教师邀请码校验 | 公开 | `{code}` | `{ok}` | auth/actions-register.js:68-69 |
| GET | `/api/auth/sessions` | 登录设备列表 | 登录 | — | `{sessions}` | settings/actions.js:146-147 |
| POST | `/api/auth/sessions/revoke` | 撤销远端设备会话 | 登录 | `{sessionId}` | — | settings/actions.js:154 |
| GET | `/api/user/username/status` | 用户名修改冷却 | 登录 | — | `{canChange, cooldownMs}` | settings/actions.js:83-88 |
| POST | `/api/user/username` | 修改用户名 | 登录+capToken | `{newUsername, capToken}` | — | settings/actions.js:137 |
| GET | `/api/user/creds` | 读取绑定手机/邮箱（脱敏） | 登录 | — | `{phone, email}` | settings/actions.js:99-102 |
| POST | `/api/user/avatar` | 头像上传（data URL） | 登录 | `{avatar}` | — | settings/actions.js:184 |
| POST | `/api/user/deactivate` | 注销账户 | 登录+capToken | `{capToken}` | — | settings/actions.js:166 |
| GET | `/api/users/:id` | 用户公开信息 | 公开 | — | `{user}` | teacher/actions.js:115-116 |

### 1.2 需求管理（demand 域 · `domains/demand/api.js`）

| 方法 | 路径 | 业务能力 | 门禁 | 请求体 | 响应字段 | 消费点 |
|---|---|---|---|---|---|---|
| GET | `/api/student/demands` | 需求列表（访客视角） | 公开 | — | `{demands}` | student/actions.js:55 |
| GET | `/api/student/demands?scope=mine` | 我的需求 | 登录+学生 | — | `{demands}`（含 `pending_intents` 徽标） | student/actions.js:36,168,507; teacher/actions.js:66; router.js:267 |
| GET | `/api/student/demands?scope=for-teacher` | 需求大厅（教师看全部） | 登录+教师 | — | `{demands}` | student/actions.js:55 |
| POST | `/api/student/demands` | 新建需求（8 步表单） | 登录+学生 | `{demand:{province,target_type,student_grade,student_gender,target_subjects,current_scores,preferred_personality_tags,preferred_teacher_gender,teaching_goal,skill_notes,teaching_method,address,expected_time,budget_min,budget_max,submitter_type,parent_contact,student_contact,additional_info}}` | — | student/actions.js:466 |
| PUT | `/api/student/demands/:id` | 编辑需求 | 登录+学生 | 同上 | — | student/actions.js:466 |
| DELETE | `/api/student/demands/:id` | 删除需求 | 登录+学生 | `{}` | — | student/actions.js:482 |
| POST | `/api/student/demands/:id/reopen` | 重开需求 | 登录+学生 | `{}` | `{message}` | student/actions.js:491-492 |
| POST | `/api/demands/:id/intents` | 教师提交意向 | 登录+教师 | `{message}` | — | student/actions.js:600 |
| GET | `/api/demands/:id/intents` | 学生查看意向教师列表 | 登录 | — | `{teachers}` | student/actions.js:664-665 |
| POST | `/api/intents/:id/resolve` | 学生接受/拒绝意向 | 登录+学生 | `{action}` | — | student/actions.js:625,636 |
| POST | `/api/demand-pushes` | 学生定向推送需求给教师 | 登录+学生 | `{teacherUserId, demandId, message}` | `{message}` | student/actions.js:544-547 |
| GET | `/api/demand-pushes` | 教师推送列表 | 登录+教师 | — | `{pushes}` | student/actions.js:56; router.js:263 |
| POST | `/api/demand-pushes/:id/resolve` | 教师接受/拒绝推送 | 登录+教师 | `{action}` | — | student/actions.js:554 |

### 1.3 教师域（teacher 域 · `domains/teacher/api.js`）

| 方法 | 路径 | 业务能力 | 门禁 | 请求体 | 响应字段 | 消费点 |
|---|---|---|---|---|---|---|
| GET | `/api/teachers` | 教师列表（广场） | 公开 | — | `{teachers}`（`verified`,`price_min`,`rating`,`time_slots`,`credential_image`…） | teacher/actions.js:46-48; student/actions.js:57 |
| GET | `/api/teacher/profile` | 本人档案（编辑预填） | 登录+教师 | — | `{profile}`（含 `credential_image` 回传） | teacher/actions.js:294-298 |
| GET | `/api/teacher/profile?userId=` | 他人档案（学生看教师详情） | 登录 | — | `{profile}`（含 `signed` 签约门禁标志） | teacher/actions.js:109-111 |
| POST | `/api/teacher/profile` | 保存教师档案（四区全量） | 登录+教师 | `{profile:{province,grade,gender,school,real_name,graduation_year,subjects,price_min,price_max,teaching_method,time_slots,personality_tags,nonacademic_projects,nonacademic_prices,gaokao_scores,intro,address,wechat,email,credential_image}}` | — | teacher/actions.js:359 |
| POST | `/api/teacher/verify-chsi` | 学信网验证码提交 | 登录+教师 | `{code}` | — | teacher/actions.js:399 |
| POST | `/api/teacher/verify-admission` | 录取通知书上传 | 登录+教师 | `{image}` | — | teacher/actions.js:437 |
| GET | `/api/teacher/verify-status` | 核验状态四态（none/pending/approved/rejected） | 登录+教师 | — | verify 状态对象 | teacher/actions.js:295,374 |

### 1.4 评价/奖学金（reviews · awards 域）

| 方法 | 路径 | 业务能力 | 门禁 | 响应字段 | 消费点 |
|---|---|---|---|---|---|
| GET | `/api/reviews?teacherUserId=` | 教师评价列表 | 公开读 | `{reviews}` | teacher/actions.js:132-134 |
| POST | `/api/reviews` | 学生提交评价 | 登录+学生 | — | teacher/actions.js:161 |
| GET | `/api/teacher/awards?userId=` | 教师奖学金列表（他人仅 approved） | 公开 | `{awards}` | teacher/actions.js:140-142 |

### 1.5 聊天/会话（chat 域 · `domains/chat/api.js`）

| 方法 | 路径 | 业务能力 | 门禁 | 请求体 | 响应字段 | 消费点 |
|---|---|---|---|---|---|---|
| GET | `/api/conversations` | 会话列表 | 登录 | — | `{conversations}`（`unread_count`,`last_body`,`student_user_id`） | chat/actions-list.js:69; router.js:255 |
| GET | `/api/conversations/:id/messages` | 消息历史 + 会话快照 | 登录 | — | `{messages, conversation}` | chat/actions-list.js:146-154 |
| GET | `/api/conversations/:id/messages?sinceId=` | 轮询增量（data-mid 去重） | 登录 | — | `{messages}` | chat/actions-list.js:193 |
| POST | `/api/conversations/:id/messages` | 发送消息批次（乐观渲染） | 登录 | `{batch:[{kind, uploadId\|body, clientKey}]}` | `{messages}` | chat/actions-send.js:111-120 |
| POST | `/api/conversations/:id/read` | 标记会话已读 | 登录 | `{}` | — | chat/actions-list.js:108 |
| GET | `/api/conversations/:id/messages/:mid/attachment` | 附件内容（懒加载） | 登录 | — | `{body, name, kind}` | chat/actions-list.js:235 |
| POST | `/api/uploads` | 上传附件（XHR） | 登录 | `{kind, fileData, fileName, thumb}` | `{id}` | core/api.js:101; chat/actions-send.js:207; complaints/actions.js:171 |
| DELETE | `/api/uploads/:id` | 取消/删除未用上传 | 登录 | `{}` | — | chat/actions-list.js:127 等 |

### 1.6 签约/合同（contract 域 · `domains/contract/api.js`）

| 方法 | 路径 | 业务能力 | 门禁 | 请求体 | 响应字段 | 消费点 |
|---|---|---|---|---|---|---|
| GET | `/api/conversations/:id/bindable-demands?phase=signing\|contract` | 会话可签约/可起草需求下拉 | 登录 | — | `{demands}` | contract/actions-draft.js:28,109 |
| POST | `/api/conversations/:id/signing` | 发起签约请求 | 登录 | `{demandId, price, schedule, method}` | — | contract/actions-draft.js:97 |
| POST | `/api/signing-requests/:id/respond` | 响应签约请求（accept 需 capToken） | 登录 | `{accept, capToken?}` | — | chat/actions-misc.js:93 |
| GET | `/api/contracts/my` | 我的合同列表 | 登录 | — | `{contracts}`（`contract_md`,`version`,`prev_business`） | contract/actions-list.js:20 |
| POST | `/api/contracts` | 起草合同 | 登录 | `{conversationId, method, plan, hourlyRate, schedule, location, demandId, payMethod, payMethodOther, firstLessonDate, trialPay, trialPayOther}` | `{message}` | contract/actions-draft.js:255-258 |
| POST | `/api/contracts/:id/sign` | 签署（双签 capToken） | 登录+capToken | `{capToken}` | `{signed}` | contract/actions-sign.js:83-85 |
| GET | `/api/contracts/:id/verify` | 台账验证 | 登录 | — | `{recorded, …}` | contract/actions-sign.js:158-159 |
| POST | `/api/contracts/:id/revoke` | 撤销合同 | 登录+capToken | `{capToken}` | — | contract/actions-sign.js:149 |
| PUT | `/api/contracts/:id` | 修改合同正文（version 乐观锁） | 登录 | `{contractMd, version}` | `{unchanged?}` | contract/actions-sign.js:173-175 |
| DELETE | `/api/contracts/:id` | 取消合同 | 登录+capToken | `{capToken}` | — | contract/actions-sign.js:198 |

### 1.7 帖子/资源广场（posts 域 · `domains/posts/api.js`）

| 方法 | 路径 | 业务能力 | 门禁 | 响应字段 | 消费点 |
|---|---|---|---|---|---|
| GET | `/api/posts?sort=&q=` | 帖子列表（排序/搜索） | 公开（authUser 标 liked） | `{posts}` | posts/actions-list.js:68-73 |
| GET | `/api/posts/favorites/mine` | 我的收藏帖 | 登录 | `{posts}` | posts/actions-list.js:67 |
| POST | `/api/posts` | 发帖 | 登录+教师 | — | posts/actions-editor.js:114 |
| POST | `/api/posts/:id/like` | 点赞 | 登录 | `{liked, likeCount}` | posts/actions-list.js:112-114 |
| POST | `/api/posts/:id/favorite` | 收藏 | 登录 | `{favorited}` | posts/actions-list.js:154-156 |
| DELETE | `/api/posts/:id` | 删帖（本人/管理员越权） | 登录（owner/管理员） | — | posts/actions-editor.js:135; admin/actions.js:422 |

### 1.8 通知中心（core/notify.js 特殊路由）

| 方法 | 路径 | 业务能力 | 门禁 | 响应字段 | 消费点 |
|---|---|---|---|---|---|
| GET | `/api/notifications` | 通知列表 | 登录 | `{notifications}` | notif/actions.js:56; router.js:256 |
| POST | `/api/notifications/:id/read` | 单条已读 | 登录 | — | notif/actions.js:76 |
| POST | `/api/notifications/read-all` | 全部已读 | 登录 | — | notif/actions.js:91 |
| POST | `/api/notifications/broadcast` | 管理员广播 | 管理员+capToken | — | posts/actions-editor.js:212 |

### 1.9 投诉/反馈（complaints 域 · 含 feedbacks）

| 方法 | 路径 | 业务能力 | 门禁 | 请求体 | 响应字段 | 消费点 |
|---|---|---|---|---|---|---|
| GET | `/api/complaints/recent?target=` | 投诉候选（最近交互对象） | 登录 | — | `{candidates}` | complaints/actions.js:60-64 |
| GET | `/api/complaints/candidates?target=&q=` | 投诉候选搜索 | 登录 | — | `{candidates:[{id,name,subtitle}]}` | complaints/actions.js:79-81 |
| POST | `/api/complaints` | 提交投诉 | 登录 | `{targetType, targetId, reason, detail, uploadIds}` | — | complaints/actions.js:224 |
| GET | `/api/complaints/:id/attachment?idx=` | 投诉附件 | 登录 | — | `{body, kind, name}` | complaints/actions.js:236-238 |
| GET | `/api/complaints/mine` | 我的投诉 | 登录 | — | `{complaints}` | posts/actions-feedback.js:73 |
| POST | `/api/feedbacks` | 提交反馈 | 登录 | `{kind, title, content}` | — | posts/actions-feedback.js:53 |
| GET | `/api/feedbacks/mine` | 我的反馈 | 登录 | — | `{feedbacks}` | posts/actions-feedback.js:72 |

### 1.10 隐私设置（settings 域）

| 方法 | 路径 | 业务能力 | 门禁 | 请求体/响应 | 消费点 |
|---|---|---|---|---|---|
| GET | `/api/privacy-settings` | 隐私设置读取 | 登录 | `{allowGuestProfile, allowGuestDemand}` | settings/actions.js:108-113 |
| POST | `/api/privacy-settings` | 隐私设置写入 | 登录 | `{[key]: 0\|1}` | settings/actions.js:121 |

### 1.11 基础设施/安全（特殊路由 + batch）

| 方法 | 路径 | 业务能力 | 门禁 | 说明 |
|---|---|---|---|---|
| POST | `/api/captcha/verify` | 滑块拼图验证 | 公开 | `{captchaId, offset, track}` → `{ok, message?, score?}`；前端防线 |
| GET | `/api/data-version` | 版本探针（域计数器） | 公开 | 缓存失效协议（见 §4 M4） |
| POST | `/api/batch` | 批量 GET 聚合 | 子请求同权限面 | `{gets:[paths]}` → `{results}`；前端优化通道，可弃用直连各 GET |

### 1.12 管理端（admin/awards/reviews/teacher 管理路由，全部 requireAdmin）

| 方法 | 路径 | 业务能力 | 消费点 |
|---|---|---|---|
| GET | `/api/admin/stats` / `dashboard` / `traffic?range=` | 统计卡/仪表盘/流量图表 | admin/actions.js:33-37,97-117 |
| GET | `/api/admin/users?role=&q=` | 用户管理（学生/教师+搜索） | admin/actions.js:127-129 |
| POST | `/api/admin/users/:id/ban` | 封禁/解封（capToken） | admin/actions.js:523 |
| GET | `/api/admin/demands?cursor=` + DELETE `:id` | 需求管理（keyset 分页） | admin/actions.js:186-202 |
| GET | `/api/admin/reviews?status=` + approve/reject/DELETE | 评价审核 | admin/actions.js:213-215; teacher/actions.js:175-182 |
| GET | `/api/admin/content?type=` + POST `:type/:id/action` | 内容审核（10 类型） | admin/actions.js:264-353 |
| GET | `/api/admin/contracts` + DELETE `:id` | 合同管理 | admin/actions.js:435-481 |
| GET | `/api/admin/awards?status=` + `:id/proof` + `:id/action` | 奖学金审核 | admin/actions.js:588-644 |
| GET | `/api/admin/verifications?status=` + POST `:id/action` | 教师认证审核 | admin/actions.js:662-743 |
| POST | `/api/admin/teachers/:id/verify` | 教师认证/撤认证 | admin/actions.js:762 |
| POST | `/api/admin/invite` + GET `/api/admin/invites` + DELETE `:code` | 邀请码管理 | admin/actions.js:533-568 |

**管理端子接口按业务能力独立**：换壳时管理端 11 个模块各消费独立标准接口，可任意组织入口层级。

---

## 2. 服务端路由清单（T-2）

真源：`src/server/app.js:36-49` routes 数组（11 域 routes + 6 特殊路由）+ `_worker.js:93-110` routeApi 额外 3 条。**共 116 条分发路由**（app.js 113 + routeApi 3），与 route 契约测试 `test/v1-5-route-contract.test.js`（断言 `routes.length === 113`）精确一致。

- 按域分布：auth 19 / admin 17 / contract 12 / demand 11 / complaints 11（含 feedbacks）/ teacher 9 / chat 7 / reviews 7 / posts 6 / awards 6 / settings 2 + 通知 4 + 版本/captcha 2 + batch/health/keepalive 3。
- **特殊路由**：通知（list/read/read-all/管理员删）、`GET /api/data-version`、`POST /api/captcha/verify`；routeApi：`POST /api/batch`（禁 `/api/auth/check` 子路径，Z-1-F2）、`GET /api/health`（release gate 503）、`GET /api/keepalive`（D1 三库保温）。
- **路径命名正交性**：全部 116 条路径为业务能力导向，**零前端组织词**（无 `/api/pages/`、`/api/sidebar`、模块名、页面 id、侧栏序）。`student/teacher/admin` 前缀是业务角色/资源归属；`my/mine` 是 REST 资源限定符；`scope=`/`phase=`/`sinceId=`/`sort=`/`q=`/`status=`/`target=`/`range=`/`cursor=`/`idx=` 全是业务/数据语义，非布局语义。响应形状为扁平领域对象数组，不携带布局/排版字段。

---

## 3. 接口对账（T-3）

### 3.1 对账结果

- **缺失接口（前端调服务端无）：零**——无 1101 级断线。前端全部 113 个路径变体（含模板串、query 变体、XHR 上传）均命中服务端路由。
- **孤儿接口（服务端有前端无）：10 条**，全部可保留：

| # | 端点 | 判定 |
|---|---|---|
| O-1/O-2 | `GET /api/admin/logs`、`GET /api/admin/logs/:id/decrypt` | 管理员日志查看页 v2 未重建（B5 休眠），backoffice 审计接口 |
| O-3 | `DELETE /api/admin/messages/:id` | 管理员删消息无 UI 触发点 |
| O-4 | `POST /api/admin/reencrypt` | 运维脚本驱动（reencrypt-production.sh），非前端业务接口 |
| O-5 | `DELETE /api/admin/notifications/:id` | 管理员删广播通知无 UI（误发撤销） |
| O-6/O-7 | `DELETE /api/teacher/awards/:id`、`POST /api/teacher/awards` | 教师奖项提交/删除 UI 在 v2 缺失——**服务端能力完整**（含 proofUploadId 校验、AWARDS_MAX、logEvent），新前端可补齐 |
| O-8 | `PUT /api/reviews/:id` | 评价编辑 UI 缺失，handler 存活 |
| O-9 | `GET /api/health` | 运维探针 |
| O-10 | `GET /api/keepalive` | 仓库外 keepalive-worker cron 打点 |

### 3.2 形状失配清单（6 处，全部低危）

| # | 位置 | 现象 | 处置 |
|---|---|---|---|
| **S-1** | admin/repo.js:90-113 → admin/actions.js:148 `u.user_id \|\| u.id` | 同一概念「用户 id」随角色换字段名（教师行 `u.id AS user_id` 时 `id`=teacher_profile.id；学生行 `u.id`） | **T-6-F2 修复**：服务端统一输出 `user_id` |
| **S-2** | teacher/repo.js:150-153 `mapTeacherProfileRow` | time_slots 留原始字符串，与他 JSON 列（subjects/gaokao 走 safeJsonArray）不一致 → 前端 `typeof==='string' ? JSON.parse` 双形态 | **T-6-F3 修复**：mapper 统一 safeJsonArray |
| **S-3** | chat/repo.js:110,120 → chat/render.js:156/176 | 消息 body 以 JSON 字符串落库/回传（客户端自著内容契约），服务端透明搬运 | **保留**（client↔client 内容契约，非服务端失配） |
| **S-4** | teacher/actions.js:476 | gaokao_scores 防御性 string 分支近死代码（mapper 恒返回数组） | **T-6-F3 顺带删除** |
| **S-5** | admin/actions.js:283 `it.title \|\| it.type` | content 条目服务端恒设 title，`\|\| it.type` 为防御兜底 | **保留**（无害） |
| **S-6** | actions-otp.js:76 ↔ auth/api.js:60-63 | **受控枚举用中文文案当值**：`scene: TEXT.OTP_SCENE_*` 文案字面量当业务枚举传服务端，服务端 `SCENE_WHITELIST=['登录验证','绑定验证','注册验证']` 硬编码中文白名单——改 text.js 任一键即静默失配 | **T-6-F1 修复**：共享 enums 单源 |

**错误码分支核对**：`OTP_EXHAUSTED`、`CONTRACT_MODIFIED_CONFLICT`、`POST_NOT_FOUND` 等前端 `err.code` 分支全部经 `src/shared/codes.js` CODES 单源映射，无中文文案脆耦合。

---

## 4. 共享依赖图与耦合点分级（T-4）

### 4.1 共享源消费面

| 共享源 | 前端 import 数 | 消费内容 | 判定 |
|---|---|---|---|
| `shared/config.js` | 35 | CONFIG/LIMITS/APP_VERSION（超时/轮询/弹窗宽/maxlength/版本探针） | 全部合法（交互参数+数值限额）；**前端从不 import** `RATE_LIMITS/SECURITY_HEADERS/TEXT_AUDIT/ADDRESS_GUARD/哈希条件`（grep 零命中） |
| `shared/enums.js` | ~40 | SUBJECTS/STUDENT_GRADES/TEACHER_GRADES/GENDERS/TEACHING_METHODS/WEEKDAYS/PERSONALITY_TAGS/NONACADEMIC_PROJECTS/TEACHING_GOALS/VERIFY_TYPES/STATUS/AWARD_STATUS/DEMAND_TYPES/ROLES/DEACTIVATED_USER_PREFIX | 全部合法（表单白名单/状态/角色字面量 = 领域词汇） |
| `shared/region-data.js` | 5（2 直接 + 2 经 re-export + 1 定义） | SUFE_REGIONS（契约 9） | 合法；**M2**：teacher/render.js:18 + teacher/actions.js:7 直接 import 绕过 constants/region-data.js 分层入口 |
| `shared/codes.js` | **零** | — | 错误文案/code 由服务端响应体下发，前端零双源（干净契约通道） |

### 4.2 前端 JSON.parse 盘点（全部 API 契约解析，无 schema 双源副本）

`api.js:111/114`（XHR 响应）、`state.js:58/74/79`（localStorage）、`teacher/actions.js:252/476`（time_slots/gaokao 列，S-2/S-4）、`student/display.js:40`（expected_time 列）、`ui-form.js:282`（time_slots 列）、`chat/actions-list.js:211`+`chat/render.js:156/176`（消息 body 列，S-3）。**没有一处前端重声明服务端 schema 结构**。

### 4.3 服务端内部结构泄漏检查（全零）

| 检查项 | 结果 |
|---|---|
| `from ... server/` 于 src/client | 零命中 |
| `domains/` 于 src/client（import 面） | 零命中（仅 1 处文档性注释） |
| 根 `server/constants.js` 被前端 import | 零命中 |
| `require/process.env/__dirname/node:fs/node:crypto/node:path` | 零命中 |
| 前端本地重声明枚举 / 硬编码省份列表 | 零命中（M1 省 id 字面量除外，见下） |
| secrets 链泄漏 | 零命中 |

### 4.4 耦合点分级汇总

- **✅ 合法单源（零动作，新壳可原样复用）**：全部 CONFIG/LIMITS/enums/SUFE_REGIONS 消费；通知 type 注册表（test/notif-structured.test.js 锁定「every type has NOTIF_ template」）。
- **⚠️ 需收口（4 项）**：

| # | 位置 | 现象 | 处置 |
|---|---|---|---|
| **M1** | match.js:53、student/actions.js:397/418/886、teacher/actions.js:488 | `'shanghai'` 省 id 硬编码 5 处，绕过 `SUFE_REGIONS.allowsOffline()` 单源（region-data.js:277，同文件 :493 已用）；若未来开第二省 offlineAllowed 则 5 处漏同步 | **T-6-F4 修复** |
| **M2** | teacher/render.js:18、teacher/actions.js:7 | 直接 `from shared/region-data.js` 绕过 constants/region-data.js 分层入口（display.js:11、notif/render.js:13 均走 re-export） | **T-6-F5 修复** |
| **M3** | text.js:165 vs contract/api.js:43 | `CONTRACT_BIZ_END` 双源哨兵（前端前缀 / 服务端全句），零 parity 测试锁；改哨兵措辞即合同正文解析静默断 | **T-6-F6 修复** |
| **M4** | version.js:25-28 vs datahub.js:131-184 | `/api/data-version` 域键集合是跨栈缓存失效协议（新增域须 server `versionDomainOf` + 前端 `DH_PREFETCH` 双侧同步；`account`/`misc` 有意豁免） | **T-6-F7 修复** |

- **❌ 深耦合要改：无。**

---

## 5. 前端重做接入指南

### 5.1 业务能力接入表（换壳时任意位置可接入）

| 业务能力 | 接入端点（方法/路径/门禁） |
|---|---|
| 账号体系 | `POST /api/auth/register`、`/login`、`/login/code`、`GET /api/auth/me`、`POST /api/auth/logout`、`/re-auth`（capToken 源）、`/api/auth/otp/request`、`/phone/bind`、`/email/bind`、`/sessions`、`/sessions/revoke`、`/api/user/{username,avatar,deactivate}`、`/creds`、`/username/status`（全部登录门禁如 §1.1） |
| 教师档案 | `GET/POST /api/teacher/profile`（自）、`?userId=`（他）、`POST /api/teacher/verify-chsi`、`/verify-admission`、`GET /api/teacher/verify-status`、`GET /api/teachers` |
| 需求管理（学生） | `GET/POST/PUT/DELETE /api/student/demands`（±`:id`/`reopen`）、`GET /api/demands/:id/intents`、`POST /api/intents/:id/resolve` |
| 需求大厅（教师/访客） | `GET /api/student/demands?scope=mine\|for-teacher`、`GET /api/demand-pushes`、`POST /api/demands/:id/intents`、`POST /api/demand-pushes/:id/resolve` |
| 定向推送 | `POST /api/demand-pushes` |
| 评价/奖学金 | `GET /api/reviews?teacherUserId=`、`POST /api/reviews`、`GET /api/teacher/awards?userId=` |
| 聊天/会话 | `GET /api/conversations`、`GET/POST /api/conversations/:id/messages`（`?sinceId=` 轮询）、`POST .../read`、`GET .../:mid/attachment`、`POST /api/uploads`、`DELETE /api/uploads/:id` |
| 签约流程 | `GET /api/conversations/:id/bindable-demands?phase=signing`、`POST /api/conversations/:id/signing`、`POST /api/signing-requests/:id/respond`（accept 须 capToken） |
| 合同流程 | `POST /api/contracts`、`GET /api/contracts/my`、`POST :id/sign`（capToken）、`GET :id/verify`、`POST :id/revoke`（capToken）、`PUT :id`（version 乐观锁）、`DELETE :id`（capToken） |
| 帖子广场 | `GET /api/posts?sort=&q=`、`/favorites/mine`、`POST /api/posts`、`/api/posts/:id/{like,favorite}`、`DELETE :id` |
| 通知中心 | `GET /api/notifications`、`POST :id/read`、`/read-all` |
| 投诉/反馈 | `GET /api/complaints/recent?target=`、`/candidates?target=&q=`、`POST /api/complaints`、`GET /mine`、`/:id/attachment`、`POST /api/feedbacks`、`GET /api/feedbacks/mine` |
| 隐私设置 | `GET/POST /api/privacy-settings` |
| 滑块验证码 | `POST /api/captcha/verify`（前端防线；`score` 仅诊断） |
| 管理端 11 模块 | 见 §1.12 各独立标准接口 |

**接口帽模式**：新前端未就绪的页面/组件对接的接口打 `dummy` 标记（接口已定义、UI 未接线），沿用现有 B5 休眠注记惯例。

### 5.2 共享模块换壳取舍

- **保留单源 import（推荐）**：`shared/{config,enums,region-data}.js` 是业务常量（限额/白名单/省份政策），非服务端内部结构——任何形态的前端都必须具备这些领域词汇，换壳继续 import 即合法复用。
- **不 import codes.js**：错误文案/code 由响应体下发，新前端无需双源。
- **弃用 `/api/batch`**（可选）：前端专用聚合优化，新前端可直连各 GET。
- **认证通道**：X-Auth-Token 请求头 + `/api/auth/me` 会话恢复 + 401 兜底（详见需求 AG-3 认证/路由横切面设计）。

---

## 6. 深耦合点清单

**判定：无一条需接口化改造的深耦合点。** 以下为轻-中耦合收口项（已拆 T-6-F1..F7，独立 commit + 独立审计）：

| 基元 | 内容 | 来源 |
|---|---|---|
| T-6-F1 | OTP scene 枚举单源（值不变零迁移） | S-6 |
| T-6-F2 | admin users 统一 `user_id`（消前端 role 三元） | S-1 |
| T-6-F3 | time_slots mapper 统一 safeJsonArray + 删 gaokao 死分支 | S-2/S-4 |
| T-6-F4 | 省 id 硬编码 → `allowsOffline()` 单源 | M1 |
| T-6-F5 | region-data 统一 re-export 入口 | M2 |
| T-6-F6 | 合同哨兵跨栈 parity 锁 | M3 |
| T-6-F7 | data-version 域键跨栈协议锁 | M4 |

有意保留（非缺口）：S-3（chat body client↔client 内容契约）、S-5（admin content 防御兜底）。

---

## 7. 正交性总评

**判据达成**：「后端结构不依赖前端组织、前端结构不受后端制约」在当前架构**成立**。证据：

1. **路径零页面组织词**：116 条端点全部业务能力命名，前端页面组织（侧栏序/模块归并/多列/入口变化）纯前端 router `registerPage` 概念，服务端零感知。
2. **响应字段是稳定 API 契约而非布局指令**：前端直接消费 snake_case 业务字段，无第二套 camelCase 包装、无布局提示字段、无字段名三元适配（S-1 收口后为零）。
3. **前端源码目录镜像后端域 = 源码组织呼应，非运行时依赖**：shell/router 页面路由全在前端内部，新壳可任意重新组织。
4. **共享 import 全是业务领域词汇**（白名单/限额/省份），非 DB 结构/secrets/路由内部实现；该共享的共享，不该共享的（RATE_LIMITS/安全策略/服务端私有）零泄漏。
5. **前端零服务端内部耦合**：不 import `domains/*`、根 `server/`、secrets 链、Node 内置；网络边界 `core/api.js` 单点。

**差距清单（收口后闭合）**：S-1 字段名随角色漂移（T-6-F2）、S-2/S-4 服务端 JSON 列反序列化例外（T-6-F3）、S-6 文案当枚举（T-6-F1）、M1 省 id 硬编码（T-6-F4）、M2 分层入口绕过（T-6-F5）、M3 双源哨兵无锁（T-6-F6）、M4 跨栈协议无锁（T-6-F7）。这些是**契约完整性**收口，非正交性缺口——正交判据在收口前已达，收口后契约更稳。

---

*报告基于 T-1/T-2/T-3/T-4 四面只读 agent 审计整合（2026-08-21），证据链文件:行号可回溯。与架构契约速查 / architecture.md 一致；本报告只评估+拆解，不改业务逻辑（用户明确「底层业务逻辑不变」）。*
