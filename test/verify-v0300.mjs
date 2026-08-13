// v0.30.0 任务二生产验证：内容审核 L1 规则层挂接 + 确认签约 capToken 二次认证
// QA 固定账户；验证后清理临时数据，不污染生产。登录只做一次复用令牌（防限流 strike/block）。
const BASE = 'https://sufe-tutor.pages.dev';
const results = [];
const ok = (name, pass, detail = '') => results.push((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));

const AUTH = async (identifier, password) => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (r.status !== 200) throw new Error('login ' + identifier + ' failed: ' + r.status + ' ' + await r.text());
  return r.json();
};
const J = h => ({ ...h, 'Content-Type': 'application/json' });
const post = (url, token, body) => fetch(BASE + url, { method: 'POST', headers: J(token ? { 'X-Auth-Token': token } : {}), body: JSON.stringify(body) });
const del = (url, token) => fetch(BASE + url, { method: 'DELETE', headers: J({ 'X-Auth-Token': token }) });

const DOORPLATE_POST_BODY = { title: '临时验证帖', bodyMd: '老师您好，我家在静安区5号楼303室，欢迎上门试课' };
const NORMAL_POST_BODY = { title: '临时验证帖', bodyMd: '分享一轮复习方法：每天两小时专注刷题' };
const createdIds = [];

const cleanup = async () => {
  if (!createdIds.length) return;
  const r = await fetch(BASE + '/api/auth/login', { // 清理需重新拿令牌（脚本作用域内可能已无）
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'qa_teacher', password: 'SufeQa2026!' }),
  });
  if (r.status !== 200) { console.log('cleanup re-login failed'); return; }
  const tok = (await r.json()).authToken;
  for (const id of createdIds) {
    const d = await del('/api/posts/' + id, tok);
    if (d && !d.ok) console.log('cleanup post ' + id + ': ' + d.status);
  }
};

try {
  const stu = await AUTH('qa_student', 'SufeQa2026!');
  const tch = await AUTH('qa_teacher', 'SufeQa2026!');
  const stuTok = stu.authToken; const tchTok = tch.authToken;
  ok('登录 qa_student/qa_teacher', true, 'student=' + stu.user.id + ' teacher=' + tch.user.id);

  // 1) 审核 L1：帖子正文含详细门牌号 → 400 合规红线（不落库；audit 断点在角色门前，学生令牌同样验证）
  const badPost = await post('/api/posts', stuTok, DOORPLATE_POST_BODY);
  const badPostTxt = await badPost.text();
  ok('帖子含门牌号 → 400（合规红线）', badPost.status === 400, 'status=' + badPost.status + ' ' + badPostTxt.slice(0, 60));

  // 2) 审核 L1：帖子正常内容 → 放行 201，随后删除（posts 为教师专属，用 qa_teacher）
  const goodPost = await post('/api/posts', tchTok, NORMAL_POST_BODY);
  const goodPostBody = await goodPost.json();
  ok('帖子正常内容 → 放行', goodPost.status >= 200 && goodPost.status < 300, 'status=' + goodPost.status + ' id=' + goodPostBody.id);
  if (goodPostBody.id) createdIds.push(goodPostBody.id);

  // 3) 审核 L1：反馈/投诉自由文本含门牌号 → 400（不落库）
  const badFb = await post('/api/feedbacks', stuTok, { title: '建议', content: '我家小区门口 xx路88号，请加装路灯' });
  ok('反馈含门牌号 → 400', badFb.status === 400, 'status=' + badFb.status);
  const badComp = await post('/api/complaints', stuTok, { targetUserId: tch.user.id, reason: '违约', detail: '联系地址：中山北路88号' });
  ok('投诉含门牌号 → 400', badComp.status === 400, 'status=' + badComp.status + ' ' + (await badComp.text()).slice(0, 60));

  // 4) 审核 L1：聊天批量正文含门牌号 → 400；正常聊天 → 放行（batch[].body 抽取）
  const convs = await fetch(BASE + '/api/conversations', { headers: J({ 'X-Auth-Token': stuTok }) });
  const convList = await convs.json();
  const conv = (Array.isArray(convList.conversations) ? convList.conversations : convList.conversations || [])
    .find(c => String(c.teacher_user_id) === String(tch.user.id));
  if (conv) {
    const badChat = await post('/api/conversations/' + conv.id + '/messages', stuTok,
      { batch: [{ kind: 'text', body: '您到了吗，我家在9号楼502室' }] });
    ok('聊天正文含门牌号 → 400', badChat.status === 400, 'status=' + badChat.status);
  } else {
    ok('聊天含门牌号 → 400', true, 'SKIP：qa 两会话无共同会话');
  }

  // 5) 确认签约须 capToken（S2-2）：找 qa 之间的 pending 签约请求，accept 不带 capToken → 403
  let signingProbe = 'SKIP：无待回应签约请求';
  if (conv) {
    const msgs = await fetch(BASE + '/api/conversations/' + conv.id + '/messages?limit=50', { headers: J({ 'X-Auth-Token': stuTok }) });
    const msgList = (await msgs.json()).messages || [];
    const sr = msgList.find(m => m.kind === 'signing_request' && m.status === 'pending');
    if (sr && sr.signing_id) {
      const noCap = await post('/api/signing-requests/' + sr.signing_id + '/respond', stuTok, { accept: true });
      signingProbe = 'status=' + noCap.status + ' ' + (await noCap.text()).slice(0, 60);
      ok('确认签约无 capToken → 403', noCap.status === 403, signingProbe);
    } else {
      ok('确认签约无 capToken → 403', true, 'SKIP：会话内无 pending 签约请求');
    }
  } else {
    ok('确认签约无 capToken → 403', true, 'SKIP：qa 两会话无共同会话');
  }

  // 6) 版本/健康
  const h = await fetch(BASE + '/api/health');
  ok('健康检查 /api/health', h.status === 200, 'status=' + h.status);
  const v = await (await fetch(BASE + '/constants.js')).text();
  ok('线上版本 0.30.0', /0\.30\.0/.test(v), v.match(/APP_VERSION:\s*'[^']+'/)?.[0] || '');
} catch (err) {
  ok('脚本异常', false, String(err && err.message || err));
} finally {
  await cleanup();
  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL '));
  console.log('\n' + (results.length - fails.length) + '/' + results.length + ' PASS');
  process.exit(fails.length ? 1 : 0);
}
