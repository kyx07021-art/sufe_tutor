# M4 C2 会话模块 · 模块契约（CONTRACT.md）

> 模块负责人钉死：每基元独立文件路径 + 导出接口 + 依赖（文件级隔离）。子 agent 只写自己基元对应的文件，禁止改他人文件 / 基础层 / 共享接口（三层工作流 §12）。批间按九阶段依赖图串行，批内全并行。

## 0. 已交付（骨架批，M4-01/02/06a/06b/06c ✅）

| 文件 | 基元 | 说明 |
|---|---|---|
| `ChatPage.vue` | M4-01 双栏布局 + M4-06b 移动端切窗 | 20%/80% + 细分割线；移动端一次一栏，点会话切会话窗（P22 负用例） |
| `components/ChatConversationPane.vue` | M4-02 顶部淡出遮罩 + M4-06a 框架布局 + M4-06c 已结束只读门禁 | 遮罩 pointer-events:none；输入槽由 `isChatInputVisible` 单点门禁 |
| `state.js` | **输入框隐藏单点**（M4-06c/27/29 共用） | `isChatInputVisible(state)` = ended + temp-quota 双 flag |
| `components/ChatListPane.vue` | 选择栏骨架（M4-03/04/05 细化） | 卡片结构 + 选中/已结束状态类就位 |
| `index.js` | 模块统一出口 | 模块外只从这里 import |
| `pages.js`（模块内） | 页面注册（路径 /chat，student/teacher 门禁） | shell/page-registry.js 的 import.meta.glob 收集；M2-08 内存历史路由 |
| `src/constants/m-chat.js` | 文案单源（收口汇 ui.js） | `import { CHAT_COPY } from '@/constants/ui.js'` |
| `test/smoke-chat-shell.mjs` | 骨架批验收 | 双栏几何/遮罩穿透/移动切窗负用例/已结束门禁变异/零 console |

## 1. 文件级映射（34 基元 → 文件）

| 阶段 | # | 名称 | 文件 | 依赖 |
|---|---|---|---|---|
| A | M4-01 | 双栏布局+路由 | `ChatPage.vue` ✅ | pages.js |
| A | M4-02 | 顶部淡出遮罩 | `components/ChatConversationPane.vue` ✅ | useScrollFade |
| B | M4-03 | 选择卡（选中/已结束灰化） | `components/ChatListPane.vue` | state.js |
| B | M4-04 | 时间格式化映射 | `logic/timeFormat.js` | —（纯函数） |
| B | M4-05 | 未读红点生命周期（四路径状态机） | `logic/unread.js` + `components/ChatListPane.vue` | state.js |
| C | M4-06a/b/c | 框架/切窗/门禁 | `ChatConversationPane.vue`/`ChatPage.vue`/`state.js` ✅ | — |
| C | M4-07 | 消息加载渲染（游标） | `logic/messages.js` + `components/ChatMessageList.vue` | I-18 |
| C | M4-08 | 普通气泡+品牌紫滤镜 | `components/ChatBubble.vue` + `logic/colorFilter.js` | I-18 |
| C | M4-09 | 气泡发送时间映射 | `logic/timeFormat.js` | — |
| D | M4-10 | 图片消息+大图查看 | `components/ChatImageBubble.vue` | I-20 |
| D | M4-11 | 文件气泡 | `components/ChatFileBubble.vue` | I-21 |
| D | M4-12 | 文件类型 LOGO 适配器 | `components/ChatFileLogo.vue` | iconRegistry |
| D | M4-13 | 文件名截断保扩展名 | `logic/fileName.js` | —（纯函数） |
| D | M4-14 | 附件暂存上传管线 | `logic/upload.js` | I-19/20/21 |
| E | M4-15 | 特殊气泡呼吸外框 | `components/ChatSpecialBubble.vue` | I-44..46 cap |
| E | M4-16 | C2.6 提示文字（40%/80%） | `components/ChatHintText.vue` | — |
| F | M4-17 | 输入框组件 | `components/ChatInputBar.vue` | CHAT_COPY |
| F | M4-18 | 纸飞机发送 | `components/ChatInputBar.vue` | I-19, send.js |
| F | M4-19 | 输入框自增高 | `components/ChatInputBar.vue` | — |
| F | M4-20 | 加号旋转变减号+上拉栏 | `components/ChatInputBar.vue` | — |
| F | M4-21 | +号上拉栏内容 | `components/ChatInputBar.vue` | I-20/21 |
| G | M4-22 | 区内上边栏 | `components/ChatTopBar.vue` | — |
| G | M4-23 | 更多下拉栏渲染 | `components/ChatTopBar.vue` | UiDropdown |
| G | M4-24 | 结束会话确认浮窗 | `components/ChatEndConfirmModal.vue` | UiConfirmModalA1 |
| G | M4-25 | 结束会话写路径+F7 | `logic/endSession.js` | I-16, state.js |
| H | M4-26 | 临时会话发起（I-23） | `logic/tempConversation.js` | I-23 |
| H | M4-27 | 限1条+输入框消失 | `state.js` isChatInputVisible | — |
| H | M4-28 | 对方侧生成+提示+红点 | `logic/tempConversation.js` | I-17 |
| H | M4-29 | 转正式+双方提示 | `logic/tempConversation.js` | I-24 |
| I | M4-30 | 乐观发送管线 | `logic/send.js` | I-19, upload.js |
| I | M4-31 | 发送气泡入场动效 | `components/ChatBubble.vue` CSS | — |
| I | M4-32 | 轮询增量 | `logic/polling.js` | I-18 |

## 2. 单点契约（禁止在别处另写）

1. **输入框隐藏单点**：`isChatInputVisible(state)`（`state.js`）。M4-06c/27/29 三方唯一判定。ended（status==='closed'）+ temp-quota（tempStatus≠init && iAmInitiator && quotaRemaining===0）双 flag。
2. **store 键**：`chatState.conversations / activeConversationId / mobilePane`；`openConversation(id)` 必须同时置 mobilePane='chat'（P22 移动切窗）。`backToList()` 置 'list'。
3. **I-17 会话行字段**：`conversationId/otherName/avatar/lastMessage/lastAt(ISO 时间戳，列表时间走 M4-04 formatListTime)/status('active'|'closed')/unread/tempStatus/tempInitiatorId/quotaRemaining/iAmInitiator`。
4. **临时会话状态机**（I-23/24）：`init（仅发起方可见可发、配额1）→ 首条落库→sent（接收方可见+可回复、发起方 409 TEMP_QUOTA_EXHAUSTED）→ 接收方回复→formal（temp_status→NULL）`。前端输入框隐藏主防线 = isChatInputVisible temp-quota flag；服务端 409 兜底。
5. **轮询增量**（M4-32）：`sinceId` 游标 + `data-mid/seq` 去重（重复消息不渲染）+ 预览 bump。
6. **乐观发送**（M4-30）：`clientKey` 幂等 + 乐观 tempId + 失败回滚 + busy 锁（F6）。
7. **文案单源**：CHAT_COPY 只放 `src/constants/m-chat.js`，经 ui.js 收口。组件模板/样式零中文。

## 3. 依赖图（批间串行 / 批内并行）

```
A 布局 ✅ ──→ B 选择栏（03/04/05）──→ C 会话区（07/08/09）──→ D 附件（10..14）
   │                                                          │
   └──→ E 特殊气泡（15/16）──→ F 输入框（17..21）──→ G 区内栏（22..25）
                                        │
                                        └──→ H 临时会话（26..29）──→ I 发送轮询（30..32）
```

- C 依赖 B（列表选中/时间/红点）；D 依赖 C（气泡）；F/G 依赖 A/C 框架；H 依赖 C（消息渲染）+ state（isChatInputVisible）；I 依赖 F（发送入口）+ H（temp 状态机）。
- 每基元 = 一个可独立验收的原子变更（W27b）。高风险（05/14/20/25/26/30/32）走 5-agent 方案。

## 4. 子 agent 纪律

- 只写 §1 映射表里自己的文件；新建文件允许，改他人文件/基础层/共享接口禁止。
- 新文件是纯逻辑模块（.js）时不接装配 = 不破坏 build；接装配时（改 ChatPage/state/index）必须跑 `npm run build` + 相关 smoke。
- 文案一律进 m-chat.js（如缺键，在 m-chat.js 加，不改他文件）。契约 6 零内联/零中文。
- 交付后模块负责人审查并入；独立审计（G2 变异/负路径）由审计 agent 复核。
