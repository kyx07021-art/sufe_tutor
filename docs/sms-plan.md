# 手机号 + 短信验证码注册 激活方案

对应休眠模块：`server/sms-auth.dormant.js`（已实现，未接路由，部署后线上零变化）。
本文档是它的激活手册：接入机制要点、逐步激活清单、存量迁移策略、灰度方案，
以及待产品负责人拍板的开放问题。

## 一、国内短信验证码接入机制要点

两家厂商流程高度一致：实名认证 -> 创建签名（短信开头的【xxx】）-> 创建模板
（正文含变量占位符）-> 等人工审核 -> 审核通过后才能调 API 发送。签名必须先于
模板通过。审核时段一般为每天 9:00-21:00，预计 2 小时内出结果。

### 阿里云（Dysmsapi）
- 开通短信服务后，控制台或 API（CreateSmsSign / CreateSmsTemplate）申请签名与模板。
- 发送接口：SendSms（Version 2017-05-25），接入地址 dysmsapi.aliyuncs.com。
- 关键参数：PhoneNumbers、SignName、TemplateCode（形如 SMS_xxx）、
  TemplateParam（JSON 字符串，如 {"code":"123456"}）。
- 鉴权为 RPC 风格 HMAC-SHA1 请求签名，签名密钥为 AccessKeySecret 末尾加 '&'。
- 成功判定：响应 Code === 'OK'。
- 来源：
  - https://help.aliyun.com/zh/sms/getting-started/get-started-with-sms
  - https://api.aliyun.com/document/Dysmsapi/2017-05-25/SendSms
  - https://help.aliyun.com/zh/sms/developer-reference/api-dysmsapi-2017-05-25-createsmssign
  - https://help.aliyun.com/zh/sms/developer-reference/api-dysmsapi-2017-05-25-createsmstemplate

### 腾讯云
- 流程：开通服务 -> 创建实名资质 -> 创建应用拿 SdkAppId -> 签名 -> 模板 -> 审核。
- 发送接口：SendSms（Version 2021-01-11），接入地址 sms.tencentcloudapi.com。
- 关键参数：SmsSdkAppId、PhoneNumberSet（大陆号必须带 +86 前缀）、SignName、
  TemplateId、TemplateParamSet（数组，按模板变量顺序填）。
- 鉴权为 TC3-HMAC-SHA256 签名，以 'TC3'+SecretKey 逐层派生密钥拼 Authorization 头。
- 成功判定：SendStatusSet[0].Code === 'Ok'。接口默认限频 3000 次/秒。
- 来源：
  - https://cloud.tencent.com/document/product/382/37745
  - https://cloud.tencent.com/document/product/382/55981

### 费用参考
国内验证码短信单价约 0.04-0.05 元/条量级，按量阶梯计价，以官方价格页为准。

## 二、激活清单（逐步）

### 第 1 步：买服务
在阿里云或腾讯云完成账号实名认证，开通短信服务（腾讯云还需创建短信应用拿到
SdkAppId）。个人认证审核偏严，建议用主体资质申请。

### 第 2 步：申请签名与模板
- 签名内容建议：平台名，如「尼采家教」。
- 模板文案建议：「您的验证码为 ${code}，5 分钟内有效，请勿泄露给他人。」
  （腾讯云变量占位符为 {1}，提交时按控制台要求填写。）
- 提交后 2 小时左右出审核结果，记录模板编号（阿里云 SMS_xxx / 腾讯云数字 ID）。

### 第 3 步：密钥进 Cloudflare Secrets / 环境变量
```
npx wrangler pages secret put SMS_ACCESS_KEY_ID     --project-name <项目名>
npx wrangler pages secret put SMS_ACCESS_KEY_SECRET --project-name <项目名>
```
非敏感项可在 Pages 控制台 Settings -> Environment variables 配置：

| 变量名 | 取值 |
| --- | --- |
| SMS_PROVIDER | mock / aliyun / tencent |
| SMS_SIGN_NAME | 审核通过的签名内容 |
| SMS_TEMPLATE_ID | 审核通过的模板编号 |
| TENCENT_SMS_SDK_APP_ID | 仅腾讯云：SdkAppId |

### 第 4 步：模块接入路由
在 `_worker.js` 中（激活时才首次修改该文件）：
```js
import { activateRoutes, initSmsAuth } from './server/sms-auth.dormant.js';
// 首次请求初始化处（env._dbInited 分支内）补一句：
//   await initSmsAuth(env.DB);   // 幂等建 users_phone / sms_codes 表
// 主路由 try 块内展开：
for (const r of activateRoutes(env)) {
  if (p === r.path && request.method === r.method) return await r.handler(db, body);
}
```
上线的四个接口：`POST /api/v2/auth/send-code`、`/api/v2/auth/register`、
`/api/v2/auth/login-code`、`/api/v2/auth/login-password`。

### 第 5 步：存量用户名账号绑定手机号（迁移策略）
- 个人中心新增「绑定手机号」入口：输号 -> 发码 -> 校验 -> 写入 users_phone。
- users_phone 的 phone PRIMARY KEY + user_id UNIQUE 已保证一号一户；冲突时
  先到先得，后绑者提示「该号码已被其他账号绑定」。
- 不强制存量用户绑定，未绑账号继续用旧 `/api/auth/login` 用户名登录。
- 若日后决定手机号为主账号，再发全站公告引导未绑定账号补绑。

### 第 6 步：灰度方案
1. SMS_PROVIDER=mock 先走通前后端联调（接口会回带 debugCode）。
2. 切真实通道后先只上「手机号注册」入口，旧注册/登录完全不动。
3. 用内部号码实测到达率、延迟与账单计量，核对单条成本。
4. 观察一周无滥用（接口刷量、轰炸他人号码）后再上「验证码登录」与绑定入口。
5. 跑两周后按成本与转化数据决定是否全量切换、是否下线用户名注册。

## 三、待负责人拍板的开放问题

1. 是否保留用户名登录并存？login-password 已兼容两种账号，长期并存还是过渡？
2. 是否支持国际号码？目前仅校验大陆号（/^1[3-9]\d{9}$/），留学生场景是否需要 +852 等。
3. 厂商二选一：阿里云还是腾讯云？取决于主体资质审核难度与单价谈判。
4. 短信费用预算：按月活 x 人均发送条数 x 单价估算上限，是否设全站日发送总量熔断。
5. 教师注册是否继续强制邀请码？模块已留钩子，放开只需删一段校验。
6. 签名与模板文案的最终措辞（影响审核通过率，教育类建议附上业务说明）。
7. 防轰炸策略是否要再加图形验证码？当前仅靠 60 秒冷却 + 日上限。
