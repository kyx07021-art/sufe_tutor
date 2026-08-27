/**
 * ZR-B6 存量迁移：教师 teacher_profiles.real_name 密文 → 明文一次性幂等回填（生产 D1）。
 *
 * 背景（ZR-B1）：real_name 列由加密落库改为明文落库——新代码写路径直写明文；
 *   生产存量行的 real_name 仍是 AES-GCM 密文（`enc:v1:<iv>:<ct>`，FIELD_ENC_KEY 加密）。
 *   本脚本一次性解密回填，只动 real_name 一列，恢复该列全明文读写。
 *
 * 幂等语义：
 *   - 只处理 real_name 带 `enc:v1:` 前缀的行；明文/空行零触碰；
 *   - 写 SQL 带「WHERE user_id=… AND real_name LIKE 'enc:v1:%'」双守卫——已明文行永不命中；
 *   - 全量 apply 后重跑 = 「无密文行，无需回填」零变更；中途中断重跑 = 续做剩余密文行。
 *
 * 安全边界（语义级闸门，对齐 release-deactivated-creds + wrangler-d1 先例）：
 *   - 只读校验 + 干跑预览为默认，--apply 才真正写；
 *   - 解密复用加密咽喉单源 decryptField（候选钥序 FIELD_ENC_KEY → FIELD_ENC_KEY_OLD →
 *     LOG_ENCRYPT_KEY_OLD，v1.5.0 轮换语义），零第二套解密实现；
 *   - fail-closed：任一行解密结果为 [undecryptable]/[encrypted]/仍密文 → 全部中止、零写入、报错退出；
 *   - 远程写经 wrangler-d1 d1WriteQuery（断言 changed_db=true，no-op 写被拒）；本地模式同语义断言 changes>0；
 *   - 逐行报告掩码：明文只打印「前 3 字符 + …」，全明文与密钥值永不打印。
 *
 * 密钥读取（secrets 网关 getSecret 先例，零仓库明文）：只经 env——process.env + 仓库根 .dev.vars
 *   （wrangler 本地密钥库，已 gitignore；.dev.vars 覆盖同名 process env）。
 *   ** 生产执行由主会话操作 **（确认 .dev.vars / Worker Secrets 本地镜像含 FIELD_ENC_KEY 后 --apply）；
 *   本脚本是纯工具，不主动触碰生产。干跑模式不需要密钥（纯只读统计）。
 *
 * 用法：
 *   node scripts/zr-realname-migrate.mjs                        # 远程干跑（只读分布统计 + 预览，不写）
 *   node scripts/zr-realname-migrate.mjs --apply                # 远程执行 + 事后重跑校验
 *   node scripts/zr-realname-migrate.mjs --local <db.sqlite>    # 本地 SQLite 库，同一套闸门（副本演练/本地验证用；干跑/执行同上）
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindCryptoEnv, decryptField } from '../src/server/core/crypto.js';
import { getSecret } from '../server/secrets.js';
import { d1ReadQuery, d1WriteQuery, D1_DB_NAME } from './wrangler-d1.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const localAt = process.argv.indexOf('--local');
const LOCAL_DB = localAt >= 0 ? process.argv[localAt + 1] : null;
if (localAt >= 0 && !LOCAL_DB) { console.error('✖ --local 需要 <db.sqlite> 参数'); process.exit(2); }

const ENC_PREFIX = 'enc:v1:';
const ENC_FILTER = `real_name LIKE 'enc:v1:%'`;
// crypto.js 解密候选钥序全集（任一配置即可解密；链内优先级由咽喉层裁定）
const KEY_NAMES = ['FIELD_ENC_KEY', 'FIELD_ENC_KEY_OLD', 'LOG_ENCRYPT_KEY', 'LOG_ENCRYPT_KEY_OLD'];

// ---- 密钥 env：process.env + 仓库根 .dev.vars（.dev.vars 覆盖同名；secrets 网关先例，零仓库明文）----
function loadEnv() {
  const env = { ...process.env };
  const p = join(root, '.dev.vars');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  }
  return env;
}
const env = loadEnv();
bindCryptoEnv(env);

// ---- 查询层：远程 = wrangler-d1 共享层（只读/写闸门在共享层）；本地 = node:sqlite 同语义闸门 ----
let readRows, writeUpdate;
if (LOCAL_DB) {
  if (!existsSync(LOCAL_DB)) { console.error(`✖ 本地库不存在: ${LOCAL_DB}`); process.exit(2); }
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(LOCAL_DB);
  readRows = sql => raw.prepare(sql).all();
  writeUpdate = sql => {
    const changes = Number(raw.prepare(sql).run().changes); // 镜像 d1WriteQuery：no-op/匹配 0 行拒绝
    if (changes <= 0) throw new Error(`写查询未实际改动行（changes=0，幂等闸门拒绝）: ${sql}`);
    return changes;
  };
} else {
  readRows = sql => d1ReadQuery(D1_DB_NAME, sql);
  writeUpdate = sql => d1WriteQuery(D1_DB_NAME, sql).changes;
}

const sqlQuote = s => `'${String(s).replaceAll(`'`, `''`)}'`;
const mask = s => { const c = [...String(s)]; return c.length <= 3 ? `${c[0] || ''}…` : `${c.slice(0, 3).join('')}…`; };
const countWhere = where => Number(readRows(`SELECT COUNT(*) AS n FROM teacher_profiles${where ? ` WHERE ${where}` : ''}`)[0].n);

console.log(`== ZR-B6 real_name 密文→明文回填（${LOCAL_DB ? `本地 ${LOCAL_DB}` : `远程 ${D1_DB_NAME}`}，${APPLY ? '执行模式' : '干跑模式'}）==\n`);

// 1. 只读校验：全量分布
const total = countWhere('');
const encRows = readRows(`SELECT user_id FROM teacher_profiles WHERE ${ENC_FILTER} ORDER BY user_id`);
console.log(`teacher_profiles 总行数: ${total}`);
console.log(`real_name 密文行（${ENC_PREFIX} 前缀，待回填）: ${encRows.length}`);
console.log(`real_name 明文/空行（不动）: ${total - encRows.length}`);
if (encRows.length) {
  console.log(`\n密文行明细（前 20 行）:`);
  for (const r of encRows.slice(0, 20)) console.log(`  user_id=${r.user_id} real_name=${ENC_PREFIX}…（密文）`);
  if (encRows.length > 20) console.log(`  …余 ${encRows.length - 20} 行`);
}

if (encRows.length === 0) {
  console.log('\n✔ 无密文行，无需回填（幂等）');
  process.exit(0);
}

if (!APPLY) {
  console.log(`\n干跑结束：将回填 ${encRows.length} 行（不写）。确认后执行: node scripts/zr-realname-migrate.mjs${LOCAL_DB ? ` --local ${LOCAL_DB}` : ''} --apply`);
  process.exit(0);
}

// 2. 密钥在场检查（fail-closed；干跑不需要密钥，执行必须有）
if (!KEY_NAMES.some(k => getSecret(env, k))) {
  console.error(`\n✖ 未配置任何字段解密密钥（${KEY_NAMES.join(' / ')} 均缺失）——fail-closed 拒绝执行`);
  console.error('  密钥只经 env 读取：配置仓库根 .dev.vars（KEY=值，已 gitignore）或 process env 后重跑');
  process.exit(1);
}

// 3. 先全量解密再写（任一行失败 → 全部中止，零写入）
const rows = readRows(`SELECT user_id, real_name FROM teacher_profiles WHERE ${ENC_FILTER} ORDER BY user_id`);
const plan = [], bad = [];
for (const r of rows) {
  const pt = await decryptField(r.real_name);
  if (typeof pt !== 'string' || pt === '[undecryptable]' || pt === '[encrypted]' || pt.startsWith(ENC_PREFIX)) {
    bad.push({ userId: r.user_id, got: typeof pt === 'string' && pt.startsWith(ENC_PREFIX) ? '解密后仍为密文' : String(pt) });
    continue;
  }
  plan.push({ userId: Number(r.user_id), pt });
}
if (bad.length) {
  console.error(`\n✖ ${bad.length}/${rows.length} 行解密失败——fail-closed 全部中止，未写入任何行：`);
  for (const b of bad) console.error(`  user_id=${b.userId} → ${b.got}（密钥缺失/不匹配？核对 FIELD_ENC_KEY 与 _OLD 轮换钥）`);
  process.exit(1);
}

// 4. 逐行写回（双守卫：user_id + 仍密文谓词；每行 changes 必恰为 1）
console.log(`\n回填 ${plan.length} 行（明文掩码 = 前 3 字符 + …）：`);
for (const { userId, pt } of plan) {
  if (!Number.isInteger(userId)) { console.error(`✖ user_id 非整数，严格解析拒绝: ${userId}`); process.exit(1); }
  const changes = writeUpdate(`UPDATE teacher_profiles SET real_name=${sqlQuote(pt)} WHERE user_id=${userId} AND ${ENC_FILTER}`);
  if (changes !== 1) { console.error(`✖ user_id=${userId} 写回 changes=${changes}（预期 1）——中止，剩余行重跑续做`); process.exit(1); }
  console.log(`  user_id=${userId} before=${ENC_PREFIX}… → after=${mask(pt)}`);
}

// 5. 事后重跑校验：零密文 + 总行数不变
const encAfter = countWhere(ENC_FILTER);
const totalAfter = countWhere('');
console.log(`\n回填后密文行: ${encAfter}（应为 0）`);
console.log(`回填后总行数: ${totalAfter}（应与回填前 ${total} 一致）`);
if (encAfter !== 0 || totalAfter !== total) {
  console.error('✖ 回填后校验不一致，需人工复核');
  process.exit(1);
}
console.log('\n✔ ZR-B6 回填完成，校验通过（重跑将零变更，幂等）');
