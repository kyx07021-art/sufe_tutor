# 组件依赖树单源性盘点（AK-N-R1 落地盘点）

> 盘点时间：2026-08-25 快照。范围：`new-frontend/src/components/{ui,shared}` + `composables` + `directives` + `modules/*/components`。
> **并发声明**：13 个实现 agent 正在并发收编/统一/涟漪重构（git status 80 个文件 modified）。本报告为现状快照——
> - `in-flight` 标记的文件**不纳入整改判定**，收口后复盘；
> - 整改基元仅针对**稳定（非 in-flight）**的确认项。

---

## 一、核心组件唯一性判定表

| 核心职责 | 唯一实现？ | 证据（file:line） | 结论 |
|---|---|---|---|
| 按钮 Button | ✅ 单核心 | `components/ui/UiButton.vue:26-48`（A/A1/B/B1/B2/C/C1/S/S1 变体 + fill/size/circle/block/surface/lift） | 模块层大量继承，合格 |
| 输入 Input | ✅ 单核心 | `components/ui/UiInput.vue:19-47`（textarea/password 双形态 + filter/growDirection/fill/IME 守卫） | PriceFilter/FilterPrice/ChatInputBar 复用，合格 |
| 卡片 Card | ✅ 单核心 | `components/ui/UiCard.vue:14-19`（A/A1/B/B1 + 交互语义） | TeacherCard/NotificationCard/DemandCard 复用，合格 |
| 弹窗基座 UiModal | ✅ 单核心 | `components/ui/UiModal.vue`；UiModalA1/UiConfirmModalA1/UiStepModal/UiAlertModal 全部 extends 它 | 合格 |
| 弹窗 A1 顶栏 chrome | ⚠️ **半重复** | `UiModalA1.vue:62-121` vs `UiConfirmModalA1.vue:109-166` vs `UiStepModal.vue:292-494` —— 三处各自实现 `.ui-*__bar`（--modala1-bar-h 52px）+ 滚动 fade mask（--modal-mask-h）+ max-height 82vh | 见整改 R1 |
| 下拉/锚定面板 | ⚠️ **双实现** | `UiDropdownPanel.vue`（options 网格）+ `components/shared/FilterTrigger.vue`（slot 面板）—— 两者各自 Teleport + Transition + useAnchoredPanel + useFocusTrap + outside-close/Escape | 见整改 R2 |
| 复选框 Checkbox | ✅ 单核心 | `components/ui/UiCheckbox.vue`（方框+勾、AK-A7 与选中伸长的胶囊刻意区分）；BlockSystemToggle 已迁它（AK-C2-F9） | 合格 |
| 选中钮 CheckButton | ✅ 单核心 | `components/ui/UiCheckButton.vue`（选中右伸胶囊）——与 UiCheckbox 为两种刻意区分的交互模型 | 合格 |
| 涟漪 Ripple | ✅ 单核心 + 双薄壳 | `composables/createRipple.js`（唯一实现，rAF 驱动 --mx/--my/--r）+ `useRipple.js`/`directives/ripple.js` 均薄壳转调它 | **in-flight（AK-N-P2）**，收口后确认单层路径 |
| 排序 SortBar + OrderToggle | ✅ 单源 | `components/shared/SortBar.vue` + `OrderToggle.vue`；M7 teacher-square SecondBar:36-49 与 M9 teacher-side B1 TeacherDemandPlaza:163-170 共用 | 合格（此前本地 OrderToggle 已收编） |
| 筛选触发器 FilterTrigger | ✅ 新建单源 | `components/shared/FilterTrigger.vue`（AK-N-㉛ 统一触发器）；SubjectFilter/GenderFilter/PersonalityFilter 消费 | **新建 in-flight**，收口后确认 |
| tab/segment | ⚠️ 弱重复 | `SortBar.vue:28-42`（横排排序 tab）vs `components/ui/NavTab.vue:42-55`（竖排导航 tab）—— 激活态都是 gray-10 填充 + 近同 `<button>` 形态 | 职责不同（排序 vs 导航），见整改 R8 低优先 |

---

## 二、重复核心 / 绕开清单

### A. 业务组件绕开核心按钮（稳定，非 in-flight）

| 文件:行号 | 内容 | 为什么算绕开 | 整改建议 |
|---|---|---|---|
| `modules/chat/components/ChatListPane.vue:45` | 手写 `<button class="chat-card">` 列表行按钮 | 全宽列表行按钮不继承 UiButton/UiCard，自带 `.chat-card` 布局+`.is-active/.is-closed` 状态样式 | 判定：行按钮语义 + 全宽布局，UiButton 固定宽不适用。建议①保持 + 补「行按钮特例」注释；②或改 UiCard A1（interactive）承载，写路径不变 |
| `modules/chat/components/ChatImageBubble.vue:55` | 手写 `<button class="chat-image__btn">` 图片缩略图按钮 | 纯图标点击区，与 ChatButton 同型（UiButton B circle 40px） | 改 UiButton variant B circle（对齐 ChatButton 先例），若尺寸/裁切需要保持可加宽高覆盖 |
| `modules/teacher-side/B2/AvatarEditor.vue:111` | 手写 `<button class="avatar-editor__circle">`（96px 圆） | 头像上传触发钮，自带 hover/focus-visible 圆框样式 | 判定：96px 头像圆是定制视觉。建议改 UiButton circle 覆盖 --btn-w/--btn-h:96px，或保持 + 补特例注释 |

### B. 合法 file-input（非绕开，明确不整改）

`ChatInputBar.vue:168/178`、`SettingsAvatar.vue:152`、`VerifyAdmission.vue:103`、`AvatarEditor.vue:138` —— 全部是 `<label for>` + 隐藏 `<input type="file">`，符合 P13（label for 机制，禁程序化 .click()），**不是按钮**，不构成绕开。

### C. 核心/共享复合组件内部手写按钮（单源本身，非绕开，注明）

FilterTrigger 触发器、SortBar tab、OrderToggle、NavTab item、UiDropdownPanel item、UiComboInput V 钮、UiCaptchaInput send 钮、UiVariableInputSet add/remove 钮 —— 这些是"核心自身"的构成元素，不算绕开；但除 UiDropdown（extends UiButton + UiDropdownPanel）与 UiComboInput（extends UiInput + UiDropdownPanel）外，**多数未从 UiButton 继承按钮语义**（各自手写 focus-visible/disabled/过渡）。收编方向：在涟漪收口后统一判定哪些可组合 UiButton。

### D. 业务组件绕开核心交互语义（稳定）

`modules/relations/RelationAvatar.vue:62-70` —— 手写 `role="button"` + tabindex + Enter/Space 键盘语义（:48-58），未继承 UiButton/UiCard 的交互核心。它是关系图上的浮点头像节点（绝对定位 + 圆环 + id 标签），形态特殊。建议：加「特例注释」（为什么不能直接套 UiCard/按钮壳）+ 明确交互契约来源，或抽象一个 `UiCircleAvatarButton` 核心供后续复用。

### E. 弹窗 A1 chrome 重复（稳定）

`UiModalA1.vue:62-121` / `UiConfirmModalA1.vue:109-166` / `UiStepModal.vue:292-494` 各自复制顶栏（--modala1-bar-h:52px、--space-5 padding、paper-raised、title fs-lg/fw-600）+ 滚动 fade mask + `max-height:82vh`。三处是同一"A1 弹窗 chrome"的字节级近同实现。见整改 R1。

### F. 锚定面板双实现（FilterTrigger 为 in-flight 新建，收口后判定）

`UiDropdownPanel.vue` 与 `FilterTrigger.vue` 各实现一遍"Teleport + useAnchoredPanel + useFocusTrap + outside-close + Escape"面板壳。UiDropdown 与 UiComboInput 复用 UiDropdownPanel；Subject/Gender/PersonalityFilter 复用 FilterTrigger。两者交互模型不同（选项网格 vs slot 内容），但**面板壳逻辑重复**。见整改 R2。

### G. in-flight 中的重复风险（标记，收口后复盘）

- 涟漪双路径（::before hover + ::after click）→ AK-N-P2 正在统一单层；`test/verify-ripple-dual-path.mjs` 已新建。
- 筛选触发器收编（FilterTrigger 新建）+ 五个 filter 组件 + 各 filter 内 `:deep(.ui-checkbtn)` 裸尺寸覆盖（28px check 宽、--btn-h 36/40px）→ 全部 in-flight，收口后确认是否提 token。

---

## 三、未注释特例清单（稳定、非 in-flight）

规则：组件内**硬编码尺寸/颜色/行为、脱离 token 或核心组件且无注释**。硬编码色值全仓 `.vue` **零命中**（已 grep `#[0-9a-fA-F]{3,8}` → 0），全部走 token，此项合格。

| 文件:行号 | 特例内容 | 注释情况 | 应补注释要点 / 整改 |
|---|---|---|---|
| `modules/chat/components/ChatBubble.vue:116-126` | 气泡尾 `top:16px; width:10px; height:10px; right:-5px; left:-5px` | 仅有"Minimal flat tail"一句，无尺寸来源 | 补：尾尖尺寸相对气泡字号/圆角的推导关系 |
| `modules/chat/components/ChatFileBubble.vue:101` | `width:260px`（文件卡片固定宽） | 无 | 补：文件卡目标宽（或 token 化） |
| `modules/chat/components/ChatEndConfirmModal.vue:45` | `width="400px"` | 无 | 补：确认弹窗目标宽 |
| `modules/notifications/NotificationsModal.vue:112/154/190/194` | `width="420px"`、`min-height:160px`、`translateX(-40px)` | 无 | 补：通知弹窗宽度/空态高/入场位移 |
| `modules/notifications/AboutModal.vue:45` | `min-height:min(320px,60vh)` | 无 | 补：关于弹窗最小高 |
| `modules/my-demands/steps/TimeSlotEditor.vue:51/58/66` | `width="104px"/"88px"/"88px"` | 无 | 补：时段行三列宽度设计依据 |
| `modules/my-demands/steps/StepSubjectMethod.vue:75` | `--btn-w:130px`（方法勾选钮） | 无 | 补：方法钮目标宽 |
| `components/ui/UiToast.vue:27/58` | `bottom:48px`、`translateY(8px)` | 无 | 补：toast 离底/入场位移 |
| `components/ui/UiAlertModal.vue:74` | `min-height:220px` | 无 | 补：确认弹窗最小高（7:3 分区的 70% 文本区高度推导） |
| `modules/teacher-side/B2/AvatarEditor.vue:155-157` | `width:96px; height:96px`（头像圆钮） | 无 | 补：头像编辑圆直径目标尺寸 |
| `modules/relations/RelationAvatar.vue:125-126` | `margin-top:6px`（id 与圆环间距） | 无 | 补：间距推导 |
| `modules/auth/AuthShell.vue:147/157/163` | `--input-h:36px / --btn-h:40px / --cb-h:24px` | **有** AK-A12/AK-L-F3 注释 | 合格特例（有注释），保留 |
| `modules/auth/CaptchaPuzzle.vue:283-285` | piece `width:calc(40px * var(--puzzle-scale))` | 有注释，但 `40px` 是 SLIDER_W 的**休眠镜像** | 已知（backlog：--piece-w 派生消灭镜像），审计确认非 FAIL |

**in-flight 裸 px（收口后复盘，不在本轮整改）**：五个 filter 组件内 `:deep(.ui-checkbtn)` 的 `--btn-h:36/40px` + `.ui-checkbtn__check{width:28px}`（SubjectFilter.vue:81-90、GenderFilter.vue:80-91、FilterSubject.vue:63-74、FilterGender.vue:54-66、PersonalityFilter.vue 同款）——28px 至少 4 处重复，收口后建议提 token（如 `--checkbtn-check-w`）。

---

## 四、继承链抽样结论（10 个业务组件）

| 组件 | 继承核心 | 自写样式（token） | 判定 |
|---|---|---|---|
| `TeacherCard.vue:82` | UiCard A1 + UiIcon | 全 var()/token | ✅ 合格 |
| `DemandCard.vue:90` | UiCard A1 + UiIcon | 全 token | ✅ 合格 |
| `NotificationCard.vue:28` | UiCard B1 + UiIcon | 全 token | ✅ 合格 |
| `RelationCard.vue:71` | UiButton C1 | 全 token | ✅ 合格 |
| `UserArea.vue:38` | UiButton B circle + UiIcon | 全 token，AK-N-B2 三图标统一 | ✅ 合格 |
| `ChatButton.vue:33` | UiButton B | 全 token | ✅ 合格 |
| `SecondBar.vue:36-49` | OrderToggle + SortBar + UiButton | 全 token | ✅ 合格 |
| `SubjectFilter.vue:50` | FilterTrigger + UiCheckButton | 全 token（**裸 28px/--btn-h 36 覆盖，in-flight**） | ⚠️ 收口后复盘 |
| `FilterGender.vue:33` | UiCheckButton | 全 token（**裸 28px/--btn-h 40 覆盖，in-flight**） | ⚠️ 收口后复盘 |
| `RelationAvatar.vue:62` | **手写 role=button** | 全 token | ❌ 绕开核心交互（见 §二-D） |

**结论**：继承纪律总体良好 —— 10 个抽样 9 个正确继承核心壳，样式 100% 走 token（零裸色值）。主要缺口 = ①RelationAvatar 手写交互语义；②三处业务原生按钮（ChatListPane/ChatImageBubble/AvatarEditor）；③filter 组件裸 px 覆盖（in-flight）。**架构未为明天的核心调整设障**：核心组件（UiButton/UiCard/UiInput/UiModal/涟漪）参数面齐备，token 单源清晰。

---

## 五、整改基元建议（W27 粒度：每基元单类原子变更 + 独立 commit + 独立审计，FAIL 回滚）

> 全部针对**稳定非 in-flight** 项。in-flight 项（涟漪单层/FilterTrigger/NavTab/filter 收编）等收口后单独复盘。

- **R1（接口变更·重构）**：`UiConfirmModalA1` 组合/继承 `UiModalA1`，消除 A1 顶栏 + scroll-mask + 82vh 三处字节级重复（UiStepModal 单独评估是否同样收编）。验收 = 三弹窗 chrome 单源 + 全量绿 + 视觉零回归。
- **R2（接口变更·重构）**：抽取 `AnchoredPanel` 原语（Teleport + useAnchoredPanel + useFocusTrap + outside/Escape），`UiDropdownPanel` 与 `FilterTrigger` 共用壳（各自只保留选项网格 vs slot 内容差异）。验收 = 双面板壳单源 + 全量绿。
- **R3（接口变更·判定）**：三处业务原生按钮逐个判定收编或注释——ChatImageBubble 改 UiButton circle；ChatListPane 行按钮、AvatarEditor 96px 圆钮判「保持 + 特例注释」或改 UiButton 覆盖。验收 = 全仓业务组件零裸 button（或全部带特例注释）+ 全量绿。
- **R4（注释·契约）**：`RelationAvatar` 补交互语义特例注释（为什么 role=button 手写、交互契约来源、后续抽象 UiCircleAvatarButton 的候选注记）。验收 = 注释落位 + 全量绿。
- **R5（单源·token）**：稳定裸 px 尺寸收敛 token 或补注释——`--toast-bottom / --toast-shift / --modal-confirm-w / --notif-modal-w / --file-bubble-w / --ts-row-w / --method-btn-w / --alert-min-h / --avatar-edit-d` 等入 tokens.css 单源。验收 = 目标文件零裸 px + 全量绿 + G2 变异（还原裸值 → 断言红）。
- **R6（in-flight 复盘，收口后执行）**：filter 组件 `--btn-h:36/40` + `.ui-checkbtn__check{width:28px}` 提 token（--checkbtn-check-w 等）。验收 = 收口后四文件单源 + 全量绿。
- **R7（文档）**：本盘点入库后，收口时按 §二-G 复盘 in-flight 项。

---

## 六、统计

- 核心组件唯一性判定：**10 项** —— 8 项合格单核心，2 项半重复（弹窗 A1 chrome、锚定面板），1 项弱重复（tab），涟漪为单核心+双壳（in-flight）。
- 重复/绕开清单：**7 类**（A 绕开按钮×3、B 合法 file-input×4、C 核心内部手写×8、D RelationAvatar×1、E A1 chrome×3、F 锚定面板×2、G in-flight×2）。
- 未注释特例清单：**12 处**（稳定）+ 5 处 in-flight 待复盘。
- 整改基元建议：**7 条**（R1-R7）。
