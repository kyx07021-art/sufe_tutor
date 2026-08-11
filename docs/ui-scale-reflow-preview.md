# UI 大小滑块拖动期「元素级模拟重排」方案（v0.27.6 已落地）

## 需求原文
「现在的UI滑块三分式预览虽然能用，但毕竟和真实的重绘布局很不一样，真实重绘设计页宽改变、重新对齐，你找找有没有能完全体现真实重绘后布局，但依旧沿用现在的非重绘预览的方案。」
（用户追加拍板方向）「1、继续切分拖动期间预览块，切到元素级，每个按钮、分隔线等等都单设分区，而且背景分区等等也加入预览，按照真实重排期间的表现设定这些元素块的移动方式，实现模拟重排；2、想办法大幅优化重排开销，或者把从重排期间不影响前端表现或者极少的部分搬到松手之后做。」
（方案演进）方案 A（停顿克隆快照）被用户否决：「我要的就是拖动期间变成真重排预览，现在本来就是拖动结束之后真重排，这方案A 别说什么高技术重构，事实上只是加了个停顿期间重排一次，那这不白改了吗？」最终落地 = 方向 1 元素级模拟重排（ui-scale-reflow.js）。

## 核心判断（调研收敛，仍成立）
1. `--ui-scale` 是**布局属性通路**（根字号 `calc(16px*var(--ui-scale))` + 69 处 calc + 305 处 rem 传递），不是 transform 通路。任何「目标 scale 下真实重排」= 全树 reflow——拖动期逐帧真重排架构上不成立（实测完整拖动帧 36-42ms ≈ 25fps，paint 是大头；v0.25.111 全页重绘返工红线）。60fps 不可达的根源是每帧整树 layout+paint，不是单一方案能绕开。
2. transform 分块预览（v0.26.5，4 块）结构性遮蔽三件真实重排才发生的事：
   - 侧栏轨道 `max(144*S, 13.3vw*S)` 变宽 → 内容列**收窄**（「页宽改变」的本质）。均匀 scale 预览把内容列做得**更宽**，方向性错误；
   - 固定 px 盒内文本/栅格重新换行重排；
   - 基于 layout 几何的浮层定位位移。
3. CSS zoom 不合格：逐帧改 = 每帧全子树 reflow（主线程无合成器路径）+ bdf 元素逐帧改盒（983252 高危）+ 非标准 + 不重触发媒体查询/除 vw。
4. iframe 被架构惩罚：`frame-ancestors 'none'` 连同源 iframe 封死；window 全局单例双实例冲突。
5. 被否决的方案 A（停顿克隆快照）：只「停顿期间真重排一次」不满足「拖动期间变真重排预览」的需求字面。

## 落地方案：元素级模拟重排（ui-scale-reflow.js）

### 机制（拖动期合成器只读，零 reflow 零 repaint；commit 一次真重排）
1. **collectUnits**：壳（`.navbar`/`.sidebar`/`.client-main`，跳过 display:none 的如 client 视图 navbar）+ 可见 `.client-page` 内「布局显著块」（类名命中 `LAYOUT_RE` 或含非空文本的几何块）→ 单元表。每个单元记录 base rect（当前 scale 下）+ parentIdx（最近单元祖先）。
   **拓扑排序**：显式根 LIFO 弹出使嵌套根（`.sidebar`→`.sidebar-nav`、`.client-main`→`.client-page`）父索引可能 > 子索引，renderAt 自顶向下累积祖先变换依赖父先子后——不排序则子读父默认值 → NaN transform（生产事故级）。
2. **sampleTargets**（flash-free）：对每个采样档位（CONFIG.UI_SCALE_REFLOW_SAMPLE_STEP 每 5% 一档，MIN~MAX 共 9 档），**同帧** set `--ui-scale` → 强制 layout 逐单元测 rect → 还原。浏览器只在任务结束 paint，不闪屏；`--ui-scale` 还原后无中间态残留。
3. **renderAt(scale)**（拖动每帧）：目标档位在相邻采样间线性插值 → 自顶向下（拓扑序）累积祖先变换算 per-element transform：
   ```
   _ancX = par._ancX + par._ancSx*(par.tx + (child.base.x - par.base.x)*par.sx)   // 父的 tx/sx 递推子局部原点
   _ancSx = par._ancSx * par.sx                                                    // 祖先累计缩放（含父自身，不含自己）
   tx = (target.x - _ancX) / _ancSx ;  sx = target.w / (base.w * _ancSx)          // 祖先已缩放的不再倍乘
   ```
   关键性质：**父链缩放正确时深层单元收敛到恒等 transform**（如侧栏项随 `.sidebar` scale(1.2) 整体缩放 → 项自身零变换零规则），样式表只写非恒等变换——合成层少、规则少。杜绝双重缩放（父 scale(1.2)× 子 scale(1.2) = 1.44×）。
4. **teardown**：清样式表 + 撤全部 `data-ui-reflow-unit`（成对零残留）。`data-ui-reflow-unit` 只在首次渲染时 set（hasAttribute 防重复 set 触发样式失效）。

### 与 4 块预览的关系（互斥门控）
- 采样就绪（`prepare()` 返回 true）：`_uiScalePreviewApply` 走 `__uiScaleReflow` → 设 `html[data-ui-reflowing]`，**不写 `--ui-preview-scale`、不挂 `data-ui-previewing`**——两套 transform 规则绝不叠加（4 分块规则特异性 0-2-1 会盖过 reflow 样式表 0-1-0）。
- 采样未就绪 / 页面变化 / 失败：自动回落 4 块预览（`--ui-preview-scale`）。拖动前 `_uiScaleReflowWarm`（进设置页 350ms 后台采样）保证就绪。
- 不用 `will-change:transform`：会提升数百合成层；有 transform 的单元本就提升，无 transform 的无需提升。

### 为什么「完全体现真实重排布局」
目标位来自对真实页面同一引擎同一视口的 `--ui-scale` 采样（唯一同源），拖动插值即目标 scale 的真实重排几何：侧栏扩张、内容列收窄、卡片位移全按真实发生。

### 为什么「仍是非重排预览」
拖动期真实页只被写属性/动态样式表 + 合成器 transform，零 reflow 零 repaint（生产实测 client-main scaleX<1 内容列真实收窄、--ui-scale 全程不动）；重排只发生在采样瞬间（一次性 9 档同帧，~150-400ms 进设置页后台预热）；commit 仍一次真重排，成本与 v0.25 相同。

### 与项目铁律相容性
- JS 只写 CSS 变量/属性/动态样式表，transform 全在 CSS 呈现层消费；无内联样式、无 transition/逐帧动画、无 zoom。
- 采样档位常量单源 `CONFIG.UI_SCALE_REFLOW_SAMPLE_STEP`。
- 领域懒加载集（DOMAIN_FILES）新增 ui-scale-reflow.js（仅客户端设置页用；app-state typeof 防御访问，boot 保持精简）。

### 单元测试（test/ui-scale-reflow.test.js，7 例）
stub getBoundingClientRect 用确定性真实重排模型（侧栏 240·sf 扩张、内容列右缘钉 1280 左缘被顶右收窄）验证：采样档位 [80..120] step5 且采样后 --ui-scale 还原；renderAt(100) 全恒等零规则；renderAt(120) 顶栏钉宽/侧栏扩张/内容列 sx≈0.954 收窄；侧栏项收敛恒等（无双重缩放）；teardown 成对零残留；页面切换 prepare 重采。

### 做不到的边界（沿用调研结论）
1. 拖动期逐帧连续真重排不可见（硬边界：禁拖动期重排 + 真重排=全树 reflow 两红线）；元素级预览是真实重排几何的插值模拟，文本折行/换行不逐字重排（盒与位移真实，内容流按 transform 缩放呈现）。
2. fixed 浮层（modal/tour/toast/下拉）不在预览范围（`#modal-container`/`#toast-container` 在壳外）。
3. commit 后以真实页为准（预览与 commit 的几何同源，像素级一致由采样机制保证）。
