# M5 notifications module · CONTRACT.md（文件级隔离契约，2026-08-22）

> M5 = C3 通知 + C4 更多（设置/关于/反馈）19 基元。每个基元一个独立文件（写隔离），
> 主会话/模块负责人组装收口。子 agent 只写自己文件，禁止触碰共享文件。

## 共享文件（模块负责人所有，子 agent 只读）
| 文件 | 职责 | 说明 |
|---|---|---|
| `src/constants/m-notifications.js` | 文案单源 | 全部用户可见中文只在此（契约 6） |
| `src/modules/notifications/auth.js` | 认证门控薄接缝 | `requireAuth/setRequireAuthHandler`（读 M2 authStore，无模块级 authed 布尔） |
| `@/core/api.js` | api 单点（全站唯一 fetch） | 模块全部网络调用走 `api()`；反馈两处 `auth:false` 保匿名 |
| `src/modules/notifications/data.js` | M5-01 通知数据层 | I-26/27 + 缓存 + unread 单源 |
| `src/modules/notifications/index.js` | M5-00 模块入口 | `openC3/openC4/openSettings` + `overlay` reactive + `M5Host` 导出 |
| `src/modules/notifications/pages.js` | 模块页面注册表 | M2 路由消费 |

## 基元 → 文件映射（写隔离）
| 基元 | 文件 | 导出 | 依赖（只读） |
|---|---|---|---|
| M5-00 入口接线 | `index.js` + `M5Host.vue` + `MoreMenu.vue`(底座) | openC3/openC4/openSettings, overlay | data/auth/core-api/m-notifications/M0 |
| M5-01 通知数据层 | `data.js` | notifyState/loadNotifications/unreadCountRef/markRead/markAllRead/startNotifyPolling/stopNotifyPolling/formatNotificationTime | core-api/m-notifications |
| M5-02 通知卡片 | `NotificationCard.vue` | NotificationCard（props item, emits open） | M0 UiCard/UiIcon/m-notifications/data.format |
| M5-03 屏蔽系统通知 | `BlockSystemToggle.vue` | BlockSystemToggle（I-28 持久化 + 列表过滤） | M0 UiCheckButton/core-api/data/m-notifications |
| M5-04 已读语义 | `read.js` | useReadSemantics（单条+退出批量静默+失败回滚） | data/core-api |
| M5-05 详情页+切换动效 | `NotificationDetail.vue` | NotificationDetail（props item, emits back/close） | M0/m-notifications |
| M5-06 更多下拉栏（SVG+保留区） | `MoreMenu.vue`（终版） | MoreMenu（props open/trigger, emits close/open-settings/open-about/open-feedback） | M0 useAnchoredPanel/UiButton/m-notifications |
| M5-07 设置骨架 | `SettingsPanel.vue` | SettingsPanel（props open, emits close；两栏+左切右滚+双向同步+中间分割线） | M0 UiModalA1/UiButton/m-notifications |
| M5-08 设置数据层 | `settings-data.js` | settingsState/loadSettings/updateSettings + F7 | core-api/m-notifications |
| M5-09a 用户名 | `SettingsUsername.vue` | SettingsUsername（props value, emits saved） | M0/settings-data/m-notifications |
| M5-09b 头像 | `SettingsAvatar.vue` | SettingsAvatar（I-11 + 裁切） | M0/settings-data/m-notifications |
| M5-09c 联系方式 | `SettingsContact.vue` | SettingsContact（I-12） | M0/settings-data/m-notifications |
| M5-10 外观 | `SettingsAppearance.vue` | SettingsAppearance（主题/UI 缩放） | M0/settings-data/m-notifications |
| M5-11 设备管理 | `SettingsDevices.vue` | SettingsDevices（I-13） | M0/settings-data/m-notifications |
| M5-12 注销账户 | `SettingsDeactivate.vue` | SettingsDeactivate（capToken+F7） | M0/settings-data/auth/m-notifications |
| M5-13 关于平台 | `AboutModal.vue` | AboutModal（props open, emits close） | M0 UiModalA1/m-notifications |
| M5-14 反馈骨架 | `FeedbackModal.vue` | FeedbackModal（props open, emits close；左栏切换复用 M0/M5-07 底座） | M0/m-notifications/FeedbackForm/FeedbackTickets |
| M5-15 反馈提交区 | `FeedbackForm.vue` | FeedbackForm（匿名提交硬约束） | M0/core-api/m-notifications |
| M5-16 我的工单 | `FeedbackTickets.vue` | FeedbackTickets（匿名身份模型） | M0/core-api/m-notifications |

## 组装职责（模块负责人，非子 agent）
- 入口接线（index.js openC3/openC4/openSettings）
- 文案汇 `m-notifications.js`
- `M5Host.vue` 装配全部浮窗/下拉
- `SettingsPanel.vue` 装配 09a..12 设置行
- `NotificationsModal.vue`（负责人持有，装配 02 卡片 + 03 复选 + 04 已读 + 05 详情）
- `test/smoke-notifications.mjs` + `m5-preview.html` + `PreviewM5.vue`
- `npm run build` 验证

## 纪律（复核注记 7 条）
1. M5-00 被拦路径负用例（未登录点击）。
2. M5-03 变异锚点（删持久化红/删过滤红）。
3. M5-04 负路径（仅「被看到过」的通知退出批量已读）。
4. M5-07/M5-14 复用 M0 左栏切换底座；M5-07 = 左右栏中间分割线 + 设置项之间无分割线。
5. M5-02 复用 M0 UiCard B1 基座。
6. M5-15 性质切换各表单几何 + 切换后清态。
7. M5-16 两路径断言（未登录 clientToken / 登录 user id 优先）。
