# 待办队列（worklist，非 changelog）

> 可执行的工作清单。已完成/弃置的历史审计登记已清理；只保留 v2 之后的待办与关键决策。

## 保留专项（攒批，勿混入小修）
- **z-index / 860 断点 token 化**：base.css :root 定义 `--z-*` / `--bp-*`，各文件统一引用（当前数值一致仅散落）。全站 CSS 重构面，视觉回归风险，攒批。
- **管理员列表分页**：评价/反馈/合同管理端列表加 keyset 游标（dbGetDemands admin 已有先例）。功能改进，生产数据量小非紧急。
- **Q-2i-M4 服务端 ROLES/STATUS 未收敛共享 enums**：domains 各 api/repo 大量裸 `'student'/'teacher'/'open'/'pending'` 字面量未引 `src/shared/enums.js`。收敛 = 几百处等价替换（零行为变化）+ SQL 字面量本就不可用 JS enums。改动面巨大、收益为架构一致性。
- **Q-2i M6/M7 + L1-L9 描述丢失**：Q-2i/Q-2f 审计细节丢失，需重跑对应审计面复核后执行。

## 性能优化备忘（按优先级）
- **日志保留期定期清理**：留档已 -96%，但长尾仍线性增长（~45MB/年）；可加保留期删除任务（如 90 天）。需用户定保留期。
- ~~构建哈希 + 内容哈希文件名 + 长 immutable Cache-Control~~ → **已落地**（scripts/build.mjs 经 esbuild code splitting 产出内容哈希资产，`/assets/*` immutable）。
- ~~JS 合并/内联关键资产~~ → **已落地**（esbuild code splitting + 共享 chunk）。
- ~~Early Hints preload~~ → pages.dev 自动开启。
- ~~Cloudflare China Network~~ → 需 ICP 备案 + 企业版，不可行，弃置。

## 产品改进
- **onboarding 引导精简**：用户反馈教程太繁琐，精简到 5~6 步核心功能（当前 onboarding-tour 步数多）。攒批专项。

## 轻量审计观察项（攒批）
- **T-6-F1-OBS1 otp.js fallback 硬编码中文场景**（src/server/core/otp.js `scene || (ch==='email' ? '登录验证' : '身份验证')`）：`'身份验证'` 不在 OTP_SCENES 内，属防御性兜底；若改 OTP_SCENES.LOGIN 会陈旧。
- **T-6-F1-OBS2 otp-delivery.test.js 场景字面量**：用 `'登录验证'` 字面量而非 OTP_SCENES.LOGIN。
- **T-6-F2-OBS dbGetStudentUsersAdmin 列表出口无 DB 直测**：仅学生搜索出口被直测，列表出口可补一条。
- **T-6-F7-OBS getVersions 默认 0 键与 DOMAINS 一致性无锁**：若 DOMAINS 加域漏补默认键，首次 bump 前响应无该域基线。
- **AI-7 ×2**（GET /api/my-relations 聚合）：排序平局 rowid 理论注记；signing 聚合子查询性能可优化非必需。
- **AI-8 L1/L2/L3**（DELETE /api/admin/relations）：404 不消费 capToken 无测试兜底；「评价保留」未直接测试；`if (conv.demand_id)` 外层 guard 冗余。
- **AI-9 O-2 chatPollTick 轮询不处理快照状态翻转**：对端 close 后本端 frame 保持 active 可写，直到重开才显示 closed（服务端 403 兜底，非断线）。
- **AI-9 O-3 verify-chat-layout.mjs 未覆盖 .chat-head-actions 几何断言**。
- **AI-9 O-4 doCloseRelation 403 失败路径无直接测试**。
- **AI-9 · settings/actions.js .btn-danger 死类**：全仓无 CSS 规则，吃引擎默认白按钮。删类名或补规则。
- **AI-9 · CHAT_CONVERSATION_CLOSED 前端无消费点**：前端统一展示 MSG 中文，code 仅测试断言用；可后续补前端 code 消费统一层。
- **NO_PERMISSION 跨面注记**（chat/api.js 发送 + contract/api.js 创建）：closed 会话入口返回 NO_PERMISSION 而非 CONVERSATION_CLOSED——有意设计（closed frame 不渲染入口），勿误当 bug。
- **CONTRACT_REVOKED 文案语义待核**：text.js「{name}」已撤销双方签署的合同」文案 vs 系统级联撤销（revoked_by=0）场景语义是否失准。

## 视觉（用户再要求才做）
- **vivid「clear-over-vivid」宝石按钮**：可选增强，用户要求才出原型，不做全站；不要为它给按钮开特例渲染路径。

## 已判定不改（保留，附理由）
- **C8 `role-tabs::after`**：非孤儿，是滑动下划线指示器；删了会丢激活下划线。
- **C12 constants 同文案多键**：状态 tag 与操作 toast 文案语义不同，合并会降低清晰度。
- **C4 台账内联 SQL**（contract.js）：LEDGER_DB 覆写域，挪 db.js 会循环依赖，有意保留+注释。
- **B2 `.form-select` v 箭头 background-image**：无 JS 兜底（select 被 initCustomSelects 隐藏仅 JS 跑时），保留。
- **U10 会话鉴权缓存**：登出/封禁/停用须即时失效，而 Pages 多实例无法全局失效——任何 TTL 窗口都引入「已封禁用户仍可操作」的安全窗口。保持每请求实时 D1 鉴权，不做会话缓存。
- **keepalive**：已降级为保底保险（initDb schema 版本判断已治本冷启动）；保留 /api/keepalive 路由 + keepD1Warm，开销可忽略。停用需用户外部操作（keepalive-worker/ 在仓库外）。
