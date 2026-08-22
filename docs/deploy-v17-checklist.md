# 新站 v17 生产切换执行清单（阶段四 · 合并替换 main）

> 状态：2026-08-23 定稿。迁移演练（`scripts/migration-drill-v17.mjs`）已在生产 D1 导出副本全过。
> 本文档是生产写操作执行手册，**执行时机由用户拍板**（W38：生产切换 = 后果严重需用户判断）。
> 前置：new-site 分支已收口（fff11a4，全量 1355/1355 + 双 arch 绿 + build 绿 + 迁移演练 PASS）。

## 0. 用户决策点（执行前必须拍板）

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| D1 | **切换窗口** | 何时执行生产迁移 + 部署？旧站（v2）下线时点？ | 低峰时段，一次性切换（旧站与新站共用生产 D1，迁移后旧站需求功能形状不符） |
| D2 | **R-3 signing 层丢弃** | 生产 1 行 `stage='signing'` 数据将被丢弃（S5-19 弃签约层） | 接受（该行是进行中签约请求，新站无签约层；历史气泡仍保留在 messages 中） |
| D3 | **公告** | 上线是否发公告？ | 新站是全新 UI，建议发 |

## 1. 前置检查（只读，无副作用）

```bash
# 1a. 生产版本确认（应为 v13）
node -e "import('./scripts/wrangler-d1.mjs').then(async ({d1ReadQuery,D1_DB_NAME})=>{
  console.log(JSON.stringify(await d1ReadQuery(D1_DB_NAME,\"SELECT v FROM schema_meta WHERE k='schema'\")))})"

# 1b. 全量备份（业务库 + 台账库导出到私有目录，chmod 0o600）
#     ——恢复点 1（迁移前完整快照）
node scripts/migration-drill-v17.mjs --export <私有路径>/prod-backup.sql   # 先跑一次留备份（脚本会走全流程，最后可 Ctrl-C 或让它跑完）

# 1c. 台账库独立备份（若生产 LEDGER_DB 独立绑定）
#     wrangler d1 export <ledger-db-name> --remote --output <私有>/ledger-backup.sql
```

## 2. 生产 demand 迁移（写操作 · 需用户在场/确认）

```bash
# 2a. 干跑核对（只读统计，不写）
node scripts/migrate-demands-single-subject.mjs --dry-run

# 2b. 正式迁移（--keep-old 先跑一遍，核对新表数据后再重建表；或直接 --apply）
node scripts/migrate-demands-single-subject.mjs --apply          # 默认路径：DROP 旧表 + 换表 + R-1 快照恢复
#     --apply 会生成 SQL 文件经 wrangler d1 execute --file 执行（单文件事务）
#     预期输出：5 行 → 10 行单科目；remapped=1（会话 demand_id 保全）；0 丢弃
```

## 3. 合并替换 main + 部署

```bash
# 3a. main 冻结 + 打回滚 tag（v2-legacy-final 已存在指向 080cb0b，可再打 v2-legacy-2）
git tag v2-legacy-final-2 main

# 3b. new-site → main（fast-forward）
git checkout main && git merge --ff-only new-site

# 3c. push 触发 Pages 部署（Pages build_config 已配 git 自动构建 dist）
git push origin main
```

## 4. 部署后验证（只读）

```bash
# 4a. 版本探针 + health
curl https://sufe-tutor.pages.dev/api/health    # 应 ready:true + schema v17

# 4b. 迁移后数据校验（对照演练断言）
node scripts/migration-drill-v17.mjs --export <部署前的备份> --rollback   # 本地重放部署前备份确认迁移正确

# 4c. 资产完整性
curl -I https://sufe-tutor.pages.dev/            # 200 + 严格 meta CSP
# 资产 200 + immutable + SPA 回退 200 + 零 CSP 违规（verify-site-smoke 实机）

# 4d. QA 全链路冒烟（新前端真实用户旅程）
node scripts/verify-site-smoke.mjs               # 本地构建产物冒烟（8 硬门）
```

## 5. 回滚（任何一步失败）

- **迁移前**：恢复点 1 = 1b 的全量备份（`wrangler d1 execute --file` 回灌）+ main 回滚到 `v2-legacy-final-2`。
- **迁移后未部署**：备份回灌即可（demand 迁移幂等可重跑，signing_contracts→contracts 由 initDb 幂等处理）。
- **部署后**：git revert main 到 v2-legacy-final-2（旧站代码 + 旧数据备份回灌）。注意新站 W1 无向后兼容——v17 库 v2 代码读不了，回滚必须同时还原数据备份。

## 6. 收尾

- 公告（D3）+ 反馈单巡检（admin 口令）
- 需求 PA（生产三轮审计）正式启动：PA-1 静态源码审计（不依赖生产，可并行先行）→ PA-2 黑盒 → PA-3 数据横切
