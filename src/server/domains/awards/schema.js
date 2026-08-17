/**
 * awards 域 schema（V-1-4b）：教师荣誉奖项表 DDL 实体在 repo.js（旧 server/awards.js 全量迁入）。
 */
import { initAwardsTable } from './repo.js';
export { initAwardsTable };

export const createStatements = [];
export const ensureColumns = [];

export async function migrate(db, ctx) {
  if (ctx.phase === 'postCreate') await initAwardsTable(db);
}
