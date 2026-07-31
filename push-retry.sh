# 后台推送重试脚本：GitHub 连接抽风时无限重试直到成功（已加白名单）
# 只推已提交的改动；commit 是主会话的职责，本脚本不代做
cd "C:\Users\Lenovo\Desktop\尼采家教v2\代码仓库"
for i in $(seq 1 40); do
  git push > /tmp/push-retry.log 2>&1
  if grep -q "main -> main\|Everything up-to-date" /tmp/push-retry.log; then
    echo "PUSH_SUCCESS on attempt $i"
    exit 0
  fi
  echo "attempt $i failed: $(tail -1 /tmp/push-retry.log)"
  sleep 30
done
echo "PUSH_GIVE_UP after 40 attempts"
exit 1
