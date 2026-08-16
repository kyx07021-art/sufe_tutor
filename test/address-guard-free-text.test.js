/**
 * 2026-08-09 收尾审计 F-1/F-4：门牌号合规红线不得被自由文本字段绕行
 *  - 需求 additional_info：含详细门牌 → 整单 400（与 address 同守）；正常文本 201 且截断到 ADDITIONAL_INFO_MAX
 *  - 教师档案 intro/school：含门牌 → 400（此前仅 address 有守卫）
 *  - 联系方式长度：wechat/email 超 CONTACT_MAX 截断（此前无上限，可塞 MB 级）
 *  - 需求 parent_contact/student_contact 同款截断
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { tokenDigest, decryptField } from '../server/crypto.js';
import { handleCreateDemand } from '../server/routes-demands.js';
import { handleSaveProfile } from '../server/routes-teacher.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

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

test('F-1 需求补充说明含门牌号 → 整单 400（与 address 同守）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stuToken } = await seed(db, raw);
  const r = await handleCreateDemand(db, { demand: { ...baseDemand, additional_info: '家住静安区5号楼303室' } }, reqOf(stuToken));
  assert.equal(r.status, 400, '门牌进补充说明被拒');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM student_demands').get().c, 0, '无任何需求落库');
});

test('v0.25.110 中文数字门牌不得绕过门控（贰柒捌捌号/五号楼/拾贰号室）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stuToken, teaToken } = await seed(db, raw);
  // 用户实证：贰柒捌捌号（中文数字）曾绕过
  // 需求五（v0.28.1）：address 字段已结构化（区·镇/街道选择器），自由文本无处写入门牌——
  // 注入的裸地址串经 isValidShanghaiAddr 拒绝（400 ADDRESS_REQUIRED），守卫语义由 ADDRESS_GUARD 升级为结构校验；
  // additional_info 仍走 auditFreeText 门牌咽喉（合规红线不因字段绕行）。
  for (const [field, val] of [
    ['additional_info', '家在贰柒捌捌号旁边'],
    ['additional_info', '具体位置是三十八号楼'],
    ['address', '上海市xx区xx路伍仟贰佰号'],
    ['additional_info', '静安区壹拾贰号403室'],
    // v0.25.113（用户实证）：数字位间夹分隔符（连字符/顿号/空格）曾绕过——贰-柒-捌-捌-号
    ['additional_info', '浦东新区杨高中路贰-柒-捌-捌-号'],
    ['additional_info', '杨高中路2-7-8-8号'],
    ['address', '某某路二百·七十八·号'],
  ]) {
    const r = await handleCreateDemand(db, { demand: { ...baseDemand, [field]: val } }, reqOf(stuToken));
    assert.equal(r.status, 400, `${field}「${val}」含中文数字门牌应被拒`);
  }
  // 教师 intro 中文数字门牌同守
  const pw = await handleSaveProfile(db, { profile: { province: 'shanghai', price_min: 150, price_max: 200, intro: '家在八号楼二单元' } }, reqOf(teaToken));
  assert.equal(pw.status, 400, '教师 intro 中文数字门牌被拒');
  // 不误伤：号线（地铁/公交）、纯数字未足两位、楼层描述、纯路名无门牌放行
  for (const ok of ['地铁九号线站附近', '中山北路1234弄', '十二号线附近', '浦东新区杨高中路'] ) {
    const r = await handleCreateDemand(db, { demand: { ...baseDemand, additional_info: ok } }, reqOf(stuToken));
    assert.equal(r.status, 200, `「${ok}」应放行`);
  }
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM student_demands').get().c >= 2, true, '放行项正常落库');
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

test('F-1 教师 intro/school 含门牌号 → 400（此前仅 address 有守卫）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { teaToken } = await seed(db, raw);
  const base = { province: 'shanghai', price_min: 150, price_max: 200 };
  for (const [field, val] of [['intro', '家在8号楼702室'], ['school', '某某学院3号楼']]) {
    const r = await handleSaveProfile(db, { profile: { ...base, [field]: val } }, reqOf(teaToken));
    assert.equal(r.status, 400, `${field} 门牌被拒`);
  }
});

test('F-4 联系方式超长截断：wechat/email ≤ CONTACT_MAX、parent/student_contact ≤ CONTACT_MAX', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { teaToken, stuToken } = await seed(db, raw);
  // 测试环境无 FIELD_ENC_KEY → encryptField fail-open 存明文，可直接断言落库长度（routes 层 slice 先于 db）
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
