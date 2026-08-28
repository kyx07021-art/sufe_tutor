/**
 * settings 域 schema（S6 定案⑥ + S6-S4）：privacy 死能力删除 + 通知屏蔽偏好。
 *
 * 定案⑥：新站无访客浏览（列表门禁 = 登录），privacy（user_settings 表访客可见性）
 * 是死能力 → 删除。本域不再建任何表（createStatements 为空）。
 *
 * S6-S4 屏蔽偏好（blockSystemNotifications / notifyBroadcastMuted）是 users 表上的
 * 跨域列，已由 auth 域 schema（auth/schema.js ensureColumns，..19）声明——
 * ensureColumns 幂等（PRAGMA 探测再 ALTER），跨域重复声明只会冗余，故不在本域重复
 * 声明（单源，规则 ）。本域的职责 = settings/repo.js 提供偏好读写数据层 +
 * settings/api.js 提供写端点（/api/settings 路由注册裁定见该文件头注释）。
 */
export const createStatements = [];
export const ensureColumns = [];
export async function migrate(db, ctx) { /* settings 域暂无专属迁移（privacy 表已删） */ }
