# M8 A2 我的需求 · 模块契约（CONTRACT.md）

> 模块负责人建立。钉死每基元独立文件路径 + 导出接口 + 依赖（文件级隔离，批内并行子 agent 只写自己文件，模块负责人审查后并入）。不 commit。
> 真源：docs/新前端需求.md §A2/A2.1 + docs/interfaces.md §19 I-33..38 + docs/module-plans/M8.md。

## 数据模型（I-33/35/36/38 行形状，单科目新模型）

```
{
  id, user_id, subject, targetType(派生), grade, province, teachingMethod,   // 'online'|'offline'|'both'
  currentScore, currentScoreFull, addressArea, expectedTime,
  preferredTags,      // 偏好性格标签数组（M8-10c 收集）
  preferredGender,    // 'male'|'female'|...
  budgetMin, budgetMax, additionalInfo, status, createdAt,
  // I-34/I-38 附：studentName, studentAvatar, matchScore, matchCount（教师广场行，M9 消费）
}
```

## 基元文件映射（每基元 = 一个独立文件/小集，文件级隔离）

| # | 文件 | 导出 | 依赖 | 归属批 |
|---|---|---|---|---|
| M8-01 | `src/modules/my-demands/DemandGrid.vue` | `DemandGrid` | M0 tokens | 批1 |
| M8-02 | `src/core/api.js` / `src/core/datahub.js` / `src/modules/my-demands/useDemands.js` | `api, ApiError` / `dhGet,dhSet,dhHas,dhInvalidate,dhFetch` / `useDemands` | — | 批1 |
| M8-03 | `src/modules/my-demands/DemandPlusSlot.vue` | `DemandPlusSlot` | M8-01, M8-06 打开 | 批2 |
| M8-04 | `src/modules/my-demands/DemandCard.vue` | `DemandCard`（M9 复用，mode prop） | M0 UiCard/UiIcon/UiText + 常量 | 批1 |
| M8-05 | `src/modules/my-demands/useDemandInteraction.js` | `useDemandInteraction` | M8-04, M8-06/13 | 批2 |
| M8-06 | `src/modules/my-demands/DemandEditorModal.vue` + `useDemandForm.js` | `DemandEditorModal` / `useDemandForm` | M0 UiStepModal + M8-07..11 | 批3 |
| M8-07 | `src/modules/my-demands/steps/StepGradeProvince.vue` | `StepGradeProvince` | SUFE_REGIONS | 批4 |
| M8-08 | `src/modules/my-demands/steps/StepSubjectMethod.vue` | `StepSubjectMethod` | M8-07 | 批4 |
| M8-09 | `src/modules/my-demands/steps/StepScore.vue` | `StepScore` | region 策略 | 批4 |
| M8-10a | `src/modules/my-demands/steps/StepAddress.vue` | `StepAddress` | M8-08 method | 批4 |
| M8-10b | `src/modules/my-demands/steps/TimeSlotEditor.vue` | `TimeSlotEditor` | M0 UiVariableInputSet | 批4 |
| M8-10c | `src/modules/my-demands/steps/StepPreferences.vue` | `StepPreferences` | personality 标签 | 批4 |
| M8-11 | `src/modules/my-demands/steps/StepIntroSubmit.vue` | `StepIntroSubmit` | M8-12 | 批4 |
| M8-12 | `src/modules/my-demands/useDemandSubmit.js` | `useDemandSubmit` | api + I-35/36 | 批5 |
| M8-13 | `src/modules/my-demands/useDemandEditPrefill.js` | `useDemandEditPrefill` | api + I-38 | 批5 |
| M8-14 | `src/modules/my-demands/useDemandDelete.js` | `useDemandDelete` | api + I-37 + invalidate | 批6 |
| M8-15 | `test/smoke-my-demands.mjs` + `MyDemandsPage.vue`（组装） | — | 全部 | 批6 |

## 共享接口契约

- **页面注册（M2-08 路由注册表消费）**：`src/modules/my-demands/pages.js` 导出 `pages` 数组，页定义 `{ path, name, roles?, component, meta? }`——path=`/my-demands`、name=`my-demands`、roles=`[ROLES.STUDENT]`（ROLES 取 `@/modules/shell/auth-store.js`）、meta.tab=true + meta.title=MY_DEMANDS_COPY.PAGE_TITLE（TabBar 显示 meta.title）。`shell/page-registry.js` 的 glob 只合并「元素全部为页定义的数组」，单对象导出（旧式 id + 角色集 + 组件）会被静默跳过，必须用数组形态。
- **文案/显示映射单源**：`src/constants/m-my-demands.js`（MY_DEMANDS_COPY / DEMAND_METHOD_LABEL / DEMAND_GENDER_LABEL）。组件模板零中文（契约 6）。
- **API 单点**：所有网络调用走 `src/core/api.js` 的 `api(path, {method,body})`；`api()` 自动前缀 `/api` + 注入 X-Auth-Token + 401 单点清 token + dispatch `window 'auth:dead'`（M2 钩子）。非 2xx 抛 `ApiError{status,code,message}`。
- **缓存单点**：`src/core/datahub.js` `dhFetch('demands', loader, {force})` / `dhInvalidate('demands')`（F7：写后失效）。红点轮询与页面读取共享。
- **DemandCard 领域渲染器**（M9 复用）：`mode: 'student'|'teacher'`；student CTA=编辑需求 / teacher CTA=去联系试课；click → emit `select`。M9 传 I-34 行（含 studentName/studentAvatar）。
- **卡片交互分流（M8-05）**：student 点卡片 → openEditModal(demandId)（M8-06/13）；teacher 模式点卡片 = no-op（本模块不接会话，跳转会话属 M9 职责——M9 复用 DemandCard `mode="teacher"` + `@select` 接线）；`interactionCap` 已从 useDemandInteraction 移除。
- **步进浮窗（M8-06..13）**：使用 M0 UiStepModal；步进页 = 展示组件，直接接收 reactive `:form` prop 并就地修改（form-prop 契约，非 modelValue/options + emits），控制器 useDemandForm 持 reactive 表单 + 必填门禁；逐值回显归 M8-13；提交写路径归 M8-12。
- **网格布局（M8-01）**：三列槽宽 28.33% / 左右 5% / 卡间 2.5%（页宽百分比，7 列显式网格）；行高定值 `--demand-card-h: 240px`；移动端（≤640px）一列（5% + 90% + 5%）；加号槽 = 网格最后子元素（nth-child 定位到下一空槽，M8-03）。

## 验收纪律

- 每基元独立实现 + 模块负责人审查后并入；复杂基元（06-13）须含变异守护/负路径/几何断言。
- G5 几何：桌面 1440 + 移动 375 双 viewport 断言（网格不溢出、卡片在槽内）。
- 契约 6：零内联事件/样式属性、零 v-html 注入、零 createElement('style')、零中文文案含注释。
- reduced-motion：动效走 CSS transition/animation + token 时长；全局 base.css 兜底。

## 实现状态（2026-08-22，模块负责人收口中）

- **M8-01..17 全部已实现**（磁盘 21 文件；实现于会话中断前 + 本会话收口）。
- 组装：MyDemandsPage（网格 + 卡片 + 加号槽 + 编辑浮窗 + 交互分流 + F7 刷新）。
- 预览：`new-frontend/preview/my-demands.html`（dev-only，Vite 多入口，未入生产构建）。
- 测试：`new-frontend/test/smoke-my-demands.mjs` 全绿（桌面/移动几何 + 缓存/invalidate + 401 + 卡片结构 + M9 复用 shape + 步进浮窗 create/edit/delete 全链路 + 零 console）。
- 构建：`npm run build` 绿（生产构建不含 preview 入口；模块经 dev server 变换验证）。
- **独立审计进行中**（4 个并行审计 agent：M8-06 控制器 / M8-07-09 步骤 / M8-10-11 步骤 / M8-01-05+15 组装与测试）。审计发现修复后再收口。
- **待收口**：契约 6 注释中文化清理（注释改英文 + 代码内 fallback 中文移 constants）——审计确认后统一修。
- **观察项**：①region.js 为模块内临时政策单源，标注 S3 收口（勿双维护）；②上海结构化区/街道选择器暂以自由文本地址替代（待 S3 区域契约）；③M8-11 简介/标签/提交并入 StepPreferences（步 5）+ modal footer 提交接线；④M8-05 教师侧 data-cap 供 M9-B1-7 接线。
