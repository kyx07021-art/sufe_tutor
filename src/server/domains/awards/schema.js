/**
 * awards 域 schema（S6-A5 下线态）：awards 在新站不上线（不保留向后兼容），
 * teacher_awards 表不再创建。
 *
 * 保留文件与导出签名——src/server/core/db.js 以 `import * as awardsSchema` 注册本域
 * （SCHEMAS.awards 参与 CREATE/ENSURE/POST_ENSURE 阶段编排），archtest「后端域自持」
 * 亦要求 domains/awards/ 三件套文件存在。migrate 为 noop：无建表、无迁移动作。
 */

export const createStatements = [];
export const ensureColumns = [];

export async function migrate() {
  // offline: no teacher_awards table, no data migration.
}
