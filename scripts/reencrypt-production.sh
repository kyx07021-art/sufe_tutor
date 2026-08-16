#!/bin/bash
# v1.5.0 密钥轮换重加密（生产一次性运维脚本）
#
# 前置条件：
#   1. Worker Secrets 已同时配置：新 FIELD_ENC_KEY / LOG_ENCRYPT_KEY，旧 FIELD_ENC_KEY_OLD / LOG_ENCRYPT_KEY_OLD；
#   2. ADMIN_DEFAULT_PASSWORD 已轮换为强口令（Release Gate 通过）；
#   3. 站点已发布且 /api/health 返回 status=ok。
#
# 用法：SUFE_ADMIN_PASS='<新管理员口令>' bash scripts/reencrypt-production.sh
# 安全：capToken 一次性 + 会话绑定，脚本不写任何文件、不打印 capToken。
set -euo pipefail
BASE="${SUFE_BASE_URL:-https://sufe-tutor.pages.dev}"
ADMIN_USER="${SUFE_ADMIN_USER:-admin_sufe}"
ADMIN_PASS="${SUFE_ADMIN_PASS:?请设置 SUFE_ADMIN_PASS=新管理员口令}"

login_json=$(curl -sS --max-time 60 -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,sys; print(json.dumps({"identifier": sys.argv[1], "password": sys.argv[2]}))' "$ADMIN_USER" "$ADMIN_PASS")")
TOKEN=$(printf '%s' "$login_json" | python -c 'import json,sys; print(json.load(sys.stdin).get("authToken",""))')
if [ -z "$TOKEN" ]; then echo "登录失败：$login_json"; exit 1; fi

reauth_json=$(curl -sS --max-time 60 -X POST "$BASE/api/auth/re-auth" \
  -H 'Content-Type: application/json' -H "X-Auth-Token: $TOKEN" \
  -d "$(python -c 'import json,sys; print(json.dumps({"password": sys.argv[1]}))' "$ADMIN_PASS")")
CAP=$(printf '%s' "$reauth_json" | python -c 'import json,sys; print(json.load(sys.stdin).get("capToken",""))')
if [ -z "$CAP" ]; then echo "二次认证失败：$reauth_json"; exit 1; fi

echo '重加密中（只把旧密文用新钥重写，不可读行会计数报告）...'
curl -sS --max-time 300 -X POST "$BASE/api/admin/reencrypt" \
  -H 'Content-Type: application/json' -H "X-Auth-Token: $TOKEN" \
  -d "$(python -c 'import json,sys; print(json.dumps({"capToken": sys.argv[1]}))' "$CAP")"
echo
echo '若 unreadable > 0：先不要删除 *_OLD 密钥，排查后再跑。'
