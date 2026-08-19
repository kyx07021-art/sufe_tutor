/**
 * 2026-08-09 收尾审计 F-1/F-4：门牌号合规红线不得被自由文本字段绕行
 *  - 需求 additional_info：含详细门牌 → 整单 400（与 address 同守）；正常文本 201 且截断到 ADDITIONAL_INFO_MAX
 *  - 教师档案 intro/school：含门牌 → 400（此前仅 address 有守卫）
 *  - 联系方式长度：wechat/email 超 CONTACT_MAX 截断（此前无上限，可塞 MB 级）
 *  - 需求 parent_contact/student_contact 同款截断
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { tokenDigest, decryptField } from '../src/server/core/crypto.js';
import { handleCreateDemand } from '../src/server/domains/demand/api.js';
import { handleSaveProfile } from '../src/server/domains/teacher/api.js';
import { bindTextAuditEnv } from '../src/server/core/text-audit.js';
import { auditBeforeWrite } from '../src/server/core/audit-flow.js'; // Q-2c-F5：门牌守卫审计面 = _worker 全局断点
import { TEST_SECRETS } from './_test-secrets.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };
const origFetch = globalThis.fetch;
beforeEach(() => {
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"flagged": false}' } }] }) });
});
afterEach(() => { bindTextAuditEnv(null); globalThis.fetch = origFetch; });


function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = {
        _sql: sql, _params: [],
        bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) {
          const info = raw.prepare(st._sql).run(...(p.length ? p : st._params));
          return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
        },
      };
      return st;
    },
    async batch(stmts) {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT');
        return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });

async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('stu','h','s','student'),('tea','h','s','teacher')`);
  const idOf = name => raw.prepare("SELECT id FROM users WHERE username=?").get(name).id;
  const mkToken = async name => {
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { stuToken: await mkToken('stu'), teaToken: await mkToken('tea') };
}

const baseDemand = {
  province: 'shanghai', student_grade: 'senior1', student_gender: 'female',
  target_subjects: ['math'], current_scores: [], teaching_method: 'offline',
  address: '杨浦区·四平路街道', // 需求五：线下单地址须合法「区·镇/街道」（单区名 '杨浦区' 已不合法）
  submitter_type: 'self', parent_contact: '13800000000',
  student_contact: '13800000000', additional_info: '',
};

test('F-1 需求补充说明含门牌号 → 全局断点拒绝（与 address 同守；Q-2c-F5 审计面收归 auditBeforeWrite）', async () => {
  // Q-2c-F5：域内 audit 已删，门牌红线由 _worker 全局断点统一把关——直测 auditBeforeWrite 锁生产真实面
  const g = await auditBeforeWrite({ path: '/api/student/demands', method: 'POST', body: { demand: { additional_info: '家住静安区5号楼303室' } } });
  assert.ok(!g.ok && g.reject, '门牌进补充说明被拒');
});

test('v0.25.110 中文数字门牌不得绕过门控（贰柒捌捌号/五号楼/拾贰号室）', async () => {
  // Q-2c-F5：additional_info 门牌守卫审计面 = _worker 全局断点（域内 audit 已删）——直测 auditBeforeWrite
  // 用户实证：贰柒捌捌号（中文数字）曾绕过；address 已结构化（区·镇/街道 picker），裸地址串由 handler 结构校验拒绝
  for (const val of ['家在贰柒捌捌号旁边', '具体位置是三十八号楼', '静安区壹拾贰号403室',
    // v0.25.113（用户实证）：数字位间夹分隔符（连字符/顿号/空格）曾绕过——贰-柒-捌-捌-号
    '浦东新区杨高中路贰-柒-捌-捌-号', '杨高中路2-7-8-8号']) {
    const g = await auditBeforeWrite({ path: '/api/student/demands', method: 'POST', body: { demand: { additional_info: val } } });
    assert.ok(!g.ok && g.reject, `additional_info「${val}」含中文数字门牌应被拒`);
  }
  // 教师 intro 中文数字门牌同守（全局断点）
  const gw = await auditBeforeWrite({ path: '/api/teacher/profile', method: 'POST', body: { profile: { intro: '家在八号楼二单元' } } });
  assert.ok(!gw.ok && gw.reject, '教师 intro 中文数字门牌被拒');
  // 裸地址串不再走 audit（address 非自由文本）——仍由 handler 结构化校验拒绝（ADDRESS_REQUIRED）
  const raw = rawOf(); const db = d1Shim(raw);
  const { stuToken } = await seed(db, raw);
  for (const addr of ['上海市xx区xx路伍仟贰佰号', '某某路二百·七十八·号']) {
    const r = await handleCreateDemand(db, { demand: { ...baseDemand, address: addr } }, reqOf(stuToken));
    assert.equal(r.status, 400, `裸地址串「${addr}」→ 结构化校验拒绝`);
  }
  // 不误伤：号线（地铁/公交）、纯数字未足两位、楼层描述、纯路名无门牌放行
  for (const ok of ['地铁九号线站附近', '中山北路1234弄', '十二号线附近', '浦东新区杨高中路'] ) {
    const g = await auditBeforeWrite({ path: '/api/student/demands', method: 'POST', body: { demand: { additional_info: ok } } });
    assert.equal(g.ok, true, `「${ok}」audit 放行`);
    const r = await handleCreateDemand(db, { demand: { ...baseDemand, additional_info: ok } }, reqOf(stuToken));
    assert.equal(r.status, 200, `「${ok}」应放行`);
  }
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM student_demands').get().c >= 4, true, '放行项正常落库');
});

test('F-1 需求补充说明正常文本 → 201 + 超长截断到 ADDITIONAL_INFO_MAX', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stuToken } = await seed(db, raw);
  const ok = await handleCreateDemand(db, { demand: { ...baseDemand, additional_info: '希望老师耐心一些，孩子基础一般' } }, reqOf(stuToken));
  assert.equal(ok.status, 200, '正常补充说明放行');
  const long = await handleCreateDemand(db, { demand: { ...baseDemand, additional_info: '文'.repeat(2000) } }, reqOf(stuToken));
  assert.equal(long.status, 200);
  const row = raw.prepare('SELECT additional_info FROM student_demands ORDER BY id DESC LIMIT 1').get();
  assert.ok(row.additional_info.length <= 500, `补充说明截断到 500（实 ${row.additional_info.length}）`);
});

test('F-1 教师 intro/school 含门牌号 → 全局断点拒绝（Q-2c-F5 审计面）', async () => {
  for (const [field, val] of [['intro', '家在8号楼702室'], ['school', '某某学院3号楼']]) {
    const g = await auditBeforeWrite({ path: '/api/teacher/profile', method: 'POST', body: { profile: { [field]: val } } });
    assert.ok(!g.ok && g.reject, `${field} 门牌被拒`);
  }
});

test('F-4 联系方式超长截断：wechat/email ≤ CONTACT_MAX、parent/student_contact ≤ CONTACT_MAX', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { teaToken, stuToken } = await seed(db, raw);
  // 测试环境无 FIELD_ENC_KEY → encryptField 回落 LOG_ENCRYPT_KEY 加密，解密后断言落库长度（routes 层 slice 先于 db）
  const pw = await handleSaveProfile(db, { profile: { province: 'shanghai', grade: 'senior1', gender: 'female', subjects: ['math'], price_min: 150, price_max: 200, wechat: 'w'.repeat(300), email: 'e'.repeat(300) } }, reqOf(teaToken));
  assert.equal(pw.status, 200);
  const row = raw.prepare('SELECT wechat, email FROM teacher_profiles').get();
  assert.equal((await decryptField(row.wechat)).length, 50, 'wechat 截断到 CONTACT_MAX');
  assert.equal((await decryptField(row.email)).length, 50, 'email 截断到 CONTACT_MAX');
  const dc = await handleCreateDemand(db, { demand: { ...baseDemand, parent_contact: '1'.repeat(300), student_contact: '2'.repeat(300) } }, reqOf(stuToken));
  assert.equal(dc.status, 200, '超长联系方式不拒（截断语义）');
  const drow = raw.prepare('SELECT parent_contact FROM student_demands ORDER BY id DESC LIMIT 1').get();
  assert.equal((await decryptField(drow.parent_contact)).length, 50, 'parent_contact 截断到 CONTACT_MAX');
});
