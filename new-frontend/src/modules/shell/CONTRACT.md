# M2 Shell 模块契约（2026-08-22 · 模块负责人冻结）

> 本契约钉死 M2 全部 14 基元的文件路径 + 导出接口 + 依赖（文件级隔离）。子 agent 只写自己的文件，
> 严格按本契约实现；模块负责人负责组装收口（pages.js glob / store 接线 / 文案汇 m-shell.js /
> smoke-shell 测试 / build 验证）。

## 0.5 生态校准（2026-08-22 主会话修订，覆盖下文冲突处）

并行模块已确立 `src/core/api.js` 为全站 fetch 单点（M8 my-demands 已消费；多模块 CONTRACT 引用）：
- **api 单点 = `src/core/api.js`**（`api(path, {method,body,auth})` + `ApiError{status,code,message}` +
  `AUTH_TOKEN_KEY='authToken'` + `readAuthToken()`/`clearAuthToken()`；401 → 清 token + `window.dispatchEvent(new CustomEvent('auth:dead'))`）。
- 因此 M2 **删除** `src/modules/shell/api.js`（不再建旁路）；M2-12 的 `handle-dead-token.js` **监听 window `auth:dead`**
  （`installDeadTokenListener()`，main.js 调一次）作为唯一 401 通道；同时保留直接 `handleDeadToken()` 调用。
- **auth-store 令牌键 = `AUTH_TOKEN_KEY`**（从 `../../core/api.js` import），与 core/api 同源，persistAuth 写
  session/local `authToken`，core/api readAuthToken 直接读到；user/remember/expires 键 = `sufe.authUser/authRemember/authExpires`。
- auth-actions 走 `@/core/api.js`。session-restore 走 `@/core/api.js`。
- 页面注册表：模块 pages.js 出口**命名不统一**（shell `pages` 数组 / teacher-side `teacherSidePages` 数组 /
  notifications `M5_CAPABILITIES` 对象=浮层入口非路由）。page-registry **稳健收集**：扫描每模块 pages.js 的
  全部导出值，凡「数组且元素含 path+name+component」即视为页面数组并入。
- `src/pages.js`（根，对象注册表）为 M0 过渡分发器（App.vue `?page=`），M2-08 落地后 App.vue 切 RouterView，该文件弃用（inert）。

## 0. 纪律（所有子 agent 必须遵守）

- 只写【文件清单】中你自己的文件；禁止修改任何其它文件、package.json、npm install、git。
- 禁止：模板内联事件属性（`@click` 等 Vue 绑定允许）、内联 style 属性 / `:style` 字面量、
  `v-html`、模板内 `<style>` 元素、中文注释（契约 6）、模块顶层直接读 window。
- 动效：JS 只切类，动画全在 CSS，时长走 token（`--dur-*`）；reduced-motion 已由 base.css 兜底。
- 文案：一律 `import { SHELL_COPY } from '@/constants/m-shell.js'`（已存在单源），禁组件内裸中文。
- 组件消费 M0：`@/components/ui/index.js`（UiButton / UiIcon / UiDropdownPanel / UiText 等）。
  UiButton variant 含 A/A1/B/B1/B2/C/C1/S/S1。
- 所有跨模块绑定必须在**调用时**解引用（不得在模块顶层解引用循环依赖绑定）。
- 每个文件头部加英文块注释说明职责与契约点。

## 1. 角色与令牌单源

- `ROLES = { STUDENT: 'student', TEACHER: 'teacher', ADMIN: 'admin' }`（auth-store.js 定义导出）。
- 存储键（auth-store.js 内部私有）：`sufe.token` / `sufe.user` / `sufe.remember` / `sufe.expires`。
- 会话恢复优先级：localStorage（记住我，未过期）→ sessionStorage → 无。
- 路由：Vue Router 4 **createMemoryHistory**（ADR 0003：纯状态路由，零 URL 竞态）。

## 2. 文件清单与导出（严格）

### 地基批（先 · 并行）

| 基元 | 文件 | 导出 | 依赖 |
|---|---|---|---|
| M2-14 | `src/modules/shell/cleanup-registry.js` | `registerCleanup(fn)` / `runCleanupCallbacks()` | 无 |
| M2-14 | `src/modules/shell/leave-hooks.js` | `registerLeaveHook(fn)` / `runLeaveHooks()` | 无 |
| M2-10 | `src/modules/shell/auth-store.js` | `ROLES` / `REMEMBER_TTL_MS` / `authStore` / `setAuth` / `clearAuth` / `persistAuth` / `readStoredAuth` / `setStorageAdapters` | vue reactive |
| M2-10 | `src/modules/shell/auth-actions.js` | `login` / `register` / `logout` | auth-store / core/api / last-page / cleanup-registry |
| M2-12 | （api 单点 = `src/core/api.js`，M2 不再建 shell/api.js） | `api` / `ApiError` / `AUTH_TOKEN_KEY` | 无 |
| M2-12 | `src/modules/shell/handle-dead-token.js` | `handleDeadToken` / `setDeadTokenRedirect` / `installDeadTokenListener` | auth-store / cleanup-registry / last-page / useToast / m-shell |
| M2-11 | `src/modules/shell/session-restore.js` | `restoreSession()` | auth-store / api / router / last-page / page-registry |
| M2-08 | `src/modules/shell/ifaces.js` | `registerIface` / `getIface` | 无 |
| M2-08 | `src/modules/shell/last-page.js` | `saveLastPage` / `getLastPage` / `clearLastPage` | 无 |
| M2-08 | `src/modules/shell/page-registry.js` | `pages` / `getPageByPath` / `defaultPageForRole` / `pagesByRole` | import.meta.glob |
| M2-08 | `src/router/index.js`（重写 stub） | `router` | page-registry / ShellLayout / router-guard |
| M2-08 | `src/modules/shell/ShellLayout.vue`（最小骨架，M2-01 将替换） | 默认组件 | RouterView |
| M2-09 | `src/modules/shell/router-guard.js` | `installRouterGuard(router)` | auth-store / page-registry / last-page / leave-hooks / handle-dead-token / ifaces |

### 上边栏批（后 · 并行）

| 基元 | 文件 | 导出 | 依赖 |
|---|---|---|---|
| M2-01 | `src/modules/shell/TopBar.vue` | 默认组件 | 下记 TopBarLogo/TabBar/UserArea/UserAreaDropdown/NotifyButton/ChatButton |
| M2-02 | `src/modules/shell/TopBarLogo.vue` | 默认组件 | UiButton / router / logo.svg |
| M2-03 | `src/modules/shell/UserArea.vue` | 默认组件 | auth-store / UiButton / m-shell |
| M2-04 | `src/modules/shell/UserAreaDropdown.vue` | 默认组件 | auth-store / UiButton / UiDropdownPanel / ifaces / m-shell |
| M2-05 | `src/modules/shell/NotifyButton.vue` | 默认组件 | UiButton / ifaces / m-shell |
| M2-06 | `src/modules/shell/ChatButton.vue` | 默认组件 | UiButton / router / auth-store / page-registry / m-shell |
| M2-07 | `src/modules/shell/TabBar.vue` | 默认组件 | page-registry / auth-store / router / UiButton / m-shell |
| M2-13 | `src/modules/shell/PageTransition.vue` | 默认组件 | vue Transition |
| M2-13 | `src/modules/shell/page-transition.css` | — | tokens |

## 3. 地基批文件级契约（逐条）

### 3.1 cleanup-registry.js（M2-14）
```js
const callbacks = new Set()
export function registerCleanup(fn) { callbacks.add(fn); return () => callbacks.delete(fn) }
export function runCleanupCallbacks() { const list = [...callbacks]; callbacks.clear(); list.forEach(fn => { try { fn() } catch (e) {} }) }
```
用途：401/登出时停止轮询/定时器/监听器（F3 去重）。无依赖。

### 3.2 leave-hooks.js（M2-14）
```js
const hooks = new Set()
export function registerLeaveHook(fn) { hooks.add(fn); return () => hooks.delete(fn) }
export function runLeaveHooks() { hooks.forEach(fn => { try { fn() } catch (e) {} }) }  // 不清空：钩子随页面生命周期自行注销
```
用途：路由 afterEach 离场清理。

### 3.3 auth-store.js（M2-10 · 纯状态+存储，零网络，Node 可测）
- `export const ROLES = Object.freeze({ STUDENT: 'student', TEACHER: 'teacher', ADMIN: 'admin' })`
- `export const REMEMBER_TTL_MS = 7 * 24 * 60 * 60 * 1000`
- `export const authStore = reactive({ token: null, user: null, ready: false })`
  - user 形状：`{ id, username, role, avatar }`（teacher 可含 teacherName）。
- `setStorageAdapters(session, local)`：测试注入；未注入时默认 `window.sessionStorage`/`window.localStorage`
  （访问处 try/catch 守卫，防 SSR/私密模式）。
- `setAuth({ token, user })`：token/user 赋值 + `ready = true`（F7 立即同步）。
- `clearAuth()`：token/user/ready 复位 + 清双存储四键。
- `persistAuth({ token, user, remember })`：sessionStorage 恒写 token/user/remember；
  remember=true 追加 localStorage 三键 + `EXPIRES = now + REMEMBER_TTL_MS`；remember=false 清 localStorage 三键。
- `readStoredAuth()`：返回 `{ token, user, remember }` 或 `null`。localStorage 优先（EXPIRES 过期则清三键并降级读
  sessionStorage）；sessionStorage 次之；user JSON.parse 失败按 null。
- 除 `vue` 的 `reactive` 外零 import。Node 测试经 setStorageAdapters 注入内存 storage。

### 3.4 auth-actions.js（M2-10）
- `import { api } from '@/core/api.js'`。
- `login({ identifier, code, remember = false, deviceId } = {})`：
  `api('/auth/login/code', { method:'POST', body:{ identifier, code, ...(deviceId?{deviceId}:{}) }, auth:false })`
  → 响应 `{ user, authToken }` → `setAuth` + `persistAuth` → return user。
- `register(payload)`：`api('/auth/register', { method:'POST', body:payload, auth:false })` → `{ user, authToken }`
  → setAuth + persistAuth(remember:false) → return user。
- `logout()`：`try { await api('/auth/logout', { method:'POST' }) } catch(e) {}` → `clearAuth()` + `clearLastPage()`
  + `runCleanupCallbacks()`。

### 3.5 api 单点（M2-12 · 采用 `src/core/api.js`，不新建）
- 采用既有 `src/core/api.js`（已存在的 fetch 单点，M8 已消费）：
  - `api(path, { method='GET', body, auth=true })`：path 形如 `/auth/me`，内部拼 `/api` 前缀；auth 注入
    `X-Auth-Token`（经 `readAuthToken()` 读 storage `AUTH_TOKEN_KEY='authToken'`）；401 → `clearAuthToken()` +
    `window.dispatchEvent(new CustomEvent('auth:dead'))` + throw `ApiError(401,'UNAUTHORIZED')`；非 2xx 抛
    `ApiError{status,code,message}`。
  - M2 不得再建 shell/api.js（W6 复用，禁止旁路）。

### 3.6 handle-dead-token.js（M2-12 · 唯一登录判定通道）
- 内部 `let redirectHandler = null`；`setDeadTokenRedirect(fn)` 注入（router-guard 调）。
- `installDeadTokenListener()`：`window.addEventListener('auth:dead', () => handleDeadToken())`，模块级 `installed`
  标志 F3 去重；main.js 启动调一次。core/api 401 → 事件 → 本函数（唯一登录判定通道）。
- `handleDeadToken({ silent = false } = {})`：
  1. `clearAuth()`（清态 + 双存储）
  2. `clearLastPage()`
  3. `runCleanupCallbacks()`
  4. `if (!silent) showToast(SHELL_COPY.LOGIN_EXPIRED)`
  5. `if (redirectHandler) redirectHandler()`（router-guard 提供：回落地页 + 引导登录）
- 幂等：重复调用不炸。

### 3.7 session-restore.js（M2-11）
- `import { api } from '@/core/api.js'`。
- `restoreSession()`：
  1. `const stored = readStoredAuth()`；无 → `authStore.ready = true; return null`。
  2. 乐观 `setAuth({ token: stored.token, user: stored.user })`。
  3. `const data = await api('/auth/me')`（401 → core/api 清 token + dispatch `auth:dead` → handleDeadToken 清态并重定向）。
  4. `setAuth({ token: stored.token, user: data.user })`。
  5. 目标导航：`const last = getLastPage(); const pg = last ? getPageByPath(last) : null;
     const ok = pg && pg.roles?.includes(data.user.role); const target = ok ? last : (defaultPageForRole(data.user.role) || '/');
     if (router.currentRoute.value.path !== target) await router.push(target)`。
  6. `catch (e) { if (e.status !== 401) {} } finally { authStore.ready = true }`。

### 3.8 ifaces.js（M2-08）
- `const ifaces = new Map()`；`registerIface(name, fn)`（覆盖）；`getIface(name)`（无返回 undefined）。
- 用途：跨模块接口帽（M6 openIdentityAuth / M5 openC3、openC4、openSettings、openAbout、openFeedback 等注册）。

### 3.9 last-page.js（M2-08）
- 键 `sufe.lastPage`（sessionStorage）；`saveLastPage(path)` / `getLastPage()` / `clearLastPage()`，均 try/catch 守卫。

### 3.10 page-registry.js（M2-08）
- `const mods = import.meta.glob('../modules/*/pages.js', { eager: true })`
- **稳健收集**（生态校准：各模块出口命名不统一）：遍历每模块全部导出值，凡「数组且每个元素是 page 定义
  （`p && typeof p === 'object' && typeof p.path === 'string' && p.component && typeof p.name === 'string'`）」即并入：
  ```js
  const collected = []
  for (const m of Object.values(mods)) {
    for (const key of Object.keys(m)) {
      const val = m[key]
      if (Array.isArray(val) && val.every(isPageDef)) collected.push(...val)
    }
  }
  export const pages = collected
  ```
  - 捕获：shell `pages` 数组、teacher-side `teacherSidePages` 数组；忽略 notifications `M5_CAPABILITIES`（对象=浮层入口）。
  - 每条 page：`{ path, name, roles?, component, meta? }`；roles 存在即受保护（登入门禁），否则公开。
- `getPageByPath(path)` → 匹配 `p.path === path`（无返回 undefined）。
- `defaultPageForRole(role)` → 第一个 `p.roles?.includes(role) && p.meta?.tab !== false` 的 `p.path`；
  无则回退第一个任意 roles 匹配的 `p.path`；再无则 `null`。
- `pagesByRole(role)` → `pages.filter(p => p.roles?.includes(role))`（供 TabBar / ChatButton）。
- 注意：glob 含本模块自身 pages.js（模块即注册源）。不得显式 import shell/pages.js。

### 3.11 src/router/index.js（M2-08 · 重写现有 stub）
- `import { createRouter, createMemoryHistory } from 'vue-router'`
- `import ShellLayout from '@/modules/shell/ShellLayout.vue'`
- `import { pages } from '@/modules/shell/page-registry.js'`
- `import { installRouterGuard } from '@/modules/shell/router-guard.js'`
- routes：
  - 公开页（`!p.roles`）→ 顶层 `{ path: p.path, name: p.name, component: p.component, meta: { ...(p.meta||{}) } }`。
  - 受保护页 → 无路径壳：`{ path: '', component: ShellLayout, meta: { requiresAuth: true },
    children: gated.map(p => ({ path: p.path, name: p.name, component: p.component, meta: { ...(p.meta||{}), roles: p.roles } })) }`。
- `export const router = createRouter({ history: createMemoryHistory(), routes })`；`installRouterGuard(router)`。
- 头部英文注释说明 memory history 决策（ADR 0003）。

### 3.12 ShellLayout.vue（M2-08 · 最小骨架）
- 模板：`<div class="shell-layout"><main class="shell-layout__body"><RouterView /></main></div>`。
- 零内联样式；布局用 tokens（`min-height:100vh`）。M2-01 将替换为完整版。

### 3.13 router-guard.js（M2-09）
- `installRouterGuard(router)`：
  1. `setDeadTokenRedirect(() => { router.push('/'); const open = getIface('openIdentityAuth'); if (open) open({ mode: 'login' }) })`。
  2. `router.beforeEach((to) => { ... })`：
     - `const requiresAuth = to.matched.some(r => r.meta.requiresAuth)`；公开 → return true。
     - `!authStore.token` → 引导登录 + 回落地页：`const open = getIface('openIdentityAuth'); if (open) open({ mode: 'login' }); return { path: '/' }`。
     - `const roles = to.meta.roles`；`roles && authStore.user && !roles.includes(authStore.user.role)`
       → `const def = defaultPageForRole(authStore.user.role); return def ? { path: def } : true`。
     - return true。
  3. `router.afterEach((to) => { if (to.path && to.path !== '/') saveLastPage(to.path); runLeaveHooks() })`。

## 4. 上边栏批文件级契约（逐条）

### 4.1 TopBar.vue（M2-01）
固定上边栏（同页面底色，无边框，层级在页面上层）。布局：
- 左：`TopBarLogo`（`topbar__logo`）。
- 中：`TabBar`（`topbar__tabs`，flex 居中占中间大部分宽度）。
- 右（从右往左）：`UserArea` → `NotifyButton` → `ChatButton`（`topbar__right`，右对齐，`flex:none` 保持固有宽——随用户名长度变化）。
- 375 不溢出：LOGO 可缩（min-width:0）+ TabBar `overflow-x:auto` 横滚（滚动条隐藏）；右簇 `flex:none` 不收缩。
- 消费同批组件文件；aria 等文案走 SHELL_COPY。

### 4.2 TopBarLogo.vue（M2-02）
UiButton variant="B"（LOGO 即按钮内组件），点击 `router.push('/')`；内含 `@/assets/svg/logo.svg`；
aria-label = SHELL_COPY.LOGO_LABEL。

### 4.3 UserArea.vue（M2-03）
读 authStore.user。圆形头像（img，user.avatar 或占位）+ 黑色加粗用户名（>10 字符省略号截断，
CSS `max-width` + `text-overflow: ellipsis`）+ 固定向下 V 形（`arrow-down.svg`，不可转动）。
悬停呼出 C4 的判定区/保留区由 M2-04 组件负责（本组件只展示视觉 + 触发状态）。

### 4.4 UserAreaDropdown.vue（M2-04）
悬停呼出 C4「更多」下拉栏（UiDropdownPanel）+ **保留区**（从文字范围向下延伸至下拉栏上边缘；
鼠标在保留区或下拉栏内都不收起，移出才收起——F3 去重，onMounted 注册一次）。
C4 内容 = 设置/关于平台/用户反馈 三项（M5 提供），本批用 `data-cap="M5.settings"` /
`data-cap="M5.about"` / `data-cap="M5.feedback"` 占位 + 点击 `getIface('openC4')?.(...)` 预留。
每项是按钮 B 行（含左侧小 SVG 图案：可用现有 assets/svg 或点号）。

### 4.5 NotifyButton.vue（M2-05）
信封 SVG 按钮 B 短胶囊。点击 `getIface('openC3')?.()`（M5 注册；main.js 已接线）。
aria-label = SHELL_COPY.NOTIFY_LABEL。

### 4.6 ChatButton.vue（M2-06）
信息气泡 SVG（`chat-bubble.svg`）按钮 B 短胶囊。点击：`pagesByRole(authStore.user.role)` 中按接口帽标记
`meta.c2` 找 C2 会话页（M4 chat 页携带，路径 /chat），有 → `router.push(目标)`；无 → 不跳
（data-cap="M4.c2" 标记，等待 C2 页注册）。aria-label = SHELL_COPY.CHAT_LABEL。

### 4.7 TabBar.vue（M2-07）
居中模块选项卡。数据 = `pagesByRole(authStore.user.role).filter(p => p.meta?.tab !== false)`（按 pages 顺序）。
每项 = UiButton variant="B" 较宽，`:class="{ 'is-selected': current }"`（选中 `--gray-10` 填充）；
点击 `router.push(p.path)`；当前路由高亮（`router.currentRoute.value.path === p.path`）。

### 4.8 PageTransition.vue + page-transition.css（M2-13）
- PageTransition.vue：`<Transition name="page" mode="out-in"><slot /></Transition>`（默认组件）。
- page-transition.css：`.page-enter-active/.page-leave-active`（fade + 轻微 float，时长 `--dur-base`/`--dur-md`，
  缓动 `--ease-out`）。**必须全局 CSS（Transition 类作用于子组件根元素，scoped 不匹配）**；
  reduced-motion 由 base.css 兜底。

## 5. 组装收口（模块负责人负责，子 agent 不做）
- `src/modules/shell/pages.js`：export `pages`（`/` = M1 LandingPage + `/home` 客户端占位(roles 全部) + `/preview` dev 展示页）。
- `src/constants/m-shell.js`：SHELL_COPY 单源（已建）。
- `src/modules/shell/ShellLayout.vue` 最终版：TopBar + RouterView(+PageTransition) + M5Host。
- `src/main.js`：装 router + restoreSession + installDeadTokenListener + M5 ifaces 注册 + `window.__APP__` 测试钩子。
- `src/App.vue`：RouterView + UiToast。
- `test/smoke-shell.mjs`（node --test + Playwright 实机，全绿）。

## 6. 完成状态（2026-08-22 收口记录）

M2 全部 14 基元已实现，由 13 个子 agent + 模块负责人（M2-07 TabBar 子 agent 被会话中断，负责人补写）完成；
最终验证（2026-08-22）：`npm run build`（391 模块绿）+ `test/smoke-shell.mjs`（5/5 绿，含角色门禁守卫测试
+ unknown-role fail-closed + toast 文案 D3 锁）+ M0 测试经 URL bridge 全通（smoke-preview / smoke-inputs /
smoke-modals 全 PASS）。独立审计 PASS（agent a136b7f4a3f680e9c）。**不 commit**（主会话收口时统一提交）。

| # | 基元 | 文件 | 状态 |
|---|---|---|---|
| M2-01 | 上边栏容器 | `TopBar.vue` | ✅ 子 agent |
| M2-02 | LOGO 按钮B | `TopBarLogo.vue` | ✅ 子 agent |
| M2-03 | 用户区 | `UserArea.vue` | ✅ 子 agent |
| M2-04 | C4 悬停下拉（保留区） | `UserAreaDropdown.vue` | ✅ 子 agent |
| M2-05 | 信封触发 C3 | `NotifyButton.vue` | ✅ 子 agent |
| M2-06 | 气泡跳转 C2 | `ChatButton.vue` | ✅ 子 agent |
| M2-07 | 居中选项卡 | `TabBar.vue` | ✅ 负责人补写（:deep 选中态） |
| M2-08 | 路由注册表 | `router/index.js` + `page-registry.js` + `last-page.js` + `ifaces.js` + `ShellLayout.vue` | ✅ 子 agent |
| M2-09 | 角色门禁守卫 | `router-guard.js` | ✅ 子 agent |
| M2-10 | authStore 核心 | `auth-store.js` + `auth-actions.js` | ✅ 子 agent |
| M2-11 | 会话恢复 | `session-restore.js` | ✅ 子 agent |
| M2-12 | 401 兜底 | `handle-dead-token.js`（api 单点=core/api.js） | ✅ 子 agent |
| M2-13 | 页面过渡 | `PageTransition.vue` + `page-transition.css` | ✅ 子 agent |
| M2-14 | leave 钩子+清理 | `leave-hooks.js` + `cleanup-registry.js` | ✅ 子 agent |

组装决策（生态校准落地）：
- api 单点 = `src/core/api.js`（M2 不建 shell/api.js，401 → window `auth:dead` → handleDeadToken）。
- auth-store 令牌键 = core/api `AUTH_TOKEN_KEY`（'authToken'），persistAuth 写 session/local 同键。
- main.js 注册 M5 ifaces（openC3/openC4）；ShellLayout 挂载 M5Host。
- 角色默认页 = 首个 `roles` 匹配且 `meta.tab !== false` 的页（student 当前 = M4 `/chat`，非 `/home`）。

### 集成修复（M1 转交 + 主会话，均已落位）
- **glob 修正**：page-registry 收集 `../*/pages.js`（M1 定位原 `../modules/*/pages.js` 解析到不存在路径）。
- **Shell 路由**：`path: '/'`（原 `path: ''` 匹配根遮蔽公开落地页）。
- **memory-history 阻断 M0 测试**：main.js `bootNavigateFromUrl()` 一次性读 `pathname` / `?page=preview` 初始导航（dev 专用，生产零影响）；smoke-preview/inputs/modals 已改 `/?page=preview`。
- **LandingStub.vue 死文件**：已删（W18）。

### 独立审计记录（agent a136b7f4a3f680e9c → PASS）
- build 绿（391 模块）+ smoke-shell 5/5 绿 + 零 console/pageerror/CSP + 375 双场景无溢出。
- **M2-09 角色门禁 fail-open 修复**（主会话）：角色不匹配时 `return def ? {path:def} : {path:'/'}`（原 `: true` 放行到越权页）；unknown/legacy 角色 fail-closed 回落地页。
- **守护测试补强**：role gate「学生被拦出教师页」+「unknown 角色 fail-closed 落 `/`」两条守卫断言（变异删门禁必红）。
- **审计观察项处理**：M8 my-demands/pages.js 已由 M8 agent 改为数组导出（`{path,name,roles,component}`，收集器只收数组）；smoke-shell 死截图行已删；toast 断言补 `SHELL_COPY.LOGIN_EXPIRED` 文案锁（D3）。
- **移交观察项**：teacher-square/actions.js:49 动态 import router 冗余（build 警告，归属 M7）；根 `src/pages.js` 已弃用（inert）；TabBar 标题 meta.title 为复制键需收口期解析；teacher-side 页 B1_TITLE 等键未解析。
