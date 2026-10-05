/**
 * admin 域 schema（）：admin 无自有业务表（用户/邀请码在 auth，统计走聚合查询）。
 */
export const createStatements = [];
export const ensureColumns = [];
export async function migrate(db, ctx) { /* admin 域暂无专属迁移 */ }
