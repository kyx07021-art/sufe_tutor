# v1.5.0 安全上线 kill-list（需求 A-1 盘点产物）

盘点日期：2026-08-16。原则：凡能导致「假身份/假认证/假核验/明文落库/绕过审核」的路径一律 fail-closed；纯可用性 fallback（缓存读失败回源、可选独立库回落业务库）不列入安全 kill-list，只逐条标注保留理由。

## 一、必须清除（安全语义）

| # | 对象 | 现状 | 改写 |
|---|---|---|---|
| K1 | `server/chsi.js:56-65` | `CHSI_PROVIDER=mock` 时任意格式合法验证码直通 approved，返回「模拟核验」学籍；当前 `server/secrets.js:34` 生产配置恰为 `mock` | 删除 mock 与未实现 thirdparty 分支；provider 固定/只接受 manual；未知 provider 返回配置错误，绝不 approved |
| K2 | `server/chsi.js:80-91` | `thirdparty` 未签约/无密钥时返回 approved 假数据 | 删除占位实现；无真实第三方契约就不存在该分支 |
| K3 | `server/text-audit.js:46-48,71` | L2 语义层未配置/超时/接口异常 → 静默跳过，谐音/方位描述绕过仅剩 L1 | L2 未配置时**拒绝写请求**（fail-closed），超时/非 200/解析失败同样拒绝；生产 Release Gate 要求 TEXT_AUDIT_API_KEY 已配置 |
| K4 | `server/audit-flow.js:116-117` | `runAudit` 300ms 预算超时 → `{ok:true}` 放行 | 删除预算竞速；直接 await auditItem；L2 自身 fail-closed。L1 微秒级不构成阻塞理由 |
| K5 | `server/secrets.js:17-39` | 仓库明文含 admin 默认口令、LOG_ENCRYPT_KEY、短信/邮件模板编码、`CHSI_PROVIDER: 'mock'`；生产 env 缺失时回落该文件 | getSecret 不再回落仓库明文（生产）；密钥只读 env；测试经显式 env 注入；文档保留「仓库只放空模板」 |
| K6 | `server/db.js:483,2144` | DDL 与写入兜底 `provider DEFAULT 'mock'` / `v.provider || 'mock'` | 默认与兜底均改 `manual` |
| K7 | `server/db.js:575-587` | 种子管理员默认口令 `admin_sufe/admin_sufe` 来自仓库明文，且已有账户时按仓库值可覆写密码哈希 | 生产无 `ADMIN_DEFAULT_PASSWORD` Secret 时启动失败；已有 admin 不再用默认口令覆写（只首次种子化）；发布前轮换管理员口令 + 吊销全量会话 |
| K8 | `constants.js:1348` `CHSI_GATE_MOCK_NOTE` 等前端「模拟核验」提示 | 内测文案/分支 | 删除 mock 提示 key 与引用 |
| K9 | `app-auth.js` 邀请码门控休眠 + `constants.js:12` `INVITE_GATE_DORMANT` | 教师注册免邀请码 | 正式上线前按公测策略恢复门控（或用户明确拍板开放注册），并同步 `server/constants.js INVITE_GATE_ENABLED`；Release Gate 校验两处一致 |
| K10 | `_worker.js:504` 注释与绑定语义 | text-audit 环境绑定描述 fail-open | K3/K4 落地后同步注释与启动检查 |

## 二、保留的可用性 fallback（逐条注明非安全路径）

| # | 对象 | 现状 | 保留理由 |
|---|---|---|---|
| F1 | `_worker.js:330-343,355-361,535-558` 公开列表 Cache API 读失败回落 routeApi、写失败静默 | 缓存是加速层，miss/异常回源不改变鉴权与数据正确性 | 保留；注释去「同加密咽喉内测兼容哲学」措辞 |
| F2 | `_worker.js:458-467` 版本化资产无 caches 环境回落直取 | 本地 dev/测试环境 | 保留；生产有 caches，语义无安全面 |
| F3 | `server/log.js:31-32` 未绑定独立 LOG_DB 回落业务库 | 可观测性落库位置，不改变门禁 | 保留 |
| F4 | `server/contract.js:177` 未绑定独立 LEDGER_DB 回落业务库 | 台账仍写入，不改变状态机 | 保留 |
| F5 | `server/security.js:118-120` D1 限流写失败仅内存限流 | 内存限流仍是收紧而非放行（不 fail-open） | 保留 |
| F6 | `server/crypto.js` 读路径解密失败标记 `[encrypted]/[undecryptable]` | 不产生可逆明文，只影响展示 | 保留；写路径已 fail-closed |

## 三、待发布前人工/生产操作

1. 轮换管理员密码哈希+盐，吊销全部 auth_sessions。
2. 生成新 FIELD_ENC_KEY / LOG_ENCRYPT_KEY（AES-256 base64）上传 Worker Secrets，执行一次性密文重加密。
3. 短信/邮件模板编码上传 Worker Secrets（当前仓库值作废）。
4. 配置 TEXT_AUDIT_API_KEY 并实测语义层可用。
5. 确认 CHSI_PROVIDER 不配置或 manual。
6. 恢复/确认邀请码门控策略。
