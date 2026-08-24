# 设计美学基础（Design Aesthetics Foundations）

> 面向「经世知途」信息门户平台前端重构团队的自学补课文档。本文档由两份调研草稿整合而成：
>
> - **平面设计篇**（`docs/design-aesthetics-平面设计.md`）——讲**为什么成立**的感知科学：瑞士网格、格式塔、视觉层级、CRAP、留白、黄金比。来源标记为 **[平面]**。
> - **网页 UI 篇**（`docs/design-aesthetics-网页UI.md`）——讲**怎么用**的数值规范：间距系统、Type Scale、设计 token、组件状态、动效、组件库数值、响应式。来源标记为 **[UI]**。
>
> 两份草稿有重叠的主题（色彩体系、字阶、对比度数值、间距网格）已**去重合并为单章**，保留各自独特内容互补。目标不是给你一百条零散技巧，而是把现代设计背后**为什么成立**的感知科学、以及**怎么用**的可操作规则，体系化地讲透。读完你应当能自己判断"一个界面为什么看起来对 / 不对"，并把它翻译成设计 token 与组件契约。
>
> 术语保留英文原名（如 Gestalt / Type Scale），中文为其解释。每章末尾列引用来源 URL（w3.org、Material / Apple HIG、权威设计文献与教程）并标注来源归属；文末有全量汇总。

---

## 第一章 总纲：设计有"对错"，因为人类的视觉系统有确定的运作方式

### 1.1 设计为什么有对错

很多人觉得"审美"是玄学——有人觉得好看、有人觉得不好看。但从认知科学看，**人类视觉系统对信息的加工有相当确定、可预测的规律**，优秀的设计本质上是顺应这些规律，糟糕的设计则是违背它们。这就是为什么平面设计教学（从包豪斯到瑞士学派到今天的 Material Design）能沉淀出一套可传授的"原理"，而不是各说各话。[平面]

### 1.2 视觉加工三阶段

视觉加工大致分三个阶段：

1. **前注意加工（Pre-attentive Processing）**：大脑在 200 毫秒内、无需刻意注意就能提取的基本特征——大小、颜色、朝向、运动、形状。这是"一眼看到重点"的生理基础，也是"对比"和"视觉层级"为什么有效的根因。
2. **注意分配与分组（Attention & Grouping）**：意识开始"读"页面时，大脑会先自动把元素**分组**（这就是格式塔 Gestalt 原则），再按重要性排序（这就是视觉层级）。
3. **语义理解（Semantic Processing）**：最后才真正读文字、理解内容。在这之前，版式的"骨架"已经被感知完毕了。

这三个阶段的推论是：**用户在看懂内容之前，就已经"喜欢"或"不喜欢"了你的版式。** 网格、留白、对齐、色彩配比——它们作用于前两个阶段，决定用户是否愿意进入第三个阶段。[平面]

### 1.3 为什么需要设计系统

从工程角度看，设计系统解决三个根本问题：[UI]

1. **认知一致（Consistency）**：用户在一个页面学到的东西，在另一个页面必须依然成立。"这个紫色是按钮，点击有反应"——如果另一个紫色只是装饰，用户就学错了。一致性让用户把注意力留给内容，而不是重新学界面。
2. **决策成本（Decision cost）**：设计师和工程师都面临无数微观决策（这个间距 14 还是 16？这个圆角 6 还是 8？）。设计系统把决策从"每次重新拍脑袋"变成"查表"，既快又稳。正如 8pt 网格的倡导者所说："你减少了可 fiddling 的空间，也就减少了通往代码的速度。"（reduce the amount of fiddling, reduce speed to code）
3. **变更可规模化（Scalable change）**：改品牌色、切暗色模式、换主题——如果颜色散落在 3000 处硬编码里，改一处漏九处；如果都收敛到 token，改一个变量全站生效。这就是 token 体系的工程价值。

### 1.4 贯穿全文的总原则

把两个视角串成一句工程箴言：[平面 · 结语]

> **先有系统，再有视觉；先有节奏，再有焦点。**

- **网格 + 对齐 + 邻近** 决定"结构"：所有元素落在可预期的位置，相关成组、无关分开。
- **重复 + 中性色阶 + Type Scale + 间距 token** 决定"统一"：一套 token 全站消费，禁止裸值、禁止特例。
- **对比 + 留白 + 强调色稀缺** 决定"焦点"：层级果断（1.5 倍 / 4.5:1 / 强调色 ≤10%），重点周围留白。
- **比例（黄金比与音乐间隔）** 决定"比例语气"：展示型页面大气，任务型页面紧凑。

或者用网页 UI 篇的话说：**美学不是玄学，是"符合人类感知规律 + 消灭任意性"的工程**。好的界面不是"好看"，而是"可预测、有层级、不耗脑"。设计系统（design system）的价值 = 用"少数规则"约束出"大量一致"。[UI]

在「经世知途」的工程语境里，这些原理的直接落点就是：**设计 token 文件（颜色/字号/间距/圆角/动效时长的单源）、组件契约（每个组件的状态层级树 disabled > loading > active > hover > focus > default，见第七章）、以及"全站零裸值零特例"的架构纪律**。用户反复抱怨的"特例、参差、灰化、数据泄露"，几乎全部可以归因为：**没有把上面某一章的原理落成 token 化的系统约束**。

### 1.5 来源

- [平面] 视觉加工三阶段；[UI] 设计系统三问题；[平面 · 结语] 工程箴言。

---

## 第二章 平面设计原理

> 本篇是"原理课"：每一节讲一个现代平面设计流派的原理、它在感知上为什么成立、以及可操作的规则。网页 UI 的具体数值规范（间距 token、字阶、色彩体系）在第三~五章，本篇负责它们背后的"为什么"。

### 2.1 瑞士/国际主义排版与网格系统（Swiss / International Typographic Style & the Grid）

#### 2.1.1 定义与历史

瑞士/国际主义排版是 1950 年代在苏黎世（Josef Müller-Brockmann）与巴塞尔（Armin Hofmann）两所瑞士工艺美术学校发展出的设计运动，继承包豪斯、构成主义（Constructivism）、De Stijl 等现代主义传统。它的核心理念可以用 Müller-Brockmann 的话概括：[平面]

> 设计应当"通过客观、非个人化的呈现，追求绝对的、普适的图形表达"——**压制设计师的主观情绪，让内容自己说话**。

它的形式特征：无衬线字体（sans-serif）、非对称构图、数学化的网格、照片而非插画、极简配色。今天你看到的大多数 SaaS 后台、科技公司官网的"干净感"，直接承袭这条脉络。

#### 2.1.2 网格系统：为什么网格让版式"看起来对"

网格（Grid）是这个流派的灵魂。Müller-Brockmann 在《平面设计中的网格系统》（*Grid Systems in Graphic Design*, 1981）里写道：[平面]

> "网格是一个组织系统，让你能以最低成本得到有秩序的结果。问题被解决得更简单、更快、更好。"

**为什么网格有效——认知依据：**

- **一致性降低搜索成本**：人类的视觉系统在扫描页面时会利用"位置记忆"——上次在这块区域找到的东西，下次还会去同样位置找。网格让所有内容落在固定的、可预期的位置，用户不必每屏重新学习布局。这对应界面设计的**一致性与可学习性**原则。
- **对齐减少视觉噪声**：当元素的边缘彼此对齐时，眼动是平滑的、可预测的；当元素参差散落时，眼球被迫不断跳变。格式塔的"连续律"（2.2.5）解释了为什么平滑路径比断裂路径更省力。
- **网格 = 隐含的节奏**：音乐有节拍，版式有节奏。网格的等距间隔让大脑感到"规律"，规律即秩序感；秩序感在感知上等于"可信、专业"。

**一个反直觉但重要的点**：网格的目的是**让设计师不必每次重新做决定**。它把"这里该放哪"从每次的直觉判断，变成一次性的系统决定。这样设计师的精力留给真正需要判断的地方（层级、语气、内容重点），而不是重复纠结边距。

#### 2.1.3 网格的类型

| 类型 | 说明 | 典型用途 |
|---|---|---|
| 栏网格 Column Grid | 页面纵向切成若干栏，内容跨栏或不跨栏 | 文章页、新闻站（12 栏系统最常见） |
| 基线网格 Baseline Grid | 以正文行高为最小单位，所有元素（含图片）都对齐到这些水平线 | 出版物、长文排版 |
| 模块化网格 Modular Grid | 纵向栏 × 横向行组成网格单元，内容按单元组合 | 卡片型界面、仪表盘 |
| 层级网格 Hierarchical Grid | 按内容关系自由分栏，不强制等宽 | 杂志、复杂信息页 |

#### 2.1.4 可操作规则

- **栏数选择**：内容型页面用 **12 栏**（12 可被 2/3/4/6 整除，组合最灵活，Bootstrap、Material 均以此为基）；展示型页面可用 4 或 8 栏。栏越多，排版自由度越高，但单栏宽度变窄。
- **统一间距系统（8pt 网格）**：所有 margin / padding / gap 取 **8px 的整数倍**（8/16/24/32/48/64…）。为什么是 8？8 是 4 的倍数、能被大多数屏幕宽度整除、且 8px 在 1x/2x/3x 设备上都对齐像素。它比黄金比例（2.6）在 UI 中**实际更常用、更可靠**。（8pt 的完整数值论证见第五章间距系统。）
- **正文文本区宽度**：按行长 45–75 字符控制（见 4.2），CSS 对应 `max-width: 65ch` 左右。
- **页边距（margin）**：从大到小提供一组预设（如 24/16/8），禁止随机填数字。
- **非对称构图**：瑞士学派反对居中。把重点内容偏置（如左上），利用留白制造张力，比居中更"现代"、更不呆板。
- **画了网格线再看**：切到浏览器开发者工具给页面叠加网格参考线，检查每个元素是否落在网格上。**只要有一个元素悬空，整体"不对"的感觉就出现了**。

#### 2.1.5 例子

- **经世知途**：卡片型教师广场、需求广场，就是模块化网格的典型——每张卡片占 3 或 4 栏，卡片内所有间距吃 8pt 系统。用户反馈的"卡片列无动效、遮罩方向错误、第三下拉栏留空不够"（AK-N-C2），本质是**间距没走统一系统、元素悬空不落网格**。
- Müller-Brockmann 的「Musica Viva」音乐会海报：几何网格 + 无衬线大字 + 非对称留白，是"网格即秩序"的教科书。

#### 2.1.6 来源 [平面]

- Müller-Brockmann, *Grid Systems in Graphic Design*（《平面设计中的网格系统》）
- Britannica, [International Typographic Style](https://www.britannica.com/art/graphic-design/Graphic-design-1945-75)
- 99designs, [What exactly is Swiss Design, anyway?](https://99designs.com/blog/design-history-movements/swiss-design/)
- MIT 6.831/6.813 课程, [Layout](https://web.mit.edu/6.813/www/sp16/classes/15-layout/)

---

### 2.2 格式塔设计原则（Gestalt Principles）

#### 2.2.1 总纲：整体大于部分之和

格式塔心理学（Gestalt psychology）由 Max Wertheimer 等人在 20 世纪初创立。它的核心发现是：**人类感知不是先认识零件再拼整体，而是先感知整体，再在整体框架里理解零件。** 那句常被引用的"整体大于部分之和"（The whole is greater than the sum of its parts），在视觉上意味着：当你看到一堆圆点时，你**首先**看到的是它们的排列模式，而不是逐个圆点。

格式塔还有一个总原则叫 **Prägnanz（完形律 / 好形原则）**：大脑总是倾向于把视觉信息解释成**最简单、最稳定、最规则**的那个形态。这解释了为什么我们能从三条断线里"看出"一个三角形、从虚线里"看出"一个圆——大脑在自动补全。

**对 UI 的意义**：界面设计本质上是在操控用户的分组方式。你希望相关的东西被分成一组、不相关的东西被分开，格式塔给的就是这些"分组开关"。[平面]

#### 2.2.2 邻近（Proximity）

**原理**：在空间上彼此靠近的元素，会被感知为属于同一组。

**认知依据**：这是最原始的、几乎是物理层面的分组依据——物体在空间上接近，在现实世界里通常意味着它们属于同一对象或同一功能。视觉系统把这个物理规律带进了抽象界面。

**可操作规则**：
- 同一组内部间距 < 组与组之间间距。这条规则的量纲很明确：**组内 gap 与组间 gap 必须能一眼区分**（例如组内 8px、组间 24px，差 3 倍）。
- 表单字段与它的标签要近（标签紧贴输入框），而与下一个字段远——这是"字段归属"是否清晰的判定标准。
- 标题与它统领的内容要近，与它上面的上一段要远。

**典型误用**：把间距用成装饰性的随机数，导致"标题离上面的内容比离它自己的内容还近"，读者分组就错了。

#### 2.2.3 相似（Similarity）

**原理**：在颜色、形状、大小、字号、图标等特征上相似的元素，会被感知为同一类。

**认知依据**：视觉系统用特征匹配来快速归类——"长得一样的，多半是同一类东西"。这是分类的自动捷径，前注意加工阶段就完成。

**可操作规则**：
- **相似的元素要有相似的行为**。长得像按钮的东西就必须能点；长得像链接的就应该跳转。这既是格式塔，也是可预期性原则。
- 用颜色给"状态"统一编码：成功绿、警告黄、错误红、链接蓝——同类状态全站同色，用户学会一次，全站受益。
- 列表里不同层级的内容用大小/字重区分，而不是靠换一种"感觉差不多"的灰色——"差不多但不一样"是最糟的状态（见 CRAP 的对比原则）。
- 图标、按钮、卡片这些"组件类别"要分别有统一的视觉签名（同尺寸、同圆角、同色），否则界面会像拼盘。

#### 2.2.4 闭合（Closure）

**原理**：大脑会补全不完整的轮廓，把它感知成完整的图形。WWF 熊猫标志是经典例子——线条断断续续，但你看得出熊猫。

**认知依据**：这是 Prägnanz 的直接体现——大脑宁愿"脑补"一个完整规则形，也不愿承认一堆无意义的碎片。补全能力让视觉加工更省力。

**可操作规则**：
- **可以在边界处"断线"**：卡片之间的分隔不一定要画实线框，用留白 + 背景色阶差就能"闭合"出卡片轮廓，界面更轻。
- **遮罩/覆盖**：弹窗盖在页面之上，用户自动把露出的边缘补全为"整个页面还在后面"——所以半透明遮罩（scrim）能同时传递"有上下文"和"当前焦点在弹窗"两个信息。
- 闭合也能被滥用：如果留白太大、间距失当，用户会"补全"出本来没有的分组。所以间距系统（第五章）是闭合正确工作的前提。

#### 2.2.5 连续（Continuity / Good Continuation）

**原理**：沿平滑曲线或直线排列的元素，会被感知为一条连续的路径，而不是一堆断点。

**认知依据**：眼动系统喜欢平滑轨迹。两条交叉的线，你会看成"两条直线交叉"，而不是"四条线段在一个点碰头"——因为前者更简单、更连续。神经层面，视觉皮层对连续轮廓的响应比对断裂轮廓更强。

**可操作规则**：
- **对齐即连续**：左对齐的列表、同一条基线网格上的文字，天然形成"连续路径"，眼睛可沿它快速扫读。这就是为什么"一切元素必须有对齐依据"（CRAP 的 Alignment）在认知上成立。
- **引导路径**：想让视线从 A 走到 B，就让 A→B 之间有平滑的视觉连接（箭头、指向性图形、递进的层级），不要让人在断点处迷路。
- 栅格布局本质就是把"连续"系统化：列与列、行与行对齐，整页视线可预期地流动。

#### 2.2.6 对称与均衡（Symmetry & Balance）

**原理**：对称的元素被感知为一个整体；视觉上"均衡"的构图让人感到稳定。

**认知依据**：人脑偏爱对称——对称在自然中通常是健康、安全的信号；同时大脑处理对称信息更省力（只需处理一半再镜像）。这里的"均衡"不只是严格的镜像对称（formal symmetry），也包括**非正式均衡（informal balance）**：左侧一个大元素 + 右侧两个小元素，视觉重量相等。

**可操作规则**：
- 弹窗、卡片这类"容器"用严格对称（居中、等宽），传达稳定。
- 页面整体构图用非正式均衡：一侧重色/大块，另一侧用多块浅色/小块补足。判断方法：**闭眼再看一眼，感觉页面是否"向一边倒"**。
- **视觉重量 ≠ 面积**：深色比浅色重、大块比小块重、高对比比低对比重、复杂纹理比纯色重。做均衡时按"视觉重量"算，不能只看像素面积。

#### 2.2.7 图底（Figure–Ground）与共同命运（Common Fate）

**图底**：视觉会自动区分"图形（前景焦点）"和"背景"。面积较小的、被包围的、闭合的物体倾向被看作前景图形。**推论**：弹窗要有明确的"浮起来"的信号（阴影、遮罩、层级），否则用户分不清焦点在哪。

**共同命运**：朝同一方向运动的元素被感知为同一组。**推论**：同时出现/消失、同步滚动的元素（如同组动画、同一抽屉滑出的一批内容），会让用户觉得它们是"一套"。

#### 2.2.8 来源 [平面]

- MIT 6.813, [Layout（格式塔在 UI 中的应用）](https://web.mit.edu/6.813/www/sp16/classes/15-layout/)
- 奥克兰大学 COMPSCI 345, [Grouping（格式塔分组讲义）](https://cs.auckland.ac.nz/courses/compsci345s1c/lectures/L13%20grouping.pdf)
- Rosenholtz et al., *An Intuitive Model of Perceptual Grouping for HCI Design*（CHI 2009，见 IEEE Technology Navigator 收录）
- Northwestern 开放教材, [Chapter 8 Glossary – UX Design](https://openbooks.library.northwestern.edu/uxdesign/chapter/chapter-8-glossary/)

---

### 2.3 视觉层级与对比（Visual Hierarchy & Contrast）

#### 2.3.1 定义与认知依据

视觉层级（Visual Hierarchy）是指**按重要程度组织元素，让眼睛按你设计的顺序读页面**。它的认知根基是前注意加工——大脑先自动捕捉最"扎眼"的特征，再逐步细读。**如果你不做层级，用户的眼睛就乱跑；层级做得对，用户在一秒内就知道"先看哪、后看哪、哪些是一组的"。** [平面]

四个最有力的对比维度：

| 维度 | 机制 | 可操作起点 |
|---|---|---|
| 大小 Size | 前注意加工中最原始的信号——大 = 重要 | 层级间至少 **1.5 倍** 差（如 16px 正文 / 24px 小标题 / 36px 大标题） |
| 字重 Weight | 粗 = 重 = 重要 | 全站只用一个字族的两档字重（Regular / Bold）制造对比，别堆四五档 |
| 色彩 Color | 高饱和色先于意识被捕捉；**稀缺才有效** | 强调色全站占比 ≤10%，用多了信号就稀释（见 3.2 的 60-30-10） |
| 位置 Position | 左上优先、上优于下、孤立元素更重 | 最重要的内容放左上/首屏；越重要的元素周围留白越多 |

**关键认知**：色彩可以"压过"大小——一个亮色按钮即使比周围文字小，也会先被抓到。但反过来说，**强调色一旦满屏都是，就失去了强调作用**（"一个红按钮是信标，四个红按钮只是一片红"）。稀缺性（scarcity）是层级成立的前提。

#### 2.3.2 F 型 / Z 型阅读路径

眼动追踪（NN/g 等研究）发现两种典型扫读模式：[平面]

- **F 型（F-Pattern）**：出现在文字密集页面（文章、新闻、表格）。用户先横读顶部一整行，然后沿左侧竖向下扫，中途看到兴趣点才向右横读——轨迹像字母 F。**推论**：左列放最重要的信息；每一段的开头（最左）放句眼；关键数据列靠左。
- **Z 型（Z-Pattern）**：出现在元素稀疏页面（落地页、海报、banner）。视线从左上横到右上，斜穿对角线到左下，再横到右下。**推论**：顶部放主钩子/导航，对角路径放视觉重点，**右下角放行动号召（CTA）**——因为 Z 的终点是右下。

**怎么选**：内容多的页面按 F 型组织（数据靠左、可扫读），内容少的营销页按 Z 型组织（对角引导 + 右下 CTA）。两种模式都要求"路径上的东西有意义"，别让视线走到死胡同。

#### 2.3.3 对比度的尺度把握

对比不足是"界面看起来哪里不对但说不出来"的头号原因。层级对比要"果断"：[平面]

- **如果两个元素不想让它看起来一样，就把它们做得明显不同**（大小、色、重、位置四维至少拉开一维的差距）。"差一点但又没差够"是最尴尬的状态——用户能感到不一致，但读不出层级。
- **层次不要超过三级**：主标题级、正文级、辅助级；再多，层级关系就糊了。

具体的量化基准（正文 ≥4.5:1、大字 ≥3:1、非文字 ≥3:1，以及对比度公式）统一收在第三章色彩体系的 3.6 节——因为对比度本质是"前景色 × 背景色"的属性，归色彩体系管理。

**自我检验方法**：
- **眯眼测试（Squint Test）**：眯起眼睛模糊视线，只看色块与大小——层级如果还在（能说清"最大那块是标题、亮色那块是按钮"），说明对比够；如果糊成一片，对比不足。
- **灰阶测试**：把页面去色成灰度图，层级应该仍然成立（因为层级不能只靠颜色撑——色盲/弱视用户读不到）。

#### 2.3.4 例子

- 经世知途落地页 hero：标题（最大、最重、最黑）→ 两个大按钮（高对比填充）→ 灰字辅助文案（低对比、退后）。三级清晰。
- 用户反馈"教师卡科目全部 75 度灰 + 字太挤"（AK-N-D6）：本质是**层级被抹平**——科目与卡内其他信息全部同一灰度同一大小，眼睛找不到焦点。修复方向：科目降为辅助级（灰 + 品牌紫小点作视觉锚），主信息（教师名/价格）保持重。

#### 2.3.5 来源 [平面]

- NN/g, [F-Shaped Pattern of Reading Web Content](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/)
- MasterClass, [Visual Hierarchy in Design: 9 Principles](https://www.masterclass.com/articles/visual-hierarchy)
- Squarespace, [Visual Hierarchy in Web Design](https://ja.squarespace.com/blog/visual-hierarchy)
- W3C, [Understanding SC 1.4.3 Contrast (Minimum) (AA)](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)（数值详表见 3.6）
- W3C, [Understanding SC 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html)（数值详表见 3.6）

---

### 2.4 CRAP 四原则（Contrast / Repetition / Alignment / Proximity）

CRAP 由 Robin Williams 在《写给大家看的设计书》（*The Non-Designer's Design Book*）中提出。它是最容易上手的四原则，但很多人只记住了名词。这里补上"为什么成立"和"典型误用"。[平面]

#### 2.4.1 对比（Contrast）

**定义**：让不同的元素明显不同，制造焦点与层级。（数值与认知详见 2.3 与 3.6。）

**误用**：①把强调色撒满全页（对比稀释）；②"只差一点点"的对比（等于没有对比还添乱）；③对比用得杂乱无章，每处都抢眼 = 处处不抢眼。

#### 2.4.2 重复（Repetition）

**定义**：在整份作品里**复用**同一套视觉元素（颜色、字体、圆角、间距、图标风格、Logo），建立统一感与品牌感。

**认知依据**：重复 = 可预期 = 省力。用户一旦学会"蓝色文字可点"，全站蓝色文字都可点；每页的标题、卡片、按钮长得一样，用户就不必每屏重新学习。这同时呼应格式塔的相似律（2.2.3）和界面的可学习性。

**误用**：
- **过度重复 = 单调**。重复的是"系统"（同一套 token），不是"每一个像素"——同一颜色可以有深浅阶，同一间距系统可以有大小档。
- 每一页都改版式、换配色（毫无重复），读者每次都要重新建立心智模型，观感业余。
- 重复的对象不一致：卡片圆角有的是 8 有的是 16、间距时而 8 时而 13——**"差不多一样"比"完全不一样"更糟**，因为大脑会尝试归类又归类失败。这正对应用户抱怨的"参差不齐到诡异的特例"（AK-N ㉛、U4）。

**可操作规则**：把颜色、字号、圆角、间距、图标线宽全部收进设计 token（如 `--radius-*`、`--space-*`、`--text-*`），全站只消费 token，禁止出现裸值。这是"重复"在工程层的落实。

#### 2.4.3 对齐（Alignment）

**定义**：页面上每一个元素都应有视觉依据与某个其他元素对齐；不允许"随手一放"。

**认知依据**：对齐 = 连续律（2.2.5）的具体化——对齐的边缘形成平滑的可扫读路径；悬空的元素打断路径，制造视觉噪声。这也是网格系统（2.1）的落点。

**误用**：
- 一半左对齐、一半居中、一半右对齐——视线被扯向三个方向。
- 想"活泼"就用随机偏移——偏移可以，但必须**有意**（如基线网格上的刻意错位），不能是没对齐。
- 忽略**隐形对齐线**：文字左缘、图片左缘、按钮左缘要在同一根竖线上，哪怕没有画线，肉眼也读得出。

**可操作规则**：左对齐是正文/界面的默认安全选择（因为阅读起点在左，见 F 型）；居中使用在少量、短、强调性内容（标题居中、按钮内文字居中）；右对齐只用于特定场景（如表单标签、数字列）。一处确定主对齐，其余跟随。

#### 2.4.4 邻近（Proximity）

**定义**：相关的元素放一起成为一组；无关的元素用留白分开。（原理与规则见格式塔 2.2.2。）

**误用**：相关元素散落全页（日期、地点、报名按钮各在页面一角），读者要自己拼装信息；或者用边框/分割线去"补救"本应用间距解决的归属问题——**能用留白分组的，就别画线**，线是噪声。

#### 2.4.5 四原则的组合

CRAP 不是四选一，而是一个反馈回路：**对齐与邻近决定"结构"，重复决定"统一"，对比决定"焦点"**。结构先于焦点——如果元素没对齐、分组不对，对比再强也救不了整体。排错顺序建议：先邻近分组 → 再对齐 → 再重复统一样式 → 最后用对比点出焦点。

#### 2.4.6 来源 [平面]

- Robin Williams, *The Non-Designer's Design Book*（《写给大家看的设计书》）
- 威斯康星大学设计实验室, [CRAP Principles](https://designlab.wisc.edu/resources/design-tips-and-tricks/crap-principles/)
- Lewis 大学写作中心, [CRAP Design Principles PDF](https://www.lewisu.edu/writingcenter/pdf/CRAPDesignPrinciples.pdf)
- Marquette 大学研究指南, [Designing for visuals](https://libguides.marquette.edu/dsdesign/crap)

---

### 2.5 留白与负空间（Whitespace & Negative Space）

#### 2.5.1 定义

留白（Whitespace / Negative Space）是元素之间、元素周围**未被标记的空间**——边距、行距、栏间距、卡片内 padding。它不必是白色，任何背景色/纹理都算，关键是"空"。平面设计里分两类：[平面]

- **宏观留白（Macro）**：大块区域之间（页面两侧、上下、大分区之间）。
- **微观留白（Micro）**：小元素之间（字距、词距、行距、图标与文字间）。

也有**被动留白**（阅读舒适所需）与**主动留白**（刻意引导视线、制造焦点）之分。

#### 2.5.2 为什么留白有效——认知依据

- **图底关系（2.2.7）**：被留白包围的元素自动成为"图形"，凸为焦点。你想让用户注意什么，就给什么周围多留白——这是最便宜、最干净的强调手段。
- **认知负荷**：信息密度过高时，大脑处理不过来，理解力下降。研究（含大学受试实验）显示：用户偏好留白更多的页面（55% vs 45%），把更挤的布局评价为"不必要的复杂、太密"。
- **阅读与理解**：有页边距时读者读得更慢但**理解更多**；没有边距时扫读更快但理解显著下降（Slade 1970 年代起的排版研究）。
- **Tufte 的 data-ink ratio**：信息设计先驱 Edward Tufte 提出"数据墨水比"——版面里传达信息的"墨水"占全部"墨水"的比例。**每删一处装饰、每加一处留白，都在提高这个比值**：留下来的每个元素都更重。这与"Less is more"一脉相承。
- **品牌气质**：宏观留白多 → 高级、从容（Apple 式）；留白少、塞满 → 廉价、急促。这是"留白即品牌"的信号层。

瑞士排印家 Jan Tschichold 有句名言：**留白是设计的肺（the lungs of a good design）**——没有它，版式窒息。

#### 2.5.3 可操作规则

- **留白是设计元素，不是"剩下的地方"**：先规划留白（定间距系统），再往里面填内容，而不是先填内容再看哪剩了白。
- **合并碎片化留白**：页面七零八落的散白会形成"视觉迷宫"。把分散的间距合并成**规则、连续的留白块**（大块 padding 而非处处塞小边距），版面立刻安静下来。
- **用间距系统锚定密度**：定义 2~3 档"密度"（紧凑 / 标准 / 宽松），各自对应一套间距 token。表单这类高频操作可以紧凑，营销文案必须宽松。
- **留白量的判定**：没有绝对数字，但有两个手感测试——①"呼吸测试"：任意两个相邻元素之间的空白是否能让你"喘口气"，还是黏成一团？②"重点测试"：你想强调的元素，周围留白是否明显大于普通元素？
- **留白不是把内容推远**：留白是**组内紧、组间松**的结果（格式塔邻近）。全文统一放大 padding，只会让信息散架，不会变高级——高级感来自**有节奏的**松紧（见第五章间距阶梯）。

#### 2.5.4 例子

- 经世知途落地页：你要求"纵向分区无分隔件靠留空格式塔"、"屏幕左右各 100px 空区"——这正是宏观留白 + 用间距代替分隔线。左边距空区同时是"内容不得越界"的约束，也把版面重心往中间收。
- 你反馈"设置浮窗右侧可滚动区大区间隙太大，像几个大区拼起来的"（AK-N-G1）：是**间距没有节奏**——每个大区都给了同等的大留白，读者读不出"哪些区其实是一类"。修复方向是引入分层间距（组内小、同层中、跨层大）。

#### 2.5.5 来源 [平面]

- A List Apart, [Whitespace](https://alistapart.com/article/whitespace/)
- Interaction Design Foundation, [The Power of White Space in Design](https://ixdf.org/literature/article/the-power-of-white-space)
- Wikimedia Foundation, [Design – Whitespace](https://www.mediawiki.org/wiki/Wikimedia_Foundation_Design/Whitespace)
- Springer, [The Effects of Website White Space on University Students](https://link.springer.com/chapter/10.1007/978-3-319-58634-2_21)

---

### 2.6 黄金比例与斐波那契（Golden Ratio & Fibonacci）

#### 2.6.1 定义

黄金比例 φ ≈ **1.618**（(1+√5)/2），由斐波那契数列（1,1,2,3,5,8,13,21,34…）相邻两项比值收敛而来。它被用来做：字体模数比例、间距阶梯、版心分栏（约 62% / 38%）、构图焦点位置。[平面]

#### 2.6.2 怎么用

- **排版字阶**：以 16px 为基准乘 1.618：16 → 26 → 42 → 68 → 110px。这是黄金比最"可靠"的用法——它给出强对比的、偏编辑/杂志感的大字阶（与第四章的 Type Scale 比值表对照：1.618 属于"比例越大跳变越大"的极端端）。
- **间距阶梯**：斐波那契数做间距（8 / 13 / 21 / 34 / 55…）。它与 8pt 系统兼容性尚可（13≈12、21≈24），但通常**直接用 8 的倍数更省心**（见第五章）。
- **分栏**：内容区 : 侧栏 ≈ 62 : 38，符合"主内容占大头"的直觉。

#### 2.6.3 何时不必迷信它——实证证据

这是本章最重要的一段。黄金比例在网上被神化为"宇宙级审美公式"，但实证数据与官方指南都指向克制：[平面]

1. **对 UI/仪表盘/密集界面太激进**：1.618 的跳变会让标题层层级间距过大——16px 基准下 h4 就 110px、h2 到 178px，根本放不进仪表盘。密集界面用 **1.2~1.25** 的紧凑比（见 4.1）。
2. **真实头部网站几乎不用它**：一份测量 22 个成功网站（Stripe、Linear、Notion、Vercel 等）110 组标题比例的统计显示，黄金比只出现 **1.8%**（110 里 2 次）；76.3% 走的是音乐间隔（Major Third 1.25、Perfect Fourth 1.333、Minor Third 1.2、Major Second 1.125）。结论原话："黄金比对排版来说太戏剧化了——它大步跨越，而眼睛需要小步走。"
3. **官方可访问性指南把它列为"不恰当比例"**：Colorado 州政府设计指南明确把 1.618 与 1.067/1.124/1.5 列为大多数项目不恰当，推荐 1.2 / 1.25 / 1.33 / 1.414。
4. **"黄金比造就伟大设计"多为事后附会**：帕特农神庙、蒙娜丽莎、各家 Logo 的"黄金比"大多是被反向硬套出来的，学术界多不认可。**别把它当魔法公式，当"事后检验"工具用**。

**结论**：黄金比适合**编辑感、营销页、Hero 大字**；UI / 仪表盘 / 内容密集界面请用音乐间隔（1.2–1.333）。所有比例都要**放到真实上下文里验证**，而不是套完就算完。

#### 2.6.4 可操作规则

- 落地页 Hero 想要"大气"，可以用 1.333~1.618 的字阶制造强对比。
- 应用内（表单、列表、后台）一律 8pt 间距 + 1.25 字阶。
- 用比例前先问：这个界面是"展示型"还是"任务型"？展示型用大比，任务型用紧凑比。

#### 2.6.5 来源 [平面]

- Digital Polo, [The Golden Ratio in Design: What It Is, How to Use It, When It's Overblown](https://www.digitalpolo.com/golden-ratio-in-design/)
- Colorado DCS, [Typography & Spacing（官方比例指南）](https://dcs.colorado.gov/ids/digital-guidelines/design-tokens/typography-fonts-spacing)
- 1001Ferramentas, [Typographic Modular Scale](https://1001ferramentas.com/en/tools/typographic-modular-scale)
- Robert Bringhurst, *The Elements of Typographic Style*（排版字阶的权威参考）

---

## 第三章 色彩体系（Color System）

> 本章合并平面设计篇的"色彩理论"与网页 UI 篇的"色彩体系"：理论依据（色轮 / 60-30-10 / 中性色阶）来自平面篇，工程规范（语义色 / HCT / 对比度表格）来自网页 UI 篇，两处重复的对比度数值统一收在 3.6。

### 3.1 色轮基础与配色关系

色轮（Color Wheel）把颜色按色相（hue）排成环。经典配色关系：[平面]

| 关系 | 定义 | 效果 | 用法 |
|---|---|---|---|
| 互补 Complementary | 色轮上相对的两色（如红/绿、蓝/橙） | 高对比、张力强 | 强调色 + 点缀，别大面积对撞 |
| 相似 Analogous | 色轮上相邻的 3 色 | 和谐、低冲突 | 大面积安全配色 |
| 分裂互补 Split-Complementary | 一色 + 其互补色左右两色 | 对比但不刺眼 | 品牌主色的衍生 |
| 三角 Triadic | 色轮上三等分的 3 色 | 活泼、均衡 | 多色但需要克制 |
| 单色 Monochromatic | 同一色相的明度/纯度阶梯 | 干净、专业 | UI 基底最常用 |

**认知依据**：互补色对比最强是因为它们在视网膜上互为"残像"关系——盯红色久后看白色会出现绿影，说明互补对在感知上彼此"激活"。相似色和谐是因为它们落在相邻的色彩通道上，冲突小。但**注意**：和谐 ≠ 好用，界面还要靠中性色（3.3）稳住。

### 3.2 60-30-10 规则

源自室内设计，应用于界面：把页面颜色按面积分三档——[平面]

- **60% 主色（Dominant）**：背景、大面——通常是中性色（近白/浅灰/深灰），决定整体基调。
- **30% 次色（Secondary）**：结构面——卡片、侧栏、头部、区块背景，支持主色不抢戏。
- **10% 强调色（Accent）**：高优先级交互——CTA 按钮、链接、激活态、焦点环。**强调色是最鲜亮的色，必须限量**。

**为什么是 10%——认知依据**：高饱和色带有很强的"感知重量"——一小块鲜红能压过一大片浅灰。这正是层级需要的：强调色稀缺，才能保持"信号"属性（见 2.3.1 色彩稀缺）。**强调色用多了，信号就没了**：满屏品牌紫 = 用户分不清哪个才是关键操作。

**对应用型 UI 的更硬版本：90% 中性 + ≤10% 强调色**。成熟 SaaS（Linear、Notion、Stripe）走的就是这条路：90%+ 灰白/暖灰中性面，一个强调色 ≤10%，语义色（成功绿/警告黄/错误红）只用于状态。**这几乎就是你的平台"8 分白 / 1 分灰黑 / 1 分亮色品牌紫"的官方版**——你的直觉是对的，且已有大量产品验证。

**可操作规则**：
- 强调色占界面面积（不是占色板数量）**≤10%**。
- 一个页面只留**一个**主 CTA 用强调色；次要操作降为次色/中性色按钮。
- 语义色只做状态，不参与品牌审美（错误不用品牌紫）。

### 3.3 中性色阶（Neutral Scale）——界面的隐形骨架

中性色（灰、近黑、近白、带冷/暖倾向的灰）是界面占比最大的部分，也是最容易被忽视的部分。平面篇的原则 + 网页 UI 篇的分层用途合并如下：

**中性色承担了 UI 约 80% 的视觉重量**——背景、分隔线、次要文字、占位符、禁用态。标准是 6–11 级灰阶，最常用 50–900（Tailwind/大多数 SaaS）。各段用途有明确分工：[UI]

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

分层逻辑：**越浅越"退后"（背景/边框），越深越"前进"（文字/强调）**。深色模式整体反转（surface 用 gray-950、文字用 gray-100）。[UI]

**平面篇的原则性补充**：[平面]

- 一套好的中性色阶应该：有 **6~10 个台阶**（`#FFFFFF` 到近黑 `#1A1A1A`，中间覆盖文本三级、边框、悬停面、按压缩下面）；**每一阶之间亮度差均匀**，保证任何两阶都能满足文字对比。
- **带色温**：纯灰 `#808080` 会显得"脏/死"，给中性色加一点点冷（蓝灰）或暖（米灰）倾向，让它与品牌色系融合。
- **品牌色调灰**：在灰阶里掺入 2–3% 品牌色，潜意识里让 UI 与品牌统一（如蓝色调的 slate 灰）。[UI]
- **明暗双主题时**：两套中性色阶**镜像**（暗色模式 = 深灰基底 + 亮灰文字），强调色可以共用但可能需要各调一档。
- 灰阶要**感知均衡**（可用 okLCH/HCT 生成，见 3.5），中段 500 为核心。[UI]

**认知依据**：人眼对"灰度的干净程度"极其敏感——灰阶不正的界面第一眼就"糊"、"脏"。中性色是层级对比（2.3）的载体：文字三级灰度 + 边框灰 + 悬停面灰，全站一致，用户才分得清"可点、不可点、已点、不可用"。

### 3.4 语义色（Semantic Colors）

- **成功 success / 警告 warning / 危险 danger / 信息 info** 四件套，各带一个前景配对。[UI]
- 危险色（如 `#D93025` 红、Material error `#B3261E`）专用于破坏性操作/错误；警告黄用于注意；成功绿用于正向反馈。**语义色必须通过语义 token 使用**（`--color-danger`、`--color-warning`），不可裸写品牌色当警示。
- 组件状态色（hover/active/disabled 底色）建议用**同色系叠层（state layer）**：在品牌色上叠透明黑/白，而不是另造色值。Material 3 的做法是 `primary` 上叠 `on-primary` 透明层（hover 8%、focus 12%、pressed 12%）。
- 语义色只做状态，不参与品牌审美（与 3.2 呼应）。

### 3.5 色彩科学：HCT 与色调调色板（M3 的现代化方案）

Material Design 3 用 Google 自研的 **HCT 色彩空间**（Hue 色相 / Chroma 彩度 / Tone 明度）替代 HSL：[UI]

- **Hue** 来自 CAM16 色貌模型（感知准确）；**Tone** 基于 CIELAB 的 L*（感知明度）——**"任意色相的 tone 40 感知亮度相同"**，这是 HSL 做不到的。
- 色调调色板（tonal palette）= 同 hue、同 chroma、tone 从 0 到 100 的渐变（标准 13 档：0,10,20,30,40,50,60,70,80,90,95,99,100）。
- 从种子色生成 5 条调色板（Primary/Secondary/Tertiary/Neutral/Neutral Variant），再映射到 29 个语义角色（primary、on-primary、surface、outline...），**成对选择保证可达标对比度**。
- 工程上不必自研 HCT，但理解它 = 理解"**明度（tone）是可达性的主杠杆**：tone 差越大对比度越高"。选色时，控制 tone 差比纠结色相更关键。

### 3.6 可访问性对比度（落地数值，全文档唯一权威表）

对比度是**可访问性的硬指标**，也是"文字能否被看清"的物理事实：[UI] + [平面]

| 场景 | 最小对比度 | 依据 |
|---|---|---|
| 正文、按钮、链接、label（常规文字） | **4.5:1** | WCAG 2.x SC 1.4.3（AA） |
| **大字**（≥24px 常规，或 ≥19px/18.5px 且字重 700+ 加粗） | **3:1** | 同上（大字号例外） |
| UI 组件边框、图标、图形对象、焦点环 | **3:1** | WCAG SC 1.4.11（非文本对比度） |
| AAA 级：常规文字 / 大字 | 7:1 / 4.5:1 | WCAG SC 1.4.6 |

对比度公式：`(L1+0.05)/(L2+0.05)`，L 为相对亮度（luminance），范围 1:1~21:1。**4.499:1 就是不合格**。未指定背景时按白色判定。豁免项：logo、纯装饰、禁用态组件、incidental text。[UI]

**工程要义**：**"背景-内容"必须有明确的层级划分**——正文与背景 ≥4.5:1，次要文字可以更低但仍是可读灰（600 阶对白底约 7:1，占位符 400 阶对白底约 3.6:1 但占位符语义非关键信息）。深色主题下强调色需要提高亮度（很多品牌紫在深底上对比不足）。设计时可用工具（Figma 对比度插件、`material-color-utilities`）自动校验，别靠肉眼——人眼对明度的感知会被色相干扰（红绿在同样亮度下感知亮度不同）。[平面] [UI]

### 3.7 例子

- 用户反馈"按钮聚焦后 SVG 字变灰"（AK-B3）——本质是**违反"强调色/文字稀缺"**：文本颜色该在层级里保持稳定，灰化让它掉出层级。黑字即黑字，只有按钮 S 是例外。[平面]
- "注册界面两个按钮 S 全局样式被改了"（AK-N-U10 变更最小化）——修改全局样式 = 破坏全站中性色/对比系统的统一性，是"重复原则"的工程级违约。
- 教师卡科目区"全部 75 度灰 + 品牌紫小点"（AK-N-D6）：灰阶给了科目辅助级定位，品牌紫小点作视觉锚——正是中性色阶 + 强调色稀缺的配合。

### 3.8 来源

- [平面] Color Archive, [The 60-30-10 ratio is a heuristic, not a law — but it points at something real](https://colorarchive.org/notes/june-2026-surface-vs-accent-ratio/)
- [平面] uinkits, [Principles of Color in UI Design & The 60-30-10 Rule](https://www.uinkits.com/blog-post/principles-of-color-in-ui-design-the-60-30-10-rule)
- [平面] W3C, [Understanding SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)
- [平面] W3C, [Understanding SC 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html)
- [平面] Google, [Material Design 3 – Color system](https://m3.material.io/styles/color/overview)（色彩角色与中性面的权威工程化参考）
- [UI] W3C, [Understanding SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)（与上同源，合并一处）
- [UI] W3C Technique G145 (3:1 large text) — https://www.w3.org/WAI/WCAG21/Techniques/general/G145
- [UI] colorarchive.org, [Building Neutral Color Palettes for Design Systems](https://colorarchive.org/guides/neutral-color-palette-guide/)
- [UI] Material Design 3, [The color system (HCT)](https://m3.material.io/styles/color/the-color-system/color-roles)
- [UI] material-color-utilities（HCT 开源实现）— https://github.com/material-foundation/material-color-utilities

---

## 第四章 排版体系（Typography）

> 本章合并平面设计篇的"字体排版层次"与网页 UI 篇的"类型尺度"：字阶比值的**选择逻辑**（黄金比 vs 音乐间隔）来自平面篇的实证，字阶**官方数值表**（M3 15 级）来自网页 UI 篇，行高/行长合并两处。

### 4.1 Type Scale（等比字阶）

**定义**：用固定比值生成一套互相和谐的字号阶梯，替代"随手填 px"。经典公式 `sizeₙ = base × ratioⁿ`，base 常用 16px/1rem。[平面]

**为什么成立**：[UI]
- **内在和谐**：等比数列让所有字号共享同一个"数学基因"，任何两个层级站在一起都不冲突。这是音乐里"纯四度/大三度"谐和听感的视觉类比。
- **认知层级**：读者靠字号差异（而非死记具体值）判断文本重要级。比例统一保证了层级的**可预测性**——看到大一号字，就知道信息高一级。
- **可伸缩**：比例定义在一处，改一处全站字号体系重调（retuning is one-line change）。

**主选比值（音乐间隔）**：[平面] + [UI]

| 比值 | 名称 | 特性 / 适用 |
|---|---|---|
| **1.25** | Major Third 大三度 | 紧凑、均衡；**UI / 仪表盘 / 信息密集界面首选** |
| **1.333** | Perfect Fourth 纯四度 | 对比强、呼吸感好；**编辑型 / 营销页 / 落地页** |
| 1.414 | Augmented Fourth 增四度 | 介于二者之间，官方推荐之一 |
| 1.618 | 黄金比 | 太大、太戏剧化，**慎用于 UI**（见 2.6 的实证批判） |

（同族还有 Minor Second 1.067、Major Second 1.125、Minor Third 1.2、Perfect Fifth 1.5。**比例越大，标题层级间跳变越大**；信息密集界面用小比例，让多个字号在窄范围内共存。）[UI]

**可操作规则**：[平面] + [UI]
- **5~7 级字阶够用**：caption（辅助注释）→ small（次文本）→ base（正文）→ subhead（小标题）→ title（标题）→ display（大标题/Hero）。不要 20 级。
- 定义成 token：`--text-xs / sm / base / lg / xl / 2xl`，全站只消费 token，禁裸字号。
- 响应式用 `clamp(min, preferred, max)` 让字阶平滑缩放，上限约 2.5× 下限，保证放大缩小不失控。
- **一个产品只选一个比例，不混用**。

**以 16px 基准 + Major Third（1.25）为例的 Web 常用阶**：[UI]

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

以 Perfect Fourth（1.333）为比的 Web 常用阶：`12, 16, 21.33, 28.43, 37.9, 50.5, 67.3`。[UI]

**Material Design 3 官方 15 级字阶**（尺寸 / 行高 / 字重）是权威参照：[UI]

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

组件映射惯例：按钮/芯片 label 用 Label Large（14/500）；卡片正文 Body Medium（14）；卡片标题 Title Medium（16/500）；弹窗标题 Headline Small（24）；输入框文本 Body Large（16）；徽标数字 Label Small（11/12）。[UI]

### 4.2 行高与行长（Line-height & Measure）

**行长（Measure）**：单行文字的理想长度 **45~75 字符**（约含空格）。CSS 一句话：正文容器 `max-width: 65ch`。过长用户丢行、过短文字碎成"排骨"。**行长随字号缩放**——字越大，容器的 `ch` 上限可以越大，但要保持在 45–75 带内。[平面]

**行高（Line-height）**：与字号成反比——**字越大，行高越紧**。两处经验合并：[平面] + [UI]

| 字号 | 推荐行高 |
|---|---|
| ≤14px | ~1.7 |
| 15–18px（正文主力） | ~1.5–1.6 |
| 19–24px | ~1.4–1.5 |
| 25–32px | ~1.3–1.4 |
| 33–48px | ~1.3 |
| ≥49px（大标题） | ~1.2（甚至 1.1） |

**为什么**：大字号本身占的垂直空间多，紧行高让标题看起来凝练；小字号需要宽松行高防止行与行黏连。Material 3 的行高表中可见规律：字号 14 → 行高 20（1.43）、16 → 24（1.5）、24 → 32（1.33）、57 → 64（1.12）——**字号越大，行高比越小**（大标题单行为主，不需要高行高；正文需要宽松）。[UI]

**行高与行长联动**：窄列要更紧的行高，宽列要更松的行高。[平面]

**认知依据**：行长 45–75 字符对应眼动扫读的"跳视（saccade）"舒适区——过长，回行时眼球容易找错行；过短，每行停顿太多、读起来"磕巴"。

### 4.3 字重对比（Weight Contrast）

- **全站一个字族，两档字重**（Regular 400 / Bold 700）通常足够制造全部层级；最多加一档 Medium（500）给导航/按钮。字重档越多，越难维持一致。[平面]
- **粗 = 重 = 层级高**：标题用 Bold、正文 Regular、辅助信息可降到 Medium 同字号但灰一点（降对比而非降字重）。
- 字重对比与字号对比可以**叠用**（大 + 粗 = 最强标题），但要避免同一级里"有的粗有的细"——同级必须同字重。
- 英文 term：font weight 700+ 为 bold，作为"大字"判据（见 3.6 对比度）。[UI]

### 4.4 混排规则（Type Mixing）

- **最多两个字族**：一个无衬线做 UI/正文（如 Inter、Noto Sans SC），一个可选衬线/展示体做 Hero/强调标题。超过两个字族 = 混乱。[平面]
- 中英文混排：中文用中文字族（思源黑体/Noto Sans SC），西文与数字用配套西文字族，**确保两套的 x-height 与字重视觉协调**（例如都选 400/700 两档）。
- 数字在表格/价格里用**等宽或表意数字**（tabular figures，如 `font-variant-numeric: tabular-nums`），让数字列上下对齐。
- 不做"标题全大写 + 中文"这种生硬处理：中文没有大写，靠字重与字号区分即可。
- 层级越高，字符间距（letter-spacing）可以适当**收紧或加宽**制造语气，但正文不调字距。

### 4.5 实现纪律

- 字号用 `rem`（不用 px），尊重用户浏览器字号偏好（WCAG 1.4.4 文本缩放）；**不要用 px 设根字号**。[UI]
- 基准保持 1rem = 16px（无障碍）。
- CSS 里用变量链式乘法实现（`--step-1: calc(var(--step-0) * var(--ratio))`），比例定义单处。

### 4.6 认知依据小结

排版层次本质上是在操控**视觉重量**（2.3）：字号、字重、行高、字距共同决定一行文字"有多重"、先被谁看到。把这三者（Type Scale / 行高 / 字重）组合成一个 token 化系统，全站一致，用户读页面时大脑就能自动按层级提取信息，这就是"排版让内容好读"的全部秘密。[平面]

### 4.7 例子

- 用户反馈"拼图滑块触点太大轨道太粗和字号对不上，滑轨至少三倍灰字高"（AK-N-A4）：是**图形组件（滑块）的字号参照系统与文字系统脱节**。正确做法是让图形组件尺寸由文字 token 派生（如轨道高度 = 3 × caption 字号），而不是各自硬编码。[平面]
- "筛选栏三个输入组件高度位置全不一样"（AK-N-㉛）：三个组件各自的文字 token、高度 token 没统一，本质是**排版系统（Type Scale + 高度 token）没建起来**。

### 4.8 来源

- [平面] 1001Ferramentas, [Typographic Modular Scale](https://1001ferramentas.com/en/tools/typographic-modular-scale)
- [平面] devhexlab, [Designing with Typographic Scales](https://devhexlab.com/articles/designing-with-typographic-scales)
- [平面] Colorado DCS, [Typography & Spacing（官方比例与行高指南）](https://dcs.colorado.gov/ids/digital-guidelines/design-tokens/typography-fonts-spacing)
- [平面] Robert Bringhurst, *The Elements of Typographic Style*
- [平面] W3C, [CSS Text / font-variant-numeric（等宽数字）](https://www.w3.org/TR/css-fonts-3/#font-variant-numeric-prop)
- [UI] Material Design 3 Typography / Type scale tokens — https://m3.material.io/styles/typography/type-scale-tokens
- [UI] devhexlab, How to Generate a CSS Typography Scale — https://www.devhexlab.com/guides/typography-scale-guide
- [UI] A Modular Type Scale with CSS Custom Properties — https://www.web-font-optimization.com/typography-fundamentals-system-architecture/type-scale-modular-grids/modular-scale-with-css-custom-properties/
- [UI] WCAG 1.4.4 Resize Text — https://www.w3.org/WAI/WCAG21/Understanding/resize-text.html

---

## 第五章 间距系统（Spacing System）

> 本章主体来自网页 UI 篇的"间距系统"；平面篇在网格一章给出的 8pt 概述（2.1.4）在此展开为完整论证。留白章（2.5）讲"为什么留白"、本章讲"留白的离散数值怎么定"。

### 5.1 原理定义

间距系统 = 用一组**离散的、有比例的**间距值（而非任意数值）来约束界面中所有元素之间的距离与尺寸。主流做法是 **8pt 网格**：所有组件尺寸、布局间距、内外边距都取 8 的倍数（8/16/24/32/48/64/96...）；**4px 作为半网格**，用于排版基线、图标、小元素内距等细粒度微调。[UI]

### 5.2 为什么成立（认知/工程依据）

- **数学优雅，避免亚像素模糊**：8 除以 2 得 4、除以 4 得 2，任何运算都落在整数上；而像 10.5px 这种小数在屏幕上会产生半像素渲染模糊。8 在 1x/1.5x/2x/3x/4x 各种像素密度倍率下相乘都得整数（8×1.5=12、8×2=16...），而 10×1.5=15 不落在任何 8 基网格上。
- **节奏感（Rhythm）**：等比/等差的间距序列产生可预测的视觉韵律。间距 8/16/24/32 的递增让眼睛能"猜到"下一个元素该在哪。
- **减少决策**：把间距从无限多种可能收缩到 7 种（8 的 1~7 倍），设计不再 fiddling。
- **为什么还要 4px**：8 太粗，无法表达图标内距、文字基线、紧凑组件内部这类"需要 4/12/20"的精细场景。业界共识是分工：**4pt 用于微调（icon padding、紧凑组件内部），8pt 用于其余一切**。Material 自己也用 8dp 对组件、4dp 对排版基线。

### 5.3 间距阶梯（--space-1..6）如何派生

以一个基准单位 `--space-unit: 4px` 起步，按倍数派生出**语义化间距 token**：[UI]

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

设计系统内常见的完整阶梯是 `4, 8, 12, 16, 24, 32, 48, 64, 96`（混合 4px 半网格与 8px 主网格）。**关键纪律**：间距值只从阶梯里取，禁止出现 13px、17px、25px 这类"随手值"。数值规范上：卡片内距 16–24、模态内距 24、表单标签到输入框 8、组标题到内容 8–12、大分区 32–64。[UI]

**与邻近原则的对接**（呼应 2.2.2）：间距阶梯就是"组内 gap 与组间 gap 差 3 倍"的量化载体——组内用 8、组间用 24，分组一眼可分。留白的高级感来自**有节奏的松紧**，而节奏就是阶梯本身（呼应 2.5.3）。

### 5.4 何时打破网格（合法例外）

网格是默认，不是枷锁。合法打破的情形：[UI]

- **细粒度内距**：文字与图标内部的视觉对齐（如按钮 label 与胶囊左右弧心的距离）用 4px 或光学调整值。
- **光学对齐（optical adjustment）**：圆角元素内部、有背景高亮的行，需要按"视觉重量"微调而非机械等距。
- **基线对齐**：文字与相邻元素对齐时，按行高基线而非盒模型顶边。
- **特殊动效/渐变**：间距参与动效时（如浮层偏移 24px 加 8px 余量）。

打破网格必须**有理由且有记录**（token 或注释），否则一律按阶梯。

### 5.5 例子

- Material Design 3：8dp 组件网格 + 4dp 排版基线。[UI]
- Tailwind：`space-x/y` 系列 0/1/2/4/8/12/16/24/32/48... 即 4 基阶梯。
- 经世知途组件契约：`--space-1..6` 即按本节派生的 4/8/12/16/24/32。
- 用户反馈"设置浮窗大区间隙像拼出来的"（AK-N-G1）：正是间距没有节奏——全用同档大留白，读不出分区层级。修复方向是引入分层间距（组内小、同层中、跨层大）。

### 5.6 来源 [UI]

- Material Design 8dp grid — https://m3.material.io/foundations/layout/applying-layout/writing-breakpoints
- Carlos Lastres, Using 8-Point Grid — https://carloslastres.webflow.io/post/using-8-point-grid
- LS.Graphics, Why 8pt grid: the math behind clean UI — https://www.ls.graphics/blog/why-8pt-grid-the-math-behind-clean-ui
- 设计达人《为什么 4 点网格系统比 8 点网格更好用》— https://www.shejidaren.com/4-dian-wang-ge-xi-tong.html
- EEA Design System Spacing — https://eea.github.io/volto-eea-design-system/docs/webdev/Guidelines/spacing/

---

## 第六章 设计 token 体系（Design Tokens）

> 本章来自网页 UI 篇。它是"重复原则"（2.4.2）与"间距/字阶/色彩"所有数值规范在工程层的收口：把设计决策变成具名变量，作为单一事实来源。

### 6.1 原理定义

设计 token = 把设计决策（颜色、字号、间距、圆角、阴影、动效时长）抽成**具名变量**，作为设计的"单一事实来源"。token 分三层，由底层原始值逐层语义化：[UI]

1. **原始/参考 token（Primitive / Reference tokens）**：最原子的值，无依赖。颜色如 `blue-500`、`gray-900`，尺寸如 `--space-4: 16px`，字号 `--fs-md`。**按外观描述命名**（appearance descriptor）。
2. **语义 token（Semantic / System tokens）**：把原始值翻译成"用途"。如 `--color-brand`、`--color-line`、`--color-divider`、`--color-text-primary`、`--color-text-secondary`。**按用途命名**（purpose descriptor）。组件只消费语义 token，不直接碰原始值。
3. **组件 token（Component tokens）**：把语义 token 映射到具体组件的具体部位，如 `--btn-primary-bg`、`--btn-radius`、`--input-h`。Material 3 的命名模式：`md.comp.button.container.height`。

### 6.2 为什么成立

- **语义与实现解耦**：语义 token 是"开关板"（switchboard）——组件只读语义 token，换主题（品牌色/暗色模式）只需重映射语义 token 的原始值，组件代码零改动。
- **一致性由结构保证**：同一用途永远同一 token，杜绝"两处 #333 一个偏蓝一个偏绿"。
- **可审计**：全站设计值收敛到 token 文件，审计裸值（hardcode）只需 grep。
- **Material 3 的对比度配对**：`primary`/`on-primary`、`surface`/`on-surface` 成对出现，保证"任何底色上都有可达标的前景"。

### 6.3 token 组织与命名

Material Design 3 的命名规范：**Namespace → Category → Concept → Property → Variant → State**（如 `acme-color-action-background-primary-hover`）。Web 设计系统常见简化为：[UI]

```css
:root {
  /* 颜色：原始 → 语义 */
  --color-gray-50: #F9FAFB;          /* 原始 */
  --color-brand: var(--color-violet-600);   /* 语义 → 原始 */

  /* 间距（见第五章） */
  --space-1: 4px;  --space-2: 8px;  --space-4: 16px;

  /* 字号（见第四章） */
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

### 6.4 token 层级如何保证一致性

- **禁止组件/页面直接写原始值**：按钮背景用 `var(--color-brand)`，不允许 `#6c5ce7` 出现在组件 CSS。
- **原始值只定义一次**：`src/shared/config.js` / `tokens.css` 是唯一来源，前端构建消费。
- **语义 token 是主题切换的边界**：浅色/深色两套主题 = 两份语义 token 映射表（`--surface-default` 浅色指 `gray-50`、深色指 `gray-950`），组件零改动。
- **规模警示**：组件 token 维护成本高（200 个语义 token 可能膨胀到 2000+ 组件 token）。大多数系统**原始 + 语义两层就够**；需要多品牌/白标/精细化定制时才引入组件层。

### 6.5 来源 [UI]

- Material Design 3 Color tokens & theming — https://m3.material.io/foundations/design-tokens/overview
- sujeet.pro, Design Tokens and Theming Architecture — https://github.com/sujeet-pro/sujeet.pro/blob/main/content/articles/design-tokens-and-theming/README.md
- Design Token 社区规范（W3C Design Tokens Community Group）— https://www.w3.org/community/design-tokens/
- 经世知途架构契约：单源原则（P4）、token 见 `docs/adr/0004-new-frontend-component-contract.md`

---

## 第七章 组件状态层次（Component State Hierarchy）

> 本章来自网页 UI 篇，是「经世知途」用户原则 **U12 层级树** 的理论源头，也是组件契约的核心。

### 7.1 原理定义：状态层级树

每个可交互组件都是一个**状态层级树**：根是全局状态（disabled/loading），向下是交互状态（hover/focus/active/selected），叶子是具体子层（涟漪、箭头位移、文字色过渡、图标动效）。核心思想：**状态是树的根，动效是树的叶子；根被禁用，整棵树全部停止**。任何"状态 A 下子层 B 仍在动/仍可点/仍变色"都是特例 bug。[UI]

状态的视觉规则（以按钮为例，六态）：

| 状态 | 触发 | 视觉规则 |
|---|---|---|
| **Default（enabled）** | 常态 | 完整色 + 完整对比度，有明确可点击语义（胶囊形、填充/描边） |
| **Hover** | 鼠标悬停（无触屏） | 轻微"抬升"：底色加深/叠加状态层、可有轻阴影。**键盘用户永远看不到 hover**，所以 hover 不能是唯一反馈 |
| **Focus** | Tab 键盘 / 程序聚焦 | 必须有**清晰的焦点环**（focus ring）——高对比（对相邻 ≥3:1）、2–3px 粗、**外偏**（outline-offset 2px，不与按钮边缘贴合） |
| **Active（Pressed）** | 按下瞬间 | "按进去"：更暗、可轻微内缩（translateY(1px)），配 100ms 内即时反馈 |
| **Disabled** | 不可用 | **整体降级**：降透明度 + 去指针样式（cursor 默认）；不可聚焦、不可 hover、无涟漪、无箭头动效。Elisa 设计系统还提醒：能避免则避免 disabled——表单校验前最好用错误提示而不是禁用按钮 |
| **Loading** | 提交中 | 禁用交互 + 显示进度（spinner/骨架），文字可保留可替换为"处理中"；必须有在途守卫（busy 锁）防重复提交 |

### 7.2 为什么 disabled 要"整体降级"（层级树思想）

- **认知一致性**：disabled = "此路不通"，必须一眼可辨、且**任何子元素都不该显得可交互**。若一个灰按钮的箭头还在 hover 下位移，用户会困惑"它到底能不能点"。
- **层级树纪律**：disabled 是最高优先级状态，必须**从根到叶整体压制**。CSS 上即：`.is-disabled` 禁掉全部 `animation/transition`，hover/focus 规则全部加 `:not(.is-disabled)` 守卫。
- **loading 同理**：loading 期按钮整体不可再触发（busy 锁），不是只改文字。

**扩展（经世知途 U12 补充说明）**：层级树不限于 disabled——一切状态机（loading/active/selected/error/readonly）都必须从根到叶整体一致，禁止叶子各自为政。例如：灰掉的 A1/B1 按钮箭头仍位移、禁用态下拉仍有涟漪，都是"根变灰叶子没停"的特例。

### 7.3 焦点可见性（focus-visible）

这是现代 Web UI 最被低估的可访问性细节：[UI]

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

### 7.4 来源 [UI]

- web.dev, Building a button component（:focus-visible 最佳实践）— https://web.dev/articles/building/a-button-component
- WCAG 2.2 SC 2.4.7 Focus Visible — https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
- WAI-ARIA Authoring Practices 1.2, Button Pattern — https://www.w3.org/WAI/ARIA/apg/patterns/button/
- Elisa Design System（disabled 建议）— https://designsystem.elisa.fi/
- DXC Halstack Button specifications — https://developer.assure.dxc.com/halstack/6/components/button/specifications/

---

## 第八章 动效原则（Motion Principles）

> 本章来自网页 UI 篇。动效是组件状态层级树的"叶子"层（第七章），也是「经世知途」落地页"浮入+淡入轻盈感"与按钮涟漪的具体实现依据。

### 8.1 时长：分层级，不是一刀切

Material Design 3 的时长分级（按交互类型）：[UI]

| 类型 | 时长 | 例子 |
|---|---|---|
| 微交互（Micro-interaction） | **50–100ms** | 涟漪、状态切换、hover 反馈（essential feedback 应 <100ms） |
| 短（Short） | **100–200ms** | 简单过渡、开关切换、单元素显隐（opacity+轻 scale） |
| 中（Medium） | 200–300ms | 展开/折叠、内容揭示 |
| 长（Long） | 300–500ms | 复杂编排、页面过渡 |

按设备：桌面 **150–200ms**（更快更直接）；移动 300ms 基线；平板 +30%（~390ms）；可穿戴 -30%。**同一个动效不要全站一个固定时长**——按位移距离、元素尺寸、表面变化动态调整。

业界共识的"甜点区"：**状态切换 ~150ms；进出场 200–250ms；点赞类反馈 ~150ms + 轻微 scale；>400ms 感觉拖沓；<100ms 几乎不可感知**。

### 8.2 缓动曲线（Easing）：物理感来自不对称

**禁止线性动效（linear）**——线性看起来机械（如机器人）。缓动的核心是**加速度不对称**：[UI]

| 曲线 | 语义 | CSS cubic-bezier | 用法 |
|---|---|---|---|
| **Standard** | 标准（ease-in-out） | `cubic-bezier(0.4, 0.0, 0.2, 1)` | 元素在屏内移动、放大缩小（最常用） |
| **Decelerate** | 减速（ease-out） | `cubic-bezier(0.0, 0.0, 0.2, 1)` | 元素**进入**：全速冲入再慢停 |
| **Accelerate** | 加速（ease-in） | `cubic-bezier(0.4, 0.0, 1, 1)` | 元素**永久离开** |
| **Sharp** | 急停 | `cubic-bezier(0.4, 0.0, 0.6, 1)` | 元素暂时离开（还会回来） |
| **Emphasized** | 强调（M3） | `cubic-bezier(0.2, 0.0, 0.0, 1.0)` | 重要过渡 |

关键：**进场用 ease-out（快进慢停）、离场用 ease-in（慢起快走）**。人脑对"进来的东西"期望它迅速到位，对"离开的东西"期望它干脆走掉。平台对应：iOS `CAMediaTimingFunction`；Material 有 `duration.shortest=150`、`duration.shorter=200` 常量。

### 8.3 动效层级：功能性动效 vs 装饰动效

- **功能性动效（Functional）**：传达状态变化、空间关系、结果——按钮按压、下拉展开、弹窗出现、表单错误。**必须快速（150-200ms）、克制的反馈**，优先级最高。
- **装饰性动效（Decorative）**：品牌氛围——滚动浮现、hover 涟漪、渐变流动。可以有，但必须：不阻碍任务、可被 reduced-motion 关闭、不喧宾夺主。
- 编排技巧：相关元素 **stagger 20–40ms** 依次入场，制造协调感；避免全屏大幅移动（诱发眩晕）。

**对照「经世知途」用户原则 U3 主次**：装饰性动效是"图形组件"，不能喧宾夺主压过文字（如滑块轨道、滚动浮入的幅度），且必须能被 reduced-motion 关闭。

### 8.4 prefers-reduced-motion（无障碍硬要求）

- `@media (prefers-reduced-motion: reduce)` 检测用户系统"减少动态"偏好（macOS 辅助功能→显示→减弱动态）。全球超过 7000 万人有前庭障碍，运动可诱发眩晕/偏头痛/癫痫。[UI]
- **"reduce" ≠ "none"**：功能必需的动效（进度指示、状态反馈）保留；非必需动效关闭或降级（用 fade 替代 scale+move、缩短时长）。
- 工程推荐：**先写静态/减少态样式，再在 `no-preference` 下增强动效**。用 `animation-duration: 0.001ms` 兜底方案可行但推荐逐组件精修（配合 CSS Cascade Layers 免 !important）。
- JS 驱动动效用 `matchMedia('(prefers-reduced-motion: reduce)')` 判断。
- 相关 WCAG：SC 2.3.3 Animation from Interactions（技术 C39 CSS / SCR40 JS）。

**经世知途落地页特殊说明**：滚动浮入（reveal）是页面核心设计动效，用户明示即使在 reduced-motion 下也需可见（AK-N-F1 先例）——这是"装饰动效可被 reduced 关闭"原则的有意豁免，必须在组件注释里写明取舍依据。

### 8.5 来源 [UI]

- Material Design 3 Motion, Duration & easing — https://m3.material.io/styles/motion/duration-easing
- Material Design, Duration & easing（旧版详表）— https://m1.material.io/motion/duration-easing.html
- WCAG Technique C39（prefers-reduced-motion CSS）— https://www.w3.org/WAI/WCAG22/Techniques/css/C39
- MDN, Using media queries for accessibility — https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- CSS-Tricks, prefers-reduced-motion almanac — https://css-tricks.com/almanac/properties/m/motion-reduced/

---

## 第九章 组件库规范（Component Library Specs）

> 本章来自网页 UI 篇，收集 Material Design 3 与 Apple HIG 的官方数值，是组件 token 的数值来源。对照「经世知途」用户原则 U7（真自制）时注意：这些是**命中区/尺寸下限**与**圆角/抬升语义**，不是让你复刻系统滚动条。

### 9.1 触控目标（Touch Target）：物理手指的硬约束

- **Apple HIG**：交互元素命中区（hit region）最小 **44×44pt**；按钮中心间距至少 **60pt**（防误触）。
- 这是物理依据：指尖平均接触面积 ~10mm，44pt ≈ 11.7mm，是可靠点按的下限。图标可以视觉上 20×20，但命中区必须扩到 44×44（用 padding/伪元素扩大热区）。
- 触屏上 hover 不存在，所以移动端必须有 focus/active 即时反馈替代。

### 9.2 按钮（Button）

**Material Design 3 Expressive 尺寸档**：[UI]

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

### 9.3 输入框（Text Field）

- **Material 3 标准输入框容器高 56px**（Outlined/Filled），密度变体 52/48/40。Web 实践常用 40–48px（紧凑用 36–40）。
- 苹果生态实践：输入框高 44–48pt（与触控目标一致）。
- 圆角：Outlined 4dp（M3）；Web 常见 6–8px。
- 内部：文字 Body Large（16）；label 浮动到顶部；边框在 focus 时换主题色 2px；错误态换 error 色 + 错误文字。
- **必填/选填标记**：必填红色星号 `*`、选填黄色/灰色星号 `*`，作为文字字符而非图标（用户心智 = 星号字符）。

### 9.4 弹窗（Dialog / Modal）

**Material 3 官方规范（Basic Dialog）**：[UI]

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

### 9.5 圆角档位通用表（Radius Scale）

`2 / 4 / 6 / 8 / 12 / 16 / 24 / full` 是常见档位，按元素尺寸选：[UI]

| 元素类型 | 圆角 |
|---|---|
| 标签、徽标、tooltip、图标按钮 | 2–4（或 8） |
| 按钮、输入框、下拉 | 4–8（M3 默认胶囊 full） |
| 卡片 | 8–16 |
| 弹窗、抽屉、sheet | 12–28 |
| 头像、开关、FAB、胶囊按钮 | full（9999） |

**嵌套圆角公式**：外层圆角 = 内层圆角 + padding（即 `inner = outer - padding`），保证两层曲线视觉平行不"夹瘪"。例：外容器 24 圆角 + 12 padding → 内子件用 12 圆角。

### 9.6 阴影/抬升（Elevation）

- M3 抬升 = **阴影 + 色调抬升（tonal elevation）**双层：阴影表达空间深度，色调抬升（surface 上叠亮度变化）在暗色模式下替代阴影。
- 档位：level0（无）→ level5；常用 level1（1dp，悬浮卡片）→ level3（6dp，弹窗/抽屉）。填充按钮 0dp（不抬升），悬浮按钮 1dp。
- Web 实践：`--shadow-sm`（1px 轻边）、`--shadow-md`（4px 主）、`--shadow-lg`（8–12px 弹窗）。**阴影越重元素越"高"**——与层级对应，同一时刻同层元素阴影一致。
- 阴影用 2 层以上（近景硬 + 远景软）更自然。

### 9.7 来源 [UI]

- Material Design 3 Components（Button / Text field / Dialog / FAB specs）— https://m3.material.io/components
- Material Design 3 Dialog specs — https://m3.material.io/components/dialogs/specs
- Material Design 3 Elevation — https://m3.material.io/styles/elevation/overview
- Apple HIG, Buttons — https://developer.apple.com/design/human-interface-guidelines/buttons
- Apple HIG, Layout（touch target 44pt）— https://developer.apple.com/design/human-interface-guidelines/layout
- Radius token 案例：Nucleus / 7onic / Usertesting — https://design.productboard.com/latest/foundations/design-tokens/dimensions/border-radius ; https://7onic.design/design-tokens/radius ; https://design-system.usertesting.com/latest/utility-classes/radii

---

## 第十章 响应式与断点（Responsive & Breakpoints）

> 本章来自网页 UI 篇。落地页"屏幕左右各 100px 空区""组件不得越界"、移动端"浮窗不可滚动/压扁"，都是本章规范的项目内表现。

### 10.1 常见断点体系

`375 / 768 / 1024 / 1440` 映射主流设备类别：[UI]

| 断点 | 设备 | 布局 |
|---|---|---|
| 375px（及以下） | 手机竖屏（iPhone SE/8/13、Pixel） | 单列（**"酸测试"酸度最高**） |
| 768px | 平板竖屏（iPad） | 双列 |
| 1024px | 平板横屏/小笔记本 | 双~三列 |
| 1440px | 主流笔记本（MacBook Pro 等） | 三~四列 |
| 1920px | 大屏 | 更多列/更宽内容区 |

对应 Chrome DevTools 设备模式（Mobile M:375 / Tablet:768 / Laptop:1024 / Laptop L:1440）。框架值略异：Tailwind `sm:640 md:768 lg:1024 xl:1280 2xl:1536`。

### 10.2 移动优先（Mobile-First）

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

### 10.3 响应式布局纪律

- 列数演进：移动 1 列 → 平板 2 列 → 桌面 3–4 列；导航在 <1024 折叠为汉堡菜单。
- 测试清单：任何宽度下**无横向滚动条**、文字可读、触控目标 ≥44px、图片不溢出不变形。
- **可滚动组件的容器规范**：[UI]（含经世知途 AK 教训注记）
  - 横向滚动（横廊/图表）：容器 `overflow-x: auto` + `scroll-snap-type: x proximity`；**不要劫持页面滚轮**（wheel 劫持会让用户滚不过去——见本项目 AK-B4b/N-F5 反转教训）；保留拖动/触摸 + 边缘渐变遮罩。
  - 垂直滚动浮层：`max-height: calc(100dvh - 32px)` + `overflow-y: auto` + `overscroll-behavior: contain`（阻止滚动链穿到页面）。
  - 视口单位用 `dvh`（动态视口高，正确处理移动端 URL 栏收缩），慎用 `100vh`。
- 间距随屏宽缩放：移动端页面侧边距 16px，桌面可到 24–48px（也可用 `clamp()` 流式）。

### 10.4 来源 [UI]

- Compound Design System, Responsive design — https://compound.thephoenixgroup.com/latest/guidelines/foundations/responsive-design
- media-query-sizes（375/768/1024/1440 表）— https://www.npmjs.com/package/media-query-sizes
- Tailwind CSS Responsive Design — https://tailwindcss.com/docs/responsive-design
- MDN, Using media queries — https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_media_queries/Using_media_queries

---

## 第十一章 落地自查清单（把理论变成 token）

> 把前九章的全部理论压缩成可执行的最小集。它合并了网页 UI 篇的"落地自查清单"，并补入平面篇的原则性检查（对齐/分组/层级/留白）——数值清单负责"统一"，原则清单负责"结构"。自查顺序按 CRAP 的组合逻辑：**先结构（邻近/对齐）→ 再统一（重复/token）→ 最后焦点（对比/留白）**。

### 11.1 设计 token 最小集

1. **间距**：`--space-1..6 = 4/8/12/16/24/32`，全部间距从表取，禁止裸值。
2. **字号**：`--fs-xs 13 / sm 14 / md 16 / lg 20 / xl 24 / 2xl 32 / 3xl 40`，用 rem；行高正文 1.5、标题 1.2–1.3。
3. **token 三层**：原始（颜色/尺寸）→ 语义（`--color-brand/--color-line/--color-divider/--color-text-primary/secondary/--surface-*`）→ 组件（`--btn-h/--input-h/--radius-*`）；组件只消费语义层。
4. **灰阶**：gray-50..900 分段分工（背景/边框/禁用/次要/主文字），含品牌调。
5. **对比度**：正文 ≥4.5:1、大字 ≥3:1、边框图标 ≥3:1；深色模式整体反转语义映射。
6. **状态层级树**：disabled > loading > active > hover > focus > default；disabled 整体停动效；`:focus-visible` 焦点环 2px 外偏 ≥3:1。
7. **动效**：微交互 150ms、进出 200–250ms、页面 300–400ms；ease-out 进场/ease-in 离场；`prefers-reduced-motion` 降级非禁用。
8. **组件数值**：按钮 40–48px、触控 ≥44px、输入框 40–48px、弹窗 max-width 560px 圆角 12–28、卡片圆角 8–16、小元素 4–8。
9. **响应式**：min-width 移动优先；断点 375/768/1024/1440；滚动容器 `max-height: 100dvh-32px` + contain；横廊不劫持滚轮。

### 11.2 结构自查（平面原理版，按 CRAP 顺序）

1. **邻近分组**：每个元素都能说清"跟谁一组"——组内 gap 与组间 gap 一眼可分（差 3 倍）。标题离它统领的内容比离上一段近。
2. **对齐**：页面上没有"随手一放"的元素；左缘/基线/网格参考线叠加后零悬空。筛选栏三个输入组件高度位置一致（AK-N-㉛ 教训：同类控件同高度 token）。
3. **重复/统一**：同类组件同 token（同尺寸/同圆角/同色/同字号）；全仓 grep 无裸值；"差不多但不一样" = 0 容忍。
4. **焦点/对比**：眯眼测试 + 灰阶测试层级仍成立；每屏只有一个主 CTA 用强调色；强调色全站 ≤10%；重点元素周围留白明显更多。
5. **留白节奏**：组内紧、组间松；大分区间距分层（组内小/同层中/跨层大），不全部等大留白。
6. **数据不泄露**：数组/对象不以原始格式（`[object Object]`/`[]`/`null`）渲染上屏（U11）——空态要有设计，不是裸字段。

### 11.3 数值速查表

| 主题 | 数值 |
|---|---|
| 对比度 | 正文 4.5:1 / 大字 3:1 / 非文字 3:1 / AAA 7:1 |
| 字阶 | UI 1.25、编辑页 1.333；5–7 级；M3 15 级表为权威 |
| 行高 | 正文 1.5–1.6、标题 1.2–1.3；行长 45–75 字符（max-width 65ch） |
| 间距 | 4/8/12/16/24/32/48/64/96 |
| 触控 | 命中区 ≥44×44pt、按钮中心距 ≥60pt |
| 按钮 | 高 40–48（M3 默认 40），圆角胶囊/4–8 |
| 输入框 | 高 40–48（M3 56），圆角 4–8 |
| 弹窗 | max-width 560、圆角 12–28、内距 24 |
| 卡片 | 圆角 8–16、内距 16–24 |
| 动效 | 状态 150ms、进出 200–250ms、页面 300–400ms |
| 焦点环 | 2–3px、外偏 2px、≥3:1 |
| 断点 | 375 / 768 / 1024 / 1440 |

### 11.4 验收顺序

按"结构 → 统一 → 焦点"排错：先看**邻近与对齐**（分组对不对）→ 再看**重复与 token**（同不同类长得一不一样）→ 最后看**对比与留白**（焦点清不清晰、密度有没有节奏）。元素没对齐、分组不对时，对比再强也救不了整体。

---

## 第十二章 与「经世知途」用户原则 U1-U12 的呼应

> 用户原则（U1-U12）来自 2026-08-24 深夜大反馈（AK-N）的心智提炼。本表把每条用户心智映射到本文档的原理/章节，证明"用户直觉"与"设计科学"是同一条路的两端——也供补课时反向定位：看到一条用户原则，就知道该回看哪一章。

| 用户原则 | 心智要点 | 对应原理/章节 | 落地锚点 |
|---|---|---|---|
| **U1 排版韵律** | 间距有节奏：相关组紧、大组松、同类一致；该空的空、不该空的紧，禁止随机 gap | 间距系统（五）/ 留白节奏（2.5.3）/ 格式塔邻近（2.2.2） | 间距阶梯 `--space-*`；组内 gap 与组间 gap 差 3 倍；分层间距（组内小/同层中/跨层大） |
| **U2 功能↔空间** | 功能关联的元素空间上必须相邻/靠近（切换链接紧跟所属标题） | 格式塔邻近（2.2.2）/ CRAP 邻近（2.4.4） | "改为邮箱注册"贴在"手机验证码"标题右缘，不是最右 |
| **U3 主次** | 字是主人，图形组件（拼图/图标/滚动条）是辅助；辅助尺寸以字号为基准，不得喧宾夺主 | 视觉层级（2.3）/ 排版体系（四）/ 动效层级（8.3） | 滑轨高度由文字 token 派生（≤3×灰字）；装饰动效可被 reduced 关闭 |
| **U4 统一性** | 同类控件/按钮/图标同尺寸同色同样式；任何非用户点名的特例都是"愚蠢的特例" | CRAP 重复（2.4.2）/ 格式塔相似（2.2.3）/ token（六） | 同类控件同 token；"差不多但不一样"零容忍；全仓零裸值 |
| **U5 逻辑层级** | 界面组织按心智逐步深入（广场→自己的东西→会话→关系），默认页=承担主要功能的广场 | 视觉层级（2.3）/ 网格与信息架构（2.1） | 默认页=广场；侧栏顺序按心智深入度 |
| **U6 信息承载** | 卡片可以空不可塌（最小高度=横 A4 宽高比）；第一行对齐、信息块自由堆叠不强制行对齐 | 留白/图底（2.5/2.2.7）/ 网格（2.1） | 卡片空态保持最小高度（297:210 比例）；卡片内列自由堆叠 |
| **U7 真自制** | 自制滚动条=贴边细指引条，无系统元素，不是复刻也不是压系统条 | 组件库规范（九）/ 设计 token（六） | 滚动条宽度/圆角/颜色 token 化；贴边细指引条 |
| **U8 本地能力本地做** | 纯前端筛选不重新加载 | （前端工程纪律，超出美学范畴） | 本地过滤 + 持久化偏好；与 U9 同属"减少不必要网络/渲染" |
| **U9 预加载** | 成熟前端必须有预加载/缓存，禁止每页 loading 闪屏 | （性能工程纪律）＋ 动效"功能性动效必须快"（8.3） | datahub 缓存 + 路由/关键模块预加载；消除全站 loading 闪屏 |
| **U10 变更最小化** | 改单页组件样式不得动全局样式类（按钮 S） | token 单源（六）/ CRAP 重复（2.4.2） | 单页特殊样式做组件内局部覆盖，不碰全局 token/样式类 |
| **U11 数据泄露零容忍** | 后台字段不得以原始格式（`[object Object]`/`[]`/`null`）渲染上屏 | 信息设计（2.5）/ 组件契约（七） | 数组/对象经显示映射渲染；空态有设计；卡片/列表字段全走 mapper |
| **U12 层级树** | 状态是树的根，动效是叶子；根变灰，整棵树的叶子全停 | 组件状态层次（七） | disabled > loading > active > hover > focus > default；disabled 整体停动效；:not(.is-disabled) 守卫全子层 |

---

## 参考来源汇总

按主题归组，标注来源归属。全部 URL 与书籍引用均来自两份草稿，无新增来源。

**网格与瑞士学派 [平面]**
- Müller-Brockmann, *Grid Systems in Graphic Design*（《平面设计中的网格系统》）
- Britannica, International Typographic Style — https://www.britannica.com/art/graphic-design/Graphic-design-1945-75
- 99designs, Swiss Design — https://99designs.com/blog/design-history-movements/swiss-design/
- MIT 6.831/6.813, Layout — https://web.mit.edu/6.813/www/sp16/classes/15-layout/

**格式塔 [平面]**
- MIT 6.813, Layout（格式塔在 UI 中的应用）— https://web.mit.edu/6.813/www/sp16/classes/15-layout/
- 奥克兰大学 COMPSCI 345, Grouping — https://cs.auckland.ac.nz/courses/compsci345s1c/lectures/L13%20grouping.pdf
- Rosenholtz et al., *An Intuitive Model of Perceptual Grouping for HCI Design*（CHI 2009）
- Northwestern 开放教材, UX Design Ch.8 Glossary — https://openbooks.library.northwestern.edu/uxdesign/chapter/chapter-8-glossary/

**视觉层级与对比 [平面]**
- NN/g, F-Shaped Pattern — https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/
- MasterClass, Visual Hierarchy in Design — https://www.masterclass.com/articles/visual-hierarchy
- Squarespace, Visual Hierarchy in Web Design — https://ja.squarespace.com/blog/visual-hierarchy
- W3C, SC 1.4.3 Contrast (Minimum) — https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
- W3C, SC 1.4.11 Non-text Contrast — https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html

**CRAP [平面]**
- Robin Williams, *The Non-Designer's Design Book*（《写给大家看的设计书》）
- 威斯康星大学设计实验室, CRAP Principles — https://designlab.wisc.edu/resources/design-tips-and-tricks/crap-principles/
- Lewis 大学写作中心, CRAP Design Principles PDF — https://www.lewisu.edu/writingcenter/pdf/CRAPDesignPrinciples.pdf
- Marquette 大学研究指南, Designing for visuals — https://libguides.marquette.edu/dsdesign/crap

**留白 [平面]**
- A List Apart, Whitespace — https://alistapart.com/article/whitespace/
- Interaction Design Foundation, The Power of White Space in Design — https://ixdf.org/literature/article/the-power-of-white-space
- Wikimedia Foundation, Design – Whitespace — https://www.mediawiki.org/wiki/Wikimedia_Foundation_Design/Whitespace
- Springer, The Effects of Website White Space on University Students — https://link.springer.com/chapter/10.1007/978-3-319-58634-2_21

**黄金比例与比例选择 [平面]**
- Digital Polo, The Golden Ratio in Design — https://www.digitalpolo.com/golden-ratio-in-design/
- Colorado DCS, Typography & Spacing（官方比例指南）— https://dcs.colorado.gov/ids/digital-guidelines/design-tokens/typography-fonts-spacing
- 1001Ferramentas, Typographic Modular Scale — https://1001ferramentas.com/en/tools/typographic-modular-scale
- Robert Bringhurst, *The Elements of Typographic Style*

**色彩 [平面] + [UI]**
- Color Archive, The 60-30-10 ratio is a heuristic, not a law — https://colorarchive.org/notes/june-2026-surface-vs-accent-ratio/ [平面]
- uinkits, Principles of Color in UI Design & The 60-30-10 Rule — https://www.uinkits.com/blog-post/principles-of-color-in-ui-design-the-60-30-10-rule [平面]
- Google, Material Design 3 Color system — https://m3.material.io/styles/color/overview [平面]
- W3C, SC 1.4.3 Contrast (Minimum) — https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html [平面] [UI]
- W3C, SC 1.4.11 Non-text Contrast — https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html [平面]
- W3C Technique G145 (3:1 large text) — https://www.w3.org/WAI/WCAG21/Techniques/general/G145 [UI]
- colorarchive.org, Building Neutral Color Palettes for Design Systems — https://colorarchive.org/guides/neutral-color-palette-guide/ [UI]
- Material Design 3, The color system (HCT) — https://m3.material.io/styles/color/the-color-system/color-roles [UI]
- material-color-utilities（HCT 开源实现）— https://github.com/material-foundation/material-color-utilities [UI]

**排版 [平面] + [UI]**
- 1001Ferramentas, Typographic Modular Scale — https://1001ferramentas.com/en/tools/typographic-modular-scale [平面]
- devhexlab, Designing with Typographic Scales — https://devhexlab.com/articles/designing-with-typographic-scales [平面] [UI]
- Colorado DCS, Typography & Spacing — https://dcs.colorado.gov/ids/digital-guidelines/design-tokens/typography-fonts-spacing [平面]
- Robert Bringhurst, *The Elements of Typographic Style* [平面]
- W3C, CSS Fonts（font-variant-numeric）— https://www.w3.org/TR/css-fonts-3/#font-variant-numeric-prop [平面]
- Material Design 3, Type scale tokens — https://m3.material.io/styles/typography/type-scale-tokens [UI]
- devhexlab, How to Generate a CSS Typography Scale — https://www.devhexlab.com/guides/typography-scale-guide [UI]
- A Modular Type Scale with CSS Custom Properties — https://www.web-font-optimization.com/typography-fundamentals-system-architecture/type-scale-modular-grids/modular-scale-with-css-custom-properties/ [UI]
- WCAG 1.4.4 Resize Text — https://www.w3.org/WAI/WCAG21/Understanding/resize-text.html [UI]

**间距系统 [UI]**
- Material Design 8dp grid — https://m3.material.io/foundations/layout/applying-layout/writing-breakpoints
- Carlos Lastres, Using 8-Point Grid — https://carloslastres.webflow.io/post/using-8-point-grid
- LS.Graphics, Why 8pt grid — https://www.ls.graphics/blog/why-8pt-grid-the-math-behind-clean-ui
- 设计达人, 4 点网格 vs 8 点网格 — https://www.shejidaren.com/4-dian-wang-ge-xi-tong.html
- EEA Design System Spacing — https://eea.github.io/volto-eea-design-system/docs/webdev/Guidelines/spacing/

**设计 token [UI]**
- Material Design 3, Design tokens & theming — https://m3.material.io/foundations/design-tokens/overview
- sujeet.pro, Design Tokens and Theming Architecture — https://github.com/sujeet-pro/sujeet.pro/blob/main/content/articles/design-tokens-and-theming/README.md
- W3C Design Tokens Community Group — https://www.w3.org/community/design-tokens/
- 经世知途架构契约：单源原则（P4）、token 见 `docs/adr/0004-new-frontend-component-contract.md`

**组件状态 [UI]**
- web.dev, Building a button component — https://web.dev/articles/building/a-button-component
- WCAG 2.2 SC 2.4.7 Focus Visible — https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
- WAI-ARIA Authoring Practices, Button Pattern — https://www.w3.org/WAI/ARIA/apg/patterns/button/
- Elisa Design System — https://designsystem.elisa.fi/
- DXC Halstack Button specifications — https://developer.assure.dxc.com/halstack/6/components/button/specifications/

**动效 [UI]**
- Material Design 3, Duration & easing — https://m3.material.io/styles/motion/duration-easing
- Material Design, Duration & easing（旧版详表）— https://m1.material.io/motion/duration-easing.html
- WCAG Technique C39 — https://www.w3.org/WAI/WCAG22/Techniques/css/C39
- MDN, prefers-reduced-motion — https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- CSS-Tricks, prefers-reduced-motion almanac — https://css-tricks.com/almanac/properties/m/motion-reduced/

**组件库数值 [UI]**
- Material Design 3 Components — https://m3.material.io/components
- Material Design 3 Dialog specs — https://m3.material.io/components/dialogs/specs
- Material Design 3 Elevation — https://m3.material.io/styles/elevation/overview
- Apple HIG, Buttons — https://developer.apple.com/design/human-interface-guidelines/buttons
- Apple HIG, Layout（touch target 44pt）— https://developer.apple.com/design/human-interface-guidelines/layout
- Radius token：Nucleus / 7onic / Usertesting — https://design.productboard.com/latest/foundations/design-tokens/dimensions/border-radius ; https://7onic.design/design-tokens/radius ; https://design-system.usertesting.com/latest/utility-classes/radii

**响应式 [UI]**
- Compound Design System, Responsive design — https://compound.thephoenixgroup.com/latest/guidelines/foundations/responsive-design
- media-query-sizes — https://www.npmjs.com/package/media-query-sizes
- Tailwind CSS Responsive Design — https://tailwindcss.com/docs/responsive-design
- MDN, Using media queries — https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_media_queries/Using_media_queries

---

*本文档为两份调研草稿（`docs/design-aesthetics-平面设计.md`、`docs/design-aesthetics-网页UI.md`）的整合正本，草稿保留供溯源。实现细节衔接 `docs/adr/0004-new-frontend-component-contract.md` 与设计 token 表；「经世知途」用户原则见主会话需求 AK-N 的心智提炼。*
