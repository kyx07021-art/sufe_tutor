/**
 * 数据库初始化与迁移编排（架构 v2，V-1-4b 起纯编排）。
 * 本文件不写任何业务 DDL / ensureColumns / 域迁移 SQL——
 * 全部下沉到 src/server/domains/<域>/schema.js，由本文件按阶段编排调用。
 */
import { ensureColumns } from './util.js';
import { bindCryptoEnv } from './crypto.js';
import { getSecret } from '../../../server/secrets.js';
import { initMetrics } from '../../../server/telemetry.js';
import { initLogDb } from './log.js';
import { initNotifyTable } from './notify.js';
import { initVersionTable } from '../../../server/version.js';
import { initDangerCaps } from './danger-ops.js';
import { initOtpTable, bindOtpEnv } from './otp.js';
import { bindChsiEnv } from '../../../server/chsi.js';

import * as authSchema from '../domains/auth/schema.js';
import * as teacherSchema from '../domains/teacher/schema.js';
import * as demandSchema from '../domains/demand/schema.js';
import * as chatSchema from '../domains/chat/schema.js';
import * as contractSchema from '../domains/contract/schema.js';
import * as reviewsSchema from '../domains/reviews/schema.js';
import * as postsSchema from '../domains/posts/schema.js';
import * as complaintsSchema from '../domains/complaints/schema.js';
import * as settingsSchema from '../domains/settings/schema.js';
import * as awardsSchema from '../domains/awards/schema.js';
import * as adminSchema from '../domains/admin/schema.js';

const SCHEMAS = {
  auth: authSchema,
  teacher: teacherSchema,
  demand: demandSchema,
  chat: chatSchema,
  contract: contractSchema,
  reviews: reviewsSchema,
  posts: postsSchema,
  complaints: complaintsSchema,
  settings: settingsSchema,
  awards: awardsSchema,
  admin: adminSchema,
};

// create / preCreate 顺序必须满足外键「父先子后」：auth(users) → teacher → demand → chat → contract → 其余
const CREATE_ORDER = ['auth', 'teacher', 'demand', 'chat', 'contract', 'reviews', 'posts', 'complaints', 'settings', 'awards', 'admin'];
// ensureColumns 顺序与原 initDb 全量迁移一致（跨域列在域迁移前补齐）
const ENSURE_ORDER = ['auth', 'complaints', 'chat', 'teacher', 'demand', 'contract', 'reviews', 'posts', 'settings', 'awards', 'admin'];
// postEnsure：先做跨域数据回填（chat 依赖 demand 列），最后 auth 收尾（旧管理员删除 / 用户名消毒）
const POST_ENSURE_ORDER = ['chat', 'demand', 'teacher', 'contract', 'complaints', 'reviews', 'posts', 'settings', 'awards', 'admin', 'auth'];

// 管理员配置统一经 secrets 网关读取（env 优先，回落本地 secrets.js）；兼容 env 为逗号分隔串 / 文件为数组
const adminNamesOf = v => Array.isArray(v) ? v : String(v || '').split(',').map(s => s.trim()).filter(Boolean);

// ============================================================
// initDb 采用 schema 版本判断：冷 isolate 首击 1 次 batch（CREATE schema_meta 幂等 + SELECT 版本）
// 命中已最新即跳过全量迁移（全量跑 ≈13-20 次 D1 往返会让冷 isolate 首击超时）。
// 纪律：任何建表/加列/迁移改动必须 SCHEMA_VERSION +1，否则冷 isolate 跳过迁移导致缺列（生产事故）。
// ============================================================
export const SCHEMA_VERSION = 8; // v2.0.0：initNotifyTable 补 V-2-4 通知结构化列 type/params（V-2-4a e2a5bf4 加列时漏 bump，存量 v7 库不跑迁移导致缺列——V-4-1c 演练抓出；存量 v7 库需跑全量迁移补列）

export async function initDb(db, env = {}) {
  bindCryptoEnv(env); // 字段加密密钥（FIELD_ENC_KEY 优先回落 LOG_ENCRYPT_KEY），env 变更重派生
  bindOtpEnv(env);    // OTP 部署级配置（SMS/EMAIL_OTP_TEMPLATE_CODE 模板编码；测试经 test/_otp-stub.js stub fetch 防真实发信）
  bindChsiEnv(env);   // CHSI 部署级配置（v1.5.0：只允许 manual，其他 provider fail-closed）
  // 1 次 batch：建 schema_meta（幂等）+ 读版本（batch 顺序执行，CREATE 后 SELECT 可见）
  let rows = null;
  try {
    rows = await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS schema_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)`),
      db.prepare(`SELECT v FROM schema_meta WHERE k='schema'`),
    ]);
  } catch { /* batch 异常：保守视为版本落后，走全量幂等迁移（不阻塞初始化） */ }
  const cur = rows && rows[1] && rows[1].results && rows[1].results[0] ? rows[1].results[0].v : 0;
  if (cur >= SCHEMA_VERSION) return; // schema 已最新：冷 isolate 首击跳过全量迁移（1 次 D1 即完成）
  await runFullMigration(db, env); // 首次部署/版本落后：跑完整幂等迁移
  try { await db.prepare(`INSERT OR REPLACE INTO schema_meta (k, v) VALUES ('schema', ?)`).bind(SCHEMA_VERSION).run(); } catch { /* 版本写失败静默：下次重跑幂等迁移 */ }
}

// 全量迁移编排（幂等）：各域 schema 自持 SQL，本函数只负责阶段与顺序。
async function runFullMigration(db, env) {
  bindCryptoEnv(env); // 字段加密密钥（FIELD_ENC_KEY 优先回落 LOG_ENCRYPT_KEY），env 变更重派生
  const adminNames = adminNamesOf(getSecret(env, 'ADMIN_USERNAMES'));
  const adminPassword = getSecret(env, 'ADMIN_DEFAULT_PASSWORD') || '';
  const ctx = { env, adminNames, adminPassword };
  const phase = p => ({ ...ctx, phase: p });

  // 阶段 1：preCreate——必须先于初始建表执行的遗留迁移（users 角色扩展 / 旧表重建）。
  // 若初始 batch 先建出子表，改名 users 时会把它们的 FK 一并改写指向 _users_old 后悬空。
  for (const name of CREATE_ORDER) await SCHEMAS[name].migrate(db, phase('preCreate'));

  // 阶段 2：create——全量幂等建表（域顺序 = 父先子后）
  const createBatch = [];
  for (const name of CREATE_ORDER) {
    for (const sql of SCHEMAS[name].createStatements) createBatch.push(db.prepare(sql));
  }
  if (createBatch.length) await db.batch(createBatch);

  // 阶段 3：postCreate——建表后的表形迁移（CHECK 换表 / 旧形状换新 / 播种管理员 / 域表初始化）
  for (const name of CREATE_ORDER) await SCHEMAS[name].migrate(db, phase('postCreate'));

  // 留档与观测表（core 模块自持；业务库与独立留档库绑定由 getLogDb 路由）
  await initLogDb(db);
  await initMetrics(db); // v1.5.0 观测指标表（请求聚合）

  // 阶段 4：ensureColumns——各域声明式补列，core 统一执行（单点 util.ensureColumns）
  for (const name of ENSURE_ORDER) {
    for (const spec of SCHEMAS[name].ensureColumns) {
      await ensureColumns(db, spec.table, spec.columns);
    }
  }

  // 阶段 5：非域表初始化（通知 / 版本 / 危险操作 / OTP）——先于 postEnsure，
  // auth 域「旧管理员硬删除」需要 notifications 等表已存在。
  await initNotifyTable(db);
  await initVersionTable(db);
  await initDangerCaps(db);
  await initOtpTable(db);

  // 阶段 6：postEnsure——补列后的数据回填 / 热点索引 / 唯一索引 / 收尾清理
  for (const name of POST_ENSURE_ORDER) await SCHEMAS[name].migrate(db, phase('postEnsure'));
}
