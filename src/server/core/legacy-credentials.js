/**
 * 历史旧凭据常量（服务端私有，禁入前端构建面）
 *
 * LEGACY_ADMIN_PASSWORD = v1 时代历史旧 admin 默认密码。**非活动凭据**——生产 admin
 * 口令早已轮换，只存 Worker Secrets。其唯一用途是「历史旧值禁回」门禁：
 *   - server/startup.js  productionConfigChecks ADMIN_CREDENTIAL_ROTATED 检查；
 *   - src/server/domains/auth/schema.js  seedAdmins 对存量 admin 不覆写历史默认口令。
 *
 * 为何在 core 而非 shared：本常量位于 src/shared/config.js 时，vite.config.js 经
 * ../src/shared/config.js 求值快照内联整个模块（new-frontend/vite.config.js.timestamp-*.mjs
 * 曾含明文 admin_sufe），属前端构建面暴露。移入服务端私有目录（src/server/core/）后，
 * 前端 import 图不再可达。零依赖，纯数据。
 */
export const LEGACY_ADMIN_PASSWORD = 'admin_sufe';
