# Secrets 公测迁移手册（v1.5.0 起执行）

## 现状

- `server/secrets.js` 为纯 env 网关（fail-closed：只读 Worker Secrets / `.dev.vars` / 测试注入，仓库零明文密钥）；`isProductionRuntime`（env 存在 `CF_PAGES_URL` / `CF_PAGES_COMMIT_SHA`）语义保留供 Release Gate 判定。
- 生产缺必需 Secret 时：Release Gate（`server/startup.js`）会让 `/api/*` 全部返回 503 not-ready，静态资源照常。
- 学信网核验已固定 manual，无 mock/thirdparty；内容审核 L2 使用 DeepSeek，缺密钥会拒绝写请求。

## 生产必需 Worker Secrets（缺一不可）

| 键 | 说明 |
|---|---|
| `ADMIN_USERNAMES` | 管理员用户名（逗号分隔；可以换新账号，旧名单外的历史 admin 会在 initDb 迁移时自动降为 student） |
| `ADMIN_DEFAULT_PASSWORD` | 轮换后的管理员口令；**不得等于历史值 `admin_sufe`**，建议 ≥12 位。首次发布时若与库内哈希不同会自动轮换 |
| `FIELD_ENC_KEY` | AES-GCM-256 base64，字段加密新钥（建议与 LOG 不同） |
| `FIELD_ENC_KEY_OLD` | 旧字段钥（重加密完成前保留） |
| `LOG_ENCRYPT_KEY` | 留档加密新钥 |
| `LOG_ENCRYPT_KEY_OLD` | 旧留档钥（重加密完成前保留） |
| `SMS_OTP_TEMPLATE_CODE` | spug.cc 短信模板编码（仓库旧值作废） |
| `EMAIL_OTP_TEMPLATE_CODE` | 邮件模板编码（仓库旧值作废） |
| `TEXT_AUDIT_API_KEY` | DeepSeek API Key（L2 地址语义审核，fail-closed；直接填 DeepSeek key 即可） |
| `CHSI_PROVIDER` | 可缺省；只接受 `manual`，其他值会使 Release Gate 失败 |
| `CRYPTO_REENCRYPT_DONE` | 重加密完成并删除旧钥后设为 `true`；此前必须保留 `*_OLD` |

可选键：`TEXT_AUDIT_BASE_URL`（默认 `https://api.deepseek.com/chat/completions`）、`TEXT_AUDIT_MODEL`（默认 `deepseek-chat`）。

上传示例：

```bash
cd 代码仓库
npx wrangler pages secret put ADMIN_USERNAMES
npx wrangler pages secret put ADMIN_DEFAULT_PASSWORD
npx wrangler pages secret put FIELD_ENC_KEY
npx wrangler pages secret put FIELD_ENC_KEY_OLD
npx wrangler pages secret put LOG_ENCRYPT_KEY
npx wrangler pages secret put LOG_ENCRYPT_KEY_OLD
npx wrangler pages secret put SMS_OTP_TEMPLATE_CODE
npx wrangler pages secret put EMAIL_OTP_TEMPLATE_CODE
npx wrangler pages secret put TEXT_AUDIT_API_KEY
```

## 迁移步骤

1. 上传上表全部 Secrets（先配好再推送代码，否则新版本 Release Gate 会把 API 全部 503）。
2. 推送 v1.5.0；`curl https://sufe-tutor.pages.dev/api/health` 必须返回 `"status":"ok"`。
3. 管理员口令由 `ADMIN_DEFAULT_PASSWORD` 在 initDb 中自动轮换；旧名单外历史 admin 自动降为 student。
4. 用新管理员口令执行一次性重加密；成功后把 `CRYPTO_REENCRYPT_DONE` 设为 `true`：

   ```bash
   SUFE_ADMIN_PASS='<新管理员口令>' bash scripts/reencrypt-production.sh
   ```

   返回 `unreadable: 0` 后，删除 `FIELD_ENC_KEY_OLD` / `LOG_ENCRYPT_KEY_OLD` 并重新发布。

5. 仓库内 `server/secrets.js` 的本地值不再被生产读取；如仓库被镜像，git 历史仍可追溯旧值，正式运营后建议 `git filter-repo` 清理历史并再次轮换。
6. 上线后拉一次反馈单（`GET /api/feedbacks`），按 CLAUDE.md 规则处理遗留问题。

## 生产 Ready 校验

- 未就绪时 `/api/health` 返回 503，`checks` 数组逐项列出失败 code（不含秘密值）。
- 本地开发/测试没有 `CF_PAGES_*` 信号，不受 Release Gate 限制；本地继续用 `server/secrets.js` 或 `.dev.vars`。
