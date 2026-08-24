# M6 C5 身份认证 · 模块内部契约（文件级隔离，2026-08-22）

> 模块负责人（主会话/lead）钉死：每个基元一个独立文件 + 精确导出接口 + 依赖。子 agent 只写自己的文件，
> 禁止触碰共享文件/他人文件。真源：docs/module-plans/M6.md + docs/新前端需求.md §C5 + docs/interfaces.md §19
> (I-01..07) + 本文件。收口时本文件随实现更新（接口漂移以代码为准但需回改本文件）。

## 0. 全局规则（所有文件遵守）
- **契约 6**：零内联事件/样式属性（源码无 `onclick=`/`onload=`/`style=` 字面量）；零运行时 `<style>` 注入；
  零 `v-html`；**零中文文案/注释**（所有用户可见文案走 `src/constants/m-auth.js`；注释一律英文）。
- **CSP**：`style-src-attr 'none'` → 禁 HTML `style="..."` 字面量与 `setAttribute('style')`；**允许** Vue `:style`
  绑定与 `el.style.setProperty`（CSSOM 数据通道，UiButton/UiModal 先例）。
- **消费 M0**：从 `@/components/ui/index.js` 导入（UiButton/UiInput/UiCaptchaInput/UiModal/UiText…）；
  禁深路径导入。api 走 `@/core/api.js`（路径**不带** `/api` 前缀，api() 自动前置；`auth:false` 公开端、
  `auth:true` 注入 X-Auth-Token + 401→auth:dead 单点）。
- **动效**：JS 只切类，动画全 CSS；`prefers-reduced-motion` 降级。
- 几何：375px 视口不横向溢出；浮窗面板不越界。

## 1. 常量（跨文件单源，值钉死；定义于 authMethod.js，勿重定义）

```js
AUTH_SCENES  = Object.freeze({ LOGIN:'login', REGISTER:'register', VERIFY:'verify' })
AUTH_METHODS = Object.freeze({ OTP_PHONE:'otp_phone', OTP_EMAIL:'otp_email', PASSWORD:'password' })
```

## 2. 基元 ↔ 文件 ↔ 导出接口 ↔ 依赖（写隔离）

| # | 基元 | 文件（唯一所有权） | 导出接口 | 依赖 |
|---|---|---|---|---|
| M6-1 | 文案单源 | `src/constants/m-auth.js` | `AUTH_COPY`（TITLE / METHOD_TITLE{} / METHOD_SWITCH_LABEL{} / IDENTIFIER_PLACEHOLDER_* / PASSWORD_PLACEHOLDER / CAPTCHA_* / ROLE_* / INVITE_* / AGREE_*） | 无（只读 authMethod 常量值，字符串直接写字面量键） |
| M6-2 | C5 浮窗壳层 | `src/modules/auth/AuthShell.vue` | props: `open, scene, contactMasks, closeOnOutside(true)`; emits: `close, update:open`; slots: `default`, `footer-left`(默认=取消按钮), `footer-right` | M0 UiModal/UiButton; m-auth |
| M6-3 | 认证方式状态机 | `src/modules/auth/authMethod.js` + `useAuthMethod.js` | 纯函数：`AUTH_SCENES/AUTH_METHODS/isOtp(m)/availableMethods(scene,masks)/defaultMethod(scene,masks)/otherMethods(scene,masks,current)`；组合式：`useAuthMethod(sceneRef,masksRef)` → `{current,credential,resetTick,available,others,switchMethod}` | 无 / vue |
| M6-8a | 拼图渲染层 | `src/modules/auth/puzzle/puzzleRender.js` | `PUZZLE_W/H/SLIDER_W/H/PUZZLE_MAX_X/PUZZLE_TOLERANCE/GAP_SHAPES/drawGapShape(ctx,cx,cy,r,shape)/paintCaptcha(ctx,pctx)` → `{target,shape,id}` | 无 |
| M6-4 | 验证码输入行 | `src/modules/auth/OtpRow.vue` | props: `method,value,countdown,sendDisabled,identifier,identifierPlaceholder,identifierFilter`; emits: `update:value,update:identifier,send`; exposes: `startCountdown(sec)` | M0 UiCaptchaInput/UiInput; m-auth |
| M6-6 | 密码输入模式 | `src/modules/auth/PasswordRow.vue` | props: `value,identifier,identifierPlaceholder`; emits: `update:value,update:identifier` | M0 UiInput; m-auth |
| M6-7 | 三选二按钮 S1 | `src/modules/auth/MethodSwitch.vue` | props: `methods,current`; emits: `select` | M0 UiButton; m-auth |
| M6-8b | 拼图交互+本地验证 | `src/modules/auth/CaptchaPuzzle.vue` | emits: `verified(captchaId)`; exposes: `reset()` | puzzleRender; m-auth |
| M6-5 | 发送验证码链路 | `src/modules/auth/useOtpSend.js` | `useOtpSend()` → `{sending,send({channel,target,scene})→Promise<boolean>}`（成功 toast=UI_COPY.OTP_SENT） | api; useCountdown; useToast; ui.js |
| M6-9 | 底部按钮行+灰态门禁 | `src/modules/auth/AuthFooter.vue` | props: `canConfirm,busy`; emits: `confirm` | M0 UiButton; m-auth |
| M6-10 | 确认提交链路（I-06） | `src/modules/auth/useConfirmSubmit.js` | `useConfirmSubmit()` → `{submitting,submit({type,value,captchaId})→Promise<boolean>}`（body `{credential:{type,value},captchaVerified:true,captchaId}`；captchaId 由 CaptchaPuzzle verified 事件传出，#108） | api; useToast |
| M6-13 | 注册模式 | `src/modules/auth/RegisterPane.vue` | props: `open`; emits: `submit(payload),close`（payload 对齐 I-03 body） | M0 输入/角色; OtpRow; useOtpSend; m-auth; api |
| M6-11 | 对外入口+生命周期 | `src/modules/auth/index.js` + `authState.js` + `AuthHost.vue` | `openIdentityAuth({scene,contactMasks,onVerified})`; `closeIdentityAuth()`; `isAuthOpen`; `authOverlay`(reactive); `AuthHost`(App.vue 挂载一次); registerIface('openIdentityAuth') 副作用 | AuthModal + 全部 |
| 组装 | 组合根 | `src/modules/auth/AuthModal.vue`（负责人写） | props: `open,scene,contactMasks,onVerified`; emits: `close,update:open` | AuthShell + 4/5/6/7/8b/9/10/13 |
| 预览 | dev 测试面 | `src/modules/auth/AuthPreview.vue`（负责人写）+ `preview/auth.html` + `preview/auth.js` 静态 harness（dev server `/preview/auth.html`） | 供 smoke-auth-shell 驱动 | AuthModal |
| 测试 | 模块级浏览器验证 | `test/smoke-auth-shell.mjs`（负责人写） | 手动 `node test/smoke-auth-shell.mjs` | 全部 |

## 3. 批次与依赖图（并行策略）

```
批1（并行）：M6-1 文案 → M6-3 状态机 → M6-2 壳 → M6-8a 拼图渲染
批2（并行）：M6-4 验证码行 → M6-6 密码 → M6-7 三选二 → M6-8b 拼图交互（依赖 8a）
批2b（并行）：M6-5 发送链路（依赖 4 契约）→ M6-13 注册模式（依赖 3/4/5/8b 契约）
批3（并行）：M6-9 底部+灰态（依赖 3/8b 契约）→ M6-10 确认提交（依赖 9 契约）
收口（负责人）：M6-11 index.js + AuthModal.vue 组装 + AuthPreview.vue + pages.js 注册 + ui.js re-export + test/smoke-auth-shell.mjs + npm run build
```

## 4. 认证方式状态机语义（M6-3，钉死，四用例）

- `availableMethods(scene, masks)`：
  - register → `[otp_phone, otp_email]`（注册走验证码通道，无密码方式）
  - login → `[otp_phone, otp_email, password]`（登录前无法得知用户绑定通道，恒提供双通道；identifier 字段承载
    用户名/手机号/邮箱，验证码通道跟随输入格式；不依赖 contactMasks）
  - verify → `[otp_phone?(masks.phone), otp_email?(masks.email), password]`（登录用户已绑定通道已知，
    验证码通道随 contactMasks 显隐；password 恒在末尾兜底）
- `defaultMethod(scene, masks)` = available 中第一个非 password 者；全无 OTP → password（"永不默认密码"= 有 OTP 时永不以密码为默认）。
  - 四用例：`{phone:1,email:1}→otp_phone`；`{phone:1,email:0}→otp_phone`；`{phone:0,email:1}→otp_email`；`{phone:0,email:0}→password`
- `otherMethods(scene,masks,current)` = available 中 ≠ current 者（三选二按钮 S1 恰好显示两种）。
- `useAuthMethod`：watch `[scene,masks]`(deep) → 重算默认 + 清 credential + `resetTick++`；`switchMethod(to)` 同语义（非法/相同 no-op）。

## 5. 拼图移植规格（M6-8a/8b，对齐 v2 像素级）

- 常量（v2 captcha.js 原值）：`PUZZLE_W=280, PUZZLE_H=120, SLIDER_W=40, SLIDER_H=40, PUZZLE_MAX_X=240, TOLERANCE=0.08`；`GAP_SHAPES=['square','circle','triangle','diamond','pentagon']`；形状半径 `R = SLIDER_W/2 - 4 = 16`。
- 渲染：随机线性渐变底 + 420 噪声点（1.2px）；随机目标 `target ∈ [16, MAX_X-24]/MAX_X`；切口 `cutX=target*MAX_X, cutY=(H-SLIDER_H)/2`；拼图块=切口图像 `destination-in` 裁形状 + 白色描边（rgba(255,255,255,.85) 2px，跟随异形轮廓）；背景缺口 `destination-out` 打洞 + 同描边；2 个干扰洞（随机 24+ 范围，穷举回退确定性左上/右下槽，三洞间距 > 直径 32 不重叠）。
- 交互：pointerdown/move/up + setPointerCapture；`--captcha-x` CSS 变量数据通道（setProperty，CSP 安全）。
- 验证（AK-A1a 本地判定）：释放时 `isPuzzleAligned(offset,target,TOLERANCE)`（`|offset-target|<=0.08` 浏览器本地比对）→ 即时 emit('verified')，零网络往返；失败 → shake 类 + 420ms 后重置重绘。tip 文案走 AUTH_COPY（CAPTCHA_TIP/PASS/FAIL/ARIA，v2 逐字）。拼图为反滥用 UX 门禁非认证边界（真实防线=服务端凭证+限流，AK-A1b 后服务端不再确认挑战）。
- 提示语义（AK-A3）：持久提示 CAPTCHA_TIP 入轨道内 `.captcha-puzzle__hint`（绝对居中，--fs-xs 12px，被 `.captcha-puzzle__fill` 遮罩盖住左侧随拖动，pass 时 is-pass 淡出）；轨道下方 `.captcha-puzzle__tip` 收敛为纯 PASS/FAIL 状态行（idle 时 display:none）。DOM 序钉死 hint < fill < knob。

## 6. 接口契约（interfaces.md §19 权威，M6 消费）
> 路径为线上完整形态；调用侧经 `@/core/api.js` 的 `api()` 调用时**省略 `/api` 前缀**（api() 自动前置）。

- **I-01** `POST /api/auth/otp/request` 公开 auth:false｜`{channel:'sms'|'email',target,scene?}`→`{ok}`
- **I-02** `POST /api/auth/login/code` 公开 auth:false｜`{identifier,code,deviceId?}`→`{user,authToken}`
- **I-03** `POST /api/auth/register` 公开 auth:false（teacher 须 inviteCode）｜`{username,password,role,inviteCode?,otpChannel,phone?|email?,code,agreeAgreement,agreePrivacy,deviceId?}`→`{user,authToken,message}`
- **I-06** `POST /api/auth/verify` 登录 auth:true｜`{credential:{type:'otp'|'password',value},captchaVerified:true,captchaId}`→`{verified:true,capToken}`（AK-A1b 起 captchaId 仅关联 id，服务端不再确认拼图）
- ~~**I-07** `POST /api/captcha/verify`~~ **已删除（AK-A1b）**——拼图浏览器本地判定（AK-A1a），不再消费服务端验证端点
- I-05 `GET /api/auth/me` → `{user:{...,contactMasks:{phone,email}}}`（只给布尔不给值；M6-3 默认判定输入）

## 7. 分界注记（防双份清理）

- **M6-2 管壳层自关**：遮罩点击/取消按钮/Esc 关闭 → emit('close')。UiModal 自身负责 body scroll lock 释放 + Teleport 卸载（无残留）。
- **M6-11 管对外生命周期**：openIdentityAuth 挂载/卸载、三出口清理（onVerified 成功 / 取消 / 强制关闭）、F3 去重（重复 open 幂等）。两处不重复做清理。

## 8. 负责人组装清单（非子 agent）
- `AuthModal.vue` 组合根（状态串联 + 场景分发 + 提交分发）
- `src/modules/auth/index.js` openIdentityAuth（M6-11）
- `AuthPreview.vue` dev 测试面 + `src/pages.js` 注册 `auth`（devOnly:true）
- `src/constants/ui.js` re-export `AUTH_COPY`
- `test/smoke-auth-shell.mjs`
- `npm run build` 验证
