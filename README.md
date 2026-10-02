# 经途·伴学 2.0

新平台源码只在「家教平台2.0」目录。根构建入口转入该目录，生成根 dist，Cloudflare Pages 的既有 Git 集成在 main 推送后构建并发布。

使用 Node.js 22。安装和运行：npm ci；npm run build；npm run dev。

生产入口：https://sufe-tutor.pages.dev 。Pages 项目 sufe-tutor；控制台既有 DB 绑定连接 D1 数据库 sufe-tutor-db-apac。wrangler.toml 不迁移控制台配置，静态资源由 Pages 提供 ASSETS。

保留生产 Secrets 名称：ADMIN_USERNAMES、ADMIN_DEFAULT_PASSWORD、FIELD_ENC_KEY、FIELD_ENC_KEY_OLD、LOG_ENCRYPT_KEY、LOG_ENCRYPT_KEY_OLD、SMS_OTP_TEMPLATE_CODE、EMAIL_OTP_TEMPLATE_CODE。新写入用 FIELD_ENC_KEY（未设置时使用既有 LOG_ENCRYPT_KEY）；旧字段在轮换钥下解密。开发凭据只写本地 .dev.vars，禁止提交。

新实现直接使用原业务表与列；没有迁移、表重建或清库。student_demands、auth_sessions 和 JSON 列名沿用生产命名。旧额外表留在 D1，但新平台不提供合同或约定功能。已有账户、密码摘要、教师资料、需求、会话、文字与附件、社区、评价和反馈都继续可用。升级后浏览器需重新登录一次。

旧应用源码、玻璃样式、测试与迁移框架已移出当前代码；Git 历史保留可恢复，docs 目录保留历史资料。开发可沿着「页面动作 → 业务路由 → SQL」阅读代码。

本地已实际完成注册登录、档案与结构化时间保存、身份审批、匹配、正式聊天、文件/图片附件、评价审批、社区点赞收藏、投诉反馈处置、通知开关、会话关闭重开与账户注销。注销后评价与点赞计数同步更新。npm ci 和 npm run build 通过，桌面与 390px 页面已查看。

没有发送真实短信或邮件验证码，也没有在生产库创建演示账户。生产发布通过 Git 集成后，以正式域名的 /api/health 版本和 commit 字段确认。
