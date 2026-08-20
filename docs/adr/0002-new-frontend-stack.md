# ADR 0002 — 新前端技术栈决策（Vue 3 + Vite）

- 状态：**已接受**（2026-08-21，用户授权主会话自主定案）
- 决策者：主会话（用户明确「对网站的具体技术栈一窍不通，这块只有你自己选择最佳方案」）
- 前置：ADR 0001（架构 v2）、需求 T 解耦度评估（docs/frontend-decoupling.md，正交性达成、接口清单定稿）、AG-1 技术栈调研

---

## 背景

网站将整体换壳为全新前端（纯静态、极简动效、前后端只经标准业务接口 `/api/*` 通信）。现有 v2 前端为原生 ESM + 渲染函数 + CSS 变量单源 + 严格 CSP。需求 = 从零打造高端前端，含组件继承表达（base 组件 + 个性化接口）、柔和动效、数千基元并行开发。

硬约束（不可妥协）：
1. 严格 CSP：`script-src 'self'; style-src-elem 'self'; style-src-attr 'none'`（零内联脚本/样式，禁 `unsafe-inline`/`unsafe-eval`）。
2. 纯静态托管（Cloudflare Pages），无 SSR。
3. 前后端只经标准业务接口通信（需求 T 接口清单）。
4. 纯白/扁平/极简 + 品牌紫配色、动效柔和、可换壳。

## 决策

**新前端技术栈 = Vue 3（Composition API + 单文件组件 SFC）+ Vite。** 构建链 = Vite（生产产物静态 ESM+CSS），部署 = Cloudflare Pages（现有管线）。备选记录：Svelte 5 + Vite（性能最优，未选）。

## 理由（对照硬约束逐条）

1. **严格 CSP 全兼容**（调研实证）：
   - runtime-only 构建（Vite+SFC 默认）免 `unsafe-eval`（模板预编译，不落运行时模板字符串）。
   - SFC `<style>`（含 scoped）由 Vite 构建期抽离为外部 `.css`（`style-src-elem 'self'` 合规，零运行时 `<style>` 注入）。
   - `:style` 绑定 / transition 走 CSSOM 通道，不受 `style-src-attr 'none'` 管辖（CSSOM 写入不在该指令检查范围——本项目 h5a-g6 已实测定案）。
   - 禁 CSS-in-JS（styled-components/Emotion 运行时注入 `<style>` 会被拦死）；本次从零自建组件库，天然规避。
2. **组件继承/组合表达**：SFC + `<slot>` + composable 是「base 组件 + 插槽扩展 + 设计令牌覆盖（CSS 变量）」最自然的表达档位，与项目既有「CSS 变量单源 + 数据属性驱动」哲学（ADR 0001）兼容。按钮 A/A1/B/B1/B2/C/C1 = 单实现 + 变体参数（需求 AG-4）。
3. **柔和动效**：内置 `<Transition>/<TransitionGroup>` 纯 CSS 驱动，零 JS 开销，契合浮入/淡入/遮罩/过渡，不引入 Framer Motion 等体积税。
4. **数千基元并行开发**：SFC 单文件组件 = 一个基元一个文件、props 进 / emit 出接口清晰；AI 生成质量 ~95%、可混用模式少（调研对比 Svelte runes ~85%）；既有「5 agent 出方案 → 主会话唯一裁判写入 → 独立复核」工作流直接套用。
5. **学习/维护/长期演进**：Vue 中文社区与文档最强（本项目维护语境为中文），曲线平缓，长期活跃维护。
6. **构建/部署**：Vite = esbuild（开发）+ Rollup（生产打包），Pages 对接标准三件套（build command / `_redirects` SPA 回退 / `_headers` 与现有 CSP 四源同步纪律延续）。

## 取舍

| 维度 | Vue 3 + Vite | 未选方案 |
|---|---|---|
| 体积 | 11–28KB gzip | React 40–62KB；Svelte 2–19KB（更小但 AI 质量弱） |
| 动效 | 内置 Transition 纯 CSS | Framer Motion 34–46KB（React） |
| 并行开发 | SFC 单文件天然拆基元 | 原生 ESM 需自建规范易漂移（v2 断线教训：F1 装配缺失、appearance 孤儿） |
| CSP | 全兼容（构建期抽离） | HTMX/Alpine 需 `unsafe-eval`，**结构性排除** |
| 维护 | 中文生态最强 | Svelte 生态/中文资料较薄 |

## 反对意见与对策

- **Vue `unsafe-eval` 陷阱**：误引 full build / 运行时模板字符串会引入 eval 需求。对策 = archtest 断言锁死 runtime-only 构建形态（新前端 archtest 契约第一号）。
- **第三方组件样式注入**：任何运行时注入 `<style>` 的 Vue 库被 `style-src-elem 'self'` 拦死。对策 = 从零自建组件库；引入第三方须过「零 createElement('style')」审计（契约 6 精神延续）。
- **archtest 契约 6 需框架感知**：`style=`/`onclick=` 字面量 grep 对 Vue SFC（`:style`/`@click`）需改断言写法。对策 = 新前端 archtest 重写源级断言，契约内核（运行时零内联、零 `<style>` 注入、零中文）不变。
- **「继承」字面期望**：若用户字面期望 OO 类继承，需澄清——框架业界是组合+插槽范式。本决策按「base 元素 + 个性化接口」成熟范式执行。

## 与 CSP 契约关系（四源同步纪律延续）

新前端上线后，CSP 四源同步（meta / `_headers` / SECURITY_HEADERS / 测试 fixture）纪律不变；Vite 产物零内联，`style-src-attr 'none'` 可原样保持。

## 后续依赖

- AG-3 认证/路由横切面设计（X-Auth-Token / `/api/auth/me` / role 分流 / 401 兜底 / 页面层级 0/A/B/C 视图切换）
- AG-4 组件架构契约设计（组件基类 + 变体参数 / 设计 token 单源 / 动效契约 / 接口帽）
- AG-6 接口映射表（T-5 清单 × 页面层级）
- AG-5 新前端 PROJECT.md（规则 S 全局基础文档）
- 技术栈选择**定案不再变更**（后续工程以此为准）。
