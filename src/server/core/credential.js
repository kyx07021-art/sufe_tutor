/**
 * 凭证更新独立环节 —— 账户凭证（用户名/手机号/邮箱）变更 单点
 *
 * 用户需求（2026-08-10）：修改用户名后全平台凭证立刻更新，凭证更新做成独立环节，
 * 和「改用户名/绑定的过程」本身解耦——未来切换到手机号为核心凭证时，只把凭证更新接口换地方。
 *
 * 本模块 = 凭证域的编排咽喉：加密落库 / 哈希可查列维护 / 冷却时间戳。
 * 与改用户名过程（auth 域的弹窗/确认/冷却判定）解耦——过程只调本模块接口。
 *
 * 凭证域自持 users 表凭证列 SQL（phone/email/phone_hash/email_hash/username_changed_at），
 * 类 notify/contract/log 自持其表域的有意决定（CLAUDE.md）；users 主列（username/password_hash/
 * role 等）SQL 仍归 db.js 数据层。未来切手机号核心：在此新增 setPhoneAsPrimary，凭证读取点
 * （登录识别/展示）只改本模块，过程层不动。
 */
import { dbGet, dbRun, toDbTime } from './util.js';
import { encryptField, decryptField, tokenDigest } from './crypto.js';
import { PHONE_HASH_COND, EMAIL_HASH_COND } from '../../shared/config.js'; // 哈希列定位条件单源

// 凭证读取列集（登录识别/校验用，含口令列——仅登录/重认证路径出层）
const USER_CRED_SQL = `SELECT id, username, role, avatar, banned, deactivated, password_hash, salt,
  phone, phone_hash, email, email_hash, username_changed_at FROM users`;

// ============================================================
// 用户名凭证（主凭证；7 天冷却时间戳一并更新）
// ============================================================
/**
 * 更新用户名凭证（全平台即时生效）：
 *   - username 是 users 表列，全站 JOIN users 的显示/留档/通知自然取新值，无需逐表同步；
 *   - 会话表存 user_id 不存用户名，现有登录态不受影响（前端 401 兜底 + /api/auth/me 自然返回新名）；
 *   - username_changed_at 落 now（7 天冷却判定依据）。
 * 未来切手机号核心：新增 phone 主凭证更新函数，调用点替换本函数即可。
 */
export async function updateUsernameCredential(db, userId, newUsername) {
  // username_changed_at 落 UTC（toDbTime，与 danger-ops/otp 的 UTC 存储域纪律一致）——
  // username_changed_at 必须 toDbTime 落 UTC（与 danger-ops/otp 同域纪律）；localtime 落库 + UTC 读
  // 漂移 ~8 小时（服务端提前放行）。
  await dbRun(db, `UPDATE users SET username=?, username_changed_at=? WHERE id=?`,
    [newUsername, toDbTime(new Date()), userId]);
}

/** 读用户名最近修改时间（无记录 = 从未改过） */
export async function getUsernameChangedAt(db, userId) {
  const row = await dbGet(db, 'SELECT username_changed_at FROM users WHERE id=?', [userId]);
  return row ? row.username_changed_at : null;
}

// ============================================================
// 手机号 / 邮箱增量凭证（绑定即加密落库 + 哈希可查列）
// ============================================================
/** 绑定手机号：AES 加密落 phone（展示可解密），SHA-256 落 phone_hash（登录可查询） */
export async function bindPhoneCredential(db, userId, phone) {
  const [enc, hash] = await Promise.all([encryptField(phone), tokenDigest(phone)]);
  await dbRun(db, 'UPDATE users SET phone=?, phone_hash=? WHERE id=?', [enc, hash, userId]);
}

/** 绑定邮箱：同 bindPhoneCredential */
export async function bindEmailCredential(db, userId, email) {
  const [enc, hash] = await Promise.all([encryptField(email), tokenDigest(email)]);
  await dbRun(db, 'UPDATE users SET email=?, email_hash=? WHERE id=?', [enc, hash, userId]);
}

/** 按手机号哈希定位账户（登录识别；含口令列供密码校验；无则 undefined） */
export async function dbFindUserByPhoneHash(db, hash) {
  return await dbGet(db, `${USER_CRED_SQL} WHERE ${PHONE_HASH_COND}`, [hash]);
}

/** 按邮箱哈希定位账户（登录识别；同 phone） */
export async function dbFindUserByEmailHash(db, hash) {
  return await dbGet(db, `${USER_CRED_SQL} WHERE ${EMAIL_HASH_COND}`, [hash]);
}

/** 手机号是否已被某账户绑定（绑定去重；UNIQUE 索引兜底并发） */
export async function dbPhoneTaken(db, phone) {
  const h = await tokenDigest(phone);
  return !!(await dbGet(db, `SELECT id FROM users WHERE ${PHONE_HASH_COND} LIMIT 1`, [h]));
}

/** 邮箱是否已被某账户绑定 */
export async function dbEmailTaken(db, email) {
  const h = await tokenDigest(email);
  return !!(await dbGet(db, `SELECT id FROM users WHERE ${EMAIL_HASH_COND} LIMIT 1`, [h]));
}

/** 本人已绑凭证（解密出门；未绑 = 空串）。仅本人/管理员路径调用 */
export async function dbGetMyCreds(db, userId) {
  const row = await dbGet(db, 'SELECT phone, email FROM users WHERE id=?', [userId]);
  if (!row) return { phone: '', email: '' };
  const [phone, email] = await Promise.all([decryptField(row.phone), decryptField(row.email)]);
  return { phone: phone || '', email: email || '' };
}
