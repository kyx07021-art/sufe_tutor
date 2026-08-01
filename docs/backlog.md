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
- ✅ **G6 tc-push-btn 紫色浮光残留**（glass.css:210 `--g-lift: 0 9px 22px -9px rgba(74,58,178,.45)` 下偏紫投影；v0.19.7 白化按钮时漏改 lift）→ 删紫色 lift，交还中性 `--glass-lift-sm`。用户发现，全文件唯一常驻紫投影（已扫确认）。
- ✅ **G7 侧栏 active 白字变色残留**（style.css:587 `.sidebar-item.active .sidebar-item-index { color:#fff }` + 607 `desc { color: var(--paper-ghost) }`——为适配旧紫卡的白字，卡白化后白字不可见）→ 删白字，交还深色（base `--ink` 系）。用户发现。
- ✅ **G8 首页上边栏删除**（landing 时 navbar 左右分色 `paper|lilac`）→ 已删：landing 时 navbar `display:none`，logo+登录/注册由 .stage-nav 浮在舞台顶；glass.css:290 landing 渐变、style.css:107/111/981 死规则整条删。

> ——— 第二轮全站审查（2026-08-01，三只读代理并行扫 style.css / style-chat+posts / glass.css，结论主会话已核）———

### 🔴 实变旁路 → 合并成参数（--g-*）
- ✅ **G9 conv-pill 直写 background 被 ::before 盖死**（glass.css:279 `background:rgba(255,255,255,.22)` + `box-shadow`；挂 `glass--solid`，app-chat.js:85）→ 改 `--g-fill:rgba(255,255,255,.22)` 删直写；引擎默认填充(.14)+sheen 实际在渲染，"米色大色块"注释已失真。
- ✅ **G10 score-mode-tab.active 白字白底跨文件打架**（glass.css:239 `--g-fill:.22白`+`--g-fg:var(--ink)` 被 style-region.css:54 `color:#fff` 压死 → 实为白字坐白填充低对比）→ 定单源：style-region 删 color 改走 `--g-fg`，或 glass 删 `--g-fg` 交还 style-region；style-region.css:53 hover 直写一并迁 `--g-hover`。
- ✅ **G11 device-current 药丸变 2px 方角**（style.css:755-756 直写 `border:1px solid currentColor`+`border-radius:2px`，盖过 glass.css:232 `--g-r:999px`）→ 删直写，交还 `--g-r`/`--g-surface`。
- ✅ **G12 profile-panel 外浮影硬编码**（style.css:1122 `box-shadow:-14px 0 44px rgba(17,17,20,.13)` + media 1179 `.22`）→ 改 `--g-lift`。
- ✅ **G13 avatar--link 悬停焦点环直写**（style.css:1095 `box-shadow:0 0 0 3px rgba(17,17,20,.16)` 盖过引擎 `--g-lift`+`--g-ring`）→ 走 `--g-ring`。
- ✅ **G14 notif-item.unread 语义条直写**（style.css:1275 `border-left:3px solid var(--danger)` 盖掉引擎 border:none）→ 仿 glass.css:335 feedback-card--bug 改 `--g-surface:inset 3px 0 0 var(--danger)`。
- ✅ **G15 about-sec-mark 实变圆**（style.css:694 `border-radius:50%` 直写；glass 件 glass.css:353 未设 --g-r）→ 改 `--g-r:50%`。
- ✅ **G16 chat 三处圆角旁路**（style-chat.css:176 `.chat-bubble{12px}` / 214 `.chat-stage-thumb{8px}` / 227 `.chat-stage-del{50%}`）→ 改 `--g-r`。
- ✅ **G17 custom-option 圆角旁路**（glass.css:243 `border-radius:8px`）→ `--g-r:8px`。

### 🟡 竞态死代码 → 删 style.css 一方（glass 后加载必胜，style 侧已是死代码）
- ✅ **G18 实 bug·登记簿聚焦下划线失效**（glass.css:252 `background:` shorthand 重置 background-image → style.css:403-407 下划线 linear-gradient 被吃）→ glass.css 252 拆 longhand `background-color`，或下划线迁 `::after`。
- ✅ **G19 实 bug·筛选下拉 v 箭头消失**（style.css:844-850 `background-image:url(svg)` 被 glass.css:252 shorthand 重置；对照 backlog B2 已判 form-select 箭头为"无 JS 兜底"保留——filter-select 需核对同类处理）→ 同上拆 longhand 或迁 ::after。
- ✅ **G20 landing-stage 二分底色死**（style.css:170/980 渐变被 glass.css `background:transparent` 胜）→ 已删：设计意图=光球舞台透出，舞台改 min-height:100dvh（G8 顺带）。
- ✅ **G21 navbar 三处死代码**（style.css:101-102 平底 / 107 landing 渐变 / 981 media，全被 glass.css:286/287 胜）→ 已删（G3 收口 6ad7935 顺带完成，本项修正翻 ✅）。
- ✅ **G22 pane 族死代码**（style.css:550 `.client-sidebar{background:lilac}` / 931 modal-overlay / 657 sidebar-backdrop / 375 form-group border-top / 1162 profile-row / 1137 profile-panel-head，被 glass.css 268/297/314/298/262/261 胜）→ 删。
- ✅ **G23 entry 悬停位移死**（style.css:281/284 `transform:translateX(3px)` 被引擎 (0,2,0) 后加载恒等变换盖掉；glass.css:134 注释"组件自有 transform 天然胜出"对 (0,2,0) 级选择器不成立）→ 删直写或引擎让位。
- ✅ **G24 form 透明声明死**（style.css:397 form-input/form-select `background-color:transparent` + 438 custom-select-trigger）→ 删。

### 🔴 孤儿残留 → 旧染色按钮连根删时漏删的类名（删，不补）
- ✅ **G25 btn-primary/danger/accent 模板类名残留**（v0.19.6 c7c00c8 已删染色按钮预设 `.btn-primary{--g-fill:ink;--g-fg:paper}` 等，但模板/JS 仍引用 40+ 处：app.js、app-admin.js、app-contracts.js、app-chat.js、app-posts.js、index.html，现成死类名吃引擎默认白填充）→ 从模板/JS 连根删类名。用户定性：删染色没删干净，**不补预设**。
- ✅ **G26 badge-verified 类名残留**（app.js:1012 挂 `glass glass--solid`，CSS 无任何定义——旧染色徽标残留，现吃引擎默认填充+sheen）→ 删类名，外观交还 `glass--solid`。若"已验证"徽标样式仍要保留，另走 `--g-*` 参数，不补染色。

### 🟢 清理 / 文档（低危）
- ✅ **G27 glass--solid 漏关 sheen**（glass.css:229 只关磨砂不关 sheen，实心小件被顶部白高光提亮，违引擎 124-125 自述"小控件关 sheen"）→ 补 `--g-sheen:none`。
- ✅ **G28 死 background-color transition ×6**（style-chat.css:55/229/140-142/281 + style-posts.css:69-72/95-97）→ 删。
- ✅ **G29 引擎覆盖缺口 ×3**（textarea.chat-textarea:284 / input.posts-search:14 / textarea.post-body-input:106 非 glass 直写）→ 挂 glass 走引擎 or 注释豁免。
- ✅ **G30 冗余 background:transparent ×5**（style.css:471 checkbox-item / 705 feedback-kind-btn / 784 drop-toggle / 1098 image-viewer-modal / 620 avatar--guest）→ 删。
- ✅ **G31 glass 件 border-color 无效直写**（style.css:708-709 feedback-kind-btn:hover/.active——引擎 border:none 无宽不显形）→ 删。
- ✅ **G32 引擎契约注释缺参数**（glass.css:20-31 头注释参数清单缺已实现且在用的 `--g-sheen`/`--g-blend`）→ 补注释。
- ✅ **G33 score-mode-tab 分隔线双源**（glass.css:240 border-left-color vs style-region.css:52 全量 border-left）→ 收口单源。

✅ **已核实无需动作**：style.css 无 ::before 内容伪元素（竖条全在 ::after，与引擎玻璃体零冲突）；头像 border 直写（glass.css:216/218）为无参数通道的合理例外（S8 已判保留）；sidebar-item/conv-item 手卷 hover（G5）保留。

> ——— 第三轮复核（2026-08-01，主会话验收 v0.19.8 收口提交 a8a20d5+6ad7935）———

- ✅ **G34 conv-pill 圆角回归**（glass.css:281：G9 删 `border-radius:var(--lg-r)` 直写时没补参数 → 吃引擎默认 9px，原 12px，会话 pill 变方）→ 已补 `--g-r: var(--lg-r)`。
- ✅ **G35 avatar/about-flow-dot 潜伏圆角直写**（style.css:1078 `.avatar{border-radius:50%}` + 1312 `.about-flow-dot{border-radius:50%}`——值与引擎 `--g-r:50%` 一致无视觉差，但直写占位，将来改 --g-r 不生效）→ 已删直写交还参数。
- ✅ **G36 G10 空块残留**（style-region.css:55 `.score-mode-tab.active { }` 删白字后留空壳）→ 已删。
- ✅ **G21 状态修正**：6ad7935 已删 navbar 三处背景直写（style.css:101-102/107/981），实际已完成 → 翻 ✅。
- 🟡 **验收备注·G29 外观新增**：chat-textarea/posts-search/post-body-input 由 glass.css:253 输入组接管（背景/圆角/内高光），从透明变玻璃输入框——计划内但属外观新增；已核原文件仅布局属性（padding/min-height/font），无属性冲突。
- 🟡 **验收备注·弯月可见化混入收口**：v0.19.8 收口提交内夹带视觉改动（卡 fill .35/暗弧 .40/新月带），后续 v0.19.9/10 独立迭代到「填充弧单机制+卡族 --g-sheen:none」。不破坏收口规则，但收口提交不纯粹。
- ✅ **弯月浅底隐形实证诊断（2026-08-01，v0.19.12 已按主方向修）**：卡族弯月在浅底不可见。根因：①白弧配浅底零对比；②渐变峰值 `at 50% -5%` 被裁在上缘外，可见区只剩 ~.45 窄条；③下缘暗弧太淡。**已修**：峰值移入卡内（`at 50% 4%`，.90 全幅可见）+ 下缘暗弧加深加锐（.55 + 16px）。弯月单一机制（填充弧），sheen/blend 整条已删（v0.19.10）。

## ✅ #54 网安复审（security 插件技能 + 三并行只读审计 agent；v0.19.41 清毕，34/34 测试通过，公告已发）
- ✅ **合同取消竞态（A 级）**：handleCancelContract 原先无条件 DELETE，与「对方刚翻 signed」竞态 → dbDeleteContract 加可选 statuses 守卫（仅删 pending/signing），changes=0 时判别：行仍在 = 状态已翻 → 409 CONTRACT_CANCEL_SIGNED_BLOCKED（须走撤销合同）；行不在 = 并发已删 → 幂等 200。管理员路径保持无条件删。
- ✅ **签约后联系方式丢失（前端真 bug）**：后端 /api/teacher/profile 签约时返回 wechat/email，前端 app.js 只 Object.assign 了 real_name/credential_image，联系方式被丢 → 补并 wechat/email，签约学生可见实际值。
- ✅ **log.js 脱敏补键**：SENSITIVE_KEYS += real_name/credential_image/phone/mobile/tel；sanitize 循环跳过 __proto__ 键（JSON.parse 自有键可走原型污染路径）；test/log-sanitize.test.js +2 用例（含 JSON.parse 构造的 __proto__ 真实路径）。
- ✅ **svg 上传一律拒收**：routes-auth.js 头像 / routes-teacher.js 学信网截图补 `startsWith('data:image/svg')` 拒绝（矢量可内嵌脚本）；app-posts.js mdRender IMG_OK 改 `/^(https?:\/\/|data:image\/(?!svg))/i`。全站图像路径口径统一：只放行位图。
- ✅ **门牌号服务端守卫（审计中）**：ADDRESS_GUARD 单源常量进 core.js，拦「两位以上数字+号(非号线)/号楼/室/栋/单元/门牌」；sanitizeDemand（需求创建/更新）+ handleSaveProfile（教师档案）双写入点校验，违者回 ADDRESS_TOO_DETAILED（前端 alert 正常展示）。需求 address 顺带限长 100。
- ✅ **删 .liquidglass_backup/**：68K 未 git 跟踪的可部署遗留备份（constants/glass 双文件），连根删除。
- 🟡 **已判定不改（记录）**：secrets.js 明文密钥 = 本地开发位（部署 secrets 已配置，公测前轮换）；gh keyring token 失效 → PAT 保留在 .git/config（给用户建议：gh auth login 重配 credential helper 或续 PAT）；token localStorage + unsafe-inline CSP = 架构选择；404/403 枚举差异低价值；capToken 每隔离区缓存 = 可用性取舍。

## ✅ v0.19.38 三审计推迟项（2026-08-01 主会话整合；v0.19.40 清毕——用户授权"自己全修"，已全部落地并 32/32 测试通过）
- ✅ **B1 log.js ↔ fieldcrypto.js 加密逻辑 ~90% 重复**：AES 原语（b64ToBytes/bytesToB64/aesKeyFromB64/encryptAes/decryptAes）收敛进 fieldcrypto.js 导出，log.js 只留 LOG_ENCRYPT_KEY 派生与 encrypted 语义；补 test/log-crypto.test.js（log 层薄壳：encrypted 标记/无密钥回落/密钥轮换，5 用例）。
- ✅ **B3 dbGetAllTeachers / dbGetTeacherUsersAdmin 双胞胎** → 合并 dbGetTeachers(db, {adminView, viewerId})，两调用点（routes-teacher/routes-admin）已切。
- ✅ **B4 dbGetAllDemands / dbGetAllDemandsAdmin** → 合并 dbGetDemands(db, {admin, cursor, teacherUserId})，调用点含测试（admin-demands-pagination 6 用例）全切。
- 🟡 **B5 db 统计函数群同构 → 已判定不改**：三个统计函数是各自独立的 3~5 行查询（表/条件/输出键全不同），参数化=造泛型 SQL 构建器（加新物非删旧物）；dbGetRecentUsers/Demands 同构度更低（JOIN+JSON 映射差异）。按 C8/C12/B2 先例保留。
- ✅ **C4 意向教师联系方式剥除点** → 内收进 dbGetIntentTeachers 出口（mapper 出口剥私密字段契约），routes-demands.js handleGetIntents 不再二次剥。
- ✅ **C3b 合同创建端需求存在校验**：`!dm → 404 DEMAND_NOT_FOUND`（此前并入 403 NO_PERMISSION）；INSERT 守卫加 `(? IS NULL OR EXISTS(SELECT 1 FROM student_demands WHERE id=?))` 原子堵 SELECT→INSERT 竞态窗口，changes=0 时判别报 404/409 不误报。

## 🟡 醒着核对后做（高风险重构，勿凌晨盲改）
- ✅ **C1 弹窗壳跨文件重复**：modal-header 模板 ×17 + 可点遮罩 ×11 → 已抽 `openModal({title,titleId,body,footer,closable,cls,style,bodyCls})` 单源（v0.19.15-16），20/20 弹窗迁移完毕，手写模板清零，渲染结构与原模板逐字节一致。**mdToolbarHtml 未抽**（发帖/广播/合同编辑三处 md-toolbar 留 body 内，低危可后续）。
- ✅ **C2 前后端错误码体系（定向版 v0.19.8）**：`error()` 加可选 `code` 参数（向后兼容），档案不完整 → `PROFILE_INCOMPLETE`、帖子删除不存在 → `POST_NOT_FOUND`；前端 api 封装把 `code` 挂到抛出的 Error，两处脆分支改按 code 判定（保留 MSG 兜底）。其余 error 路径暂未全覆盖，可续。

## 已判定不改（保留，附理由）
- **C8 `role-tabs::after`**：非孤儿，是 base 滑动下划线指示器；glass `.role-tab.active` 胶囊是叠加态，不替代下划线。删了会丢激活下划线。
- **C12 constants 同文案多键**：`STATUS_APPROVED/REJECTED`（状态 tag 文案）与 `SUCCESS_APPROVED/REJECTED`（操作 toast 文案）语义不同、仅当前同字；`BTN_SEND`/`CHAT_BTN_SEND` 不同上下文。合并会降低清晰度，保留。
- **C4 台账内联 SQL**（contract.js:121,123,130-131）：LEDGER_DB 覆写域，挪 db.js 会循环依赖，有意保留+注释。
- **B2 `.form-select` v 箭头 background-image**（style.css:437-441）：非死代码，是无 JS 兜底（select 被 initCustomSelects 隐藏仅 JS 跑时；JS 挂时原生 select 仍需箭头），保留。

## 视觉实验（用户同意概念，需截图调参到美丽再上线）
- **vivid「clear-over-vivid」宝石按钮**：✅ 彩色玻璃观感已由 0.18.11 的统一达成（按钮=填色卡 + 标准遮罩 + 折射），**无需**元素自绘或 backdrop 垫层。若用户进一步要"折射去弯折一块自有 vivid 渐变"的宝石感，才需正后方垫同形不透明 vivid 层、按钮毛度≈0（backdrop-filter 无法跳层，自有 background 不被折射，故需垫层）——此为可选增强，只出截图原型，给用户看再定推不推全站；**不要**为它再给按钮开特例渲染路径（违 best-part-is-no-part）。
