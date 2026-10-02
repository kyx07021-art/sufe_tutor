# 经途·伴学

浏览器页面在 web；Worker 路由与领域 SQL 在 src。根目录 npm ci 后，运行 npm run build 生成唯一部署产物：根 dist。

正式入口：https://sufe-tutor.pages.dev 。生产绑定和密钥名称见仓库根 README。该目录是唯一源码，工作区外「家教平台2.0」为指向这里的 Windows 目录联接。

Flat 是唯一视觉模式。页面以原生 JavaScript 装配，聊天每 5 秒读取新消息，离开页面停止轮询。密码与字段加密沿用现有生产参数；权限和数据归属规则留在所属业务域。
