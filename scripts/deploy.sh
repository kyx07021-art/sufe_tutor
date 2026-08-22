#!/bin/bash
# 新站部署：build（Vite 前端 + esbuild worker）→ dist → wrangler pages deploy dist（部署对象固定 dist）
# 注意：--project-name 仍是 v2 占位（sufe-tutor 是 v2 生产项目）。新站项目名/域名属用户决策，
# 保持占位不变；域名定案前勿用本脚本直接发布（会覆盖 v2 生产站）。
set -e
cd "$(dirname "$0")/.."
node scripts/build.mjs
npx wrangler pages deploy dist --project-name sufe-tutor "$@"
