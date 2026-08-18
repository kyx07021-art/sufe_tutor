/**
 * V-4-1a 存量数据校验（生产 D1 只读，发布 2.0.0 前置）：
 *   1. 通知：V-2-4 结构化（{type,params}）后，无「text 空且 type NULL」的不可渲染行；
 *      无「type 有值 params NULL」的半结构化行；type 值均在 NOTIFY_TYPES 键内；params 为合法 JSON。
 *      —— 生产若未落迁移（type/params 列缺失，2.0.0 未部署属预期），降级为 v1 形状校验：
 *      无空 text 行（v1 形状的不可渲染行），结构化校验改上线后复跑。
 *   2. region：student_demands.province 非空取值均在 SUFE_REGIONS.provinces[].id 内
 *      （真表为 student_demands；空串 = 用户未选择，属合法未选择态，不判违规）。
 *   3. 权限/脱敏：auth_sessions.token_hash 全为 SECURITY.TOKEN_HASH_HEX_LEN 位（SHA-256 摘要）；
 *      users.role 在共享 ROLES 内；需求地址含「号」报告式不硬判。
 * 只读保证：全部 SELECT/PRAGMA，经 scripts/wrangler-d1.mjs 的语义级只读闸门
 *   （changed_db=false 且 changes=0）+ 3 次网络重试。
 * 用法：node scripts/validate-prod-data.mjs（需 wrangler 已认证）。
 */
import { d1ReadQuery, D1_DB_NAME } from './wrangler-d1.mjs';
import { SUFE_REGIONS } from '../src/shared/region-data.js';
import { NOTIFY_TYPES } from '../src/shared/codes.js';
import { ROLES } from '../src/shared/enums.js';
import { SECURITY } from '../src/shared/config.js';

const q = sql => d1ReadQuery(D1_DB_NAME, sql);

let fail = 0;
const check = (name, cond, detail = '') => {
  const suffix = detail ? `（${detail}）` : '';
  if (cond) console.log(`✔ ${name}${suffix}`);
  else { console.error(`✖ ${name}${suffix}`); fail++; }
};

console.log(`== V-4-1a 存量数据校验（${D1_DB_NAME}，只读）==\n`);

// 0. 表结构探测（PRAGMA 只读；目标列缺失 = 迁移未落生产，属预期 → 对应校验降级/上线后复跑）
const tableCols = {};
const cols = t => {
  if (!tableCols[t]) tableCols[t] = new Set(q(`PRAGMA table_info(${t})`).map(r => r.name));
  return tableCols[t];
};

// 1. 通知渲染性（按实际形状：结构化 vs v1 兜底）
const nc = cols('notifications');
if (nc.has('type') && nc.has('params')) {
  const bad = q(`SELECT COUNT(*) AS n FROM notifications WHERE (text IS NULL OR text='') AND type IS NULL`);
  check('通知无不可渲染行（text 空且 type NULL）', bad[0].n === 0, `n=${bad[0].n}`);
  const partial = q(`SELECT COUNT(*) AS n FROM notifications WHERE type IS NOT NULL AND params IS NULL`);
  check('通知无半结构化行（type 有值 params NULL）', partial[0].n === 0, `n=${partial[0].n}`);
  const types = q(`SELECT DISTINCT type AS t FROM notifications WHERE type IS NOT NULL`);
  const unknownTypes = types.map(r => r.t).filter(t => !Object.hasOwn(NOTIFY_TYPES, t));
  check('通知 type 值均在 NOTIFY_TYPES 键内', unknownTypes.length === 0,
    unknownTypes.length ? `未知=${unknownTypes.join(',')}` : `${types.length} 种`);
  const badJson = q(`SELECT COUNT(*) AS n FROM notifications WHERE params IS NOT NULL AND params != '' AND json_valid(params) = 0`);
  check('通知 params 全为合法 JSON', badJson[0].n === 0, `n=${badJson[0].n}`);
} else {
  const bad = q(`SELECT COUNT(*) AS n FROM notifications WHERE text IS NULL OR text=''`);
  check('通知 v1 形状无空 text 行（v1 亦不可渲染）', bad[0].n === 0, `n=${bad[0].n}`);
  console.log('ℹ 报告：生产 notifications 未落 V-2-4 结构化（缺 type/params 列，2.0.0 未部署属预期）——结构化校验随 2.0.0 上线后复跑');
}

// 2. region 数据（需求域真表为 student_demands，province 经 v2 ensureColumns 补列）
const dc = cols('student_demands');
if (dc.has('province')) {
  const provs = q(`SELECT DISTINCT province AS p FROM student_demands`);
  const validProvs = new Set(SUFE_REGIONS.provinces.map(p => p.id));
  const unknownProvs = provs.map(r => r.p).filter(p => p && !validProvs.has(p));
  check('需求 province 非空取值均在 SUFE_REGIONS 内', unknownProvs.length === 0,
    unknownProvs.length ? `未知=${unknownProvs.join(',')}` : `${provs.length} 种`);
} else {
  console.log('ℹ 报告：student_demands 缺 province 列（迁移未落生产），region 校验跳过');
}

// 3. 权限 / 脱敏
const sc = cols('auth_sessions');
if (sc.has('token_hash')) {
  const badTokens = q(`SELECT COUNT(*) AS n FROM auth_sessions WHERE length(token_hash) != ${SECURITY.TOKEN_HASH_HEX_LEN}`);
  check(`会话 token_hash 全为 ${SECURITY.TOKEN_HASH_HEX_LEN} 位（SHA-256 摘要）`, badTokens[0].n === 0, `n=${badTokens[0].n}`);
} else {
  console.log('ℹ 报告：auth_sessions 缺 token_hash 列，令牌摘要校验跳过');
}
const uc = cols('users');
if (uc.has('role')) {
  const roleIn = Object.values(ROLES).map(r => `'${r}'`).join(',');
  const badRoles = q(`SELECT COUNT(*) AS n FROM users WHERE role NOT IN (${roleIn})`);
  check('用户 role 在共享 ROLES 内', badRoles[0].n === 0, `n=${badRoles[0].n}`);
}
const addrCols = ['address', 'address_detail'].filter(c => dc.has(c));
if (addrCols.length) {
  const doorNumbers = q(`SELECT COUNT(*) AS n FROM student_demands WHERE ${addrCols.map(c => `${c} LIKE '%号%'`).join(' OR ')}`);
  console.log(`ℹ 报告：需求地址含「号」（门牌号启发式，规则 48 红线）命中 ${doorNumbers[0].n} 行（人工复核）`);
}
if (uc.has('role')) {
  const admins = q(`SELECT COUNT(*) AS n FROM users WHERE role='${ROLES.ADMIN}'`);
  console.log(`ℹ 报告：管理员账号 ${admins[0].n} 个（对照 ADMIN_USERNAMES 名单）`);
}

console.log(fail === 0 ? `\n校验通过（全部只读，changed_db 恒 false）` : `\n✖ 发现 ${fail} 项违规`);
process.exit(fail === 0 ? 0 : 1);
