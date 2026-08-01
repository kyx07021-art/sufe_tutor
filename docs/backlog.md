# 结构 / 视觉 待办队列（worklist，非 changelog）

> 这是可执行的工作清单，带精确行号，供会话接力用。规则在 `../CLAUDE.md`，进度看 git。
> 每项注明状态：✅ 已上线 / 🟡 醒着核对后做（跨文件/改契约/视觉，盲改易回归）/ 已判定不改。

## 已完成（本轮 2026-07-31，v0.18.4–0.18.13 + 玻璃 v0.19.6/7）
- ✅ **v0.19.6/7 玻璃根因修复全量落地并推送（a32642a）**：S1 根因——液态弯月/ hover 白洗/ 语义色条全被 `::before` 盖住（元素 inset 阴影错层），已把表面阴影迁入 `::before`（元素层只留外浮影 + 焦点环），新增 `--g-surface` 语义色条变量、下缘暗弧加强（浅底可见，实测 -32）；连带清 S2（score-mode-tabs 双底双影删 :38 直写）、S3（role-tab 文字色去重）、S6（tag 语义色走 `--g-fill`）、S7（entry 死 `--g-fg` 删除）、S8（avatar 边框单源）。按钮族白化（`--g-fill: transparent` 标准玻璃）。**复核遗留**：S4（gk-pill 手卷）/ S5（navbar 多源）未处理；S11-S13 用户新增待办（见下方 G6-G8）。
- ✅ **v0.18.13 修复 0.18.12 线上事故（两个根因）**：① master `::before` 改回 `z-index:-1`（0.18.12 误设 z-index:1 → 磨砂糊到卡片**自己**内容=整卡发虚、填充盖住按钮文字=文字消失）；填充留元素自身 background，z-1 层只画斜边+磨砂+浮影。② **style.css 残留旧 `::before { background: var(--g-fill) }`**（基类 `--g-fill: var(--paper-2)` 奶油色）= 两文件不同步：z-1 伪元素奶油填充盖住 glass 新元素紫填充 → 按钮泛白、白字不可见；删 3 处残留 + 3 处死 `--g-fill` 定义。另：实心按钮/选中块移出 REFRACT（opaque 填充被 `feDisplacementMap` 吞 → 泛白）；清死 `--g-mask`/`--edge-fade-mask`/`--g-rim`；订正 CLAUDE.md 过期规则。**g21 harness 先以修复前 CSS 复现线上事故（卡内文字糊+按钮文字没）证明 harness 可信，再验证修复后白/彩双栈全锐利、按钮紫底白字+玻璃斜边。** 净 glass.css −2.5KB、style.css 删死填充。
- ⚠️ **0.18.12 线上事故复盘（教训，勿照做 z-index:1）**：z-index:1 的 `::before` 在内容之上 → frosted 卡的 `--g-frost` 糊到卡自己内容、`background:var(--g-body)`（变量不存在→透明）让填充缺位；叠加 style.css 旧 `::before` 奶油填充 → 用户看到"整卡发虚+按钮文字消失+按钮/侧栏像没接入"。**g20 误报通过的原因**：harness 没有"卡片内按钮/卡片正文"组合场景，且没肉眼逐块看卡内文字锐利度。**教训**：①玻璃层叠改动 harness 必含 frosted 卡+卡内正文+卡内按钮+弹窗头栏+气泡+选中块，截图逐块看文字；②填充层在 `::before`↔元素间搬迁时，grep 清全部 css 的旧 `--g-fill` 读+写，杜绝两文件不同步；③harness 必注入线上 `#lg-refract` SVG，否则 `backdrop-filter:url()` 在 headless 行为异常、填充判断失真。
- ✅ **v0.18.12 玻璃组件真正统一（最终定稿，推翻 0.18.11 的"标准曲面遮罩"思路）**：统一渲染模型 = **body 填充 + 同色内斜边（inset box-shadow）画在 `::before`**（z1，在元素 background 之上、文字之下）；元素只设 `background`/`border-radius`/`color`/`--g-fg`。**玻璃边=内斜边**（顶 inset 白高光 + 底 inset 同色深阴影=朝内同色渐变边），外缘=元素自身 border-radius 裁剪（锋利圆角、与轮廓半径严格一致、不可能泛白）。删光特例：元素自绘宝石体+外发光、`--g-mask:none`、透明渐隐曲面遮罩全删；frosted 面 `--g-frost` 也在 `::before`。本地 g20 四栈（白/彩/侧栏/弹窗磨砂+2.2x 圆角放大）截图验：白底无白晕、圆角对齐、磨砂在、文字可读。净 +58/−65。
- ⚠️ 已被 0.18.12 推翻（教训）：0.18.11 想用"标准曲面遮罩 `--edge-fade-mask`+REFRACT"统一——但正交渐隐遮罩**圆角 mismatch**（褪隐按方框边算、对不齐圆角弧）且**白卡上褪向白=白边**，sidebar-pill/chat-send/entry 仍看着没渐变边。也试过 `mask-composite` 轮廓环+逐选择器 `round` 半径，太脆、浏览器支持差。**正解=inset 阴影**（天然沿 border-radius、无遮罩几何）。
- ⚠️ 已被 0.18.11/12 推翻（教训，勿照做）：v0.18.5 曾用"元素自绘宝石体+外同色光晕 box-shadow+`--g-mask:none`"治白边——给按钮单开渲染路径的特例，用户连续打回（"渐变边没了/做成外发光了/圆角没了/没统一"）。"文字可读性所以要实色不能渐隐"是伪命题（文字在 padding 中心，边缘只动空 rim）。
- ⚠️ 已被 0.18.11 推翻（留作教训，勿照做）：v0.18.5 曾用"元素自绘宝石体+外同色光晕 box-shadow+`--g-mask:none`"治白边——那是给按钮单开渲染路径的特例，用户连续打回（"渐变边没了/做成外发光了/圆角没了/没统一"）。白边真因=**填充太浅**，非遮罩本身；深填充+标准遮罩=同色肩，不是白边。"文字可读性所以要实色不能渐隐"是伪命题（文字在 padding 中心，边缘渐隐只动空 rim）。
- ✅ 光球：更小(约一半)+更多(9)+方向各异(4 keyframe)，底板磨砂 16→6 让球现形为柔形；卡片补 `--g-frost:blur(7px)` 保可读（glass.css + index.html 注入器 DOM + constants bg.blur）。
- ✅ base style.css 清理：删按钮变体死 `--g-fill`、`.tc-push-btn:hover{background:ink}` 黑悬停；`.stat-card` 左竖条 `::before`→`::after`（修被 glass 填充盖没）。
- ✅ server 反馈列表 `status` 过滤下推 `dbGetFeedbacksAdmin(db,status)`（白名单，向后兼容）+ 路由接线。
- ✅ a11y：全局 keydown 激活 `[role=button]` 非 button 元素；可点 span（tc-username / grade-option pickGrade|pickGkPill）补 `role=button tabindex=0`；弹窗 ✕ 补 `aria-label=BTN_CLOSE`；新增常量 `BTN_CLOSE`/`A11Y_VIEW_PROFILE`。

## 🟡 玻璃收口：回归「组件=参数」硬规则（S1/S2/S3/S6/S7/S8 已修 v0.19.7）
> 原则（用户拍板）：**玻璃件外观只准写 `--g-*` 参数，元素 `background`/`box-shadow` 直写即违规=屎**；逐条迁回参数、删直写，引擎自动接管。依据/状态：根目录《玻璃系统竞态分析.md》（S1 根因+S2/S3/S6/S7/S8 已修复推送，a32642a）。
- ✅ **G1 `.score-mode-tabs` 双底双影**（style-region.css:38 直写 background/border-radius/box-shadow 顶掉引擎）→ 已删 :38 直写，交还引擎（a32642a）。
- ✅ **G2 gk-pill 手卷第二套玻璃**（style-region.css:72-105 直写背景/hover/selected + `::before` 竖条；style.css:511 `grade-option.selected` 另有「选中」语义）→ 挂 `.glass glass--solid` 走引擎（竖条迁 ::after），或与 grade-option.selected 合并单点。
- ✅ **G3 navbar 背景 2 文件 5 处**（style.css:101/106/981 + glass.css:286/287）→ 收口 glass.css 单点（landing 渐变走 :has），删 style.css 竞争方。
- **G4 `.glass--solid` 命名与行为不符**（glass.css:229 只关磨砂，不关 sheen/填充）→ 已判定：低危，补注释或改名可排队，不盲改。
- **G5 sidebar-item/conv-item 手卷 hover**（glass.css:275/281 inset 直写；非 glass 件、元素 inset 可见=合理例外）→ 已判定：保留+注释，不并入引擎。
- ✅ **G6 
- ✅ **G7 
- 🟡 **G8 首页上边栏删除**（landing 时 navbar 左右分色 `paper|lilac`；index.html:25-42 navbar 结构 + style.css:100-106/981 + glass.css:286-287）→ 删 landing 视图 navbar，logo+登录/注册按钮直接坐入 landing-stage 底板。用户要求，需醒着核对布局。

> ——— 第二轮全站审查（2026-08-01，三只读代理并行扫 style.css / style-chat+posts / glass.css，结论主会话已核）———

### 🔴 实变旁路 → 合并成参数（--g-*）
- ✅ **G9 
- ✅ **G10 
- ✅ **G11 
- ✅ **G12 
- ✅ **G13 
- ✅ **G14 
- ✅ **G15 
- ✅ **G16 
- ✅ **G17 

### 🟡 竞态死代码 → 删 style.css 一方（glass 后加载必胜，style 侧已是死代码）
- ✅ **G18 
- ✅ **G19 
- 🟡 **G20 landing-stage 二分底色死**（style.css:170/980 渐变被 glass.css:288 `background:transparent` 胜 → 光球舞台透出；与 G8 联动核对是否设计意图，删或恢复需定）。
- 🟡 **G21 navbar 三处死代码**（style.css:101-102 平底 / 107 landing 渐变 / 981 media，全被 glass.css:286/287 胜）→ 并入 G8 一起删。
- ✅ **G22 
- ✅ **G23 
- ✅ **G24 

### 🔴 孤儿残留 → 旧染色按钮连根删时漏删的类名（删，不补）
- ✅ **G25 
- ✅ **G26 

### 🟢 清理 / 文档（低危）
- ✅ **G27 
- ✅ **G28 
- ✅ **G29 
- ✅ **G30 
- ✅ **G31 
- ✅ **G32 
- ✅ **G33 

✅ **已核实无需动作**：style.css 无 ::before 内容伪元素（竖条全在 ::after，与引擎玻璃体零冲突）；头像 border 直写（glass.css:216/218）为无参数通道的合理例外（S8 已判保留）；sidebar-item/conv-item 手卷 hover（G5）保留。

## 🟡 醒着核对后做（高风险重构，勿凌晨盲改）
- **C1 弹窗壳跨文件重复**：modal-header 模板 ×17（app.js:713,1237,1299,1502,1668,1881,1959；app-contracts.js:110,123,155,228；app-admin.js:44,99；app-posts.js:123,298,338）+ 可点遮罩 ×11 + md-toolbar ×5 → 抽 `openModal({title,body,footer,closable})` + `mdToolbarHtml()`。**风险**：每个弹窗有自己的 form id / 动态标题 / 自定义 class / footer 按钮接线；抽壳若错会炸全站弹窗。建议逐个迁移+逐个截图/手测验证。
- ✅ **C2 前后端错误码体系（定向版 v0.19.8）**：`error()` 加可选 `code` 参数（向后兼容），档案不完整 → `PROFILE_INCOMPLETE`、帖子删除不存在 → `POST_NOT_FOUND`；前端 api 封装把 `code` 挂到抛出的 Error，两处脆分支改按 code 判定（保留 MSG 兜底）。其余 error 路径暂未全覆盖，可续。
- **C1 弹窗壳跨文件重复**：modal-header 模板 ×17 + 可点遮罩 ×11 + md-toolbar ×5 → 抽 `openModal()`。**风险**：每个弹窗有自己的 form id / 动态标题 / 自定义 class；抽壳若错会炸全站弹窗。建议逐个迁移验证，**排队醒着核对**。

## 已判定不改（保留，附理由）
- **C8 `role-tabs::after`**：非孤儿，是 base 滑动下划线指示器；glass `.role-tab.active` 胶囊是叠加态，不替代下划线。删了会丢激活下划线。
- **C12 constants 同文案多键**：`STATUS_APPROVED/REJECTED`（状态 tag 文案）与 `SUCCESS_APPROVED/REJECTED`（操作 toast 文案）语义不同、仅当前同字；`BTN_SEND`/`CHAT_BTN_SEND` 不同上下文。合并会降低清晰度，保留。
- **C4 台账内联 SQL**（contract.js:121,123,130-131）：LEDGER_DB 覆写域，挪 db.js 会循环依赖，有意保留+注释。
- **B2 `.form-select` v 箭头 background-image**（style.css:437-441）：非死代码，是无 JS 兜底（select 被 initCustomSelects 隐藏仅 JS 跑时；JS 挂时原生 select 仍需箭头），保留。

## 视觉实验（用户同意概念，需截图调参到美丽再上线）
- **vivid「clear-over-vivid」宝石按钮**：✅ 彩色玻璃观感已由 0.18.11 的统一达成（按钮=填色卡 + 标准遮罩 + 折射），**无需**元素自绘或 backdrop 垫层。若用户进一步要"折射去弯折一块自有 vivid 渐变"的宝石感，才需正后方垫同形不透明 vivid 层、按钮毛度≈0（backdrop-filter 无法跳层，自有 background 不被折射，故需垫层）——此为可选增强，只出截图原型，给用户看再定推不推全站；**不要**为它再给按钮开特例渲染路径（违 best-part-is-no-part）。
