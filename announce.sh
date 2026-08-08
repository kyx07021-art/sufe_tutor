#!/bin/bash
# 公告发送助手（v0.25.16 起）：杜绝手写 JSON 出非法转义。
# 教训（v0.25.13-15）：当时把公告 JSON 里的 \n 写成了字面换行 → 非法 JSON，正文换行全部丢失
# （用户反馈「公告没换行」）。本脚本用 python json.dumps 转义生成合法 JSON 文件，再 curl 发送。
#
# 用法（正文第二参数可含真实换行，逐条 bullet 各占一行）：
#   bash announce.sh "版本更新 · v0.25.16" "本次更新
# · 第一点
# · 第二点"
#   bash announce.sh "标题" "$(cat /tmp/body.txt)"
#
# 管理员凭据：环境变量 SUFE_ADMIN_USER / SUFE_ADMIN_PASS（缺省回落 CLAUDE.md 记录的 admin_sufe/admin_sufe）
# 纪律：发送前须确认线上 constants APP_VERSION 已是该版本（版本门控双匹配），否则用户端公告与版本不符。
set -e
TITLE="$1"; BODY="$2"
if [ -z "$BODY" ]; then echo "用法: bash announce.sh \"标题\" \"本次更新\\n· 点一...\""; exit 1; fi
ADMIN_USER="${SUFE_ADMIN_USER:-admin_sufe}"
ADMIN_PASS="${SUFE_ADMIN_PASS:-admin_sufe}"
# 1) python json.dumps 生成合法 JSON（任何输入都转义，绝不手写）
PAYLOAD="$(mktemp)" && trap 'rm -f "$PAYLOAD"' EXIT
python - "$TITLE" "$BODY" "$PAYLOAD" <<'PY'
import json, sys
title, body, out = sys.argv[1], sys.argv[2], sys.argv[3]
with open(out, 'w', encoding='utf-8') as f:
    json.dump({'title': title, 'text': body}, f, ensure_ascii=False)
PY
# 2) curl 登录拿 token + 发送（curl 走系统代理/UA，与线上既有通路一致）
TOKEN=$(curl -s --max-time 60 -X POST "https://sufe-tutor.pages.dev/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" \
  | python -c "import sys,json;print(json.load(sys.stdin).get('authToken',''))")
if [ -z "$TOKEN" ]; then echo "管理员登录失败"; exit 1; fi
curl -s --max-time 60 -X POST "https://sufe-tutor.pages.dev/api/notifications/broadcast" \
  -H "Content-Type: application/json" -H "X-Auth-Token: $TOKEN" -d @"$PAYLOAD"
echo
