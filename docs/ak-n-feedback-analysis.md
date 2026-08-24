# AK-N 需求理解分析（2026-08-24，理解阶段文档）

> **定位**：用户 AK-N 大反馈（30 条 + ㉘㉙㉚ + 组件契约底层质问）的**逐条深度理解**——每条 = 原话（逐字保留）→ 真实意图 → 当前差距（file:line 证据）→ 易扭曲点 → 用户验收方式。**基元拆解（AK-N-A1..N5）必须在此文档定稿、用户对齐之后才动笔**（用户原话：「你动笔的那一刻就在漏需求了」）。
> **输入**：5 个理解视角 agent（视觉/交互/工程/产品心智/挑剔用户）+ N4 自查 agent + 文字排版系统调研 agent + ㉛ 三筛选器 W25 取证 + 组件契约全站审计（进行中）。
> **心智原则**：U1-U11 已文档化于 `docs/ui-mindset-principles.md`（AK-C1 产物），本文档不重复，逐条需求标注其挂靠的 U#。

---

## 0. 组件契约底层漏洞（用户最新质问：「整个网页的按钮他妈的甚至都没全接进我设计的标准组件？这可是底层的底层啊！」）

**用户原话**：「不是，你是说整个网页的按钮他妈的甚至都没全接进我设计的标准组件？这可是底层的底层啊我操！」

**真实意图**：用户设计的组件体系（UiButton A/A1/B/B1/S/C/C1、UiInput、UiCheckButton、UiCheckbox、UiComboInput、UiVariableInputSet、UiDropdownPanel、SortBar、OrderToggle…）是**全站原件契约**。业务模块手写原生 `<button>/<input>/<select>/<textarea>` = 绕过契约 = 特例土壤。用户要的是：**业务代码零原生元素**（白名单除外），全部消费标准组件；组件库缺能力 → 扩组件库，不许在业务代码里自搓。

**组件契约全站审计（agent ae7c35c6，2026-08-24 返回）确认 17 个违反模板点**：

| 模块 | 违反点 | 明细 |
|---|---|---|
| teacher-square (M7) | 4 | GenderFilter trigger（原生 button）/ PriceFilter ×2（原生 input 黑边框）/ PersonalityFilter trigger（原生 button 黑边框）——SubjectFilter 用 UiButton C 属合规对照范本 |
| teacher-side (M9) | 4 | FilterGender / FilterSubject 芯片（原生 button）/ FilterReveal（注释自述"UiButton variant S style"却抄样式不抄组件）/ TeacherDemandPlaza reset（应 S1） |
| chat (M4) | 6 | ChatInputBar ×3（textarea 全套重写 UiInput 的 IME/autoGrow/sendOnEnter + plus 圆钮 + 纸飞机钮）/ ChatTopBar ×2（more 钮应 UiButton circle + 菜单项应 UiButton B）/ ChatMessageList 加载更多（应 S1） |
| shell (M2) | 2 | UserArea / UserAreaDropdown 占位行（应 UiButton B） |
| notifications (M5) | 2 | FeedbackModal / SettingsPanel 左导航 tab（应 UiButton B） |

**存疑 3 处**（无标准形态，可容忍或进白名单）：AvatarEditor 圆形头像钮 96px / ChatImageBubble 缩略图 / ChatListPane 会话卡复合行。**正当 5 处**：全部 `input type="file"` label-for 上传（P13）。**全仓零 `<select>`。**

**根因（审计结论）**：①M0 库缺「筛选触发器」形态 → M7 契约只钉了选项用 UiCheckButton、没钉 trigger 用什么 → 各子 agent 各写各的（三触发器三实现 = ㉛ 参差来源）；②M4 chat 契约自身没钉 ChatInputBar 必须用 UiInput → 全套重写 = ADR 0004 §1「单实现+变体参数，非复制多组件」最典型反例；③子 agent 抄样式不抄组件（FilterReveal 注释自认）；④并行开发无统一收口、archtest 契约 6 管住了内联样式/中文/v-html 却**没管住原生标签**——监管盲区。

**修复方案（审计建议，进 AK-N 拆解）**：①新增 archtest 契约 11「业务代码零原生 button/select/textarea，input 仅放行 type=file」（沿用契约 6 扫描器骨架 + 变异测试承重豁免正则）；②新建共享 `FilterTrigger.vue`（trigger=UiButton C + useAnchoredPanel/useFocusTrap 面板 slot）一次消灭 3 份手写 trigger + ㉛ 视觉参差；③逐模块收口（上表，含对照范本：teacher-side FilterPrice 已正确用 `UiInput filter="digits"`）；④各模块 CONTRACT 把交互基元钉到标准组件 + 纪律「M0 缺形态禁止手写原生，必须扩组件变体或申请新共享组件」。

**验收方式（用户视角）**：全站业务代码 grep 零原生 button/input（白名单：file input / label-for / 组件库自身 / preview）；新增 archtest 契约「业务代码零原生表单元素」+ 变异测试；筛选栏四卡统一触发器组件。

---

## 1. 三十条逐条理解

### ① 间距韵律（挂 U1）
**原话**：「行距小了但该空的行也没了（密码↔隐私、隐私↔拼图、两个小title上下），全站统一排版思路、韵律恰当疏落有致」
**真实意图**：三级 gap 体系（行内最紧/组间中等/大区最松），不是均匀加间距。AK-L-F3 压缩把三级压成同 4px，节奏死了。
**差距**：`AuthShell.vue:159-162` `.register-pane{gap:--space-1}` + otp/password-row gap + 拼图 track margin 全 4px；`base.css:118-123` `.ui-title-sm{margin:--space-2 0}` 8px，与字段 gap 叠加无"行"感。
**验收**：注册页间距与三级韵律表逐字段一致；两个小 title 上下明显"空一行"。
**易扭曲点**：不是"加大间距"——全站 16px 是另一种均质。必须分级对比。

### ② 通道切换链接贴标题（挂 U2）
**原话**：「'改为邮箱注册'应在'手机验证码'右边不远处而非最右边，功能关联→空间分布关联思想，全站排查」
**差距**：`OtpRow.vue:46-48` `.otp-row__title-row{justify-content:space-between}` 把 suffix 推最右；`RegisterPane.vue:176-180` 经 `#title-suffix` 传入。
**验收**：链接紧贴标题右缘 ~12px（--space-3），登录/验证/绑定同型。

### ③ 拼图主次（挂 U3）⚠️ 最易理解反
**原话**：「拼图滑块触点太大轨道太粗和字号对不上，滑轨至少是里边的灰字三倍高，图形组件不能喧宾夺主、注册页字才是主人，主次思想全站排查」
**⚠️ 用户深夜纠正（AK-N-A4 已记）**：「我说你现在滑轨大于三倍文字是很有问题的」——方向是降不超三倍（40px 轨道 > 3×12px 灰字 = 36px 已是问题），修复 = 降到 ≤36px，不是升。**全批最易被实现反的一条。**
**差距**：`CaptchaPuzzle.vue:285` track `calc(40px*scale)`；knob 40×40；hint 12px。
**验收**：轨道 ≤ 3×hint（36px），knob 缩小，变异守护。

### ④ 默认页=广场（挂 U5）
**原话**：「会话是默认页不对，组件分布应为广场→自己的东西（需求/资料）→会话→关系（逐步深入的逻辑），让承担主要功能的广场成为默认页」
**差距**：`page-registry.js:38-44` defaultPageForRole 取 glob 首个命中 = `/chat`（chat 字母序最前）；TabBar 顺序 [会话,我的需求,关系,教师广场] 与会话置首。
**验收**：学生默认→teacher-square、教师默认→需求广场；TabBar 顺序 = 广场→自己的东西→会话→关系。**侧边栏顺序 + 默认页一起改（B1）。**

### ⑤ 右上角三图标统一（挂 U4）
**原话**：「人头SVG右上角大小颜色和另外两个不一样，愚蠢的特例，统一」
**差距**：`UserArea.vue:42` 人头 `UiIcon :size="32"` 灰 gray-50；`NotifyButton.vue`/`ChatButton.vue` 40px 胶囊内 20px 图标继承 ink。三态（大小/色/承载形态）不一致。
**验收**：三图标同尺寸 token、同色、同承载、同悬停。

### ⑥ LOGO 换四方块（挂 U4）
**原话**：「平台LOGO极其丑陋，换回'原来那个四个方块的'」
**差距**：`assets/svg/logo.svg` 单方块+圆孔；**必须先 git 历史找回"四个方块"旧版**，找不到再重建（标注"重建非还原"）。

### ⑦ 左上角 LOGO+平台名按钮 B（挂 U4）
**原话**：「客户端左上角logo右边放平台名字、地方比想象的大一些、按钮B包含整个logo+名字」
**差距**：`TopBarLogo.vue:30-31` 只渲染 28px LogoSvg 无平台名；gap 无定义。
**验收**：B 按钮 = [logo 28px] + gap(≥--space-4 16px，"比想象大") + 平台名。平台名文案版本（全称 vs 简称）**待用户确认**。

### ⑧ 筛选/排序按钮 SVG（挂 U3/U4）
**原话**：「筛选按钮半边箭头（完整箭头让三条横线没地方），图案扁不美观；且之前已要求筛选按钮A1箭头改为向下/向上V」
**差距**：`sort-asc/desc.svg` 完整箭头挤横线；`SecondBar.vue:46` 筛选按钮 A1 文字+右箭头无横线图标。
**验收**：三个图标一起重做（筛选=三横线+半边V下、升序=三横线+半边V上、降序=三横线+半边V下），全站统一。

### ⑨ 学科空括号数据泄露（挂 U11）
**原话**：「教师广场所有卡片所有学科右边都有空的中括号=后台数据格式泄露，全平台彻查」
**差距（N3 已定位）**：`TeacherCard.vue:64` `awards: s.awards ?? ''`（`??` 拦不住空数组）+ `:110` `v-if="row.awards"`（[] truthy）+ `{{ row.awards }}` → "[]"；后端 `teacher/repo.js` 恒发 `awards: []`；mock-data.js 缺 awards 键掩盖。
**验收**：空 awards 不显示；**全平台数组/对象原始渲染路径（[object Object]/[]/null）彻查修复，逐点独立 commit**。

### ⑩ 教师卡头像最左（挂 U4）⚠️ 有歧义需确认
**原话**：「教师卡头像应在最左边，头像右边放用户id和星级」
**差距**：`TeacherCard.vue:79-99` identity（name+stars）在前、avatar 在后（右）。
**⚠️ 歧义**：当前显示 `teacher.name` 非数字 id。用户字面说"用户id"——需确认是要数字 id 还是名字（拆解标记，不擅自换）。

### ⑪ 按钮 S 全局回滚（挂 U10）
**原话**：「只让改注册界面两个按钮S，却直接改按钮S全局样式，站内所有按钮S都丑陋了，回滚重做」
**差距**：`UiButton.vue:201-204` `.ui-btn--s:hover{color:--gray-60}` 全局 S 灰化。**需 git 历史定位污染 commit**（AK-C2-F2 已删 UiCheckButton 灰化，S 变体另查），回滚全局 + 注册页两按钮局部覆盖。

### ⑫ 筛选下拉栏（挂 U1/U3）
**原话**：「筛选下拉栏问题：卡片列无动效、遮罩方向和位置错误、第三下拉栏和卡片留空不够」
**差距**：卡片动效 = `PageEnter :key="nonce"` 只在 filters deep-change bump，**filtersOpen 翻转不 bump**（`TeacherSquarePage.vue:100-102`）；遮罩 `FilterReveal.vue:50-59` 固定第三栏底 v-if 隐藏即消失；留空 `.tsq__body{margin-top:--space-4}` 16px 不够。
**验收**：展开/收起动效连贯、遮罩方向位置实机确认、第三栏与卡片间距加大。

### ⑬ 关系页空态（挂 自我定位感）
**原话**：「关系管理页面要的背景圆点阵列呢？就算没有关系我自己的头像呢」
**差距（N4 确认）**：`RelationsBoard.vue:57-68` 圆点阵列**已实现**但只在非空分支渲染；`RelationsPage.vue:211-216` 空态走 RelationsStates 纯文字无圆点无自头像。
**验收**：空态也渲染圆点阵列 + 中央自己头像（真实头像，非中性占位）。**W6 别重复造组件——圆点已写，扩渲染分支即可。**

### ⑭ 设置大区间距（挂 U1）
**原话**：「设置浮窗右侧可滚动区大区间隙太大，像分别做了几个大区界面留白拼起来的」
**差距**：`SettingsPanel.vue:184-186` `.st-section{min-height:320px}` + `:187-189` margin-top --space-6(40px)——min-height 320 制造空区 + 40px 间隔 = 拼接感。**去 min-height + 间隔降到 24px 左右；注意 scroll-spy 依赖 offsetTop。**
**验收**：右侧连续滚动无"跳块"。

### ⑮ 账号资料三项对齐/按钮统一（挂 U4）
**原话**：「账号资料设置里用户名右对齐、头像超级左对齐、联系方式居中，三项按钮样式各不一样」
**差距**：`SettingsUsername.vue:136-143` 值右对齐 + 编辑 B 80×34；`SettingsAvatar.vue:163-183` 左排 + 保存 A sm；`SettingsContact.vue:174-185` 96px 标签 + 绑定 B 220px。三种对齐基准 + 三种按钮。
**验收**：统一对齐基准 + 三项按钮同 variant 同尺寸。

### ⑯ 缩放假可用（挂 D3/诚实可用性）
**原话**：「界面缩放可用但还是toast'该功能开发中'」
**差距（N4-F3）**：`SettingsAppearance.vue:68-75` setProperty('--ui-scale') 真生效 + CAP_TOAST"开发中"；且不持久化。同病：Username/Contact/Deactivate/Devices/附件/需求卡会话。
**验收**：真实启用（+持久化）或隐藏入口，绝不"生效却宣称未开发"。

### ⑰ 缩放后浮层跑屏外（挂 坐标系全局一致）⚠️ 全站共因
**原话**：「缩放一下界面后右上角聚焦下拉栏跑屏幕外，且绝非唯一问题，自查全站」
**差距（N4-F2 系统性根因）**：`useAnchoredPanel.js:38-71` place() 用 `getBoundingClientRect()`（缩放后坐标）+ `position:fixed` 再被 zoom 缩一次 = 双重缩放；`window.innerWidth` 未缩放 clamp 失真。zoom=1.1 C4 面板 right=1535>1440 实机复现。全 useAnchoredPanel 浮层（MoreMenu/UiDropdownPanel/GenderFilter/PersonalityFilter/ChatTopBar）同根因。
**验收**：缩放任意档位浮层锚定正确不出屏；**逐浮层独立 commit 独立审计**（H2）。

### ⑱ 会话入口=气泡（挂 U5/入口收敛）
**原话**：「右上角聊天气泡=原本设想的会话入口（后来忘了才又设计了上边栏'会话'主入口），删'会话'，会话页入口改成气泡」
**差距（N4-F5）**：`chat/pages.js:20` meta.tab:true 渲染"会话"tab；气泡 ChatButton 已存在。双入口并存。
**验收**：删 tab（meta.tab:false），气泡解析 /chat 不受影响；与④顺序联动。

### ⑲ 遮罩绑定最底层（挂 坐标系/层级）
**原话**：「教师广场可滚动，上边栏淡出遮罩绑定在显示出来的最下面一层上边栏底下，不是绑死第三上边栏」
**差距（N4-F6）**：`FilterReveal.vue:44-58` 唯一遮罩在第三栏 wrapper（v-if 展开才有）；第二栏非 sticky 且无遮罩，内容硬切。
**验收**：遮罩动态贴"当前可见最低一条上边栏"底缘（第三栏开→第三栏底/关→第二栏底）；全站可滚动页同型排查。

### ⑳ 教师卡最小高度（挂 U6）
**原话**：「教师卡可以空但不可以扁，起码横着的A4比例」
**真实意图**：min-height ≥ 宽/√2（297:210，0.707×宽），空态也保持。**与㉑互补：保底不拉齐。**
**差距**：`TeacherCard.vue:118-121` 无 min-height，高度纯内容驱动。
**验收**：卡片 min-height = 宽/√2，空态保持；`CardGrid.vue:38` align-items:start 配合不拉齐。

### ㉑ 教师卡对齐语义（挂 U6）
**原话**：「教师卡第一行对齐、后面每一列自由堆叠、行之间不对齐」
**差距**：header flex 居中；后续块已自由堆叠基本符合。需核查：同列卡 header 顶线是否同水平线（名字换行致 header 高不一）。
**验收**：第一行（头像+id+星级）卡片间对齐；bio/price/subjects 自由堆叠。

### ㉒ 教师卡科目展示（挂 U3）
**原话**：「教师卡科目展示全部75度信息灰字（字太挤）+科目前缀品牌紫小点放大」
**差距**：`TeacherCard.vue:260-267` 科目名/分数 `var(--ink)` 黑字；`:245` line-height:1 挤；`:107` 紫点 :size="10" 小；DetailMiddle.vue:109-122 同款黑字。
**验收**：科目区全部 gray-75、行距 1.4-1.5 多科目不挤、紫点放大 12-14px；**卡与详情同表示**。

### ㉓ 真自制滚动条（挂 U7）
**原话**：「自制滚动条要美观简洁雅观贴边细指引条，不是复刻系统样式（上下三角形无存在必要），也不是把系统滚动条往里压」
**差距**：`base.css:92-111` 现状 = 系统 thin 变体（scrollbar-width:thin + webkit 8px + 内压圆角）——正是用户否定的"往里压"。
**验收**：贴边细指引条（4-6px、无轨道无三角、hover 加深、不可滚动不显示、悬浮内容上）；全站可滚动容器统一，**逐容器独立 commit**。

### ㉔ 屏蔽系统通知本地筛选（挂 U8）
**原话**：「屏蔽系统通知不该重新加载，是本地筛选」
**差距（N4-F4）**：`BlockSystemToggle.vue:33-46` 勾选 → PUT → `loadNotifications()` 重拉（网络往返 + loading 闪烁）；`data.js:29-30` 注释自述"server filters, client must NOT re-filter" = 反题。
**验收**：本地即时过滤 avatar_src==='system'（勾上消失/取消恢复，排序未读态保留）+ 后台静默 PUT 持久化；**判定口径与服务端一致，注释改写（D3）**。

### ㉕ 上边栏按钮尺寸层次（挂 U3/U4）
**原话**：「第二上边栏按钮B和升降序按钮扁小、比筛选按钮都扁，筛选按钮又宽又高光彩夺目，按钮尺寸层次统一」
**差距**：`SecondBar.vue:46` 筛选 A1 吃 UiButton 默认 220×52；`OrderToggle.vue:44-46` 40px；`SortBar.vue:42-45` tab ~34px。52/40/34 三梯队。
**验收**：同栏控件同一高度基准（~40px）+ 各自合理宽度；垂直中心对齐。

### ㉖ 站点预加载（挂 U9）
**原话**：「点进任何地方都是加载中=站点预加载机制为零，V2成熟的预加载逻辑哪去了」
**差距（N5 已定位）**：`core/datahub.js` 裸 Map（零 TTL/single-flight/批量/预取）；`page-registry.js:18` eager glob 全量打包；各页 onMounted 直 fetch 不走 dhFetch；`TeacherSquarePage.vue:44` 默认 loading。**F1 装配断线——缓存模块定义了但从未被消费。**
**验收**：切回访问过的页缓存即出（stale-while-revalidate）；关键列表登录后/空闲预取；**注意 /api/data-version 已删（PA-1i-F1），版本探针不可用——预取策略勿依赖它**。

### ㉗ 理解+自查五遍（挂 流程）
**原话**：「先花一小时认真全面分析反馈，拆最细致基元和最严格实现要求，反复揣摩理解，总结所有用户心智和'一眼就能看见你找不出bug的路径'，拿原则自查全站五遍，任何需求不许被忽略」
**本文档即"认真全面分析反馈"的交付**。N1-N5 自查角度：N1=韵律/主次、N2=功能↔空间/统一性特例、N3=数据泄露/渲染异常、N4=交互/缩放浮层/遮罩/本地筛选（已完成，F1-F7）、N5=性能/预加载/加载态。**完成度闸门**：每遍报告末尾「27 条全清零 + U1-U11 全覆盖」勾表。

### ㉘ 分隔线 30 度灰（挂 U4，2026-08-24 补充）
**原话**：「是时候调整分割线表现了，所有分割线改为30度灰」
**差距（排版调研 G1）**：`--line: gray-50` 一值两职（分隔线+控件边框）；29 处 `var(--line)` 需按用途重分类——**分隔线 → 新 `--divider: gray-30`**；`ChatListPane.vue:98` 用 gray-10 做行分隔也归一 gray-30。
**验收**：全站分隔线 gray-30、控件边框保留 gray-50；变异守护。

### ㉙ 报价区间与下拉按钮不一致（2026-08-24 补充，被㉛ 吸收）
**原话**：「筛选栏的报价区间两个输入框和其他的下拉按钮高度位置不！一！样！」
**差距（W25 取证）**：PriceFilter 输入框 44px/12px/黑框/16px vs 下拉触发器 52px/26px 胶囊/黑框/16px（SubjectFilter）/ 44px/12px/灰框/14px（GenderFilter）。**与㉛ 同根：统一筛选触发器原件。**

### ㉚ 全平台每一个原件（挂 U3/U4，2026-08-24 补充，最重）
**原话**：「你需要去思考全平台每一个字，我是说每一个字，它应该有什么大小、位置和色号，这不是比喻……把每一个细节都按照我的原则犁十遍。上dribble，或者别的什么设计网站之集大成者，找美！美的方案，美的理念，而不是美的俺寻思！」
**⚠️ 用户纠正（2026-08-24）**：「我说找字你真就只找字啊？我说的是每个原件」——落点是**每个组件原件**（typography+geometry+color 三要素），文字只是一维。
**交付（排版调研已产出）**：全站原件排版系统规格——三支柱（typography/geometry/color）+ 字阶表（补 --fs-md 18/--fs-page-title 24）+ 文字色阶 token（--text-primary/secondary/tertiary/muted/placeholder/disabled/link/on-brand/danger）+ 高度梯（--ctrl-h-xl/lg/md/sm/xs）+ 圆角梯 + 三档间距 + **29 个原件规格清单（一个原件一行）**。差距 G0-G12：G1 分隔线(㉘)/G2 UiButton C/C1 圆角 bug(胶囊非圆角矩形)/G3 无文字色语义 token/G4 字阶缺档/G5 裸字重/G6 无字距 CJK 规则/G7 数字非 tabular/G8 行高未分层/G9 输入框双形态未规格化/G10 占位符对比度失控/G11 控制高度无语义梯/G12 已符合保持。
**验收**：每个原件一条可落地规范（字号/高度/px 色号/间距）；全站组件消费语义 token 零裸值；archtest 锁「零裸 font-size/color:var(--gray-X)」防回潮。

### ㉛ 筛选栏三输入组件统一（挂 U4，2026-08-24 补充）
**原话**：「筛选栏里擅长科目、教师性别和报价区间，这三个输入组件有的样式不同，高度位置全都不同！你知道我是强迫症，你还做这种参差不齐到诡异的特例，你是要杀了我吗？」
**差距（W25 取证，源码逐行）**：见 §0 表格——SubjectFilter=UiButton C（52/26 胶囊/黑框/16/涟漪）、GenderFilter=原生 button（44/12/灰框/14/无涟漪）、PriceFilter=原生 input（44/12/黑框/16/占位 gray-30 过淡 2.07:1）。**三组件连组件类型都不同 + 五维不一致；第四卡 PersonalityFilter 待一并盘点。**
**验收**：统一"筛选触发器"原件（44/12/gray-50 框/14px/占位 gray-50）+ 变异守护锁「同栏四触发器几何逐位一致」。

---

## 2. 组件契约全站审计（✅ 已完成，结论并入 §0）

## 2.1 全站层级树审计（用户㉟，2026-08-24，4 agent 并行——3 面已回 + 实机验证）

**实机验证（test/verify-ripple-dual-path.mjs，dev :5199，已跑）量化证据**：
- **P2 涟漪双路径实锤**：next 按钮（192×52，对角线 199px）点击 top-left origin=(0,0) radius=99 < farthestCorner=199 **COVERS=NO**（圆从角落喷出按钮外 = 用户"扩散到整个浮窗"）；点击 center origin=(96,26) radius=99=99 **COVERS=YES**；聚焦 ::before 圆心钉中心 radius=99=99 **COVERS=YES**。**同一按钮：点角落盖不满、聚焦全盖** —— 双路径几何差异机械化实证。
- **P3 disabled 箭头实锤**：hover 前 transform=none → hover 后 matrix(1,0,0,1,-3.99,0)（箭头位移触发）。
- **P5 五角星实锤**：required-empty 标记 innerHTML = `m12 3 2.7 5.6 6.1.9...`（star-filled.svg 五角星路径），markText 空——非星号字符。

**审计面 1（按钮涟漪面）结论**：
- T1（用户㉞）：`UiButton.vue:279-284` `.ui-btn:hover .ui-btn__arrow` 无 `:not(.is-disabled)` 守卫，disabled 下箭头仍 4px 位移。
- T2（更广）：UiComboInput V 钮 / UiCaptchaInput 发送钮 / UiVariableInputSet X+ 三组件 disabled 下 hover 灰层泄漏（无 `:disabled::before/::after{display:none}`）。
- T3（用户㉝ 根因实锤）：`--btn-d = hypot(w,h)`（useRipple.js:27），点击圆心在 `--mx/--my`（UiButton.vue:256）——点角落时圆心到最远角=对角线=2r > r，最远角在圆外，弧线甩出按钮。AK-H1 把 2×hypot 改回 hypot 引入回归。
- T4：UiCheckButton A 系 hover 上浮在 disabled 下泄漏（`.is-disabled` 无 `transform:none`）。
- T5：**六份 `ui-*-hover-in` keyframes 逐字重复**（UiButton/UiCheckButton/UiCard/UiComboInput/UiCaptchaInput/UiVariableInputSet 各一份）+ 双圆层 CSS 复制六遍 + `--btn-d` 兜底五个裸数（600/900/200/300/120px）——层级沙漠实证。
- T6：useRipple 与 directives/ripple.js 双实现（核心五函数逐字重复）。
- T7/T8/T9/T10/T11：check SVG 紫不随灰化 / `--btn-dur-focus` 死 token / reduced-motion 未压位置 transform / reduced 覆盖不一致 / vRipple animationend 缺 target 守卫。

**审计面 3（业务模块面）结论**：
- **18 处原生 button 全量清单**（ChatInputBar plus+发送 / ChatTopBar more+结束项 / ChatMessageList 加载更多 / ChatListPane 会话卡 / ChatImageBubble 缩略图 / SettingsPanel+FeedbackModal 导航 tab（逐字节复制的两份）/ UserArea / UserAreaDropdown / FilterReveal（注释自述"UiButton variant S style"却手写）/ FilterGender / FilterSubject / TeacherDemandPlaza 重置 / AvatarEditor 96px 圆钮 / GenderFilter / PersonalityFilter）+ PriceFilter 原生 input ×2 + ChatInputBar textarea（重写 UiInput 全套 IME/autoGrow/sendOnEnter）+ 正当豁免 file input ×5。
- **HIGH-1**：SortBar/OrderToggle **无 disabled prop**，loading 时排序/升降序动画照跑（根 loading 不停叶）。
- **HIGH-2**：18 处手写 button 全部缺失"根 disabled → 叶涟漪停"抑制。
- **MED-1**：ChatMessageList 加载更多无在途守卫（F6）。
- **MED-2**：筛选触发器无 loading/disabled 态。
- **3a 筛选触发器五维不一致源码实锤**（㉛）：SubjectFilter UiButton C 52/胶囊/黑/16/涟漪 vs GenderFilter 原生 button 44/12/灰/14/无 vs PersonalityFilter 44/12/黑/16/无 vs PriceFilter input 44/12/黑/16/无。
- **3b 两广场"筛选"总开关完全相反**：teacher-square A1 默认 220×52（光彩夺目）vs teacher-side B1 S 小字钮（㉕）。
- **3d 左导航 tab 双份逐字节复制**：SettingsPanel :149-169 与 FeedbackModal :95-115。
- **4 必填标记**：UiFieldInput 用五角星（违反 ㊱）；auth 注册表单/teacher B2 档案**零必填标记**；FeedbackForm "联系方式（选填）" 文字 vs 黄星双语言。

**审计面 4（样式动效面）结论**：
- 22 个 keyframes：`ui-ripple` 全局单源 ✓；**6 个功能相同 hover-in 私有复制**（应合并全局 `ui-fill-in`，与 ui-ripple 同先例）。
- 裸时长 6 处（puzzle-shake 420ms / chat-special-breathe 3s / rel-flow 6s / grid stagger 40-280ms / RelationAvatar 裸 ease / CaptchaPuzzle 40/20/18px 镜像）。
- reduced-motion 功能无漏网（base.css:126-135 全局 !important 兜底），但 7 处依赖全局无本地块（模式不一致）。
- **loading 根零承重**：全仓无 `.is-loading` CSS 层级（grep 零命中），"loading 停子树"无实现（㉖ 样式层镜像）。
- **缩放双缩放波及面**：useAnchoredPanel.js:42-79 place() 用 getBoundingClientRect（缩放后）+ window.innerWidth clamp + fixed 再缩放 = 双缩放；消费方 UiDropdownPanel（全部 UiDropdown）/MoreMenu/ChatTopBar/PersonalityFilter/GenderFilter；修复 = place() 除根 zoom 因子 + 监听 --ui-scale 变更重排。
- tokens 建议：`--divider: gray-30`（㉘ 分隔线）/`--text-primary/secondary/tertiary`（㉚ 色阶语义）/`--ctrl-h-*` 高度梯（㉛）/`--fw-*` 字重/`--fs-md`+`--fs-page-title`（字阶缺口）。

**审计面 2（输入选择面）结论**：
- **HIGH-1 必填标记语义撞车**：`UiFieldInput.vue:4/:55-59` 五角星 StarFilled 与**评分星共用同一字形**（`RatingStars.vue:67` / `TeacherCard.vue:83` 同 `star-filled.svg`，icons.js:14/:50）——表单必填标记 = 评分图标；全站无星号 `*` 字面量、无 aria-required（MED-3）。
- **HIGH-2 缩放浮层实测**：`useAnchoredPanel.js:38-79` getBoundingClientRect（渲染空间坐标）× position:fixed（布局空间再缩放）= 双缩放。实测 1440 屏：scale=1 贴齐 ✓；scale=1.1 → rectRight 1574 **134px 跑屏外**；scale=1.25 → **1787 / 347px 跑屏外**。用户⑰ 根因实锤。
- **MED-1 reduced-motion 覆盖不一致**：UiDropdownPanel :209-211 杀 `.ui-droppanel` 是空操作（动画在 `.ui-drop-*-enter-active`）；UiDropdown 整文件无 reduced 块（V 箭头 rotate 仍动画）。
- **MED-2 disabled+checked 满饱和泄漏**：UiCheckbox :113-120 brand 填充 + 白 check 不随 disabled 灰化；UiCheckButton 同病（check-svg 仍紫 + stretch 仍在）。
- **LOW**：auth 表单零必填标记（与 info-input-area 模式分裂）/ UiInput 无 readonly prop / OtpRow space-between 确认 AK-N-② 未落地 / tokens.css:32 `--warn /* yellow star */` 注释待标记改星号后同步。

**P 组修复基元**（AK-N-P1..P5）已写入 CLAUDE.md 需求 AK-N。**4 审计面全部返回，层级树特例清单整合完成**。

## 3. 执行序（基元拆解前置说明）
- 本理解文档用户对齐 → AK-N-0 拆解复核（W27c/W45）→ 阶段 A..N 逐基元。
- **跨条依赖**：㉙㉛ 并入 ㉚ 原件系统化（统一筛选触发器 = 原件 8/9）；㉛ 又依赖组件契约审计结论（根治 = 业务代码接标准组件）；⑱ 依赖 ④ 顺序；⑳㉑ 一对共同裁决；⑬ W6 复用既有圆点阵列。
