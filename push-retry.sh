#!/bin/bash
# 推送重试脚本（CLAUDE.md 纪律：github DNS 偶发抽风，后台循环重试直到成功）
# 用法：bash push-retry.sh   （最多 40 次 / 间隔 30s；成败写 /tmp/push-retry.log）
LOG=/tmp/push-retry-$(date +%H%M%S).log
echo "LOG_FILE=$LOG"
REPO="C:\Users\Lenovo\Desktop\尼采家教v2\代码仓库"
: > "$LOG"
for i in $(seq 1 40); do
  echo "[$(date +%H:%M:%S)] attempt $i" >> "$LOG"
  if git -C "$REPO" push --force-with-lease >> "$LOG" 2>&1; then
    echo "PUSH_SUCCESS at attempt $i" >> "$LOG"
    exit 0
  fi
  sleep 30
done
echo "PUSH_FAILED after 40 attempts" >> "$LOG"
exit 1
