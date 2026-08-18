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
 * 只读保证：全部 SELECT/PRAGMA，逐查询断言 wrangler meta changed_db=false 且 changes=0
 *   （语义级只读闸门；PRAGMA 的 rows_written 报告偶不稳定，不以其为准）。
 * 用法：node scripts/validate-prod-data.mjs（需 wrangler 已认证）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SUFE_REGIONS } from '../src/shared/region-data.js';
import { NOTIFY_TYPES } from '../src/shared/codes.js';
import { ROLES } from '../src/shared/enums.js';
import { SECURITY } from '../src/shared/config.js';

// 部署字面量（有意决定）：库名仅本脚本与 Pages 项目 D1 绑定使用（worker 经 binding 读取，不依赖库名），
// 全仓无代码级第二引用；放 shared/config 会随客户端 bundle 泄出内部基建命名，故留脚本内并钉死契约。
// 若改动绑定名，必须同步此处与 CLAUDE.md「常量约定」段落。
const D1_DB_NAME = 'sufe-tutor-db-apac';

// wrangler 以 node 直接执行其 JS 入口：零 shell、无 Windows .cmd EINVAL、无注入面
// （全局安装：Windows %APPDATA%\npm\node_modules；POSIX /usr/lib 或 /usr/local/lib）
function resolveWranglerBin() {
  const candidates = process.platform === 'win32' && process.env.APPDATA
    ? [join(process.env.APPDATA, 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js')]
    : ['/usr/lib/node_modules/wrangler/bin/wrangler.js', '/usr/local/lib/node_modules/wrangler/bin/wrangler.js'];
  return candidates.find(existsSync) || null;
}

const WRANGLER_BIN = resolveWranglerBin();

function parseResult(sql, out) {
  const { results, meta } = JSON.parse(out)[0]; // wrangler 结构：[{ results, success, meta }]，只读字段在 meta 子对象
  // 只读闸门：changed_db=false 且 changes=0（语义级「是否改库」；PRAGMA 的 rows_written 偶发不稳定，不以其为准）
  if (meta.changed_db !== false || meta.changes !== 0) {
    throw new Error(`非只读查询！changed_db=${meta.changed_db} changes=${meta.changes}: ${sql}`);
  }
  return (results || []).map(r => ({ ...r }));
}

const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// 本网络对 Cloudflare API 有偶发抖动（fetch failed 实测命中），重试 3 次；
// 每次均为全新 wrangler 子进程（无状态残留），只读闸门在每次成功返回上同样生效。
const QUERY_RETRIES = 3;

function q(sql) {
  const run = () => {
    if (WRANGLER_BIN) {
      return parseResult(sql, execFileSync(process.execPath,
        [WRANGLER_BIN, 'd1', 'execute', D1_DB_NAME, '--remote', '--json', '--command', sql],
        { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
    }
    // 兜底：全局 wrangler 不在常见路径时走 npx（Windows 需 shell 解析 .cmd）。
    // SQL 全为常量字面量且经 fail-closed 字符校验，无注入面（DEP0190 仅在兜底路径触发）。
    if (/["%!^`]/.test(sql)) throw new Error(`q() 拒绝含 shell 特殊字符的 SQL（fail-closed）：${sql}`);
    return parseResult(sql, execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['wrangler', 'd1', 'execute', D1_DB_NAME, '--remote', '--json', '--command', sql],
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, shell: process.platform === 'win32' }));
  };
  for (let attempt = 1; ; attempt++) {
    try { return run(); } catch (e) {
      if (attempt >= QUERY_RETRIES) throw e;
      const waitMs = 2000 * attempt;
      console.log(`  ↻ 查询重试 ${attempt}/${QUERY_RETRIES - 1}（${String(e.message).split('\n')[0].slice(0, 70)}… ${waitMs}ms 后）`);
      sleepSync(waitMs);
    }
  }
}

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
