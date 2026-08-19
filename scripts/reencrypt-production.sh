#!/bin/bash
# v1.5.0 密钥轮换重加密（生产一次性运维脚本；A-12 分片续跑）
#
# 前置条件：
#   1. Worker Secrets 已同时配置：新 FIELD_ENC_KEY / LOG_ENCRYPT_KEY，旧 FIELD_ENC_KEY_OLD / LOG_ENCRYPT_KEY_OLD；
#   2. ADMIN_DEFAULT_PASSWORD 已轮换为强口令（Release Gate 通过）；
#   3. 站点已发布且 /api/health 返回 status=ok。
#
# 用法：SUFE_ADMIN_PASS='<新管理员口令>' bash scripts/reencrypt-production.sh
# 安全：capToken 一次性 + 会话绑定，脚本不写任何文件、不打印 capToken。
# A-12（D1 Free 单调用 50 次查询上限）：端点单次只处理 ≤20 行密文并返回 { done, cursor, 各段计数 }——
#   本脚本循环续跑：每轮重新 re-auth 签发新 capToken（一次性语义，命中即删），带上一轮返回的
#   cursor 续调，直至 done=true，汇总打印全量计数。中途失败重跑 = 从头幂等重跑（重加密对可读行
#   恒重写，无害；unreadable 行不覆盖）。
set -euo pipefail
BASE="${SUFE_BASE_URL:-https://sufe-tutor.pages.dev}"
ADMIN_USER="${SUFE_ADMIN_USER:-admin_sufe}"
ADMIN_PASS="${SUFE_ADMIN_PASS:?请设置 SUFE_ADMIN_PASS=新管理员口令}"

# 从 JSON 取单字段（简单字段用；布尔统一小写——JSON true → Python True → 比较需 "true"）
jget() { python -c "import json,sys; d=json.load(sys.stdin); v=d.get(sys.argv[1],'') if isinstance(d,dict) else ''; print(str(v).lower() if v is not None else '')" "$1"; }

login_json=$(curl -sS --max-time 60 -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,sys; print(json.dumps({"identifier": sys.argv[1], "password": sys.argv[2]}))' "$ADMIN_USER" "$ADMIN_PASS")")
TOKEN=$(printf '%s' "$login_json" | jget authToken)
if [ -z "$TOKEN" ]; then echo "登录失败：$login_json"; exit 1; fi

# 累计计数（12 项：fields/attachments/logs × scanned/rewritten/unreadable/skipped）
declare -A SUM=(
  [f_scanned]=0 [f_rewritten]=0 [f_unreadable]=0 [f_skipped]=0
  [a_scanned]=0 [a_rewritten]=0 [a_unreadable]=0 [a_skipped]=0
  [l_scanned]=0 [l_rewritten]=0 [l_unreadable]=0 [l_skipped]=0
)
CURSOR="null"
ROUND=0

echo '分片重加密中（每轮 ≤20 行；只把旧密文用新钥重写，不可读行会计数报告）...'
while :; do
  ROUND=$((ROUND+1))
  # 每轮重新 re-auth 签发一次性 capToken
  reauth_json=$(curl -sS --max-time 60 -X POST "$BASE/api/auth/re-auth" \
    -H 'Content-Type: application/json' -H "X-Auth-Token: $TOKEN" \
    -d "$(python -c 'import json,sys; print(json.dumps({"password": sys.argv[1]}))' "$ADMIN_PASS")")
  CAP=$(printf '%s' "$reauth_json" | jget capToken)
  if [ -z "$CAP" ]; then echo "二次认证失败（第 ${ROUND} 轮）：$reauth_json"; exit 1; fi

  BODY=$(CURSOR_JSON="$CURSOR" CAP_TOKEN="$CAP" python -c '
import json, os
body = {"capToken": os.environ["CAP_TOKEN"]}
cur = os.environ["CURSOR_JSON"]
if cur and cur != "null":
    body["cursor"] = json.loads(cur)
print(json.dumps(body))')

  resp=$(curl -sS --max-time 300 -X POST "$BASE/api/admin/reencrypt" \
    -H 'Content-Type: application/json' -H "X-Auth-Token: $TOKEN" -d "$BODY")
  done=$(printf '%s' "$resp" | jget done 2>/dev/null) || { echo "重加密调用失败（第 ${ROUND} 轮，非 JSON 响应）：${resp:0:300}"; exit 1; }
  if [ -z "$done" ]; then echo "重加密调用失败（第 ${ROUND} 轮）：${resp:0:300}"; exit 1; fi

  # 累计本轮计数
  read -r f_s f_r f_u f_k a_s a_r a_u a_k l_s l_r l_u l_k <<< "$(printf '%s' "$resp" | python -c '
import json, sys
d = json.load(sys.stdin)
g = lambda s, k: d.get(s, {}).get(k, 0)
print(g("fields","scanned"), g("fields","rewritten"), g("fields","unreadable"), g("fields","skipped"),
      g("attachments","scanned"), g("attachments","rewritten"), g("attachments","unreadable"), g("attachments","skipped"),
      g("logs","scanned"), g("logs","rewritten"), g("logs","unreadable"), g("logs","skipped"))')"
  SUM[f_scanned]=$(( SUM[f_scanned]+f_s )); SUM[f_rewritten]=$(( SUM[f_rewritten]+f_r )); SUM[f_unreadable]=$(( SUM[f_unreadable]+f_u )); SUM[f_skipped]=$(( SUM[f_skipped]+f_k ))
  SUM[a_scanned]=$(( SUM[a_scanned]+a_s )); SUM[a_rewritten]=$(( SUM[a_rewritten]+a_r )); SUM[a_unreadable]=$(( SUM[a_unreadable]+a_u )); SUM[a_skipped]=$(( SUM[a_skipped]+a_k ))
  SUM[l_scanned]=$(( SUM[l_scanned]+l_s )); SUM[l_rewritten]=$(( SUM[l_rewritten]+l_r )); SUM[l_unreadable]=$(( SUM[l_unreadable]+l_u )); SUM[l_skipped]=$(( SUM[l_skipped]+l_k ))

  echo "  第 ${ROUND} 轮：字段重写 +${f_r} / 附件 +${a_r} / 日志 +${l_r}（done=${done}）"
  if [ "$done" = "true" ]; then break; fi
  CURSOR=$(printf '%s' "$resp" | python -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d["cursor"]) if d.get("cursor") else "null")')
  # reauth 限流（RATE_LIMITS.reauth=8/10min/IP）：轮间 sleep 保证整轮旋转不触限（默认 90s，测试可 REENCRYPT_ROUND_SLEEP=0）
  sleep "${REENCRYPT_ROUND_SLEEP:-90}"
done

echo
echo '重加密完成（累计）：'
echo "  字段   scanned=${SUM[f_scanned]}  rewritten=${SUM[f_rewritten]}  unreadable=${SUM[f_unreadable]}  skipped=${SUM[f_skipped]}"
echo "  附件   scanned=${SUM[a_scanned]}  rewritten=${SUM[a_rewritten]}  unreadable=${SUM[a_unreadable]}  skipped=${SUM[a_skipped]}"
echo "  日志   scanned=${SUM[l_scanned]}  rewritten=${SUM[l_rewritten]}  unreadable=${SUM[l_unreadable]}  skipped=${SUM[l_skipped]}"
if [ "${SUM[f_unreadable]}" -gt 0 ] || [ "${SUM[a_unreadable]}" -gt 0 ] || [ "${SUM[l_unreadable]}" -gt 0 ]; then
  echo "⚠ unreadable > 0：先不要删除 *_OLD 密钥，排查后再跑。"
fi
