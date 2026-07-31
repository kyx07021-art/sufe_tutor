# 结构 / 视觉 待办队列（worklist，非 changelog）

> 这是可执行的工作清单，带精确行号，供会话接力用。规则在 `../CLAUDE.md`，进度看 git。
> 每项注明状态：✅ 已上线 / 🟡 醒着核对后做（跨文件/改契约/视觉，盲改易回归）/ 已判定不改。

## 已完成（本轮 2026-07-31，v0.18.4–0.18.13）
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

## 🟡 醒着核对后做（高风险重构，勿凌晨盲改）
- **C1 弹窗壳跨文件重复**：modal-header 模板 ×17（app.js:713,1237,1299,1502,1668,1881,1959；app-contracts.js:110,123,155,228；app-admin.js:44,99；app-posts.js:123,298,338）+ 可点遮罩 ×11 + md-toolbar ×5 → 抽 `openModal({title,body,footer,closable})` + `mdToolbarHtml()`。**风险**：每个弹窗有自己的 form id / 动态标题 / 自定义 class / footer 按钮接线；抽壳若错会炸全站弹窗。建议逐个迁移+逐个截图/手测验证。
- **C2 前后端错误码体系**：app.js:1950 `.includes('档案不完整')`、app-posts.js:318 `/不存在/` 等用中文 MSG 做分支（脆耦合）→ 后端 `error()` 带稳定 `code`，前端 `switch(code)`。**风险**：改后端响应形状+前端判定，需全链路核对。

## 已判定不改（保留，附理由）
- **C8 `role-tabs::after`**：非孤儿，是 base 滑动下划线指示器；glass `.role-tab.active` 胶囊是叠加态，不替代下划线。删了会丢激活下划线。
- **C12 constants 同文案多键**：`STATUS_APPROVED/REJECTED`（状态 tag 文案）与 `SUCCESS_APPROVED/REJECTED`（操作 toast 文案）语义不同、仅当前同字；`BTN_SEND`/`CHAT_BTN_SEND` 不同上下文。合并会降低清晰度，保留。
- **C4 台账内联 SQL**（contract.js:121,123,130-131）：LEDGER_DB 覆写域，挪 db.js 会循环依赖，有意保留+注释。
- **B2 `.form-select` v 箭头 background-image**（style.css:437-441）：非死代码，是无 JS 兜底（select 被 initCustomSelects 隐藏仅 JS 跑时；JS 挂时原生 select 仍需箭头），保留。

## 视觉实验（用户同意概念，需截图调参到美丽再上线）
- **vivid「clear-over-vivid」宝石按钮**：✅ 彩色玻璃观感已由 0.18.11 的统一达成（按钮=填色卡 + 标准遮罩 + 折射），**无需**元素自绘或 backdrop 垫层。若用户进一步要"折射去弯折一块自有 vivid 渐变"的宝石感，才需正后方垫同形不透明 vivid 层、按钮毛度≈0（backdrop-filter 无法跳层，自有 background 不被折射，故需垫层）——此为可选增强，只出截图原型，给用户看再定推不推全站；**不要**为它再给按钮开特例渲染路径（违 best-part-is-no-part）。
