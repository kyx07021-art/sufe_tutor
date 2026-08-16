#!/bin/bash
# v2 部署：build → dist → wrangler pages deploy dist（部署对象固定 dist）
set -e
cd "$(dirname "$0")/.."
node scripts/build.mjs
npx wrangler pages deploy dist --project-name sufe-tutor "$@"
