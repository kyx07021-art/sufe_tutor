# 全站动效盘点（motion-audit）

> 文档性质：只读现状快照 + 标准化建议（AK-N-S1「标准动效库」落地前置盘点）。
> 生成时间：2026-08-25（AK-N 收口期）。盘点对象：`new-frontend/src` 全部 .vue/.js/.css（components/ modules/ composables/ directives/ styles/ views/）。
> 口径：每一处 `@keyframes` / `animation` / `transition` / Vue `<Transition>` / rAF 驱动动效 / 动效类定时器均已收录；`prefers-reduced-motion` 回退逐文件核对。
> ⚠️ **in-flight 标注**：CORE agent 正在重构涟漪/按钮动效 + tokens 动效 token（下述文件 mtime 2026-08-25 00:06–00:16，属于进行中工作区）。in-flight 文件**不纳入整改判定**，仅在清单中标注，避免与进行中重构互相踩踏。

---

## 0. 摘要

| 指标 | 数值 |
|---|---|
| `@keyframes` 定义 | **16**（tokens.css 2 个共享 + 各组件 14 个局部） |
| `animation:` 声明 | 38（含 reduced/disabled 的 `animation: none`） |
| `transition:` 声明 | 82（含 reduced 的 `transition: none`） |
| `animation-*` / `transition-*` 长属性 | 17（动画延迟 8 + reduced 压缩 2 + reveal 5 + transition-delay 2） |
| Vue `<Transition>` / `<TransitionGroup>` | **11 个命名 transition / 12 个组件 / 14 个标签**（UiToast、NotificationsModal 各含 2 标签） |
| rAF 驱动动效 composable | 7 文件（createRipple / PageEnter / useScrollDetach / LandingGallery / useGalleryDrift / useGalleryShrink / useScrollReveal） |
| 动效类 setTimeout/setInterval | 6 处（UiStepModal / useToast / CaptchaPuzzle / settings-data / useScrollReveal / useCountdown） |
| `prefers-reduced-motion` 回退 | 37 文件全覆盖（base.css 全局挤压 + 各组件局部回退） |
| 动效 token 消费量 `var(--ease-*|--dur-*|--btn-dur-*)` | 230 处 |
| **动效 token 定义但零消费** | `--dur-lg`(500ms)、`--dur-xl`(700ms) —— 死 token |
| **裸值散落**（非 token 的 duration/easing/位移 px） | **~28 处**（详见 §5） |
| 同类动效多实现（fade/slide 参差） | **fade+slide 组合位移距离不统一**：6px/8px/10px/12px/28px/40px 六档（详见 §6.2） |

**结论**：动效已具备**强基座**——共享 `ui-ripple`/`ui-fill-in` keyframes + `--dur-*`/`--ease-*` token 体系 + 全组件 reduced-motion 回退 + 6 涟漪组件统一走 `createRipple` 单核心。**缺口集中在**：① 位移距离（translate 的 px）无 token，六档裸值散落；② `--dur-lg`/`--dur-xl` 死 token；③ `ease`/`linear` 裸关键字绕过 --ease-*；④ 步进浮窗 STEP_MS(320) 与 `--dur-base`(300) 语义重复未连通；⑤ JS 侧动效参数（toast 2600 / gallery speed 40 / stagger 90 / relu C=120,f=0.3）全部裸值。→ 收编进「标准动效库」接口的路径见 §7。

---

## 1. 动效总表（文件:行号 | 类型 | 参数 | 标准化 | 归类）

### 1.1 共享基座（tokens.css —— 全站动效单源）

| 位置 | 类型 | 内容 | 参数 | 标准化 |
|---|---|---|---|---|
| tokens.css:122-127 | token | `--dur-xs 100ms / --dur-sm 200ms / --dur-base 300ms / --dur-md 400ms / --dur-lg 500ms / --dur-xl 700ms` | 100ms 主 + 乘数 | ✅ 单源 |
| tokens.css:128-130 | token | `--ease-out / --ease-soft / --ease-in`（cubic-bezier） | 三档缓动 | ✅ 单源 |
| tokens.css:217-221 | keyframes | `ui-ripple`（涟漪透明度：前半淡入，后半保持 1） | opacity 0→1→1 | ✅ 共享，**[in-flight]** |
| tokens.css:227-230 | keyframes | `ui-fill-in`（悬停填充 scale 0→1） | transform scale | ✅ 共享，**[in-flight]** |
| base.css:126-135 | 全局回退 | `prefers-reduced-motion` 挤压 `animation-duration:0.01ms !important` + `transition-duration:0.01ms` | 0.01ms | ✅ 全局兜底 |
| base.css:92-111 | 平台滚动条 | WebKit 8px 圆角 thumb / Firefox thin | — | ✅ 与动效无关 |

> `--dur-lg` / `--dur-xl` **零消费**（§5.2）。`--ease-soft` 仅 1 处消费（ChatSpecialBubble breathe）。`--ease-in` 仅 3 处（UiStepModal 离场）。

### 1.2 UI 基础组件（components/ui/ —— 除 UiModal 外均为 [in-flight]）

| 位置 | 类型 | 参数 | 标准化 |
|---|---|---|---|
| UiButton.vue:160-162 | transition（transform + box-shadow） | `--btn-dur-color` / `--btn-dur-focus` + `--ease-out` | ✅ token |
| UiButton.vue:195/201 | transition（color，S/S1 灰化） | `--btn-dur-color` + `--ease-out` | ✅ token |
| UiButton.vue:245 | transition（hover 层 opacity） | `--btn-dur-out` + `--ease-out` | ✅ token |
| UiButton.vue:247-252 | animation `ui-fill-in`（hover 填充） | `--btn-dur-in` + `--ease-out` forwards | ✅ 共享 keyframes |
| UiButton.vue:264-267 | animation `ui-ripple`（点击涟漪） | `--btn-dur-click`(200ms) + `--ease-out` forwards | ✅ 共享 + rAF |
| UiButton.vue:279-288 | transition（label/arrow color + arrow transform） | `--btn-dur-color` + `--ease-out` | ✅ token |
| UiButton.vue:293-298 | arrow focus/hover 位移 | `translateX(var(--btn-arrow-shift))` | ✅ token（4px） |
| UiButton.vue:325-331 | A/C 悬停微抬 | `translateY(var(--btn-lift))` | ✅ token |
| UiCheckButton.vue:127-131 | transition（width 伸长 + transform + box-shadow） | `--dur-sm` / `--btn-dur-color` / `--btn-dur-focus` | ✅ token |
| UiCheckButton.vue:149-152 | transition（check 容器 width/opacity） | `--dur-sm` + `--ease-out` | ✅ token |
| UiCheckButton.vue:163-165 | animation `ui-check-in`（勾选弹出） | `--dur-sm` + `--ease-out` | ⚠️ 局部 keyframes |
| UiCheckButton.vue:207-209 | animation `ui-fill-in` | `--btn-dur-in` + `--ease-out` | ✅ 共享 |
| UiCheckButton.vue:220-223 | animation `ui-ripple` | `--btn-dur-click` + `--ease-out` | ✅ 共享 |
| UiCard.vue:108/123 | animation `ui-fill-in` / `ui-ripple` | `--dur-xs` / `--btn-dur-click` | ✅ 共享 |
| UiComboInput.vue:159/174 | animation `ui-fill-in` / `ui-ripple` | `--dur-xs` / `--btn-dur-click` | ✅ 共享 |
| UiComboInput.vue:190-192 | transition（V 图标旋转） | `transform rotate(180deg)` + `--dur-sm` | ✅ token |
| UiCaptchaInput.vue:146/151/166 | animation `ui-fill-in` / `ui-ripple` | `--dur-md` / `--dur-xs` / `--btn-dur-click` | ✅ 共享 |
| UiVariableInputSet.vue:200/217 | animation `ui-fill-in` / `ui-ripple` | `--dur-xs` / `--btn-dur-click` | ✅ 共享 |
| UiInput.vue:234 | transition（背景灰化） | `--dur-sm` + `--ease-out` | ✅ token |
| UiInput.vue:300 | transition（**下划线 wipe**） | `transform scaleX 0↔1`，origin 随状态翻转 | ✅ token（AK-A5） |
| UiDropdown.vue:126-131 | transition（V 图标旋转） | `rotate(180deg)` + `--dur-sm` | ✅ token |
| UiDropdownPanel.vue:196-214 | Vue `<Transition name="ui-drop-*">` **4 方向浮入** | `--dur-sm` + `--ease-out`，`translate(Y/X ±6px)` | ⚠️ **位移裸 6px** |
| UiModal.vue:130-146 | Vue `<Transition name="ui-modal">` fade + 面板浮入 | 面板 `translateY(10px) scale(0.97)` + `--dur-base`/`--dur-sm` | ⚠️ **位移/缩放裸 10px/0.97**（UiModal 非 in-flight） |
| UiStepModal.vue:346-365 | Vue `<Transition name="ui-step-title-*">` 标题滑入 | `translateX(±28px)` + `--dur-base` | ⚠️ **位移裸 28px** |
| UiStepModal.vue:402-417 | animation `ui-step-enter/leave-next/prev`（页切换） | `translateX(±28px)` + `--dur-base`/`--ease-in` | ⚠️ **位移裸 28px** |
| UiStepModal.vue:381-389 | transition（step 圆点） | `background-color` + `transform scale(1.18)` + `--dur-sm` | ⚠️ **scale 裸 1.18** |
| UiStepModal.vue:469-490 | animation `ui-step-footer-in/out` | `translateX(±28px)` + `--dur-base`/`--ease-in` | ⚠️ **位移裸 28px** |
| UiStepModal.vue:45/139-143 | JS 定时 `STEP_MS = 320` | setTimeout(endTransition, 320) | ⚠️ **JS 裸 320，与 --dur-base 语义重复** |
| UiToast.vue:51-59 | Vue `<TransitionGroup name="ui-toast">` fade+滑入 | `translateY(8px)` + `--dur-base` | ⚠️ **位移裸 8px** |
| UiCheckbox.vue:99-112 | transition（方框 + 勾） | `border-color/background/opacity/transform scale(0.4)` + `--dur-sm` | ⚠️ **scale 裸 0.4** |
| UiFieldInput.vue:64 | 状态标记（红*黄*绿✓） | 无动效（状态切换） | ✅ 非动效（AK-N-P5 已收口） |

### 1.3 共享组件（components/shared/）

| 位置 | 类型 | 参数 | 标准化 |
|---|---|---|---|
| FilterTrigger.vue:135-137 | transition（边框 + focus ring） | `--dur-sm` + `--ease-out` | ✅ token |
| FilterTrigger.vue:164-168 | transition（chevron 旋转） | `rotate(180deg)` + `--dur-sm` | ✅ token |
| OrderToggle.vue:63 | transition（背景） | `--dur-sm` + `--ease-out` | ✅ token |
| SortBar.vue:57 | transition（tab 字色 + 背景） | `--dur-sm` + `--ease-out` | ✅ token |

### 1.4 模块组件（modules/ —— 逐模块）

| 位置 | 类型 | 参数 | 标准化 |
|---|---|---|---|
| auth/CaptchaPuzzle.vue:299/302 | transition（track transform）+ animation `puzzle-shake` | `--dur-sm` / **`420ms`** + `--ease-out` | ⚠️ **duration 裸 420ms** |
| auth/CaptchaPuzzle.vue:323-327 | transition（hint 淡出） | `--dur-sm` | ✅ token |
| chat/ChatBubble.vue:131-133 | animation `chat-bubble-in` | `translateY(12px)` + `--dur-base` | ⚠️ **位移裸 12px**（发送气泡） |
| chat/ChatSpecialBubble.vue:51 | animation `chat-special-breathe` | **`3s`** + `--ease-soft` infinite | ⚠️ **duration 裸 3s** |
| chat/ChatTopBar.vue:214-222 | Vue `<Transition name="chat-more">` | `translateY(-6px)` + `--dur-sm` | ⚠️ **位移裸 6px** |
| chat/ChatConversationPane.vue:260 | transition（滚动遮罩淡入淡出） | `--dur-base` | ✅ token |
| chat/ChatInputBar.vue:212/221 | transition（胶囊 shadow + toggle 旋转） | `--dur-sm`/`--dur-base` | ✅ token |
| chat/ChatInputBar.vue:259-273 | transition（附件 sheet 滑入） | `translateY(var(--space-2))` + `--dur-base` | ✅ token（位移用 spacing） |
| chat/ChatListPane.vue:101 | transition（卡片背景） | `--dur-base` | ✅ token |
| notifications/MoreMenu.vue:253-261 | Vue `<Transition name="m5-more">` | `translateY(-6px)` + `--dur-sm` | ⚠️ **位移裸 6px** |
| notifications/NotificationDetail.vue:85-98 | Vue `<Transition name="nt-detail">` 右滑入/左滑出 | `translateX(±40px)` + `--dur-base` | ⚠️ **位移裸 40px** |
| notifications/NotificationsModal.vue:182-195 | Vue `<Transition name="nt-list">` 左滑 | `translateX(-40px)` + `--dur-base` | ⚠️ **位移裸 40px** |
| notifications/SettingsAvatar.vue:224 | transition（背景） | `--dur-xs` | ✅ token |
| my-demands/DemandCard.vue:284 | transition（CTA 箭头位移） | `translateX(var(--btn-arrow-shift))` + `--dur-sm` | ✅ token |
| relations/RelationAvatar.vue:106 | transition（ring 边框） | `--dur-sm` + **`ease`** | ⚠️ **easing 裸关键字** |
| relations/flow.css:17-28 | animation `rel-flow`（虚线流向） | `--rel-flow-dur: 6s` + **`linear`** infinite | ⚠️ **duration 裸 6s（局部变量）+ easing 裸 linear** |
| teacher-side/B1/TeacherDemandGrid.vue:42-54 | animation `cell-enter` + **8 档 stagger** | `translateY(var(--space-3))` + `--dur-base`；delay **40-280ms 裸值 ×8** | ⚠️ **stagger 裸 40ms×8** |
| teacher-side/B1/FilterReveal.vue:63/73-81 | Vue `<Transition name="filter-reveal">` | `translateY(-6px)` + `--dur-base` | ⚠️ **位移裸 6px** |
| teacher-square/FilterReveal.vue:62-76 | Vue `<Transition name="fr">` | `translateY(calc(-1 * var(--space-3)))` + **`--dur-md`** | ✅ token（位移用 spacing） |
| teacher-square/PageEnter.vue:105-112 | **stagger 入场**（transition） | `translateY(var(--reveal-y, 24px))` + `--dur-base`；`transition-delay: var(--enter-delay)` | ⚠️ **fallback 裸 24px / JS stagger 裸 90ms** |
| teacher-square/SecondBar.vue / SortBar / OrderToggle | 见 shared | — | ✅ |

### 1.5 落地页（views/landing/）

| 位置 | 类型 | 参数 | 标准化 |
|---|---|---|---|
| landing-reveal.css:14-62 | **滚动浮现** `landing-reveal-up/down` | `translateY(±var(--reveal-y))` + `--dur-base` + `--ease-out`，fill backwards | ✅ token |
| landing-gallery-mask.css:13-28 | 横廊边缘静态渐变遮罩 | `mask-image` 渐变，`--gallery-mask-w` | ✅ 非动效 |
| LandingGallery.vue:151 | `--g-scale` 缩放（useGalleryShrink 驱动） | `transform: scale(var(--g-scale))` | ✅ token + rAF |
| LandingGallery.vue:61-68 | 滚动取模回绕 | rAF 批处理 | ✅ 非动效 |
| useGalleryDrift.js:23/40 | 横廊自动缓移 | rAF + performance.now delta；**speed = 40 裸值 px/s** | ⚠️ **JS 裸 40px/s** |
| useGalleryShrink.js:20-30 | 边缘线性缩小 | `--gallery-shrink-min`(0.72) / `--gallery-mask-w`(50) 运行时读 token | ✅ token 读源 |
| useScrollReveal.js:28/71 | 滚动浮现 JS 编排 | `ANIM_FALLBACK = 700` 裸值（必须 > --dur-base 300ms） | ⚠️ **JS 裸 700ms** |

### 1.6 页面切换（modules/shell/）

| 位置 | 类型 | 参数 | 标准化 |
|---|---|---|---|
| PageTransition.vue:14 | Vue `<Transition name="page" mode="out-in">` | — | ✅ 承载 |
| page-transition.css:15-29 | 页面切换 fade+浮 | `translateY(±var(--reveal-y))` + `--dur-base` + `--ease-out` | ✅ token |

---

## 2. @keyframes 全清单（16 个）

| # | 名称 | 位置 | 内容 | 被引用（animation） |
|---|---|---|---|---|
| 1 | `ui-ripple` | tokens.css:217 | opacity 0→1（前半）→1（后半） | 6 涟漪组件 `.is-rippling::after` **[in-flight]** |
| 2 | `ui-fill-in` | tokens.css:227 | transform scale 0→1 | 6 涟漪组件 hover `::before` **[in-flight]** |
| 3 | `ui-check-in` | UiCheckButton.vue:166 | scale 0.4→1 + opacity | `.ui-checkbtn.is-checked .ui-checkbtn__check-svg` |
| 4 | `ui-step-enter-next` | UiStepModal.vue:406 | translateX 28→0 + opacity | `.ui-step__page--enter-next` |
| 5 | `ui-step-leave-next` | UiStepModal.vue:410 | translateX 0→-28 + opacity | `.ui-step__page--leave-next` |
| 6 | `ui-step-enter-prev` | UiStepModal.vue:414 | translateX -28→0 + opacity | `.ui-step__page--enter-prev` |
| 7 | `ui-step-leave-prev` | UiStepModal.vue:418 | translateX 0→28 + opacity | `.ui-step__page--leave-prev` |
| 8 | `ui-step-footer-in` | UiStepModal.vue:471 | translateX -28→0 + opacity | `.ui-step__footer--enter` |
| 9 | `ui-step-footer-out` | UiStepModal.vue:475 | translateX 0→-28 + opacity | `.ui-step__footer--leave` |
| 10 | `puzzle-shake` | CaptchaPuzzle.vue:379 | translateX 0→-6→6→0 | `.captcha-puzzle__track.is-shake` |
| 11 | `chat-bubble-in` | ChatBubble.vue:134 | translateY 12→0 + opacity | `.chat-bubble.animate-in` |
| 12 | `chat-special-breathe` | ChatSpecialBubble.vue:54 | border-color + box-shadow 呼吸 | `.chat-special`（3s infinite） |
| 13 | `rel-flow` | relations/flow.css:25 | stroke-dashoffset 0→-200px | `.relations-board.is-flowing .rel-line__path` |
| 14 | `cell-enter` | TeacherDemandGrid.vue:51 | translateY(space-3)→0 + opacity | `.td-grid__cell` |
| 15 | `landing-reveal-up` | landing-reveal.css:34 | translateY(24)→0 + opacity | `.reveal-in-up` |
| 16 | `landing-reveal-down` | landing-reveal.css:45 | translateY(-24)→0 + opacity | `.reveal-in-down` |

**观察**：仅 `ui-ripple` / `ui-fill-in` 是跨组件共享 keyframes（收编成功先例）；其余 14 个均组件局部。`ui-step-*` 4 个页切换 + 2 个 footer 与 `ui-step-title-*` Transition 语义重复（同类 slide 多实现）。

---

## 3. Vue `<Transition>` 使用处（11 个命名 / 12 个组件）

| 命名 | 位置 | 用途 | 方向 | 位移 |
|---|---|---|---|---|
| `ui-drop-*` | UiDropdownPanel.vue:105 | 下拉面板浮入 | up/down/left/right 4 向 | 6px |
| `ui-modal` | UiModal.vue:77 | 模态遮罩+面板 | down + scale | 10px / 0.97 |
| `ui-step-title-*` | UiStepModal.vue:222 | 步进标题切换 | left/right | 28px |
| `ui-toast`（Group） | UiToast.vue:14 | toast 进出 | down | 8px |
| `chat-more` | ChatTopBar.vue:131 | 会话更多面板 | down | 6px |
| `m5-more` | MoreMenu.vue:174 | 更多菜单 | down | 6px |
| `nt-detail` | NotificationDetail.vue:27 / NotificationsModal.vue:141 | 通知详情 | right-in / left-out | 40px |
| `nt-list` | NotificationsModal.vue:126 | 通知列表 | left | 40px |
| `page` | PageTransition.vue:14 | 路由页切换 | down/up | ±24px(--reveal-y) |
| `filter-reveal` | teacher-side/B1/FilterReveal.vue:40 | 教师端筛选展开 | down | 6px |
| `fr` | teacher-square/FilterReveal.vue:36 | 教师广场筛选展开 | down | space-3 |

**观察**：全部走 token duration/easing（`--dur-*`/`--ease-out`），**但位移距离六档裸值（6/8/10/12/28/40px）**，同类「fade+slide 浮入」无统一 `--shift` 语义。

---

## 4. JS 动效路径清单

### 4.1 rAF 驱动（7 文件）

| 文件 | 驱动对象 | 参数来源 | 标准化 |
|---|---|---|---|
| composables/createRipple.js:53-130 | 涟漪圆心收敛 + 半径增长（`--mx/--my/--r` CSSOM） | duration 运行时读 `--btn-dur-click`（getComputedStyle）；easeOutCubic 内联 | ✅ 读 token；**[in-flight]** |
| composables/useRipple.js / directives/ripple.js | createRipple 薄壳 | — | ✅ 单核心；**[in-flight]** |
| modules/teacher-square/PageEnter.vue:57-68 | 双 rAF 入场 + stagger | `stagger` prop 默认 **90ms 裸值** | ⚠️ JS 裸值 |
| modules/teacher-square/useScrollDetach.js:74-135 | 卡片滚动脱离（`--detach-y` CSSOM） | `const: C=120 / factor=0.3` 裸值 | ⚠️ JS 裸值；reduced 门控 |
| views/landing/LandingGallery.vue:61-68 | 滚动取模回绕 | — | ✅ |
| views/landing/useGalleryDrift.js:23-52 | 横廊自动缓移 | `speed = 40` 裸值 px/s | ⚠️ JS 裸值 |
| views/landing/useGalleryShrink.js:20-55 | 边缘缩放（`--g-scale`） | 运行时读 `--gallery-shrink-min` / `--gallery-mask-w` token | ✅ 读 token |
| views/landing/useScrollReveal.js:20-128 | 滚动浮现编排 | `ANIM_FALLBACK = 700` 裸值 | ⚠️ JS 裸值 |

### 4.2 动效类定时器（6 处）

| 位置 | 用途 | 值 |
|---|---|---|
| UiStepModal.vue:45/139-143 | 步进页切换收尾 | `STEP_MS = 320`（裸，与 --dur-base 300 语义重复） |
| composables/useToast.js:15 | toast 自动消失 | `duration = 2600`（裸 ms） |
| modules/auth/CaptchaPuzzle.vue:189 | 拼图失败重置 | `setTimeout`（业务逻辑） |
| modules/notifications/settings-data.js:47 | 「已保存」提示回撤 | `2000`（裸 ms） |
| views/landing/useScrollReveal.js:71 | 浮现动画兜底 | `ANIM_FALLBACK = 700`（裸） |
| composables/useCountdown.js:24 | 倒计时驱动 | `250ms` 间隔（业务逻辑） |

---

## 5. 参数散落值汇总（裸值频次）

### 5.1 duration / easing 裸值

| 裸值 | 位置 | 次数 |
|---|---|---|
| `420ms` | CaptchaPuzzle.vue:302（puzzle-shake） | 1 |
| `3s` | ChatSpecialBubble.vue:51（breathe） | 1 |
| `6s`（局部变量 --rel-flow-dur） | relations/flow.css:17 | 1 |
| `0.01ms` | base.css:130/132（reduced 全局压缩） | 2（合法全局兜底，非散落） |
| `ease`（裸关键字） | RelationAvatar.vue:106 | 1 |
| `linear`（裸关键字） | relations/flow.css:22 | 1 |
| `STEP_MS = 320`（JS） | UiStepModal.vue:45 | 1 |
| `ANIM_FALLBACK = 700`（JS） | useScrollReveal.js:28 | 1 |
| `duration = 2600`（JS toast） | useToast.js:15 | 1 |
| `2000`（JS saved 回撤） | settings-data.js:48 | 1 |
| `speed = 40`（JS 横廊） | useGalleryDrift.js:23 / LandingGallery.vue:40 | 2 |
| `const: C=120, factor=0.3`（JS 卡片脱离） | useScrollDetach.js:21 | 2 |
| `stagger = 90`（JS 入场） | PageEnter.vue:37 | 1 |
| `40/80/120/160/200/240/280ms`（stagger ×8） | TeacherDemandGrid.vue:44-50 | 8 |

### 5.2 位移/缩放裸值（px / scale）

| 裸值 | 出现处 | 次数 |
|---|---|---|
| `translateY(-6px)` / `translateY(6px)` | UiDropdownPanel(4 向 6px)、ChatTopBar、MoreMenu、teacher-side FilterReveal | 4 组件 / 8 声明 |
| `translateY(8px)` | UiToast | 1 |
| `translateY(10px) scale(0.97)` | UiModal 面板 | 2 |
| `translateY(12px)` | ChatBubble | 1 |
| `translateX(±28px)` | UiStepModal 页切换 ×6 + 标题 ×4 | 10 |
| `translateX(±40px)` | NotificationDetail / NotificationsModal | 4 |
| `scale(0.4)` | UiCheckButton ui-check-in / UiCheckbox 勾 | 2 |
| `scale(1.18)` | UiStepModal step 圆点 | 1 |

### 5.3 死 token

| token | 定义值 | 消费数 |
|---|---|---|
| `--dur-lg` | 500ms | **0** |
| `--dur-xl` | 700ms | **0** |
| `--ease-soft` | cubic-bezier(0.4,0,0.2,1) | 1（breathe） |
| `--ease-in` | cubic-bezier(0.4,0,1,1) | 3（UiStepModal 离场） |

> `--dur-xl` 原为点击涟漪时长，AK-H1 已改 `--btn-dur-click: var(--dur-sm)`（200ms）后弃用——**死 token 应删或重用途**。

---

## 6. 标准化缺口（同类动效参差特例）

1. **fade+slide 位移距离不统一（最重）**：同类「浮入浮出」面板/浮层位移六档——6px（下拉/更多/筛选）/ 8px（toast）/ 10px+0.97（模态）/ 12px（气泡）/ 28px（步进）/ 40px（通知）。无 `--shift` 语义 token，无处可改一处通改。
2. **`--dur-lg`/`--dur-xl` 死 token**：定义了 500/700ms 却零消费，应删或收编（如 scroll-in/out 本应配 --dur-lg，但 reveal 实际用 --dur-base）。
3. **easing 裸关键字**：`ease`（RelationAvatar）、`linear`（rel-flow）绕过 `--ease-*` 单源。
4. **`--ease-in` 仅 3 处**：只服务于 UiStepModal 离场；离场是否统一用 ease-in 值得定案。
5. **步进浮窗双轨动效**：`ui-step-*` keyframes（6 个）+ `ui-step-title-*` Transition（4 个）语义重复，同一 slide 动效多实现；STEP_MS 320 与 --dur-base 300 未连通。
6. **stagger 体系裸值**：TeacherDemandGrid 8 档 40ms×8 硬编码，PageEnter stagger 90ms 硬编码——stagger 步长/间隔无 token 无共享 composable。
7. **JS 侧动效参数全裸**：toast 2600ms、gallery speed 40px/s、relu C=120/f=0.3、ANIM_FALLBACK 700ms、saved 2000ms——不在 CSS token 体系内，JS 与 CSS 两套参数域未统一。
8. **局部 keyframes 无共享**：breathe/shake/cell-enter/chat-bubble-in/ui-check-in 均为组件局部，暂无跨组件复用需求（可缓收编），但 shake 420ms 与 breathe 3s 的时长游离在 token 体系外。

**已走标准路径（良好基线，勿破坏）**：6 涟漪组件共享 `ui-ripple`/`ui-fill-in` + `createRipple` 单核心；全部组件 duration/easing 消费 `--dur-*`/`--ease-*`（230 处）；37 文件 reduced-motion 回退；落地页 reveal/横廊/镜像用 `--reveal-y`/`--gallery-*`/`--dur-base` token；页面切换、模态、toast、下拉均走 token。

---

## 7. 标准化建议（标准动效库接口形状，供 AK-N-S1 定案）

### 7.1 新增动效语义 token（tokens.css 单源）

```css
/* -- Motion geometry (new: displacement / scale single source) -- */
--shift-xs: 4px;    /* chevron/V/arrow 微位移 */
--shift-sm: 6px;    /* dropdown / more / filter reveal 浮入 */
--shift-md: 10px;   /* modal panel / toast 浮入 */
--shift-lg: 28px;   /* step page/title/footer 切换 */
--shift-xl: 40px;   /* notification list/detail 抽屉 */
--shift-in: 12px;   /* chat bubble 入场 */
--scale-modal: 0.97;   /* modal panel 收起缩放 */
--scale-check: 0.4;    /* check/勾 弹出起点 */
--scale-dot: 1.18;     /* step 圆点当前 */
--stagger-step: 40ms;  /* 网格 stagger 步长 */
--stagger-page: 90ms;  /* 页面入场 stagger 步长 */
```

> 六档位移收成 6 个 `--shift-*` token 后，同类浮入动效全部改指变量，一处改通处。

### 7.2 死 token 处置

- 删 `--dur-lg`、`--dur-xl`（零消费）；若 AK-N 后续为滚动浮现/抽屉配 `--dur-lg`（500ms）则保留重用途并注释。
- `--ease-in` 定案：离场动效统一走 `--ease-in`，或统一走 `--ease-out`（对称化）——二选一并全局同步。

### 7.3 标准动效组件接口（全屏元素统一联动）

用户要求「全屏元素都能通过接口统一联动」→ 建议建 **`useMotion()` composable / `v-motion` 指令 / `UiMotion` 组件** 三选一（对齐现有 `createRipple` 单核心先例），统一接口形状：

```js
// 建议接口（命名随 CORE 定案，此处仅给形状）
useMotion(el, {
  type: 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right'
       | 'scale-in' | 'ripple' | 'reveal' | 'stagger',
  duration: 'sm' | 'base' | 'md',     // 仅接受 token 档名，禁裸 ms
  easing: 'out' | 'soft' | 'in',      // 仅接受 token 档名，禁裸关键字
  shift: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'in', // 新 --shift-* 档名
  delay: 'stagger-step' | 'stagger-page' | number, // stagger 档名或业务值
  replay: true | false,               // 出视口重播（reveal 语义）
})
```

- 入口统一：CSS 侧只消费 `--shift-*`/`--dur-*`/`--ease-*`；JS 侧（rAF）参数经 token 档名解析，**消灭 JS 裸值**（toast 2600 → `--dur-toast` token；gallery speed → `--gallery-speed` token；relu C/factor → token；stagger → 档名）。
- 全屏元素统一联动：通过给根节点（`#app`/页面容器）设一个 `data-motion-theme` 上下文，让所有子动效经同一接口读档名——切主题/全局 reduced/全局加速时只改一处。

### 7.4 收编优先级（先易后难）

| 优先级 | 事项 | 范围 |
|---|---|---|
| P0 | 新增 `--shift-*` + 六档位移裸值收编 | 8 组件 30+ 声明（§5.2） |
| P0 | 删 `--dur-lg`/`--dur-xl` 死 token | tokens.css |
| P0 | `ease`/`linear` 裸关键字 → `--ease-*` | RelationAvatar / flow.css |
| P1 | `useMotion`/`v-motion` 接口落地 + JS 裸值（toast/gallery/relu/stagger/ANIM_FALLBACK）token 化 | composables + 4 文件 |
| P1 | 步进浮窗双轨收编：`ui-step-*` + `ui-step-title-*` 统一走 `--shift-lg`，STEP_MS 320 → 读 `--dur-base` | UiStepModal |
| P1 | shake 420ms / breathe 3s 时长 token 化 | CaptchaPuzzle / ChatSpecialBubble |
| P2 | stagger 体系共享 composable（网格 40ms + 页面 90ms 统一档名） | TeacherDemandGrid / PageEnter |

### 7.5 与 in-flight 重构的衔接

- 涟漪/按钮/tokens（mtime 08-25 00:06–00:16）为 CORE 进行中工作区，**§7.1 新增 token 建议中的 `--shift-*` 不进入该重构判定**，待 CORE 收口后由标准动效库基元统一落地，避免双写冲突。
- 本盘点不改任何代码；后续按 W27 拆独立基元（每基元单类变更 + 独立审计 PASS）。

---

## 8. in-flight 文件清单（不纳入整改判定）

| 文件 | 状态 |
|---|---|
| src/styles/tokens.css | 动效 token 重构中（含 ui-ripple/ui-fill-in keyframes 注释） |
| src/composables/createRipple.js / useRipple.js | 涟漪单核心重构中 |
| src/directives/ripple.js | vRipple 重构中 |
| src/components/ui/UiButton.vue / UiCheckButton.vue / UiCard.vue / UiComboInput.vue / UiCaptchaInput.vue / UiVariableInputSet.vue / UiStepModal.vue / UiFieldInput.vue | 涟漪/按钮/步进模态随动效 token 收编中 |

> 其余动效文件（UiModal / UiToast / UiDropdownPanel / UiInput / UiCheckbox / Chat* / MoreMenu / Notification* / relations / landing / PageEnter / TeacherDemandGrid / FilterReveal 等）非 in-flight，可独立整改。
