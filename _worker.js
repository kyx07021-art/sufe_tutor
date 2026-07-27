/**
 * 上财家教信息共享平台 - Cloudflare Pages Worker
 * 所有 API 路由在此处理，非 API 请求回退到 public/ 静态文件
 *
 * 绑定: env.DB = D1 数据库
 */

// ============================================================
// 敏感信息 — 部署时建议通过环境变量或 Secrets 覆盖
// ============================================================
const ADMIN_USERNAMES = ['admin_sufe'];
const ADMIN_DEFAULT_PASSWORD = 'admin_sufe';

// ============================================================
// 业务常量
// ============================================================
const SUBJECTS = [
  { id: 'chinese', name: '语文', maxScore: 150 },
  { id: 'math', name: '数学', maxScore: 150 },
  { id: 'english', name: '英语', maxScore: 150 },
  { id: 'physics', name: '物理', maxScore: 100 },
  { id: 'chemistry', name: '化学', maxScore: 100 },
  { id: 'biology', name: '生物', maxScore: 100 },
  { id: 'history', name: '历史', maxScore: 100 },
  { id: 'geography', name: '地理', maxScore: 100 },
  { id: 'politics', name: '政治', maxScore: 100 },
];

// 评分系统
const INITIAL_RATING = 4.0;
const INITIAL_WEIGHT = 10;

// 邀请码有效期
const INVITE_VALIDITY_MS = 5 * 60 * 1000;

// ============================================================
// 服务端消息常量
// ============================================================
const MSG = {
  // 验证错误
  USERNAME_LENGTH: '用户名长度需在 3-30 个字符之间',
  PASSWORD_LENGTH: '密码长度至少 6 个字符',
  INVALID_ROLE: '无效的用户角色',
  LOGIN_REQUIRED: '请输入用户名和密码',
  LOGIN_FAILED: '用户名或密码错误',
  USERNAME_TAKEN: '用户名已被注册',

  // 邀请码
  TEACHER_NEEDS_INVITE: '教师注册需要邀请码',
  INVITE_INVALID: '邀请码无效或已过期',
  NO_PERMISSION: '无权限',
  ADMIN_NOT_FOUND: '管理员账户不存在',

  // 教师
  PROFILE_SAVED: '教师信息已保存',

  // 学生需求
  STUDENT_ONLY: '仅学生可提交需求',
  DEMAND_SUBMITTED: '需求已提交',

  // 评价
  RATING_RANGE: '评分需在1-5之间',
  COMMENT_TOO_SHORT: '评价内容太短',
  STUDENT_REVIEW_ONLY: '仅学生可发表评价',
  REVIEW_SUBMITTED: '评价已提交，等待管理员审核',
  REVIEW_NOT_FOUND: '评价不存在',
  REVIEW_APPROVED: '评价已通过',
  REVIEW_REJECTED: '评价已拒绝',

  // 通用
  REGISTER_SUCCESS: '注册成功',
  SERVER_ERROR: '服务器内部错误',
};

// ============================================================
// DB 辅助函数 (D1 API)
// ============================================================
async function dbAll(db, sql, params = []) {
  const r = await db.prepare(sql).bind(...params).all();
  return r.results || [];
}

async function dbGet(db, sql, params = []) {
  return await db.prepare(sql).bind(...params).first();
}

async function dbRun(db, sql, params = []) {
  return await db.prepare(sql).bind(...params).run();
}

// ============================================================
// 数据库初始化
// ============================================================
async function initDb(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','teacher')),
      created_at DATETIME DEFAULT (datetime('now','localtime')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS teacher_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
      grade TEXT, gender TEXT, subjects TEXT, gaokao_scores TEXT,
      price REAL DEFAULT 0, wechat TEXT, email TEXT,
      rating REAL DEFAULT ${INITIAL_RATING},
      rating_count INTEGER DEFAULT 0, rating_sum REAL DEFAULT 0,
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS student_demands (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      student_grade TEXT NOT NULL, student_gender TEXT NOT NULL,
      target_subjects TEXT NOT NULL, current_scores TEXT NOT NULL,
      teaching_method TEXT NOT NULL DEFAULT 'offline',
      address TEXT DEFAULT '', address_detail TEXT DEFAULT '',
      budget_min REAL DEFAULT 0, budget_max REAL DEFAULT 0,
      submitter_type TEXT NOT NULL, parent_contact TEXT NOT NULL,
      student_contact TEXT NOT NULL, additional_info TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_user_id INTEGER NOT NULL,
      reviewer_user_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating>=1 AND rating<=5),
      comment TEXT NOT NULL, status TEXT DEFAULT 'pending'
        CHECK(status IN ('pending','approved','rejected')),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      reviewed_at DATETIME, reviewed_by INTEGER,
      FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY, created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      expires_at DATETIME NOT NULL, used_by INTEGER DEFAULT NULL,
      used_at DATETIME DEFAULT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (used_by) REFERENCES users(id))`),
  ]);

  // 种子管理员
  for (const name of ADMIN_USERNAMES) {
    const existing = await dbGet(db, 'SELECT id FROM users WHERE username = ?', [name]);
    if (!existing) {
      const { hash, salt } = await hashPassword(ADMIN_DEFAULT_PASSWORD);
      await dbRun(db, 'INSERT INTO users (username,password_hash,salt,role) VALUES (?,?,?,?)',
        [name, hash, salt, 'student']);
    }
  }
}

// ============================================================
// 数据访问层 — 所有 SQL 操作封装在此
// 路由处理函数只调用这些函数，不直接写 SQL
// 换数据库时只需重写此区域
// ============================================================

// --- 用户 ---
async function dbFindUserByUsername(db, username) {
  return await dbGet(db, 'SELECT * FROM users WHERE username=?', [username]);
}

async function dbFindUserById(db, id) {
  return await dbGet(db, 'SELECT id,role FROM users WHERE id=?', [id]);
}

async function dbCreateUser(db, username, hash, salt, role) {
  const result = await dbRun(db,
    'INSERT INTO users (username,password_hash,salt,role) VALUES (?,?,?,?)',
    [username, hash, salt, role]);
  return Number(result.meta.last_row_id);
}

// --- 邀请码 ---
async function dbFindValidInviteCode(db, code) {
  return await dbGet(db,
    "SELECT * FROM invite_codes WHERE code=? AND used_by IS NULL AND expires_at > datetime('now','localtime')",
    [code]);
}

async function dbUseInviteCode(db, code, userId) {
  await dbRun(db,
    "UPDATE invite_codes SET used_by=?, used_at=datetime('now','localtime') WHERE code=?",
    [userId, code]);
}

async function dbCreateInviteCode(db, code, adminId, expiresAt) {
  await dbRun(db,
    'INSERT INTO invite_codes (code,created_by,expires_at) VALUES (?,?,?)',
    [code, adminId, expiresAt]);
}

async function dbGetAllInvites(db) {
  return await dbAll(db, `SELECT ic.*, u1.username as creator_name, u2.username as used_by_name
    FROM invite_codes ic LEFT JOIN users u1 ON ic.created_by=u1.id
    LEFT JOIN users u2 ON ic.used_by=u2.id ORDER BY ic.created_at DESC`);
}

// --- 教师档案 ---
async function dbGetTeacherProfile(db, userId) {
  const profile = await dbGet(db, 'SELECT * FROM teacher_profiles WHERE user_id=?', [userId]);
  if (profile) {
    profile.subjects = profile.subjects ? JSON.parse(profile.subjects) : [];
    profile.gaokao_scores = profile.gaokao_scores ? JSON.parse(profile.gaokao_scores) : [];
  }
  return profile;
}

async function dbUpsertTeacherProfile(db, userId, profile) {
  const existing = await dbGet(db, 'SELECT id FROM teacher_profiles WHERE user_id=?', [userId]);
  const subjects = JSON.stringify(profile.subjects);
  const gaokao = JSON.stringify(profile.gaokao_scores);

  if (existing) {
    await dbRun(db, `UPDATE teacher_profiles SET grade=?,gender=?,subjects=?,gaokao_scores=?,
      price=?,wechat=?,email=?,updated_at=datetime('now','localtime') WHERE user_id=?`,
      [profile.grade, profile.gender, subjects, gaokao, profile.price||0, profile.wechat, profile.email, userId]);
  } else {
    await dbRun(db, `INSERT INTO teacher_profiles (user_id,grade,gender,subjects,gaokao_scores,price,wechat,email)
      VALUES (?,?,?,?,?,?,?,?)`,
      [userId, profile.grade, profile.gender, subjects, gaokao, profile.price||0, profile.wechat, profile.email]);
  }
}

async function dbGetAllTeachers(db) {
  const profiles = await dbAll(db, `SELECT tp.*, u.username
    FROM teacher_profiles tp JOIN users u ON tp.user_id=u.id ORDER BY tp.updated_at DESC`);
  return profiles.map(p => ({
    id: p.id, user_id: p.user_id, username: p.username,
    grade: p.grade, gender: p.gender,
    subjects: p.subjects ? JSON.parse(p.subjects) : [],
    gaokao_scores: p.gaokao_scores ? JSON.parse(p.gaokao_scores) : [],
    price: p.price || 0, wechat: p.wechat, email: p.email,
    rating: p.rating, rating_count: p.rating_count, updatedAt: p.updated_at,
  }));
}

async function dbUpdateTeacherRating(db, teacherUserId, rating, count, sum) {
  await dbRun(db,
    'UPDATE teacher_profiles SET rating=?, rating_count=?, rating_sum=? WHERE user_id=?',
    [rating, count, sum, teacherUserId]);
}

// --- 学生需求 ---
async function dbCreateDemand(db, userId, demand) {
  const result = await dbRun(db, `INSERT INTO student_demands
    (user_id,student_grade,student_gender,target_subjects,current_scores,
     teaching_method,address,address_detail,budget_min,budget_max,
     submitter_type,parent_contact,student_contact,additional_info)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    userId, demand.student_grade, demand.student_gender,
    JSON.stringify(demand.target_subjects), JSON.stringify(demand.current_scores),
    demand.teaching_method || 'offline', demand.address || '', demand.address_detail || '',
    demand.budget_min || 0, demand.budget_max || 0,
    demand.submitter_type, demand.parent_contact, demand.student_contact, demand.additional_info || '',
  ]);
  return Number(result.meta.last_row_id);
}

async function dbGetAllDemands(db) {
  const rows = await dbAll(db, `SELECT sd.*, u.username
    FROM student_demands sd JOIN users u ON sd.user_id=u.id ORDER BY sd.created_at DESC`);
  return rows.map(r => ({
    ...r,
    target_subjects: JSON.parse(r.target_subjects || '[]'),
    current_scores: JSON.parse(r.current_scores || '[]'),
  }));
}

// --- 评价 ---
async function dbCreateReview(db, teacherUserId, reviewerUserId, rating, comment) {
  const result = await dbRun(db,
    'INSERT INTO reviews (teacher_user_id,reviewer_user_id,rating,comment) VALUES (?,?,?,?)',
    [teacherUserId, reviewerUserId, rating, comment]);
  return Number(result.meta.last_row_id);
}

async function dbGetApprovedReviews(db, teacherUserId) {
  return await dbAll(db, `SELECT r.*, u.username as reviewer_name
    FROM reviews r JOIN users u ON r.reviewer_user_id=u.id
    WHERE r.teacher_user_id=? AND r.status='approved' ORDER BY r.created_at DESC`,
    [teacherUserId]);
}

async function dbGetPendingReviews(db) {
  return await dbAll(db, `SELECT r.*, u1.username as reviewer_name, u2.username as teacher_name
    FROM reviews r JOIN users u1 ON r.reviewer_user_id=u1.id JOIN users u2 ON r.teacher_user_id=u2.id
    WHERE r.status='pending' ORDER BY r.created_at DESC`);
}

async function dbUpdateReviewStatus(db, reviewId, status) {
  await dbRun(db,
    "UPDATE reviews SET status=?, reviewed_at=datetime('now','localtime') WHERE id=?",
    [status, reviewId]);
}

async function dbGetReviewById(db, reviewId) {
  return await dbGet(db, 'SELECT * FROM reviews WHERE id=?', [reviewId]);
}

async function dbGetApprovedReviewStats(db, teacherUserId) {
  return await dbGet(db, `SELECT COUNT(*) as cnt, COALESCE(SUM(rating),0) as total
    FROM reviews WHERE teacher_user_id=? AND status='approved'`, [teacherUserId]);
}

// --- 管理员统计 ---
async function dbGetUserStats(db) {
  return await dbGet(db, `SELECT COUNT(*) as total,
    SUM(CASE WHEN role='student' THEN 1 ELSE 0 END) as students,
    SUM(CASE WHEN role='teacher' THEN 1 ELSE 0 END) as teachers FROM users`);
}

async function dbGetCount(db, table) {
  const row = await dbGet(db, `SELECT COUNT(*) as cnt FROM ${table}`);
  return row?.cnt || 0;
}

async function dbGetReviewStats(db) {
  return await dbGet(db, `SELECT COUNT(*) as total,
    SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected FROM reviews`);
}

async function dbGetInviteStats(db) {
  return await dbGet(db, `SELECT COUNT(*) as total,
    SUM(CASE WHEN used_by IS NOT NULL THEN 1 ELSE 0 END) as used,
    SUM(CASE WHEN used_by IS NULL AND expires_at>datetime('now','localtime') THEN 1 ELSE 0 END) as active
    FROM invite_codes`);
}

async function dbGetRecentUsers(db, limit = 8) {
  return await dbAll(db, 'SELECT id,username,role,created_at FROM users ORDER BY created_at DESC LIMIT ?', [limit]);
}

async function dbGetRecentDemands(db, limit = 8) {
  const rows = await dbAll(db, `SELECT sd.id,sd.student_grade,sd.target_subjects,sd.created_at,u.username
    FROM student_demands sd JOIN users u ON sd.user_id=u.id ORDER BY sd.created_at DESC LIMIT ?`, [limit]);
  return rows.map(d => ({ ...d, target_subjects: JSON.parse(d.target_subjects || '[]') }));
}

// ============================================================
// 密码学 (Web Crypto API)
// ============================================================
function bufToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, existingSalt) {
  const salt = existingSalt || bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-512' },
    keyMaterial, 512
  );
  return { hash: bufToHex(bits), salt };
}

async function verifyPassword(password, storedHash, salt) {
  const { hash } = await hashPassword(password, salt);
  return hash === storedHash;
}

// ============================================================
// 工具函数
// ============================================================
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function error(msg, status = 400) { return json({ error: msg }, status); }

function checkAdmin(username) { return ADMIN_USERNAMES.includes(username); }

function genCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, v => chars[v % chars.length]).join('');
}

// ============================================================
// 路由：认证
// ============================================================
async function handleRegister(db, body) {
  const { username, password, role, inviteCode } = body;
  if (!username || username.length < 3 || username.length > 30) return error(MSG.USERNAME_LENGTH);
  if (!password || password.length < 6) return error(MSG.PASSWORD_LENGTH);
  if (!['student', 'teacher'].includes(role)) return error(MSG.INVALID_ROLE);

  if (role === 'teacher') {
    if (!inviteCode) return error(MSG.TEACHER_NEEDS_INVITE);
    const code = await dbFindValidInviteCode(db, inviteCode);
    if (!code) return error(MSG.INVITE_INVALID);

    if (await dbFindUserByUsername(db, username)) return error(MSG.USERNAME_TAKEN);

    const { hash, salt } = await hashPassword(password);
    const userId = await dbCreateUser(db, username, hash, salt, role);
    await dbUseInviteCode(db, inviteCode, userId);
    return json({ user: { id: userId, username, role }, message: MSG.REGISTER_SUCCESS });
  }

  if (await dbFindUserByUsername(db, username)) return error(MSG.USERNAME_TAKEN);

  const { hash, salt } = await hashPassword(password);
  const userId = await dbCreateUser(db, username, hash, salt, role);
  return json({ user: { id: userId, username, role }, message: MSG.REGISTER_SUCCESS });
}

async function handleLogin(db, body) {
  const { username, password } = body;
  if (!username || !password) return error(MSG.LOGIN_REQUIRED);

  const user = await dbFindUserByUsername(db, username);
  if (!user || !(await verifyPassword(password, user.password_hash, user.salt))) {
    return error(MSG.LOGIN_FAILED, 401);
  }
  return json({ user: { id: user.id, username: user.username, role: user.role, isAdmin: checkAdmin(username) } });
}

// ============================================================
// 路由：管理员
// ============================================================
async function handleAdminCheck(db, url) {
  const username = url.searchParams.get('username');
  return json({ isAdmin: checkAdmin(username) });
}

async function handleGenInvite(db, body) {
  const { username } = body;
  if (!checkAdmin(username)) return error(MSG.NO_PERMISSION, 403);
  const admin = await dbFindUserByUsername(db, username);
  if (!admin) return error(MSG.ADMIN_NOT_FOUND, 403);

  const code = genCode(8);
  const expiresAt = new Date(Date.now() + INVITE_VALIDITY_MS).toISOString();
  await dbCreateInviteCode(db, code, admin.id, expiresAt);
  return json({ code, expiresAt });
}

async function handleAdminInvites(db, url) {
  if (!checkAdmin(url.searchParams.get('username'))) return error(MSG.NO_PERMISSION, 403);
  const invites = await dbGetAllInvites(db);
  return json({ invites });
}

async function handleAdminStats(db, url) {
  if (!checkAdmin(url.searchParams.get('username'))) return error(MSG.NO_PERMISSION, 403);

  const users = await dbGetUserStats(db) || { total:0, students:0, teachers:0 };
  const profiles = await dbGetCount(db, 'teacher_profiles');
  const demands = await dbGetCount(db, 'student_demands');
  const reviews = await dbGetReviewStats(db) || { total:0, approved:0, pending:0, rejected:0 };
  const invites = await dbGetInviteStats(db) || { total:0, used:0, active:0 };
  const recentUsers = await dbGetRecentUsers(db);
  const recentDemands = await dbGetRecentDemands(db);

  return json({
    stats: { users, profiles, demands, reviews, invites, recentUsers, recentDemands }
  });
}

async function handleAdminReviews(db, url) {
  if (!checkAdmin(url.searchParams.get('username'))) return error(MSG.NO_PERMISSION, 403);
  const reviews = await dbGetPendingReviews(db);
  return json({ reviews });
}

async function handleReviewAction(db, reviewId, action, body) {
  if (!checkAdmin(body.username)) return error(MSG.NO_PERMISSION, 403);
  const review = await dbGetReviewById(db, reviewId);
  if (!review) return error(MSG.REVIEW_NOT_FOUND);

  const status = action === 'approve' ? 'approved' : 'rejected';
  await dbUpdateReviewStatus(db, reviewId, status);

  if (action === 'approve') {
    const stats = await dbGetApprovedReviewStats(db, review.teacher_user_id);
    const cnt = stats?.cnt || 0;
    const sum = stats?.total || 0;
    const rating = (INITIAL_RATING * INITIAL_WEIGHT + sum) / (INITIAL_WEIGHT + cnt);
    await dbUpdateTeacherRating(db, review.teacher_user_id, rating, cnt, sum);
  }
  return json({ message: action === 'approve' ? MSG.REVIEW_APPROVED : MSG.REVIEW_REJECTED });
}

// ============================================================
// 路由：教师
// ============================================================
async function handleGetProfile(db, url) {
  const userId = parseInt(url.searchParams.get('userId'));
  const profile = await dbGetTeacherProfile(db, userId);
  return json({ profile: profile || null });
}

async function handleSaveProfile(db, body) {
  const { userId, profile: p } = body;
  await dbUpsertTeacherProfile(db, userId, p);
  return json({ message: MSG.PROFILE_SAVED });
}

async function handleGetTeachers(db) {
  const teachers = await dbGetAllTeachers(db);
  return json({ teachers });
}

// ============================================================
// 路由：学生需求
// ============================================================
async function handleCreateDemand(db, body) {
  const { userId, demand: d } = body;
  const user = await dbFindUserById(db, userId);
  if (!user || user.role !== 'student') return error(MSG.STUDENT_ONLY, 403);

  const id = await dbCreateDemand(db, userId, d);
  return json({ id, message: MSG.DEMAND_SUBMITTED });
}

async function handleGetDemands(db) {
  const demands = await dbGetAllDemands(db);
  return json({ demands });
}

// ============================================================
// 路由：评论
// ============================================================
async function handleCreateReview(db, body) {
  const { teacherUserId, reviewerUserId, rating, comment } = body;
  if (!rating || rating < 1 || rating > 5) return error(MSG.RATING_RANGE);
  if (!comment || comment.trim().length < 2) return error(MSG.COMMENT_TOO_SHORT);

  const reviewer = await dbFindUserById(db, reviewerUserId);
  if (!reviewer || reviewer.role !== 'student') return error(MSG.STUDENT_REVIEW_ONLY, 403);

  const id = await dbCreateReview(db, teacherUserId, reviewerUserId, rating, comment.trim());
  return json({ id, message: MSG.REVIEW_SUBMITTED });
}

async function handleGetReviews(db, url) {
  const teacherUserId = parseInt(url.searchParams.get('teacherUserId'));
  const reviews = await dbGetApprovedReviews(db, teacherUserId);
  return json({ reviews });
}

// ============================================================
// 主路由
// ============================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 非 API 请求 → 静态文件
    if (!p.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    // 首次请求时初始化数据库
    if (!env._dbInited) {
      await initDb(env.DB);
      env._dbInited = true;
    }

    const db = env.DB;
    let body = {};
    if (request.method === 'POST') {
      try { body = await request.json(); } catch { body = {}; }
    }

    try {
      // 认证
      if (p === '/api/auth/register' && request.method === 'POST') return await handleRegister(db, body);
      if (p === '/api/auth/login' && request.method === 'POST') return await handleLogin(db, body);

      // 管理员
      if (p === '/api/admin/check' && request.method === 'GET') return await handleAdminCheck(db, url);
      if (p === '/api/admin/invite' && request.method === 'POST') return await handleGenInvite(db, body);
      if (p === '/api/admin/invites' && request.method === 'GET') return await handleAdminInvites(db, url);
      if (p === '/api/admin/stats' && request.method === 'GET') return await handleAdminStats(db, url);
      if (p === '/api/admin/reviews' && request.method === 'GET') return await handleAdminReviews(db, url);
      if (p.match(/^\/api\/admin\/reviews\/(\d+)\/approve$/) && request.method === 'POST') {
        const id = parseInt(p.match(/\/(\d+)\//)[1]);
        return await handleReviewAction(db, id, 'approve', body);
      }
      if (p.match(/^\/api\/admin\/reviews\/(\d+)\/reject$/) && request.method === 'POST') {
        const id = parseInt(p.match(/\/(\d+)\//)[1]);
        return await handleReviewAction(db, id, 'reject', body);
      }

      // 教师
      if (p === '/api/teacher/profile' && request.method === 'GET') return await handleGetProfile(db, url);
      if (p === '/api/teacher/profile' && request.method === 'POST') return await handleSaveProfile(db, body);
      if (p === '/api/teachers' && request.method === 'GET') return await handleGetTeachers(db);

      // 学生需求
      if (p === '/api/student/demands' && request.method === 'POST') return await handleCreateDemand(db, body);
      if (p === '/api/student/demands' && request.method === 'GET') return await handleGetDemands(db);

      // 评论
      if (p === '/api/reviews' && request.method === 'POST') return await handleCreateReview(db, body);
      if (p === '/api/reviews' && request.method === 'GET') return await handleGetReviews(db, url);

      // 健康检查
      if (p === '/api/health') return json({ status: 'ok', timestamp: new Date().toISOString() });

      return error('Not Found', 404);
    } catch (err) {
      console.error('API Error:', err);
      return error(MSG.SERVER_ERROR + ': ' + err.message, 500);
    }
  },
};
