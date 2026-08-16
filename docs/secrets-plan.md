# Secrets 公测迁移手册（内测阶段休眠，届时按此执行）

## 现状（内测）

- 全部敏感值明文存于 `server/secrets.js`（v1.4.14 起数据与网关合并单文件，挂 `globalThis.APP_SECRETS`；原仓库根 `secrets.js` 已删除）。
- 读取一律经 `server/secrets.js` 网关：`getSecret(env, key)` —— env（Worker Secrets）优先，回落本文件内联数据。
- `_worker.js` 对 `server/` 目录整体返回 404，公网无法下载。

## 迁移动机

公测后仓库可能被 fork/镜像，明文敏感值必须从代码中彻底消失，改为 Cloudflare Worker Secrets（加密存储，仅业务逻辑运行时可临时调用，本地无影无踪）。

## 迁移步骤

1. **上传 Secrets**（Dashboard：Pages 项目 → Settings → Environment variables → 选 Production，或 CLI）：
   ```bash
   npx wrangler pages secret put ADMIN_USERNAMES        # 值填逗号分隔：admin_sufe,副管理员名
   npx wrangler pages secret put ADMIN_DEFAULT_PASSWORD
   npx wrangler pages secret put LOG_ENCRYPT_KEY
   npx wrangler pages secret put SMS_ACCESS_KEY_ID      # 短信开通后
   npx wrangler pages secret put SMS_ACCESS_KEY_SECRET
   npx wrangler pages secret put SMS_SIGN_NAME
   npx wrangler pages secret put SMS_TEMPLATE_CODE
   ```
   键名与 `secrets.js` 完全一致 → 网关 env 优先链自动接管，**业务代码零改动**。

2. **覆盖仓库内的旧文件**（把带敏感信息的版本从历史里挤掉）：
   把 `server/secrets.js` 内联数据替换为占位版（所有值置空，仅留键与注释），commit + 强推：
   ```bash
   git add server/secrets.js && git commit -m "secrets 迁移 Worker Secrets，本地置空"
   git push            # 新推送覆盖远端文件
   ```
   注：git 历史里的旧值仍可追溯，如需彻底清除走 `git filter-repo` 重写历史 + 轮换全部凭证（管理员密码、LOG 密钥重新生成）。

3. **加入 .gitignore**（占位版留存防 globalThis.APP_SECRETS 缺键；或彻底删数据并让网关空值兜底）：
   推荐保留占位键入库，不 ignore —— 避免新克隆环境缺键时 `getSecret` 全空导致鉴权/加密路径不可用。

4. **轮换**：迁移同时更换管理员密码与 `LOG_ENCRYPT_KEY`（换密钥后旧密文留档不可解，需先解密重加密一轮，或接受历史留档只读封存）。

## 网关行为验证

```bash
# env 未配置（内测）：回落本地文件，管理员登录正常
# env 已配置（公测）：改本地文件里的值 → 线上行为不变，即证明 env 优先生效
```

## 未来新敏感字段接入流程

API 到手 → ① `secrets.js` 加键（内测即时可用）→ ② 公测时同步 `wrangler pages secret put` → ③ 业务经 `getSecret(env, 'XXX')` 读取。
