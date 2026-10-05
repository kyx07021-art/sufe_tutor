# 经途·伴学

正式站已切回「尼采家教v2」原平台。运行源码从实验替换前的 Git 提交 `abd09f53ba57148cbdcc0b4a87bee5695dd855b9` 原样恢复，位于本仓库根目录的 `src/`、`web/`、`features/` 和根样式文件。

使用 Node.js 22。安装和运行：`npm ci`、`npm run build`、`npm run dev`。`build.mjs` 调用 `scripts/build.mjs`，将原平台前后端及静态资源打包到根 `dist/`，不依赖「家教平台2.0」。

生产入口：https://sufe-tutor.pages.dev 。Cloudflare Pages 既有 Git 集成从 `main` 构建并发布根 `dist/`。生产数据库、控制台绑定和 Secrets 沿用现有配置，不清库、不回灌历史数据。

「家教平台2.0」是已结束的架构实验，代码和复原蓝图保留，仅供参考，不参与正式站构建。未完成的实验修改不随本次切换发布。
