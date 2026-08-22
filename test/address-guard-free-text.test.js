/**
 * 门牌号合规红线不得被自由文本字段绕行（S3 单科目适配：body 直传 /api/demands + additionalInfo）
 *  - 需求 additionalInfo：含详细门牌 → 整单 400（与 addressArea 同守）；正常文本 200 且截断到 ADDITIONAL_INFO_MAX
 *  - 教师档案 intro/school：含门牌 → 400（此前仅 address 有守卫）
 *  - 联系方式长度：wechat/email 超 CONTACT_MAX 截断
 *  - S3 §15①：需求联系方式整列删除（parent_contact/student_contact 不存储）→ 联系方式截断断言随旧列删除
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { tokenDigest, decryptField } from '../src/server/core/crypto.js';
import { handleCreateDemand } from '../src/server/domains/demand/api.js';
import { handleSaveProfile } from '../src/server/domains/teacher/api.js';
import { bindTextAuditEnv } from '../src/server/core/text-audit.js';
import { auditBeforeWrite } from '../src/server/core/audit-flow.js'; // 门牌守卫审计面 = _worker 全局断点
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

// S3 单科目需求直传 body（interfaces §19 I-35 形状）
const baseDemand = {
  subject: 'math', grade: 'senior1', province: 'shanghai', teachingMethod: 'offline',
  addressArea: '杨浦区·四平路街道', // 线下单地址须合法「区·镇/街道」
  currentScore: '', expectedTime: '', preferredTags: [], preferredGender: '',
  budgetMin: 0, budgetMax: 0, additionalInfo: '',
};

test('F-1 需求补充说明含门牌号 → 全局断点拒绝（与 addressArea 同守；Q-2c-F5 审计面收归 auditBeforeWrite）', async () => {
  const g = await auditBeforeWrite({ path: '/api/demands', method: 'POST', body: { additionalInfo: '家住静安区5号楼303室' } });
  assert.ok(!g.ok && g.reject, '门牌进补充说明被拒');
});

test('v0.25.110 中文数字门牌不得绕过门控（贰柒捌捌号/五号楼/拾贰号室）', async () => {
  for (const val of ['家在贰柒捌捌号旁边', '具体位置是三十八号楼', '静安区壹拾贰号403室',
    '浦东新区杨高中路贰-柒-捌-捌-号', '杨高中路2-7-8-8号']) {
    const g = await auditBeforeWrite({ path: '/api/demands', method: 'POST', body: { additionalInfo: val } });
    assert.ok(!g.ok && g.reject, `additionalInfo「${val}」含中文数字门牌应被拒`);
  }
  // 教师 intro 中文数字门牌同守（全局断点）
  const gw = await auditBeforeWrite({ path: '/api/teacher/profile', method: 'POST', body: { profile: { intro: '家在八号楼二单元' } } });
  assert.ok(!gw.ok && gw.reject, '教师 intro 中文数字门牌被拒');
  // 裸地址串不再走 audit（addressArea 非自由文本）——仍由 handler 结构化校验拒绝（ADDRESS_REQUIRED）
  const raw = rawOf(); const db = d1Shim(raw);
  const { stuToken } = await seed(db, raw);
  for (const addr of ['上海市xx区xx路伍仟贰佰号', '某某路二百·七十八·号']) {
    const r = await handleCreateDemand(db, { ...baseDemand, addressArea: addr }, reqOf(stuToken));
    assert.equal(r.status, 400, `裸地址串「${addr}」→ 结构化校验拒绝`);
  }
  // 不误伤：号线（地铁/公交）、纯数字未足两位、楼层描述、纯路名无门牌放行
  for (const ok of ['地铁九号线站附近', '中山北路1234弄', '十二号线附近', '浦东新区杨高中路'] ) {
    const g = await auditBeforeWrite({ path: '/api/demands', method: 'POST', body: { additionalInfo: ok } });
    assert.equal(g.ok, true, `「${ok}」audit 放行`);
    const r = await handleCreateDemand(db, { ...baseDemand, additionalInfo: ok }, reqOf(stuToken));
    assert.equal(r.status, 200, `「${ok}」应放行`);
  }
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM student_demands').get().c >= 4, true, '放行项正常落库');
});

test('F-1 需求补充说明正常文本 → 200 + 超长截断到 ADDITIONAL_INFO_MAX', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stuToken } = await seed(db, raw);
  const ok = await handleCreateDemand(db, { ...baseDemand, additionalInfo: '希望老师耐心一些，孩子基础一般' }, reqOf(stuToken));
  assert.equal(ok.status, 200, '正常补充说明放行');
  const long = await handleCreateDemand(db, { ...baseDemand, additionalInfo: '文'.repeat(2000) }, reqOf(stuToken));
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

test('F-4 教师联系方式超长截断：wechat/email ≤ CONTACT_MAX（S3：需求联系方式列已删，仅存教师侧）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { teaToken } = await seed(db, raw);
  const pw = await handleSaveProfile(db, { profile: { province: 'shanghai', grade: 'senior1', gender: 'female', subjects: ['math'], price_min: 150, price_max: 200, wechat: 'w'.repeat(300), email: 'e'.repeat(300) } }, reqOf(teaToken));
  assert.equal(pw.status, 200);
  const row = raw.prepare('SELECT wechat, email FROM teacher_profiles').get();
  assert.equal((await decryptField(row.wechat)).length, 50, 'wechat 截断到 CONTACT_MAX');
  assert.equal((await decryptField(row.email)).length, 50, 'email 截断到 CONTACT_MAX');
});
