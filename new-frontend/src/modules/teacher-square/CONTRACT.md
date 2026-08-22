# M7 A1 教师广场 · 模块文件级契约（CONTRACT）

> **完成状态（2026-08-22）**：23 基元全部实现。M7-01..05/12（核心批）+ 装配由模块 lead 直接实现；M7-06..11/13..22 由 17 个并行子 agent 实现（每基元一文件）。`npm run build` 绿；`node test/smoke-teacher-square.mjs` 全绿（纯函数变异守护 + 浏览器渲染/筛选/详情/移动端 + 契约 6 静态扫描）。页面注册 `src/modules/teacher-square/pages.js`（M2 路由 glob 消费）。共享件 `SortBar.vue`/`useMatchGroup.js` 在 `components/shared/`（并行 agent 建入，本模块消费）。

> 每基元 = 一个独立文件（文件级隔离）。子 agent 只写自己文件；跨文件依赖经导入接口，禁改他人文件。
> 共享件（M0 解冻，已由并行 agent 建入，**本模块只消费勿改写**）：
>   `src/components/shared/SortBar.vue` — 排序选项卡（props: options[{key,label}]/modelValue; emits: update:modelValue/select；**本模块只绑 update:modelValue，勿双绑**）
>   `src/components/shared/OrderToggle.vue` — 升降序圆钮（M7-05/M9-B1-3b 单源；props: order/ariaLabel; emits: toggle/update:order）
>   `src/components/shared/useMatchGroup.js` — 命中分组纯函数（dimension shape `{key, active(filters), matches(item,filters)}`；`matchGroup(items,filters,dimensions,sortBy)` 返回 `[{count,items}]`）
> 文案单源：`src/constants/m-teacher-square.js`（模板/组件零裸中文，契约 6）。

## 文件分配（基元 → 文件）
| # | 基元 | 文件 | 导出接口 | 依赖 |
|---|---|---|---|---|
| M7-01 | 教师列表获取与响应映射 | `teachers-api.js` | `I29_PATH` `buildTeachersQuery` `mapTeacherResponse` `mapTeacherResponseList` `fetchTeachers` | sort.js |
| M7-02 | 排序偏好持久化+筛选重置 | `prefs.js` | `loadSortPref` `saveSortPref` `emptyFilters` | — |
| M7-03 | 列表排序纯函数 | `sort.js` | `SORT_KEYS` `midPrice` `makeTeacherSorter` `sortTeachers` | — |
| M7-04 | 第二上边栏+排序选项卡 | `SecondBar.vue` | default comp（props: sortKey/order/showFilter; emits: update:sortKey/update:order/filter-click） | SortBar(shared), OrderToggle, m-teacher-square |
| M7-05 | 升降序圆钮+SVG | 共享 `components/shared/OrderToggle.vue` | props: order/ariaLabel; emits: toggle/update:order | M0 sort-asc/sort-desc.svg |
| M7-06 | 筛选按钮+第三上边栏展开动效 | `FilterReveal.vue` | default comp（v-model:open; props: thirdBar slot; emits: toggle） | SortBar filter-click |
| M7-07 | 第三上边栏容器+筛选项目卡 | `ThirdBar.vue` | default comp（v-model:active; slot: 筛选项卡片） | FilterReveal |
| M7-08 | 科目筛选器（双纵列复选） | `SubjectFilter.vue` | default comp（v-model:value string[]; emits: change） | UiDropdown/UiCheckButton |
| M7-09 | 性别筛选器 | `GenderFilter.vue` | default comp（v-model:value string） | UiCheckButton |
| M7-10 | 性格筛选器 | `PersonalityFilter.vue` | default comp（v-model:value string[]） | UiCheckButton |
| M7-11 | 报价区间筛选器 | `PriceFilter.vue` | default comp（v-model:value {min,max}） | UiInput |
| M7-12 | 筛选纯函数+命中数分组重排 | `match-dimensions.js` | `TEACHER_MATCH_DIMENSIONS` `priceHit`（shape `{key,active(filters),matches(item,filters)}`） | shared/useMatchGroup |
| M7-13 | 筛选更改即应用+动效重播 | `useFilterApply.js` | `useFilterApply({ items, dimensions, filters, sortBy })` → { groups, items, nonce, replay } | shared/useMatchGroup |
| M7-14 | 进入页面动效 | `PageEnter.vue` | default comp（wrapper; props: stage） | M0 useScrollFade 同型 |
| M7-15 | 名片网格（四列/移动两列） | `CardGrid.vue` | default comp（props: items; emits: open(t)） | TeacherCard |
| M7-16 | 卡片滚动脱离动效 | `useScrollDetach.js` | `useScrollDetach({ el, centerGetter })` 位移 ∝ RELU(h-center-const) | — |
| M7-17 | 教师名片渲染（四层） | `TeacherCard.vue` | default comp（props: teacher; emits: click） | UiCard/UiIcon |
| M7-18 | 详情浮窗容器+三栏+数据加载 | `TeacherDetailModal.vue` | default comp（v-model:open; props: teacherId; emits: close, send-message） | DetailLeft/Middle/Right |
| M7-19 | 详情左栏渲染 | `DetailLeft.vue` | default comp（props: teacher） | UiText |
| M7-20 | 详情中栏 | `DetailMiddle.vue` | default comp（props: teacher, reviews） | RatingStars |
| M7-20a | 五星比例填充组件 | `RatingStars.vue` | default comp（props: score） | star.svg |
| M7-21 | 详情右栏+发消息 | `DetailRight.vue` | default comp（props: teacher, isStudent; emits: send-message） | UiButton |
| M7-22 | 发消息动作 | `TeacherSquarePage.vue` + `actions.js` | 调 chat 模块边界 `startTempConversation(teacherId, firstMessage)`（I-23）→ 成功 `navigateToConversation(convId)` 路由进 /chat | I-23/I-25 |

## 页面装配（组装收口，主会话）
- `TeacherSquarePage.vue` 组装：SecondBar → FilterReveal/ThirdBar（M7-06/07 挂载时）→ CardGrid/TeacherCard（M7-15/17 挂载时）→ TeacherDetailModal（M7-18..22 挂载时）。
- 页面注册：中央 `src/pages.js`（`teacherSquare: { component, auth:'logged-in' }`，App.vue 按 `?page=teacherSquare` 分发）；模块 `index.js` 收口 re-export。

## 关键契约面（6 条，审计变异守护主靶点）
①报价排序=中间价 (min+max)/2、单边用单边、双 null 置后（sort.js）
②报价筛选=区间交叉命中（单/双边）（match-dimensions priceHit）
③命中数=维度命中对数之和+分组重排、组内按排序偏好（useMatchGroup）
④排序偏好保留/筛选重置（prefs.js）
⑤「发消息」学生可见门禁（DetailRight.vue）
⑥卡片滚动脱离位移公式 RELU(h−center−const)（useScrollDetach）

## 纪律
- 契约 6：模板/注释零裸中文；零内联事件/样式属性；零 createElement('style')；零 v-html 注入。
- 消费 M0（UiButton/UiIcon/UiCard/UiText/UiDropdown/UiCheckButton/UiInput）；CSS 变量单源 tokens.css。
- reduced-motion 尊重；375 几何不溢出。
