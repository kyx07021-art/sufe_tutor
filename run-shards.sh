#!/bin/bash
cd "$(dirname "$0")"
total_fail=0
for batch in .test-shards/batch_??; do
  files=$(tr '\n' ' ' < "$batch")
  name=$(basename "$batch")
  if timeout 300 node --test --test-timeout=90000 --test-reporter=spec $files > ".test-shards/$name.log" 2>&1; then
    echo "SHARD $name OK"
  else
    code=$?
    echo "SHARD $name FAIL/TIMEOUT code=$code"
    total_fail=$((total_fail+1))
  fi
  grep -E "^ℹ (tests|pass|fail)" ".test-shards/$name.log" | tr '\n' ' '; echo
done
echo "FAILED SHARDS: $total_fail"
