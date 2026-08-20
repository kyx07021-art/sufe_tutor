/**
 * AE-3 存量清理：释放已注销账户（deactivated=1）残留的联系方式占用（生产 D1）。
 *
 * 背景（AE-1 生产 bug 存量修复）：dbDeactivateUser 在 AE-1 修复前不清 users 表的
 *   phone/phone_hash/email/email_hash → 唯一索引 idx_users_phone_hash/idx_users_email_hash
 *   仍占用 → 已注销的手机号/邮箱无法再次注册（409 PHONE/EMAIL_ALREADY_BOUND）。
 *   本脚本把「已注销但联系方式残留」的存量行清空，恢复可注册。
 *
 * 安全边界（语义级闸门，对齐 validate-prod-data 风格）：
 *   - 只清 deactivated=1 的注销账户；banned-only 封禁账户（banned=1, deactivated=0）零触碰
 *     （封禁≠注销，封禁账户联系方式保留，解封后仍可登录）；
 *   - 只读校验 + 干跑预览为默认；--apply 才真正执行写；
 *   - 写经 scripts/wrangler-d1.mjs d1WriteQuery（断言 changed_db=true）；幂等重跑 changes=0 属预期；
 *   - 全部 SQL 为脚本内常量字面量，无用户输入注入面。
 *
 * 用法：
 *   node scripts/release-deactivated-creds.mjs            # 只读校验 + 干跑预览（不写）
 *   node scripts/release-deactivated-creds.mjs --apply    # 执行清理 + 重跑校验
 * （需 wrangler 已认证，生产 D1 为 sufe-tutor-db-apac）
 */
import { d1ReadQuery, d1WriteQuery, D1_DB_NAME } from './wrangler-d1.mjs';

const APPLY = process.argv.includes('--apply');

// 清理谓词：只清注销账户（deactivated=1）且任一联系方式哈希残留
const CLEAN_WHERE = `deactivated=1 AND (phone_hash != '' OR email_hash != '')`;

function count(where) {
  const r = d1ReadQuery(D1_DB_NAME, `SELECT COUNT(*) AS n FROM users WHERE ${where}`);
  return Number(r[0].n || 0);
}

console.log(`== AE-3 释放已注销账户联系方式（${D1_DB_NAME}，${APPLY ? '执行模式' : '干跑模式' }）==\n`);

// 1. 只读校验：全量分布
const totalDeact = count('deactivated=1');
const residual = count(CLEAN_WHERE);
const bannedOnly = count(`banned=1 AND deactivated=0 AND (phone_hash != '' OR email_hash != '')`);
console.log(`已注销账户（deactivated=1）总数: ${totalDeact}`);
console.log(`其中联系方式残留（待清理）: ${residual}`);
console.log(`封禁但未注销账户联系方式残留（banned-only，不动）: ${bannedOnly}`);

// 2. 明细预览（前 20 行，人工核对）
const samples = d1ReadQuery(D1_DB_NAME,
  `SELECT id, username, CASE WHEN phone_hash != '' THEN 1 ELSE 0 END AS has_phone,
     CASE WHEN email_hash != '' THEN 1 ELSE 0 END AS has_email
   FROM users WHERE ${CLEAN_WHERE} ORDER BY id LIMIT 20`);
if (samples.length) {
  console.log('\n待清理明细（前 ' + samples.length + ' 行）:');
  for (const s of samples) console.log(`  id=${s.id} username=${s.username} phone_hash=${s.has_phone} email_hash=${s.has_email}`);
}

if (residual === 0) {
  console.log('\n✔ 无残留占用，无需清理（幂等）');
  process.exit(0);
}

if (!APPLY) {
  console.log(`\n干跑结束：将清理 ${residual} 行（不写）。确认后执行: node scripts/release-deactivated-creds.mjs --apply`);
  process.exit(0);
}

// 3. 执行清理（写闸门：changed_db 必须 true；changes 与校验数一致）
const w = d1WriteQuery(D1_DB_NAME,
  `UPDATE users SET phone='', phone_hash='', email='', email_hash='' WHERE ${CLEAN_WHERE}`);
if (w.changes !== residual) {
  console.error(`✖ 清理行数 ${w.changes} 与校验数 ${residual} 不一致（并发窗口？），需人工复核`);
  process.exit(1);
}
console.log(`\n✔ 已清理 ${w.changes} 行（phone/phone_hash/email/email_hash 清空）`);

// 4. 重跑校验：零残留 + ban-only 不受影响
const residualAfter = count(CLEAN_WHERE);
const bannedOnlyAfter = count(`banned=1 AND deactivated=0 AND (phone_hash != '' OR email_hash != '')`);
console.log(`清理后联系方式残留: ${residualAfter}（应为 0）`);
console.log(`清理后 ban-only 残留: ${bannedOnlyAfter}（应与清理前 ${bannedOnly} 一致）`);
if (residualAfter !== 0 || bannedOnlyAfter !== bannedOnly) {
  console.error('✖ 清理后校验不一致，需人工复核');
  process.exit(1);
}
console.log('\n✔ AE-3 清理完成，校验通过');
