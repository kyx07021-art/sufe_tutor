# M3 C1 关系管理 · 模块内部契约（文件级隔离）

> 模块负责人（主会话）钉死：每个基元一个独立文件 + 精确导出接口 + 依赖。子 agent 只写自己的文件，禁止改他人文件。
> 真源：docs/module-plans/M3.md + docs/新前端需求.md §C1 + docs/interfaces.md §19 I-15 + 本文件。
> 收口时本文件随实现更新（接口若漂移，以代码为准但需回改本文件）。

## 0. 全局规则（所有文件遵守）
- **契约 6**：零内联事件/样式属性（源码无 `onclick=`/`onload=`/`style=` 字面量）；零运行时 `<style>` 注入；零 `v-html`；**零中文文案/注释**（所有用户可见文案走 `src/constants/m-relations.js`；注释一律英文）。
- **动效**：JS 只切类，动画全 CSS；`prefers-reduced-motion` 降级（虚线/卡仍可见）。
- **消费 M0**：从 `@/components/ui/index.js` 导入（UiButton/UiCard/UiText/UiToast…）；禁深路径导入。
- **CSP**：`style-src-attr 'none'` → 禁用 HTML `style="..."` 字面量与 `setAttribute('style')`；**允许** Vue `:style` 绑定（CSSOM 数据通道，UiButton 先例）。
- 几何：375px 视口不横向溢出；头像/卡必须落在板内。

## 1. 共享数据模型（M3-01 产出，全局唯一形状）

```js
// node（每个 other 聚合一个节点）：
{
  userId: int,                 // other.id
  role: 'student' | 'teacher', // other.role
  name: string,                // other.name（教师名优先，前端已回退）
  avatar: string,              // other.avatar（dataURL 或空串）
  status: 'active' | 'closed', // 会话状态显示口径（temp init/sent/formal 均归 active）
  edges: Edge[],               // 会话边数组（本轮只建会话边）
  edgeCount: number,           // = edges.length（虚线数量，供 M3-03 圆心角）
  hasContract: boolean,        // !!signing（供 M4 灰掉结束按钮）
  contract: object | null,     // 原始 I-15 signing 字段（传 M4）
  last: object | null,         // 最近消息摘要（I-15 last）
}
// Edge（一条关系 = 一条会话边）：
{
  conversationId: int,
  status: 'active' | 'closed',
  tempStatus: string | null,
  last: object | null,
  other: { id, role, name, avatar },
}
```

## 2. 基元 ↔ 文件 ↔ 导出接口 ↔ 依赖

| # | 基元 | 文件 | 导出 | 依赖 |
|---|---|---|---|---|
| M3-01 | 关系数据接入层 | `data.js` | `parseMyRelations(payload)` → `{nodes, edges, total}`（形状校验 fail-closed，坏形状抛 `RelationsShapeError`）；`fetchMyRelations(api?)` → 同形；`RelationsShapeError` 类；`ALLOWED_CONV_STATUSES` | I-15 契约；**`src/core/api.js`** 单点（路径去 `/api` 前缀，`authToken` 键，401 → auth:dead；可选注入 `apiFn` 供测试） |
| M3-02 | 底板+格点阵列 | `RelationsBoard.vue` | 默认导出 SFC。props：`{ center: {x,y}, radius: number, size: {w,h} }`（供 M3-10 派生）；slots：`avatars` / `lines` / `cards`（绝对定位层，z-order 变量见下）；提供 CSS 变量 `--rz-line/--rz-avatar/--rz-card` | 无（独立）；z-order 单源见 §3 |
| M3-03 | 同心圆布局算法 | `layout.js` | `layoutCircle(nodes, { radius, center, avatarDiameter })` → `{ positions:[{node,x,y,angle}], meta:{ radius, minSep, overlap, maxEdgeUserId, center } }` | M3-01 node 形状（只读 `edgeCount`） |
| M3-04 | 虚线弯曲算法 | `curve.js` | `buildCurves(edgeCount, from, to)` → `[{ path }]`（SVG path d 字符串数组，N=1 直/N=2 双外弯/N=3 中直外弯/N≥4 递增/中段间距≥阈值/共享端点/镜像对称）；`CURVE_GAP_MIN` 常量 | M3-03 位置（from/to） |
| M3-05 | 头像与 id 渲染 | `RelationAvatar.vue` | 默认导出 SFC。props：`{ node, x, y, diameter, isSelf }`；emit `{ click }`（点击开资料面板，本轮空 emit 即可） | M3-03 positions |
| M3-06 | 虚线静态渲染 | `RelationLines.vue` | 默认导出 SFC。props：`{ segments: [{ from, to, edgeCount }], size: {w,h} }`；输出 `<svg>`，每曲线一个 `<path class="rel-line__path">`（stroke-dasharray 走 `var(--rel-dash)`）；z-order 由 Board 层给 | M3-04 `buildCurves` |
| M3-07 | 流向中心动效 | `flow.css` + `flow.js` | CSS：`.relations-board.is-flowing .rel-line__path { animation: rel-flow … }` + `@keyframes rel-flow`（stroke-dashoffset 外→内）+ reduced-motion 关动画；`flow.js`：`isFlowAllowed()`（读 `prefers-reduced-motion`，供 M3-10 切类） | M3-06 `.rel-line__path` class 契约 |
| M3-08 | 关系卡渲染与跳转 | `RelationCard.vue` + `card-layout.js` | `RelationCard.vue`：props `{ edge, x, y, width, layout:'float'\|'list' }`；emit `{ open }`（`conversationId`）；float=绝对定位中点挂卡，list=垂直列表卡（含用户名 label）；会话中=UiButton C1「会话中」/ended=灰化 10 灰底 60 灰字「会话已结束」但仍可点。`card-layout.js`：纯函数 `planRelationCards(positions, { center, radius, selfDiameter, cardWidthMax, cardWidthMin, gap })` → `{ mode:'midpoint'\|'list', cardWidth, cards }`（宽度 `min(CARD_W, fitted, adj)` 不上钳；`mode` 几何门控） | M3-01 Edge；M3-03 positions；M0 UiButton；copy m-relations.js |
| M3-09 | 空/加载/失败态 | `RelationsStates.vue` | 默认导出 SFC。props：`{ state: 'loading'|'error'|'empty', message }`；emit `{ retry }` | copy m-relations.js |
| M3-10 | 页面装配 | `RelationsPage.vue` + `pages.js` | `RelationsPage.vue` 默认导出（fetch→parse→layout→render，resize 重算，离开清理 F3）；`pages.js` `export { pages }`（见 §4） | 01..09 全部 |
| M3-11 | 测试适配+回归 | `test/smoke-relations.mjs` | 手动运行 `node test/smoke-relations.mjs`（不改 package.json，收口统一合并） | 全部 |

## 3. z-order 单源（M3-02 定值，模块内单源）

定义于 `RelationsBoard.vue` `<style>`（CSS 变量）：
```css
.relations-board { --rz-dots: 0; --rz-line: 1; --rz-avatar: 2; --rz-card: 3; }
```
层元素 `z-index: var(--rz-avatar)` 等。任何文件禁裸写 z-index 数字。

## 4. pages.js 契约（M2 shell/page-registry.js `import.meta.glob` 收集）

```js
export const pages = [{
  path: '/relations',
  name: 'relations',
  roles: ['student', 'teacher'],      // AB 共用；roles 存在 = 受保护 shell 子路由
  component: RelationsPage,
  meta: { title: RELATIONS_COPY.PAGE_TITLE, tab: true },
}]
```
> M2 `page-registry.isPageDef` 要求每个元素含 `path`(string)/`name`(string)/`component`；TabBar 标签 = `meta.title || name`，显示条件 = `meta.tab !== false`。

## 5. 文案与几何单源

所有用户可见中文 → `src/constants/m-relations.js`（`export const RELATIONS_COPY = {…}`）。组件模板零裸中文。
`export const RELATIONS_GEOMETRY = { SELF_D, OTHER_D, CARD_W, CARD_GAP, CARD_W_MIN, EDGE_MARGIN, COMPACT_BREAKPOINT, RADIUS_MIN（由 SELF_D/OTHER_D 派生）, SELF_D_COMPACT, OTHER_D_COMPACT, RADIUS_MIN_COMPACT }`。
**z-order 单源 = `RelationsBoard.vue` CSS 变量 `--rz-*`，JS 不导出 z 值副本**（避免双源）。

## 6. 批次与依赖图（并行策略）

```
批A（并行）：01 → 02 → 03        （03 只依赖 node 形状，契约已钉，可并行）
批B（并行）：04 → 05 → 09        （依赖 01/03 输出）
批C（并行）：06 → 07 → 08        （06 依赖 04；07 依赖 06 class 契约；08 依赖 01/03）
批D：10 页面装配（负责人亲写）
批E：11 测试+回归（负责人亲写）
```
复杂基元（04/07/08）走 5-agent 方案；简单/中等的（01/02/03/05/06/09）每基元一个实现 agent 或负责人亲写。

## 7. 交付状态（2026-08-22 核心批 + 全批并行收口）

- ✅ M3-01 data.js（实现 agent，自检+验收过）
- ✅ M3-02 RelationsBoard.vue（实现 agent）
- ✅ M3-03 layout.js（实现 agent）
- ✅ M3-04 curve.js（负责人亲写；**5-agent 方案两轮共 5/5 方案落地**：proposal-4/5 + A/B/C。取共识 = 立方贝塞尔圆润 + 1.2G 幅度（proposal-5/A/C 认可）。采纳 refinement：命名常量 `OUTER_STEP_FACTOR`/`CUBIC_MID_FACTOR`、坐标 1 位小数、`CURVE_BOW_RATIO_MAX=0.4` 弓高上限、`CURVE_MIN_LENGTH=1` 退化守卫、gap 不变式注释精确化；拒绝 proposal-B 的 comb 窗口（纯视觉取舍，需设计方拍板，fan 更贴合"共享端点"语义））——`CURVE_GAP_MIN=12`
- ✅ M3-05 RelationAvatar.vue（实现 agent）
- ✅ M3-06 RelationLines.vue（实现 agent）
- ✅ M3-07 flow.css + flow.js（实现 agent）
- ✅ M3-08 RelationCard.vue（实现 agent）
- ✅ M3-09 RelationsStates.vue（实现 agent）
- ✅ M3-10 RelationsPage.vue + pages.js（负责人亲写）
- ✅ M3-11 test/smoke-relations.mjs（负责人亲写；**未改 package.json**，收口统一合并）
- ✅ src/constants/m-relations.js + src/services/api.js（负责人亲写）

**备注（审计收口）**：独立审计 FAIL → F1/F2（1101）+ F3/F4（中）+ L1-L5（轻）全部修复中。
- F1：pages.js 已改 M2 page-registry 形状（`path/name/component/meta.title`）——原 `{id,level,title}` 被 `val.every(isPageDef)` 静默丢弃。
- F2：data.js 已切 `src/core/api.js` 单点（`/my-relations` 无前缀、`authToken` 键、401→auth:dead）；`services/api.js` 是 M6 跨模块遗留双源（记协调收口统一）。
- F3：RelationCard ended CSS 由 `:deep(.ui-btn)` 后代选择器改复合选择器 `.rel-card__btn--ended.ui-btn`（原永不匹配致底色不灰）。
- F4：卡摆位——**几何模型**（5 设计评审 A/B/C/D/E 收敛）：`card-layout.js` 纯函数 `planRelationCards`，卡宽 `min(CARD_W, fitted, adj)` 不上钳（fitted=中心净空、adj=相邻卡角距），`mode` = 几何门控（`width ≥ CARD_W_MIN=140` 才板上中点挂卡，否则板下垂直列表）；列表卡带用户名 label + 「会话」标题；compact 板高 360px 让列表首屏可见。消除中心/相邻/对角重叠 + 560-704px 残留窗。
- L1：板 `role="img"` → `role="group"`（含可聚焦子元素）；L3：几何裸值入 RELATIONS_GEOMETRY 单源（EDGE_MARGIN/COMPACT_BREAKPOINT/CARD_GAP/CARD_W_MIN/RADIUS_MIN 派生）；L4：selfNode 改 computed（M2 注入更新）；L5：load() 加 disposed 守卫。
- **F5（1101 装配断线，收口验证抓出）**：①`ref="board"` 必须落在**原生元素**——组件 ref 返回组件实例（非 DOM），`getBoundingClientRect()`/`ResizeObserver.observe()` 不可用（代码库惯例实证：SubjectFilter `rootRef`/MoreMenu `panelRef` 均原生 ref + useScrollDetach `typeof …getBoundingClientRect==='function'` 守卫，全仓零 `.$el` 用法）。stage 改为原生外包 div 承 `ref="board"`，RelationsBoard 经 `size` prop 镜像测量尺寸（破除「板自测自身」循环依赖，板由 CSS 100% 填满 stage）。②stage 仅 ready 非空分支渲染，**mount 时不存在** → 旧 onMounted 直调 `observe(board.value)` 抛 `Failed to execute 'observe' on 'ResizeObserver': parameter 1 is not of type 'Element'` 且阻断 `load()`（页恒「加载中…」）。修复 = observer 于 onMounted 创建，`load()` 置 `phase='ready'` 后 `await nextTick()` 再 `measureBoard()`（测量 + observe + compact 刷新）；onResize 仅转发 measureBoard。smoke 全绿（桌面中点卡 6 / 1366×768 列表锁 / 375 列表 + 零溢出 / reduced-motion / 零 console）。
- `src/services/api.js` 不再被 M3 消费（M6 auth 仍用，属跨模块统一项）。
