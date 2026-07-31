# 结构 / 视觉 待办队列（worklist，非 changelog）

> 这是可执行的工作清单，带精确行号，供会话接力用。规则在 `../CLAUDE.md`，进度看 git。
> 每项注明状态：✅ 已上线 / 🟡 醒着核对后做（跨文件/改契约/视觉，盲改易回归）/ 已判定不改。

## 已完成（本轮 2026-07-31，v0.18.4–0.18.9）
- ✅ 主按钮黑→紫 + 白边/四角错位根除：按钮族改**元素自绘**（宝石体+外同色光晕 box-shadow），`::before` 填充与元素折射禁用，`--g-mask:none`（glass.css 按钮块）。白边真因=alpha 渐隐遮罩在白卡上透白+四角错位；同色边只能靠 box-shadow 光晕（沿 border-radius）。
- ✅ 侧栏选中块同色玻璃边：`.sidebar-pill` 改元素自绘宝石+光晕（glass.css；条目背景透明→光晕透出，z0 在条目下、白字仍落不透明宝石上）。
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
- **vivid「clear-over-vivid」宝石按钮**：本轮按钮已用"元素自绘宝石+同色光晕"达成彩色玻璃观感，无需 backdrop 垫层即可；若要进一步"折射弯折自有 vivid 渐变"的宝石感，可在按钮正后方垫同形不透明 vivid 层、按钮毛度≈0（backdrop-filter 无法跳层，自有 background 不被折射，故需垫层）。只出截图原型，给用户看再定推不推全站。
