# 网页 UI 设计美学与工程原理（自学补课文档）

> 本文档系统梳理现代网页 UI 设计的成熟美学规范（Web / Material Design 3 / Apple HIG 三大体系），从**根子上**讲清每个原理"为什么这样设计合理"（认知/工程依据），再给**可操作的具体数值规范**。术语保留英文原名，括号注中文。面向"经世知途"新前端重构团队：本文档是设计 token 与组件库的**上游理论依据**，实现细节看 `docs/adr/0004-new-frontend-component-contract.md` 与设计 token 表。
>
> 核心观念先立住：**好的界面不是"好看"，而是"可预测、有层级、不耗脑"**。每一个设计规范，本质上都是在降低用户的认知负担、消除实现的任意性。设计系统（design system）的价值 = 用"少数规则"约束出"大量一致"。

---

## 0. 一个总纲：为什么需要设计系统

在进入具体规范前，先建立全局认知。设计系统解决的是三个根本问题：

1. **认知一致（Consistency）**：用户在一个页面学到的东西，在另一个页面必须依然成立。"这个紫色是按钮，点击有反应"——如果另一个紫色只是装饰，用户就学错了。一致性让用户把注意力留给内容，而不是重新学界面。
2. **决策成本（Decision cost）**：设计师和工程师都面临无数微观决策（这个间距 14 还是 16？这个圆角 6 还是 8？）。设计系统把决策从"每次重新拍脑袋"变成"查表"，既快又稳。正如 8pt 网格的倡导者所说："你减少了可 fiddling 的空间，也就减少了通往代码的速度。"（reduce the amount of fiddling, reduce speed to code）
3. **变更可规模化（Scalable change）**：改品牌色、切暗色模式、换主题——如果颜色散落在 3000 处硬编码里，改一处漏九处；如果都收敛到 token，改一个变量全站生效。这就是 token 体系的工程价值。

贯穿全文的一个总原则：**美学不是玄学，是"符合人类感知规律 + 消灭任意性"的工程**。下面每一节都按"原理 → 为什么成立 → 数值规范 → 例子"展开。

---

## 1. 间距系统（Spacing System）

### 1.1 原理定义

间距系统 = 用一组**离散的、有比例的**间距值（而非任意数值）来约束界面中所有元素之间的距离与尺寸。主流做法是 **8pt 网格**：所有组件尺寸、布局间距、内外边距都取 8 的倍数（8/16/24/32/48/64/96...）；**4px 作为半网格**，用于排版基线、图标、小元素内距等细粒度微调。

### 1.2 为什么成立（认知/工程依据）

- **数学优雅，避免亚像素模糊**：8 除以 2 得 4、除以 4 得 2，任何运算都落在整数上；而像 10.5px 这种小数在屏幕上会产生半像素渲染模糊。8 在 1x/1.5x/2x/3x/4x 各种像素密度倍率下相乘都得整数（8×1.5=12、8×2=16...），而 10×1.5=15 不落在任何 8 基网格上。
- **节奏感（Rhythm）**：等比/等差的间距序列产生可预测的视觉韵律。间距 8/16/24/32 的递增让眼睛能"猜到"下一个元素该在哪。
- **减少决策**：把间距从无限多种可能收缩到 7 种（8 的 1~7 倍），设计不再 fiddling。
- **为什么还要 4px**：8 太粗，无法表达图标内距、文字基线、紧凑组件内部这类"需要 4/12/20"的精细场景。业界共识是分工：**4pt 用于微调（icon padding、紧凑组件内部），8pt 用于其余一切**。Material 自己也用 8dp 对组件、4dp 对排版基线。

### 1.3 间距阶梯（--space-1..6）如何派生

以一个基准单位 `--space-unit: 4px` 起步，按倍数派生出**语义化间距 token**：

```css
:root {
  /* 基准 4px，半网格层 */
  --space-0: 0;       /* 0    */
  --space-1: 4px;     /* 1×  —— 微内距、图标距文字 */
  --space-2: 8px;     /* 2×  —— 紧凑组件内部、按钮内 label 距图标 */
  --space-3: 12px;    /* 3×  —— 表单行内距、列表项内距 */
  --space-4: 16px;    /* 4×  —— 卡片内距、块间距（默认标准） */
  --space-5: 24px;    /* 6×  —— 大区块间距、模态内距 */
  --space-6: 32px;    /* 8×  —— 页面分区、hero 间距 */
  /* 更大时用 48/64/96，按 8pt 主网格 */
}
```

设计系统内常见的完整阶梯是 `4, 8, 12, 16, 24, 32, 48, 64, 96`（混合 4px 半网格与 8px 主网格）。**关键纪律**：间距值只从阶梯里取，禁止出现 13px、17px、25px 这类"随手值"。数值规范上：卡片内距 16–24、模态内距 24、表单标签到输入框 8、组标题到内容 8–12、大分区 32–64。

### 1.4 何时打破网格（合法例外）

网格是默认，不是枷锁。合法打破的情形：

- **细粒度内距**：文字与图标内部的视觉对齐（如按钮 label 与胶囊左右弧心的距离）用 4px 或光学调整值。
- **光学对齐（optical adjustment）**：圆角元素内部、有背景高亮的行，需要按"视觉重量"微调而非机械等距。
- **基线对齐**：文字与相邻元素对齐时，按行高基线而非盒模型顶边。
- **特殊动效/渐变**：间距参与动效时（如浮层偏移 24px 加 8px 余量）。

打破网格必须**有理由且有记录**（token 或注释），否则一律按阶梯。

### 1.5 例子

- Material Design 3：8dp 组件网格 + 4dp 排版基线。
- Tailwind：`space-x/y` 系列 0/1/2/4/8/12/16/24/32/48... 即 4 基阶梯。
- 经世知途组件契约：`--space-1..6` 即按本节派生的 4/8/12/16/24/32。

**来源**：
- Material Design 8dp grid — https://m3.material.io/foundations/layout/applying-layout/writing-breakpoints
- Carlos Lastres, Using 8-Point Grid — https://carloslastres.webflow.io/post/using-8-point-grid
- LS.Graphics, Why 8pt grid: the math behind clean UI — https://www.ls.graphics/blog/why-8pt-grid-the-math-behind-clean-ui
- 设计达人《为什么 4 点网格系统比 8 点网格更好用》— https://www.shejidaren.com/4-dian-wang-ge-xi-tong.html
- EEA Design System Spacing — https://eea.github.io/volto-eea-design-system/docs/webdev/Guidelines/spacing/

---

## 2. 类型尺度（Type Scale）

### 2.1 原理定义

类型尺度 = 一组按**固定数学比例**递增的字号列表。从基准字号（通常 16px/1rem）出发，乘以一个比例系数逐级放大/缩小，得到 5~7 个层级。两个最常用比例：

| 比例 | 值 | 适用场景 |
|---|---|---|
| **Major Third**（大三度） | **1.25** | 信息密集的 UI：后台、仪表盘、SaaS、移动 App、工具类产品——层级紧凑、字号相差温和 |
| **Perfect Fourth**（纯四度） | **1.333** | 编辑型/内容型站点：文章站、内容平台、需要强烈层级对比的 Web 应用 |

（同族还有 Minor Second 1.067、Major Second 1.125、Minor Third 1.2、Augmented Fourth 1.414、Perfect Fifth 1.5、Golden Ratio 1.618。**比例越大，标题层级间跳变越大**；信息密集界面用小比例，让多个字号在窄范围内共存。）

### 2.2 为什么成立

- **内在和谐**：等比数列让所有字号共享同一个"数学基因"，任何两个层级站在一起都不冲突。这是音乐里"纯四度/大三度"谐和听感的视觉类比。
- **认知层级**：读者靠字号差异（而非死记具体值）判断文本重要级。比例统一保证了层级的**可预测性**——看到大一号字，就知道信息高一级。
- **可伸缩**：比例定义在一处，改一处全站字号体系重调（retuning is one-line change）。

### 2.3 常见字阶表（Web 实践值）

以 16px 基准 + Major Third（1.25）为例：

```css
:root {
  --fs-xs:   13px;   /* 13   —— 辅助说明、脚注 */
  --fs-sm:   14px;   /* 14   —— 次要正文、表单 label */
  --fs-md:   16px;   /* 16   —— 正文 body（基准） */
  --fs-lg:   20px;   /* 20   —— 小节标题 */
  --fs-xl:   24px;   /* 24   —— 卡片/弹窗标题 */
  --fs-2xl:  32px;   /* 32   —— 页级标题 */
  --fs-3xl:  40px;   /* 40   —— hero 大标题 */
}
```

以 Perfect Fourth（1.333）为比的 Web 常用阶：`12, 16, 21.33, 28.43, 37.9, 50.5, 67.3`。

Material Design 3 的**官方 15 级字阶**（尺寸 / 行高 / 字重）是权威参照：

| 类别 | 样式 | 字号 | 行高 | 字重 |
|---|---|---|---|---|
| **Display**（展示） | Large | 57 | 64 | 400 |
| | Medium | 45 | 52 | 400 |
| | Small | 36 | 44 | 400 |
| **Headline**（大标题） | Large | 32 | 40 | 400 |
| | Medium | 28 | 36 | 400 |
| | Small | 24 | 32 | 400 |
| **Title**（标题） | Large | 22 | 28 | 500 |
| | Medium | 16 | 24 | 500 |
| | Small | 14 | 20 | 500 |
| **Body**（正文） | Large | 16 | 24 | 400 |
| | Medium | 14 | 20 | 400 |
| | Small | 12 | 16 | 400 |
| **Label**（标签） | Large | 14 | 20 | 500 |
| | Medium | 12 | 16 | 500 |
| | Small | 11 | 16 | 500 |

组件映射惯例：按钮/芯片 label 用 Label Large（14/500）；卡片正文 Body Medium（14）；卡片标题 Title Medium（16/500）；弹窗标题 Headline Small（24）；输入框文本 Body Large（16）；徽标数字 Label Small（11/12）。

### 2.4 行高与字号比例

**正文行高 = 字号 × 1.4~1.6**，常见 1.5。原因：行高容纳字母上行部（ascender）与下行部（descender），比例过小（<1.3）长文本挤成一团，过大（>1.8）则散。短标题可收紧到 1.2–1.3，长正文用 1.5–1.6。Material 3 的行高表中可见规律：字号 14 → 行高 20（1.43）、16 → 24（1.5）、24 → 32（1.33）、57 → 64（1.12）——**字号越大，行高比越小**（大标题单行为主，不需要高行高；正文需要宽松）。

### 2.5 实现纪律

- 字号用 `rem`（不用 px），尊重用户浏览器字号偏好（WCAG 1.4.4 文本缩放）；**不要用 px 设根字号**。
- 基准保持 1rem = 16px（无障碍）。
- 尺度控制在基准上约 5 级、下 2 级；**一个产品只选一个比例，不混用**。
- CSS 里用变量链式乘法实现（`--step-1: calc(var(--step-0) * var(--ratio))`），比例定义单处。
- 英文 term：font weight 700+ 为 bold，作为"大字"判据（见第 4 节对比度）。

**来源**：
- Material Design 3 Typography / Type scale tokens — https://m3.material.io/styles/typography/type-scale-tokens
- devhexlab, How to Generate a CSS Typography Scale — https://www.devhexlab.com/guides/typography-scale-guide
- devhexlab, Designing with Typographic Scales — https://devhexlab.com/articles/designing-with-typographic-scales
- A Modular Type Scale with CSS Custom Properties — https://www.web-font-optimization.com/typography-fundamentals-system-architecture/type-scale-modular-grids/modular-scale-with-css-custom-properties/
- WCAG 1.4.4 Resize Text — https://www.w3.org/WAI/WCAG21/Understanding/resize-text.html

---

## 3. 设计 token 体系（Design Tokens）

### 3.1 原理定义

设计 token = 把设计决策（颜色、字号、间距、圆角、阴影、动效时长）抽成**具名变量**，作为设计的"单一事实来源"。token 分三层，由底层原始值逐层语义化：

1. **原始/参考 token（Primitive / Reference tokens）**：最原子的值，无依赖。颜色如 `blue-500`、`gray-900`，尺寸如 `--space-4: 16px`，字号 `--fs-md`。**按外观描述命名**（appearance descriptor）。
2. **语义 token（Semantic / System tokens）**：把原始值翻译成"用途"。如 `--color-brand`、`--color-line`、`--color-divider`、`--color-text-primary`、`--color-text-secondary`。**按用途命名**（purpose descriptor）。组件只消费语义 token，不直接碰原始值。
3. **组件 token（Component tokens）**：把语义 token 映射到具体组件的具体部位，如 `--btn-primary-bg`、`--btn-radius`、`--input-h`。Material 3 的命名模式：`md.comp.button.container.height`。

### 3.2 为什么成立

- **语义与实现解耦**：语义 token 是"开关板"（switchboard）——组件只读语义 token，换主题（品牌色/暗色模式）只需重映射语义 token 的原始值，组件代码零改动。
- **一致性由结构保证**：同一用途永远同一 token，杜绝"两处 #333 一个偏蓝一个偏绿"。
- **可审计**：全站设计值收敛到 token 文件，审计裸值（hardcode）只需 grep。
- **Material 3 的对比度配对**：`primary`/`on-primary`、`surface`/`on-surface` 成对出现，保证"任何底色上都有可达标的前景"。

### 3.3 token 组织与命名

Material Design 3 的命名规范：**Namespace → Category → Concept → Property → Variant → State**（如 `acme-color-action-background-primary-hover`）。Web 设计系统常见简化为：

```css
:root {
  /* 颜色：原始 → 语义 */
  --color-gray-50: #F9FAFB;          /* 原始 */
  --color-brand: var(--color-violet-600);   /* 语义 → 原始 */

  /* 间距（见第 1 节） */
  --space-1: 4px;  --space-2: 8px;  --space-4: 16px;

  /* 字号（见第 2 节） */
  --fs-sm: 14px;  --fs-md: 16px;  --fs-lg: 20px;

  /* 圆角 */
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-full: 9999px;

  /* 阴影 */
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.06);
  --shadow-md: 0 4px 8px -2px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.06);

  /* 动效时长与缓动 */
  --dur-fast: 150ms; --dur-md: 200ms; --dur-slow: 300ms;
  --ease-out: cubic-bezier(0.0, 0.0, 0.2, 1);
  --ease-standard: cubic-bezier(0.4, 0.0, 0.2, 1);
}
```

### 3.4 token 层级如何保证一致性

- **禁止组件/页面直接写原始值**：按钮背景用 `var(--color-brand)`，不允许 `#6c5ce7` 出现在组件 CSS。
- **原始值只定义一次**：`src/shared/config.js` / `tokens.css` 是唯一来源，前端构建消费。
- **语义 token 是主题切换的边界**：浅色/深色两套主题 = 两份语义 token 映射表（`--surface-default` 浅色指 `gray-50`、深色指 `gray-950`），组件零改动。
- **规模警示**：组件 token 维护成本高（200 个语义 token 可能膨胀到 2000+ 组件 token）。大多数系统**原始 + 语义两层就够**；需要多品牌/白标/精细化定制时才引入组件层。

**来源**：
- Material Design 3 Color tokens & theming — https://m3.material.io/foundations/design-tokens/overview
- sujeet.pro, Design Tokens and Theming Architecture — https://github.com/sujeet-pro/sujeet.pro/blob/main/content/articles/design-tokens-and-theming/README.md
- Design Token 社区规范（W3C Design Tokens Community Group）— https://www.w3.org/community/design-tokens/
- 经世知途架构契约：单源原则（P4）、token 见 `docs/adr/0004-new-frontend-component-contract.md`

---

## 4. 色彩体系（Color System）

### 4.1 中性色阶（Neutral Scale）的分层用途

中性色（灰阶）承担了 UI 约 **80% 的视觉重量**——背景、分隔线、次要文字、占位符、禁用态。标准是 9–11 级灰阶，最常用 50–900（如 Tailwind/大多数 SaaS）。各段用途有明确分工：

| 档位 | 典型值（Tailwind 系） | 用途 |
|---|---|---|
| gray-50 | `#F9FAFB` | 页面次级背景（subtle surface） |
| gray-100 | `#F3F4F6` | 次级背景、hover 底色、次级按钮 |
| gray-200 | `#E5E7EB` | **默认边框、分隔线**（divider） |
| gray-300 | `#D1D5DB` | 强调边框 |
| gray-400 | `#9CA3AF` | **禁用文字、占位符**（placeholder） |
| gray-500 | `#6B7280` | 三级文字、中性强调 |
| gray-600 | `#4B5563` | **次要文字**（secondary text） |
| gray-700 | `#374151` | 正文（次级深） |
| gray-800 | `#1F2937` | 强调文字 |
| gray-900 | `#111827` | **主文字/标题**（primary text，最深） |

分层逻辑：**越浅越"退后"（背景/边框），越深越"前进"（文字/强调）**。深色模式整体反转（surface 用 gray-950、文字用 gray-100）。

工程要点：
- **不要用纯数学灰**（RGB 相等）——看起来生硬。Apple/Google/Tailwind 都用微暖/微冷灰。
- **品牌色调灰**：在灰阶里掺入 2–3% 品牌色，潜意识里让 UI 与品牌统一（如蓝色调的 slate 灰）。
- 灰阶要**感知均衡**（可用 okLCH/HCT 生成），中段 500 为核心。

### 4.2 语义色（Semantic Colors）

- **成功 success / 警告 warning / 危险 danger / 信息 info** 四件套，各带一个前景配对。
- 危险色（如 `#D93025` 红、Material error `#B3261E`）专用于破坏性操作/错误；警告黄用于注意；成功绿用于正向反馈。**语义色必须通过语义 token 使用**（`--color-danger`、`--color-warning`），不可裸写品牌色当警示。
- 组件状态色（hover/active/disabled 底色）建议用**同色系叠层（state layer）**：在品牌色上叠透明黑/白，而不是另造色值。Material 3 的做法是 `primary` 上叠 `on-primary` 透明层（hover 8%、focus 12%、pressed 12%）。

### 4.3 色彩对比度：WCAG 标准

对比度是**可访问性的硬指标**，也是"文字能否被看清"的物理事实：

| 场景 | 最小对比度 | 依据 |
|---|---|---|
| 正文、按钮、链接、label（常规文字） | **4.5:1** | WCAG 2.x SC 1.4.3（AA） |
| **大字**（≥24px 常规，或 ≥19px/18.5px 且字重 700+ 加粗） | **3:1** | 同上（大字号例外） |
| UI 组件边框、图标、图形对象 | **3:1** | WCAG SC 1.4.11（非文本对比度） |
| AAA 级：常规文字 / 大字 | 7:1 / 4.5:1 | WCAG SC 1.4.6 |

对比度公式：`(L1+0.05)/(L2+0.05)`，L 为相对亮度（luminance），范围 1:1~21:1。**4.499:1 就是不合格**。未指定背景时按白色判定。豁免项：logo、纯装饰、禁用态组件、incidental text。

工程要义：**"背景-内容"必须有明确的层级划分**——正文与背景 ≥4.5:1，次要文字可以更低但仍是可读灰（600 阶对白底约 7:1，占位符 400 阶对白底约 3.6:1 但占位符语义非关键信息）。设计时可用工具（Figma 对比度插件、`material-color-utilities`）自动校验。

### 4.4 色彩科学：HCT 与色调调色板（M3 的现代化方案）

Material Design 3 用 Google 自研的 **HCT 色彩空间**（Hue 色相 / Chroma 彩度 / Tone 明度）替代 HSL：
- **Hue** 来自 CAM16 色貌模型（感知准确）；**Tone** 基于 CIELAB 的 L*（感知明度）——**"任意色相的 tone 40 感知亮度相同"**，这是 HSL 做不到的。
- 色调调色板（tonal palette）= 同 hue、同 chroma、tone 从 0 到 100 的渐变（标准 13 档：0,10,20,30,40,50,60,70,80,90,95,99,100）。
- 从种子色生成 5 条调色板（Primary/Secondary/Tertiary/Neutral/Neutral Variant），再映射到 29 个语义角色（primary、on-primary、surface、outline...），**成对选择保证可达标对比度**。
- 工程上不必自研 HCT，但理解它 = 理解"**明度（tone）是可达性的主杠杆**：tone 差越大对比度越高"。选色时，控制 tone 差比纠结色相更关键。

**来源**：
- WCAG 2.1 SC 1.4.3 Contrast (Minimum) — https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
- WCAG Technique G145 (3:1 large text) — https://www.w3.org/WAI/WCAG21/Techniques/general/G145
- colorarchive.org, Building Neutral Color Palettes for Design Systems — https://colorarchive.org/guides/neutral-color-palette-guide/
- Material Design 3, The color system (HCT) — https://m3.material.io/styles/color/the-color-system/color-roles
- material-color-utilities（HCT 开源实现）— https://github.com/material-foundation/material-color-utilities

---

## 5. 组件状态层次（Component State Hierarchy）

### 5.1 原理定义：状态层级树

每个可交互组件都是一个**状态层级树**：根是全局状态（disabled/loading），向下是交互状态（hover/focus/active/selected），叶子是具体子层（涟漪、箭头位移、文字色过渡、图标动效）。核心思想：**状态是树的根，动效是树的叶子；根被禁用，整棵树全部停止**。任何"状态 A 下子层 B 仍在动/仍可点/仍变色"都是特例 bug。

状态的视觉规则（以按钮为例，六态）：

| 状态 | 触发 | 视觉规则 |
|---|---|---|
| **Default（enabled）** | 常态 | 完整色 + 完整对比度，有明确可点击语义（胶囊形、填充/描边） |
| **Hover** | 鼠标悬停（无触屏） | 轻微"抬升"：底色加深/叠加状态层、可有轻阴影。**键盘用户永远看不到 hover**，所以 hover 不能是唯一反馈 |
| **Focus** | Tab 键盘 / 程序聚焦 | 必须有**清晰的焦点环**（focus ring）——高对比（对相邻 ≥3:1）、2–3px 粗、**外偏**（outline-offset 2px，不与按钮边缘贴合） |
| **Active（Pressed）** | 按下瞬间 | "按进去"：更暗、可轻微内缩（translateY(1px)），配 100ms 内即时反馈 |
| **Disabled** | 不可用 | **整体降级**：降透明度 + 去指针样式（cursor 默认）；不可聚焦、不可 hover、无涟漪、无箭头动效。Elisa 设计系统还提醒：能避免则避免 disabled——表单校验前最好用错误提示而不是禁用按钮 |
| **Loading** | 提交中 | 禁用交互 + 显示进度（spinner/骨架），文字可保留可替换为"处理中"；必须有在途守卫（busy 锁）防重复提交 |

### 5.2 为什么 disabled 要"整体降级"（层级树思想）

- **认知一致性**：disabled = "此路不通"，必须一眼可辨、且**任何子元素都不该显得可交互**。若一个灰按钮的箭头还在 hover 下位移，用户会困惑"它到底能不能点"。
- **层级树纪律**：disabled 是最高优先级状态，必须**从根到叶整体压制**。CSS 上即：`.is-disabled` 禁掉全部 `animation/transition`，hover/focus 规则全部加 `:not(.is-disabled)` 守卫。
- **loading 同理**：loading 期按钮整体不可再触发（busy 锁），不是只改文字。

### 5.3 焦点可见性（focus-visible）

这是现代 Web UI 最被低估的可访问性细节：

```css
/* 鼠标用户不显示焦点环 */
button:focus { outline: none; }
/* 键盘用户必须显示高对比焦点环 */
button:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;   /* 外偏，不与元素边缘贴死 */
}
```

- `:focus-visible` 只在键盘/程序聚焦时生效，鼠标/触屏不打扰视觉。
- **焦点环设计要求**：对比 ≥3:1、2–3px 粗、外偏 2px、全站所有可交互元素一致。
- **红线**：`outline: none` 而无替代 = 可访问性违规（WCAG 2.4.7 Focus Visible）。
- **常见错误**：只做 hover 不做 focus（或反之）——它们是不同用户的不同状态。
- 图标按钮必须有 aria-label/tooltip；弹窗关闭后焦点要还回触发元素。

**来源**：
- web.dev, Building a button component（:focus-visible 最佳实践）— https://web.dev/articles/building/a-button-component
- WCAG 2.2 SC 2.4.7 Focus Visible — https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
- WAI-ARIA Authoring Practices 1.2, Button Pattern — https://www.w3.org/WAI/ARIA/apg/patterns/button/
- Elisa Design System（disabled 建议）— https://designsystem.elisa.fi/
- DXC Halstack Button specifications — https://developer.assure.dxc.com/halstack/6/components/button/specifications/

---

## 6. 动效原则（Motion Principles）

### 6.1 时长：分层级，不是一刀切

Material Design 3 的时长分级（按交互类型）：

| 类型 | 时长 | 例子 |
|---|---|---|
| 微交互（Micro-interaction） | **50–100ms** | 涟漪、状态切换、hover 反馈（essential feedback 应 <100ms） |
| 短（Short） | **100–200ms** | 简单过渡、开关切换、单元素显隐（opacity+轻 scale） |
| 中（Medium） | 200–300ms | 展开/折叠、内容揭示 |
| 长（Long） | 300–500ms | 复杂编排、页面过渡 |

按设备：桌面 **150–200ms**（更快更直接）；移动 300ms 基线；平板 +30%（~390ms）；可穿戴 -30%。**同一个动效不要全站一个固定时长**——按位移距离、元素尺寸、表面变化动态调整。

业界共识的"甜点区"：**状态切换 ~150ms；进出场 200–250ms；点赞类反馈 ~150ms + 轻微 scale；>400ms 感觉拖沓；<100ms 几乎不可感知**。

### 6.2 缓动曲线（Easing）：物理感来自不对称

**禁止线性动效（linear）**——线性看起来机械（如机器人）。缓动的核心是**加速度不对称**：

| 曲线 | 语义 | CSS cubic-bezier | 用法 |
|---|---|---|---|
| **Standard** | 标准（ease-in-out） | `cubic-bezier(0.4, 0.0, 0.2, 1)` | 元素在屏内移动、放大缩小（最常用） |
| **Decelerate** | 减速（ease-out） | `cubic-bezier(0.0, 0.0, 0.2, 1)` | 元素**进入**：全速冲入再慢停 |
| **Accelerate** | 加速（ease-in） | `cubic-bezier(0.4, 0.0, 1, 1)` | 元素**永久离开** |
| **Sharp** | 急停 | `cubic-bezier(0.4, 0.0, 0.6, 1)` | 元素暂时离开（还会回来） |
| **Emphasized** | 强调（M3） | `cubic-bezier(0.2, 0.0, 0.0, 1.0)` | 重要过渡 |

关键：**进场用 ease-out（快进慢停）、离场用 ease-in（慢起快走）**。人脑对"进来的东西"期望它迅速到位，对"离开的东西"期望它干脆走掉。平台对应：iOS `CAMediaTimingFunction`；Material 有 `duration.shortest=150`、`duration.shorter=200` 常量。

### 6.3 动效层级：功能性动效 vs 装饰动效

- **功能性动效（Functional）**：传达状态变化、空间关系、结果——按钮按压、下拉展开、弹窗出现、表单错误。**必须快速（150-200ms）、克制的反馈**，优先级最高。
- **装饰性动效（Decorative）**：品牌氛围——滚动浮现、hover 涟漪、渐变流动。可以有，但必须：不阻碍任务、可被 reduced-motion 关闭、不喧宾夺主。
- 编排技巧：相关元素 **stagger 20–40ms** 依次入场，制造协调感；避免全屏大幅移动（诱发眩晕）。

### 6.4 prefers-reduced-motion（无障碍硬要求）

- `@media (prefers-reduced-motion: reduce)` 检测用户系统"减少动态"偏好（macOS 辅助功能→显示→减弱动态）。全球超过 7000 万人有前庭障碍，运动可诱发眩晕/偏头痛/癫痫。
- **"reduce" ≠ "none"**：功能必需的动效（进度指示、状态反馈）保留；非必需动效关闭或降级（用 fade 替代 scale+move、缩短时长）。
- 工程推荐：**先写静态/减少态样式，再在 `no-preference` 下增强动效**。用 `animation-duration: 0.001ms` 兜底方案可行但推荐逐组件精修（配合 CSS Cascade Layers 免 !important）。
- JS 驱动动效用 `matchMedia('(prefers-reduced-motion: reduce)')` 判断。
- 相关 WCAG：SC 2.3.3 Animation from Interactions（技术 C39 CSS / SCR40 JS）。

**来源**：
- Material Design 3 Motion, Duration & easing — https://m3.material.io/styles/motion/duration-easing
- Material Design, Duration & easing（旧版详表）— https://m1.material.io/motion/duration-easing.html
- WCAG Technique C39（prefers-reduced-motion CSS）— https://www.w3.org/WAI/WCAG22/Techniques/css/C39
- MDN, Using media queries for accessibility — https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- CSS-Tricks, prefers-reduced-motion almanac — https://css-tricks.com/almanac/properties/m/motion-reduced/

---

## 7. 组件库规范（Component Library Specs）

### 7.1 触控目标（Touch Target）：物理手指的硬约束

- **Apple HIG**：交互元素命中区（hit region）最小 **44×44pt**；按钮中心间距至少 **60pt**（防误触）。
- 这是物理依据：指尖平均接触面积 ~10mm，44pt ≈ 11.7mm，是可靠点按的下限。图标可以视觉上 20×20，但命中区必须扩到 44×44（用 padding/伪元素扩大热区）。
- 触屏上 hover 不存在，所以移动端必须有 focus/active 即时反馈替代。

### 7.2 按钮（Button）

**Material Design 3 Expressive 尺寸档**：

| 档位 | 高度 | 场景 |
|---|---|---|
| Extra Small | 32 | 紧凑工具栏 |
| **Small（默认）** | **40** | 标准界面 |
| Medium | 48 | 提升显著性 |
| Large | 56 | 高强调动作 |
| Extra Large | 64 | hero 主行动 |

- 圆角：M3 默认**全圆角（胶囊）**，20dp；通用 shape token 档位 extraSmall=4、small=8、medium=12、large=16。
- 内距：label 距边缘 ≥16px（横向）；图标与文字间距 8px。
- 变体层级（强调度从高到低）：Filled（实心，最强调，0dp 阴影）→ Tonal（色调面）→ Outlined（描边）→ Text（纯文字）。**同一页面用一主一辅**，不要所有按钮同等强调。
- 文字按钮 label 用 Label Large（14/500）；`padding-inline: 24px`（大按钮 24–32px）。

### 7.3 输入框（Text Field）

- **Material 3 标准输入框容器高 56px**（Outlined/Filled），密度变体 52/48/40。Web 实践常用 40–48px（紧凑用 36–40）。
- 苹果生态实践：输入框高 44–48pt（与触控目标一致）。
- 圆角：Outlined 4dp（M3）；Web 常见 6–8px。
- 内部：文字 Body Large（16）；label 浮动到顶部；边框在 focus 时换主题色 2px；错误态换 error 色 + 错误文字。
- **必填/选填标记**：必填红色星号 `*`、选填黄色/灰色星号 `*`，作为文字字符而非图标（用户心智 = 星号字符）。

### 7.4 弹窗（Dialog / Modal）

**Material 3 官方规范（Basic Dialog）**：

| 属性 | 值 |
|---|---|
| 容器宽 | 最小 280dp，最大 **560dp** |
| 圆角 | **28dp**（大圆角，弹窗是大表面） |
| 内距 | 四周 **24dp** |
| 标题↔正文 | 16dp |
| 正文↔操作区 | 24dp |
| 按钮间距 | 8dp |

- 全屏对话框：圆角 0、头高 56dp、内距 24/8。
- Web 常识补充：桌面弹窗常用 max-width 560px（= M3），窄屏下应自动收窄并允许垂直滚动（`max-height: calc(100dvh - 32px)` + `overflow-y:auto`）。
- 圆角规律：**大表面大圆角**（弹窗 12–28、卡片 8–16、按钮/输入 4–8、小元素/胶囊 full）。

### 7.5 圆角档位通用表（Radius Scale）

`2 / 4 / 6 / 8 / 12 / 16 / 24 / full` 是常见档位，按元素尺寸选：

| 元素类型 | 圆角 |
|---|---|
| 标签、徽标、tooltip、图标按钮 | 2–4（或 8） |
| 按钮、输入框、下拉 | 4–8（M3 默认胶囊 full） |
| 卡片 | 8–16 |
| 弹窗、抽屉、sheet | 12–28 |
| 头像、开关、FAB、胶囊按钮 | full（9999） |

**嵌套圆角公式**：外层圆角 = 内层圆角 + padding（即 `inner = outer - padding`），保证两层曲线视觉平行不"夹瘪"。例：外容器 24 圆角 + 12 padding → 内子件用 12 圆角。

### 7.6 阴影/抬升（Elevation）

- M3 抬升 = **阴影 + 色调抬升（tonal elevation）**双层：阴影表达空间深度，色调抬升（surface 上叠亮度变化）在暗色模式下替代阴影。
- 档位：level0（无）→ level5；常用 level1（1dp，悬浮卡片）→ level3（6dp，弹窗/抽屉）。填充按钮 0dp（不抬升），悬浮按钮 1dp。
- Web 实践：`--shadow-sm`（1px 轻边）、`--shadow-md`（4px 主）、`--shadow-lg`（8–12px 弹窗）。**阴影越重元素越"高"**——与层级对应，同一时刻同层元素阴影一致。
- 阴影用 2 层以上（近景硬 + 远景软）更自然。

**来源**：
- Material Design 3 Components（Button / Text field / Dialog / FAB specs）— https://m3.material.io/components
- Material Design 3 Dialog specs — https://m3.material.io/components/dialogs/specs
- Material Design 3 Elevation — https://m3.material.io/styles/elevation/overview
- Apple HIG, Buttons — https://developer.apple.com/design/human-interface-guidelines/buttons
- Apple HIG, Layout（touch target 44pt）— https://developer.apple.com/design/human-interface-guidelines/layout
- Radius token 案例：Nucleus / 7onic / Usertesting — https://design.productboard.com/latest/foundations/design-tokens/dimensions/border-radius ; https://7onic.design/design-tokens/radius ; https://design-system.usertesting.com/latest/utility-classes/radii

---

## 8. 响应式与断点（Responsive & Breakpoints）

### 8.1 常见断点体系

`375 / 768 / 1024 / 1440` 映射主流设备类别：

| 断点 | 设备 | 布局 |
|---|---|---|
| 375px（及以下） | 手机竖屏（iPhone SE/8/13、Pixel） | 单列（**"酸测试"酸度最高**） |
| 768px | 平板竖屏（iPad） | 双列 |
| 1024px | 平板横屏/小笔记本 | 双~三列 |
| 1440px | 主流笔记本（MacBook Pro 等） | 三~四列 |
| 1920px | 大屏 | 更多列/更宽内容区 |

对应 Chrome DevTools 设备模式（Mobile M:375 / Tablet:768 / Laptop:1024 / Laptop L:1440）。框架值略异：Tailwind `sm:640 md:768 lg:1024 xl:1280 2xl:1536`。

### 8.2 移动优先（Mobile-First）

- **核心手法：先写移动端基础样式，再用 `min-width` 媒体查询逐级增强**（progressive enhancement），而非用 `max-width` 从桌面收缩：

```css
/* 移动基础样式在前 */
.container { width: 100%; padding: 1rem; }
/* 逐级增强 */
@media (min-width: 768px)  { .container { padding: 2rem; } }
@media (min-width: 1024px) { .container { max-width: 1024px; margin-inline: auto; } }
```

- 为什么：①移动用户只下载核心 CSS（性能）；②与 Google 移动优先索引（Mobile-First Indexing）一致；③强制你先把"最重要的内容"想清楚。
- **断点应由内容驱动**：设备尺寸不断变，别死记数字；当布局开始破（挤压、溢出、留白失衡）的地方就是断点。375/768/1024/1440 只是常见自然破裂点。

### 8.3 响应式布局纪律

- 列数演进：移动 1 列 → 平板 2 列 → 桌面 3–4 列；导航在 <1024 折叠为汉堡菜单。
- 测试清单：任何宽度下**无横向滚动条**、文字可读、触控目标 ≥44px、图片不溢出不变形。
- **可滚动组件的容器规范**：
  - 横向滚动（横廊/图表）：容器 `overflow-x: auto` + `scroll-snap-type: x proximity`；**不要劫持页面滚轮**（wheel 劫持会让用户滚不过去——见本项目 AK 修复教训）；保留拖动/触摸 + 边缘渐变遮罩。
  - 垂直滚动浮层：`max-height: calc(100dvh - 32px)` + `overflow-y: auto` + `overscroll-behavior: contain`（阻止滚动链穿到页面）。
  - 视口单位用 `dvh`（动态视口高，正确处理移动端 URL 栏收缩），慎用 `100vh`。
- 间距随屏宽缩放：移动端页面侧边距 16px，桌面可到 24–48px（也可用 `clamp()` 流式）。

**来源**：
- Compound Design System, Responsive design — https://compound.thephoenixgroup.com/latest/guidelines/foundations/responsive-design
- media-query-sizes（375/768/1024/1440 表）— https://www.npmjs.com/package/media-query-sizes
- Tailwind CSS Responsive Design — https://tailwindcss.com/docs/responsive-design
- MDN, Using media queries — https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_media_queries/Using_media_queries

---

## 9. 落地自查清单（把理论变成 token）

把以上规范落成经世知途可执行的最小集：

1. **间距**：`--space-1..6 = 4/8/12/16/24/32`，全部间距从表取，禁止裸值。
2. **字号**：`--fs-xs 13 / sm 14 / md 16 / lg 20 / xl 24 / 2xl 32 / 3xl 40`，用 rem；行高正文 1.5、标题 1.2–1.3。
3. **token 三层**：原始（颜色/尺寸）→ 语义（`--color-brand/--color-line/--color-divider/--color-text-primary/secondary/--surface-*`）→ 组件（`--btn-h/--input-h/--radius-*`）；组件只消费语义层。
4. **灰阶**：gray-50..900 分段分工（背景/边框/禁用/次要/主文字），含品牌调。
5. **对比度**：正文 ≥4.5:1、大字 ≥3:1、边框图标 ≥3:1；深色模式整体反转语义映射。
6. **状态层级树**：disabled > loading > active > hover > focus > default；disabled 整体停动效；`:focus-visible` 焦点环 2px 外偏 ≥3:1。
7. **动效**：微交互 150ms、进出 200–250ms、页面 300–400ms；ease-out 进场/ease-in 离场；`prefers-reduced-motion` 降级非禁用。
8. **组件数值**：按钮 40–48px、触控 ≥44px、输入框 40–48px、弹窗 max-width 560px 圆角 12–28、卡片圆角 8–16、小元素 4–8。
9. **响应式**：min-width 移动优先；断点 375/768/1024/1440；滚动容器 `max-height: 100dvh-32px` + contain；横廊不劫持滚轮。

---

*本文档为设计美学调研产出，供"经世知途"新前端重构团队自学与对照；主会话整合后与 `docs/adr/0004-new-frontend-component-contract.md`、设计 token 表衔接。*
