# ADR-001：架构 v2 —— 域模块 + 原生 ESM + 薄构建层

- 状态：已采纳（v2.0.0 目标）
- 日期：2026-08-16
- 基线：`v2-baseline`（v1.5.0 发布形态）

## 背景

v1 站点是「单 `_worker.js` 路由 + 经典脚本全局函数」结构。该结构上线后运行稳定，但存在四类结构债：

1. `server/db.js` 与 `constants.js` 单文件过大，schema/迁移/业务 SQL 混居；
2. 72 条 `if (p === '/api/...')` 路由靠顺序与手写正则维持；
3. 前端依赖 13+ 个经典脚本的加载顺序与全局符号，且内联 `onclick` 使 CSP 无法移除 `unsafe-inline`；
4. 源码目录直接作为部署包，依赖黑名单防泄露。

## 决策

采用「不引入框架、保留 Cloudflare Pages + D1」的最小重构：

1. **后端**：`_worker.js` 只做装配；声明式路由表统一匹配；核心咽喉与业务域分目录，域自持 `schema.js / repo.js / api.js`。
2. **前端**：原生 ES Modules + 动态 import；域经 registry 注册；事件统一 `data-action` 委托；用户文案只在 `client/constants/text.js`。
3. **构建**：引入 esbuild 薄构建层，输出固定 `dist/`；worker 打成单文件，前端 code-splitting 出哈希 chunk；部署对象只认 `dist/`。
4. **契约**：路由声明、错误码、结构化通知、schema 注册、动作注册五类契约集中且可测试；`test/architecture.test.js` 作为可执行边界。

## 后果

- 优点：边界可由结构保证；源码不再进部署包；CSP 可移除 `unsafe-inline`；大文件按域收敛。
- 代价：引入构建步骤；需按域迁移测试与页面；短期动工面大。
- 迁移策略：绞杀者模式，每域端到端绿后再切下一域；v1 行为作为回归基线。
