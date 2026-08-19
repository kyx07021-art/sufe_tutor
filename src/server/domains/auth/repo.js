/**
 * 认证域数据层（V-1-4 从 server/db.js 提取）：users / invite_codes / 用户私有数据清理。
 * 导入：core/util、core/crypto、src/shared/config（常量单源）。mapper 与 SQL 只在本文件。
 */
import { dbAll, dbGet, dbRun, toDbTime } from '../../core/util.js';
import { hashPassword } from '../../core/crypto.js';
import { INITIAL_RATING, INITIAL_WEIGHT, LIMITS, PHONE_HASH_COND, EMAIL_HASH_COND } from '../../../shared/config.js';
import { STATUS } from '../../../shared/enums.js';
// 教师评分重算依赖：统计来自评价域、写库来自教师域（Z-5-F1 断线修复，补全两 helper）
import { dbGetApprovedReviewStats } from '../reviews/repo.js';
import { dbUpdateTeacherRating } from '../teacher/repo.js';

// 显式列集：凭证列（password_hash/salt）仅登录/重认证出层，其余列不随裸行外溢
const USER_BY_USERNAME_SQL = 'SELECT id, username, role, avatar, banned, deactivated, password_hash, salt FROM users WHERE username=?';

export async function dbFindUserByUsername(db, username) {
  return await dbGet(db, USER_BY_USERNAME_SQL, [username]);
}

// B1：认证路由限流同批的用户查询语句（与 dbFindUserByUsername 同 SQL 单源；供 authRateBatch 的附加查询）
export function dbUserLookupStmt(db, username) {
  return db.prepare(USER_BY_USERNAME_SQL).bind(username);
}
export function dbUsernameExistsStmt(db, username) {
  return db.prepare('SELECT id FROM users WHERE username=?').bind(username);
}
// 登录识别：手机号/邮箱哈希可查列定位 stmt（限流同批；hash 由调用方 tokenDigest 预计算；
// 谓词单源 PHONE/EMAIL_HASH_COND，与 credential.js 登录识别同口径）
export function dbUserPhoneHashStmt(db, hash) {
  return db.prepare(`SELECT id, username, role, avatar, banned, deactivated, password_hash, salt FROM users WHERE ${PHONE_HASH_COND}`).bind(hash);
}
export function dbUserEmailHashStmt(db, hash) {
  return db.prepare(`SELECT id, username, role, avatar, banned, deactivated, password_hash, salt FROM users WHERE ${EMAIL_HASH_COND}`).bind(hash);
}

// 用户卡片（公开名片 / 封禁态判定 / 管理员封禁 / 帖子作者留档 / 教师推送守卫共用）：
// 固定列集，不含口令盐等凭证；调用点读 banned/deactivated 做守卫判定，勿再收窄列集（曾致封禁拦截静默失效）
export async function dbGetUserById(db, id) {
  return await dbGet(db, 'SELECT id, username, role, avatar, banned, deactivated FROM users WHERE id=?', [id]);
}

export async function dbCreateUser(db, username, hash, salt, role) {
  const result = await dbRun(db,
    'INSERT INTO users (username,password_hash,salt,role) VALUES (?,?,?,?)',
    [username, hash, salt, role]);
  return Number(result.meta.last_row_id);
}

// 注册邀请码消费输家的回滚：删除刚建的用户（子表 FK 均 ON DELETE CASCADE，无需逐表清）
export async function dbDeleteUser(db, userId) {
  await dbRun(db, 'DELETE FROM users WHERE id=?', [userId]);
}

// 注销账户：用户名墓碑化 + 凭证清空 + 封禁/注销标记（墓碑全站展示 + 登录阻断）
export async function dbDeactivateUser(db, userId, tombstone) {
  await dbRun(db, `UPDATE users SET username=?, password_hash='', salt='', avatar='', banned=1, deactivated=1 WHERE id=?`,
    [tombstone, userId]);
}

// 教师评分重算（评价通过 / 已通过评价被拒绝或删除时统一调用；注销清理同款口径，单点下沉于此）
export async function dbRecomputeTeacherRating(db, teacherUserId) {
  const stats = await dbGetApprovedReviewStats(db, teacherUserId);
  const cnt = stats?.cnt || 0;
  const sum = stats?.total || 0;
  const rating = (INITIAL_RATING * INITIAL_WEIGHT + sum) / (INITIAL_WEIGHT + cnt);
  await dbUpdateTeacherRating(db, teacherUserId, rating, cnt, sum);
}

// 注销清理：吊销全部登录态 + 单方数据全删；双方共享数据（会话/聊天/合同）匿名化本人侧后保留，
// JOIN username 处自然显示墓碑。学生侧需求（含联系方式）/意向/推送/自写评价一律删除
// （网安报告 F-06：原实现漏删学生侧表，敏感数据永久保留）。
export async function dbPurgeUserOwnedData(db, userId, role) {
  await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id=?', [userId]); // 注销即吊销全部设备的登录态
  await dbRun(db, 'DELETE FROM teacher_profiles WHERE user_id=?', [userId]);
  await dbRun(db, 'DELETE FROM notifications WHERE user_id=?', [userId]);
  await dbRun(db, 'DELETE FROM feedbacks WHERE user_id=?', [userId]);
  await dbRun(db, 'DELETE FROM complaints WHERE user_id=?', [userId]); // R22：注销清理投诉记录
  await dbRun(db, 'DELETE FROM uploads WHERE user_id=?', [userId]);
  await dbRun(db, 'DELETE FROM post_likes WHERE user_id=?', [userId]);
  await dbRun(db, 'DELETE FROM post_favorites WHERE user_id=?', [userId]); // R23：注销清理收藏
  await dbRun(db, 'DELETE FROM posts WHERE user_id=?', [userId]);

  if (role === 'student') {
    // 学生侧：删自建需求（级联删意向/推送，含联系方式与地址）。
    // 网安 N-12：已签约（contracted）需求不删、置 revoked 保留行——否则合同 demand_id 悬空（裸 INTEGER 无 FK）
    await dbRun(db, `DELETE FROM student_demands WHERE user_id=? AND status <> ?`, [userId, STATUS.CONTRACTED]);
    await dbRun(db, `UPDATE student_demands SET status=? WHERE user_id=? AND status=?`, [STATUS.REVOKED, userId, STATUS.CONTRACTED]);
    // 删除本人对教师的评价并重算受影响教师评分
    await dbRun(db, 'DELETE FROM demand_pushes WHERE student_user_id=?', [userId]);
    const myReviews = await dbAll(db, 'SELECT id, teacher_user_id FROM reviews WHERE reviewer_user_id=?', [userId]);
    await dbRun(db, 'DELETE FROM reviews WHERE reviewer_user_id=?', [userId]);
    for (const rv of myReviews) await dbRecomputeTeacherRating(db, rv.teacher_user_id);
  } else if (role === 'teacher') {
    // 教师侧：删其发出的意向/收到的推送；被评价记录保留（评价格局归学生，教师不可自删）
    await dbRun(db, 'DELETE FROM demand_intents WHERE teacher_user_id=?', [userId]);
    await dbRun(db, 'DELETE FROM demand_pushes WHERE teacher_user_id=?', [userId]);
  }

  // 注销幽灵数据：发起方的待处理签约请求收束为「已拒绝」终态——行 + 会话内气泡同步终态。
  // 不能 DELETE：气泡自包含（kind='signing_request' 渲染自 body JSON），行删了气泡仍显 pending 按钮、
  // 接收方点击必 404 死按钮（死签约请求）；也不可留 pending：注销者永不可回应、对方永远悬着。
  // 置 rejected = 单方 offer 收走（offer 作历史双方协商记录保留），气泡终态灰字「已拒绝此次签约请求」。
  const myPendingSignings = await dbAll(db,
    'SELECT id, message_id, price, schedule, method FROM signing_requests WHERE initiator_user_id=? AND status=?',
    [userId, STATUS.PENDING]);
  for (const sr of myPendingSignings) {
    await dbRun(db, `UPDATE signing_requests SET status=?, responded_at=datetime('now','localtime') WHERE id=? AND status=?`,
      [STATUS.REJECTED, sr.id, STATUS.PENDING]);
    if (sr.message_id) {
      await dbRun(db, 'UPDATE messages SET body=? WHERE id=?',
        [JSON.stringify({ id: sr.id, price: sr.price, schedule: sr.schedule, method: sr.method, status: STATUS.REJECTED }), sr.message_id]);
    }
  }

  // 匿名化本人发出的聊天正文与附件（会话/合同行保留，正文清空 + 墓碑用户名显示，符合 F-06 保留分级）。
  // image/file 消息的 dataURL 本体（最高 700KB）与文件名同样清空（不只清 kind='text'），
  // 注销者历史照片/文件会永久留在库中、可被会话对方经 attachment 接口无限期下载。
  // contract 类型的合同事件气泡无隐私本体（body 为固定事件标记），保留以供聊天窗事件展示。
  await dbRun(db, `UPDATE messages SET body='', name='' WHERE sender_user_id=? AND kind IN ('text','image','file')`, [userId]);
}

// 账户设置：头像更新
export async function dbUpdateUserAvatar(db, userId, avatar) {
  await dbRun(db, 'UPDATE users SET avatar=? WHERE id=?', [avatar, userId]);
}

// 管理员封禁 / 解封
export async function dbSetUserBanned(db, userId, banned) {
  await dbRun(db, 'UPDATE users SET banned=? WHERE id=?', [banned, userId]);
}

// ============================================================
// 邀请码
// ============================================================
export async function dbFindValidInviteCode(db, code) {
  // v1.2.0 T4：邀请码无过期时间（去掉 expires_at 条件），一人使用并成功注册后失效（used_by 非空）
  return await dbGet(db,
    "SELECT * FROM invite_codes WHERE code=? AND used_by IS NULL",
    [code]);
}

export async function dbUseInviteCode(db, code, userId) {
  // 赢家模式：并发双注册同码时仅 changes>0 的一方消费成功（防一枚码两人用，调用方回滚输家）
  const r = await dbRun(db,
    "UPDATE invite_codes SET used_by=?, used_at=datetime('now','localtime') WHERE code=? AND used_by IS NULL",
    [userId, code]);
  return !!(r && r.meta && r.meta.changes > 0);
}

export async function dbCreateInviteCode(db, code, adminId) {
  // v1.2.0 T4：邀请码无过期时间（去掉 expires_at 列/参数）
  await dbRun(db,
    'INSERT INTO invite_codes (code,created_by) VALUES (?,?)',
    [code, adminId]);
}


// ============================================================
// JSON 列反序列化单点：subjects / gaokao_scores / target_subjects / current_scores
// 四列在库里是 JSON 字符串，出 db.js 一律经此函数变数组——容错（脏数据不炸全列表），
// 调用方拿到的永远是数组，严禁在路由层再 JSON.parse（双重解析会炸）
// ============================================================
// ============================================================
