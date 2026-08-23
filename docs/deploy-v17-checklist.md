# 新站生产切换执行清单（阶段四 · 合并替换 main · 全新开始方案）

> 状态：2026-08-23 修订。**用户决策（2026-08-23 拍板）：全新开始——丢弃全部业务历史数据，只保留账户数据 + 账户操作留档 + 个人资料可迁移字段。**
> 迁移演练（`scripts/fresh-start-drill.mjs`）已在生产 D1 导出副本全过（保留集原位零丢失 + 业务表全清 + v18 幂等）。
> 本文档是生产写操作执行手册，**执行时机由用户拍板**（W38：生产切换 = 后果严重需用户判断）。
> 前置：new-site 分支已收口（fff11a4，全量 1355/1355 + 双 arch 绿 + build 绿）。

## 0. 用户决策点（已拍板，2026-08-23）

| # | 决策 | 定案 |
|---|---|---|
| D1 | **切换窗口** | **现在切换**（用户拍板）——一次性切换，旧站（v2）与新站共用生产 D1 |
| D2 | **历史数据范围** | **全新开始**（用户拍板）——丢弃全部业务历史数据（需求/签约/聊天/合同/帖子/评价/通知等），只保留**账户数据 + 账户相关操作留档 + 个人资料可迁移字段** |
| D3 | **公告** | 新站是全新 UI，建议发（待 admin 口令） |

### D2 保留集 / 丢弃集（写死，演练断言锁定）

**保留集（KEEP，原位保留零搬运）**：
| 表 | 内容 | 行数 |
|---|---|---|
| `users` | 账户数据（用户名/口令哈希/角色/联系方式/头像） | 44 |
| `activity_log` | 账户相关操作留档 | 3403 |
| `teacher_profiles` | 教师个人资料可迁移字段 | 11 |
| `teacher_verifications` | 教师核验状态（2 approved/2 pending/1 rejected） | 5 |
| `schema_meta` | 版本元数据（保留以走 v13→v18 迁移链） | 1 |

> **口径注记（PA-2b F6）**：上表是**表级**保留集行数。教师广场（学生侧）列出的是有档案的教师
> （`teacher_profiles JOIN users`）= 11；`users` 中 `role='teacher'` 的**账户**数（管理端教师列表
> 经 `users LEFT JOIN teacher_profiles` 展示）可能多于 11（含未补全档案的账户）。两数差异属
> 预期（档案是可迁移字段子集），非数据丢失。

**丢弃集（DROP，业务历史数据全删）**：`conversations/messages/uploads`（聊天）· `student_demands`（需求）· `signing_contracts/contract_ledger`（签约/合同/台账）· `posts/post_likes/post_favorites`（帖子）· `reviews`（评价）· `complaints/feedbacks`（投诉/反馈）· `notifications`（通知）· `auth_sessions/rate_limits/verification_codes/danger_caps`（会话/限流/验证码/capToken 运行时）· `invite_codes`（邀请码）· `demand_intents/demand_pushes/teacher_awards/user_settings/data_versions/request_metrics`（S 域已删旧表 + 观测表）。

**方案**：保留集表原位保留（一个字节不动），只 DROP 业务表 → 部署新站后 worker initDb 自动跑 v13→v18（保留集表 ensureColumns 补列 + 业务表重建为空）。**不搬 activity_log 3403 行 → 零数据丢失风险；生产写操作最小化（一个 DROP SQL）。**

## 1. 前置检查（只读，无副作用）

```bash
# 1a. 生产版本确认（应为 v13）
node -e "import('./scripts/wrangler-d1.mjs').then(async ({d1ReadQuery,D1_DB_NAME})=>{
  console.log(JSON.stringify(await d1ReadQuery(D1_DB_NAME,\"SELECT v FROM schema_meta WHERE k='schema'\")))})"

# 1b. 全量备份（业务库导出到私有目录，chmod 0o600）——恢复点 1（切换前完整快照）
#     fresh-start-drill 无 --export 时自动导出到私有临时目录；要留持久备份用 wrangler d1 export：
wrangler d1 export sufe-tutor-db-apac --remote --output <私有路径>/prod-backup-v13.sql

# 1c. 台账库独立备份（若生产 LEDGER_DB 独立绑定；本库 contract_ledger 在业务库内则跳过）
```

## 2. 全新开始迁移演练（本地副本，只读，无副作用）

```bash
# 2a. 跑演练（自动导出生产副本 → DROP 业务表 → initDb v18 → 断言保留集零丢失/业务表全清/幂等）
node scripts/fresh-start-drill.mjs --emit-drop .probe/drop-business-tables.sql

# 预期：全部 ✔ 通过。产出 .probe/drop-business-tables.sql（24 条 DROP，生产执行用）
# 已跑通过（2026-08-23）：保留集 4 表原位零丢失 + 业务表全清 + v18 幂等 + FK 零违规。
```

## 3. 生产 DROP 业务表（写操作 · 用户已拍板 D1/D2）

> **先确认 1b 备份已留**（DROP 不可逆，恢复点 1 是唯一回滚依据）。

```bash
# 3a. 执行 DROP（24 条业务表；保留集 5 表 + _cf_KV + sqlite_* 不动）
wrangler d1 execute sufe-tutor-db-apac --remote --file .probe/drop-business-tables.sql

# 3b. 确认保留集原位（只读）
node -e "import('./scripts/wrangler-d1.mjs').then(async ({d1ReadQuery,D1_DB_NAME})=>{
  for (const t of ['users','activity_log','teacher_profiles','teacher_verifications'])
    console.log(t, (await d1ReadQuery(D1_DB_NAME, 'SELECT COUNT(*) AS n FROM \\\`'+t+'\\\`'))[0].n)})"
# 预期：44 / 3403 / 11 / 5（与 1b 备份前一致）
```

## 4. 合并替换 main + 部署（写操作 · 用户已拍板 D1）

```bash
# 4a. main 冻结 + 打回滚 tag（v2-legacy-final 已存在指向 080cb0b，可再打 v2-legacy-2）
git tag v2-legacy-final-2 main

# 4b. new-site → main（fast-forward）
git checkout main && git merge --ff-only new-site

# 4c. push 触发 Pages 部署（Pages build_config 已配 git 自动构建 dist）
git push origin main
# 部署后 worker 首次请求自动 initDb v13→v18（保留集 ensureColumns 补列 + 业务表重建空）
```

## 5. 部署后验证（只读）

```bash
# 5a. 版本探针 + health
curl https://sufe-tutor.pages.dev/api/health    # 应 ready:true + schema v18

# 5b. 保留集数据完整 + 业务表全空（对照演练断言）
node scripts/fresh-start-drill.mjs --export <1b 的备份>   # 本地重放备份确认迁移正确（复用 1b 文件）
node -e "import('./scripts/wrangler-d1.mjs').then(async ({d1ReadQuery,D1_DB_NAME})=>{
  for (const t of ['users','activity_log','teacher_profiles','teacher_verifications','conversations','messages','student_demands','contracts','posts','reviews','notifications'])
    console.log(t, (await d1ReadQuery(D1_DB_NAME, 'SELECT COUNT(*) AS n FROM \\\`'+t+'\\\`'))[0].n)})"
# 预期：44/3403/11/5 + 业务表全 0

# 5b2. contract_ledger 生产终态（worker boot initLedgerTable 重建空表——演练终态是「不存在」，生产终态是「存在且空」，审计 F3 闭合）
node -e "import('./scripts/wrangler-d1.mjs').then(async ({d1ReadQuery,D1_DB_NAME})=>{
  console.log('contract_ledger', (await d1ReadQuery(D1_DB_NAME, 'SELECT COUNT(*) AS n FROM contract_ledger'))[0].n)})"
# 预期：0（存在且空——worker 已 initLedgerTable 重建）

# 5c. 资产完整性
curl -I https://sufe-tutor.pages.dev/            # 200 + 严格 meta CSP
# 资产 200 + immutable + SPA 回退 200 + 零 CSP 违规（verify-site-smoke 实机）

# 5d. QA 全链路冒烟（新前端真实用户旅程）
node scripts/verify-site-smoke.mjs               # 本地构建产物冒烟（8 硬门）
```

## 6. 回滚（任何一步失败）

- **迁移前**：恢复点 1 = 1b 的全量备份（`wrangler d1 execute --file` 回灌）+ main 回滚到 `v2-legacy-final-2`。
- **DROP 后未部署**：备份回灌即可（业务表重建由 initDb 幂等处理；保留集原位未动）。
- **部署后**：git revert main 到 v2-legacy-final-2（旧站代码 + 旧数据备份回灌）。注意新站 W1 无向后兼容——v18 库 v2 代码读不了，回滚必须同时还原数据备份。
- **业务数据已丢不可恢复**：D2 决策明确丢弃，回滚只能恢复到 1b 备份时点（含已丢弃业务数据——若需回滚至切换前完整状态，必须用 1b 备份回灌 + v2-legacy-final-2 代码）。

## 7. 收尾

- 公告（D3）+ 反馈单巡检（admin 口令）
- 需求 PA（生产三轮审计）正式启动：PA-1 静态源码审计（不依赖生产，可并行先行）→ PA-2 黑盒 → PA-3 数据横切
