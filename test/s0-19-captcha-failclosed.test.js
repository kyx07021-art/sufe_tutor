/**
 * S0-19 captcha verify throat (src/server/core/human-check.js) — fail-closed mutation guard.
 *
 * Locks four fail-closed contracts with mutation-guarded assertions:
 *   1. human/bot trajectory judgment (mutation: always-ok OR always-fail -> the opposite
 *      track leaks through -> red; both directions locked).
 *   2. anti-replay single consumption (mutation: markChallengePassed always-true ->
 *      same captchaId 2nd verify returns 200 instead of 403 -> red).
 *   3. log failure must NOT flip the verify verdict (E2) — injected throwing logger:
 *      success stays 200 and bot stays 403 even though every audit write throws
 *      (mutation: logCaptchaResult loses its try/catch -> the throw propagates -> red).
 *   4. audit side-effect actually happens (E1) — injected recording logger must capture
 *      captcha.verify.passed/failed with score/reason/points/offset (mutation: drop the
 *      logCaptchaResult call -> no record -> red). E1 gap exposure itself lives inside
 *      logEvent (dropped counter), not re-swallowed here.
 * Plus: PASS_SCORE / replay window / tolerance single-source lock against config
 * (mutation: module falls back to a local literal -> red).
 */
// NOTE (F-3): the hard-cap test below leaves the module-level passedChallenges map FULL (~10000
// entries) for the rest of this file's process. Any test added AFTER it must not assume an empty/small
// map — either add it before the hard-cap test, or use distinct captchaIds and assert on its own flow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  humanTrajectoryCheck, markChallengePassed, isChallengeVerified, handleCaptchaVerify, PASS_SCORE,
  CAPTCHA_CONFIRM_LIMIT,
} from '../src/server/core/human-check.js';
import { LIMITS, CONFIG } from '../src/shared/config.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** human-like track: slow-fast-slow displacement (frac - sin(2π·frac)/2π) + y jitter + 800ms + 60 points */
function humanTrack() {
  const pts = [];
  const T = 800, N = 60, dist = 200;
  for (let i = 0; i < N; i++) {
    const frac = i / (N - 1);
    const x = dist * (frac - Math.sin(2 * Math.PI * frac) / (2 * Math.PI));
    const y = 100 + Math.sin(frac * 20) * 2 + (Math.random() - 0.5) * 3;
    pts.push({ t: Math.round(T * frac), x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  }
  return pts;
}

/** bot track: uniform speed, 48ms total, constant y */
function botTrack() {
  const pts = [];
  for (let i = 0; i < 40; i++) pts.push({ t: i * 1.2, x: i * 5, y: 100 });
  return pts;
}

const req = () => ({ headers: new Headers() });

test('S0-19：人机判定——人样轨迹通过 / 机器轨迹拒绝（变异删判定两向 → 红）', () => {
  for (let i = 0; i < 5; i++) { // random jitter must stay above the threshold deterministically
    const r = humanTrajectoryCheck(humanTrack());
    assert.equal(r.ok, true, `第 ${i + 1} 条人样轨迹应通过，score=${r.score} reason=${r.reason}（变异：判定恒拒 → 红）`);
  }
  for (let i = 0; i < 3; i++) {
    const r = humanTrajectoryCheck(botTrack());
    assert.equal(r.ok, false, `机器轨迹应拒绝，score=${r.score}（变异：判定恒放行 → 红）`);
  }
});

test('S0-19：评分跨越放行阈值单源 LIMITS.CAPTCHA_PASS_SCORE', () => {
  assert.equal(PASS_SCORE, LIMITS.CAPTCHA_PASS_SCORE, '导出的 PASS_SCORE 与 config 单源一致（变异：本地改阈值 → 红）');
  assert.ok(humanTrajectoryCheck(humanTrack()).score >= LIMITS.CAPTCHA_PASS_SCORE, '人样轨迹分数 ≥ 阈值');
  assert.ok(humanTrajectoryCheck(botTrack()).score < LIMITS.CAPTCHA_PASS_SCORE, '机器轨迹分数 < 阈值');
});

test('S0-19：轨迹缺失 / 点数过少 / 非法点 / 无位移 → 拒绝', () => {
  assert.equal(humanTrajectoryCheck(null).ok, false, 'null 轨迹拒绝');
  assert.equal(humanTrajectoryCheck([]).ok, false, '空轨迹拒绝');
  assert.equal(humanTrajectoryCheck([{ t: 0, x: 0, y: 0 }]).ok, false, '单点拒绝');
  assert.equal(humanTrajectoryCheck(humanTrack().slice(0, 8)).ok, false, '少于 10 点拒绝');
  assert.equal(humanTrajectoryCheck(humanTrack().map(p => ({ t: 'a', x: null, y: undefined }))).ok, false, '非法点拒绝');
  const flat = [{ t: 0, x: 0, y: 0 }, { t: 800, x: 0, y: 0 }];
  assert.equal(humanTrajectoryCheck(flat).ok, false, '无横向位移拒绝');
});

test('S0-19：防重放——同 captchaId 放行后二次 verify 403（变异删防重放 → 红）', async () => {
  const first = await handleCaptchaVerify(null, { captchaId: 'replay-only', track: humanTrack() }, req());
  assert.equal(first.status, 200, '首次放行');
  const second = await handleCaptchaVerify(null, { captchaId: 'replay-only', track: humanTrack() }, req());
  assert.equal(second.status, 403, '同挑战重复提交拒绝（变异：防重放恒放行 → 二次 200 → 红）');
  const fresh = await handleCaptchaVerify(null, { captchaId: 'replay-fresh', track: humanTrack() }, req());
  assert.equal(fresh.status, 200, '新挑战可放行');
});

test('S0-19：handleCaptchaVerify 全路径——人 200 / 机器 403 / 缺轨迹 400 / offset 观测', async () => {
  const ok = await handleCaptchaVerify(null, { captchaId: 'flow-ok', offset: 0.5, track: humanTrack() }, req());
  assert.equal(ok.status, 200, '人样轨迹成功路径 200');
  const okBody = await ok.json();
  assert.deepEqual({ ok: true, hasScore: typeof okBody.score === 'number' }, { ok: true, hasScore: true }, '成功路径返回 { ok, score }（裸对象恒 500，R-3 根因）');
  const bot = await handleCaptchaVerify(null, { captchaId: 'flow-bot', offset: 0.5, track: botTrack() }, req());
  assert.equal(bot.status, 403, '机器轨迹 403');
  const missing = await handleCaptchaVerify(null, { captchaId: 'flow-missing' }, req());
  assert.equal(missing.status, 400, '轨迹缺失 400');
});

test('S0-19：isChallengeVerified——放行后可确认 / 未放行拒绝 / 窗口外过期（变异删窗口判定 → 红）', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  assert.equal(isChallengeVerified('never-marked'), false, '从未放行的 captchaId 拒绝');
  assert.equal(isChallengeVerified(''), false, '空 captchaId 拒绝');
  assert.equal(markChallengePassed('verify-now'), true, '放行登记');
  assert.equal(isChallengeVerified('verify-now'), true, '放行后可确认（窗口内）');
  // confirmation is counted, not consumed: the passedChallenges entry survives, so replay stays
  // blocked (a destructive consume-once read would break the verify modal's legitimate retries)
  assert.equal(markChallengePassed('verify-now'), false, 'isChallengeVerified 不删键 → 重放仍拒');
  t.mock.timers.tick(LIMITS.CAPTCHA_REUSE_WINDOW_MS + 1);
  assert.equal(isChallengeVerified('verify-now'), false, '窗口外过期拒绝（变异：isChallengeVerified 只查存在不查窗口 → 恒 true → 红）');
});

test('S0-19：isChallengeVerified 每 captchaId 确认限次——预算内放行 / 超预算拒绝 / 新挑战不误伤（变异去上限 → 红）', () => {
  const id = 'verify-cap-budget';
  assert.equal(markChallengePassed(id), true, '放行登记');
  for (let i = 0; i < CAPTCHA_CONFIRM_LIMIT; i++) {
    assert.equal(isChallengeVerified(id), true, `第 ${i + 1} 次确认在预算内`);
  }
  assert.equal(isChallengeVerified(id), false, '超预算确认拒绝（变异：去掉上限 → 恒 true → 红）');
  // 新挑战（新 puzzle solve）= 新 captchaId → 首确认恒放行，上限不误伤合法新挑战
  const fresh = 'verify-cap-fresh';
  assert.equal(markChallengePassed(fresh), true, '新挑战放行登记');
  assert.equal(isChallengeVerified(fresh), true, '新挑战首确认放行');
});

test('S0-19：留档失败不翻转 verdict（E2；变异去 logCaptchaResult try/catch → 红）', async () => {
  const throwingLog = async () => { throw new Error('log db down'); };
  const ok = await handleCaptchaVerify(null, { captchaId: 'e2-pass', track: humanTrack() }, req(), throwingLog);
  assert.equal(ok.status, 200, '留档失败不翻转通过 verdict（E2）');
  const bot = await handleCaptchaVerify(null, { captchaId: 'e2-bot', track: botTrack() }, req(), throwingLog);
  assert.equal(bot.status, 403, '留档失败不翻转拒绝 verdict（E2）');
  // replay path also must not flip under log failure
  const replay = await handleCaptchaVerify(null, { captchaId: 'e2-pass', track: humanTrack() }, req(), throwingLog);
  assert.equal(replay.status, 403, '重放仍拒绝（留档失败不翻转）');
});

test('S0-19：留档副作用实际发生且含观测字段（E1；变异删 logCaptchaResult 调用 → 红）', async () => {
  const events = [];
  const recordingLog = async (_db, ev) => { events.push(ev); };
  const ok = await handleCaptchaVerify(null, { captchaId: 'rec-pass', offset: 0.5, track: humanTrack() }, req(), recordingLog);
  assert.equal(ok.status, 200);
  const pass = events.find(ev => ev.action === 'captcha.verify.passed');
  assert.ok(pass, '通过留档被记录（变异：删 passed 留档调用 → 红）');
  assert.equal(pass.detail.ok, true);
  assert.equal(typeof pass.detail.score, 'number', 'score 入留档');
  assert.equal(pass.detail.points, 60, '点数入留档');
  assert.equal(pass.detail.offset, 0.5, 'offset 入留档（观测；变异：不记 offset → 红）');
  assert.equal(pass.entityId, 'rec-pass', 'captchaId 作实体 id 入留档');

  const bot = await handleCaptchaVerify(null, { captchaId: 'rec-bot', track: botTrack() }, req(), recordingLog);
  assert.equal(bot.status, 403);
  const fail = events.find(ev => ev.action === 'captcha.verify.failed' && ev.entityId === 'rec-bot');
  assert.ok(fail, '失败留档被记录（变异：删 failed 留档调用 → 红）');
  assert.equal(fail.detail.ok, false);
  assert.ok(fail.detail.reason, '拒绝原因入留档');
});

test('S0-19：防重放硬上限——满表逐出最旧 + 当前挑战必登记，绝不清表 fail-open（变异旧 clear+return true → 红）', () => {
  // 塞满 MAP_HARD_CAP(10000) 的唯一挑战 → 最后一次迭代 size>=10000 触发硬上限逐出；此后每次插入逐出 1 条，size 恒 ≤10000
  for (let i = 0; i < 10001; i++) {
    assert.equal(markChallengePassed(`cap-fill-${i}`), true, `填充第 ${i + 1} 次应放行`);
  }
  // 触发硬上限分支：新挑战必须被登记（变异：旧实现 clear+return true 未登记 → 二次仍 true → 红）
  const fresh = 'cap-fresh-after-full';
  assert.equal(markChallengePassed(fresh), true, '硬上限分支下新挑战放行');
  assert.equal(markChallengePassed(fresh), false, '放行后当前挑战必须已登记 → 重放拒绝（变异：clear+return true → 未登记 → true → 红）');
  // 清表变异第二向：老挑战不得因清表被遗忘（变异 clear 后全部可重放 → 红）
  assert.equal(markChallengePassed('cap-fill-5000'), false, '硬上限逐出只丢最旧一条，其余已登记挑战仍防重放（变异：整表清空 → 可重放 → true → 红）');
});

test('S0-19：PASS_SCORE / 防重放窗口 / TOLERANCE 单源在 shared/config.js（变异改本地字面量 → 红）', () => {
  assert.equal(LIMITS.CAPTCHA_PASS_SCORE, 59, 'config 单源放行阈值');
  assert.equal(LIMITS.CAPTCHA_REUSE_WINDOW_MS, 5 * 60 * 1000, 'config 单源防重放窗口');
  assert.equal(CONFIG.CAPTCHA_TOLERANCE, 0.08, 'config 单源前端偏移容差');
  const src = readFileSync(ROOT + 'src/server/core/human-check.js', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); // strip comments
  assert.doesNotMatch(code, /[一-鿿]/, '非注释代码零中文字符（文案单源 codes.js MSG；变异加回内联中文 → 红）'); // Q-2h/Q-2i guard preserved from test/human-check.test.js
  assert.match(code, /LIMITS\.CAPTCHA_PASS_SCORE/, 'PASS_SCORE 从 config 读取（变异：本地字面量 → 红）');
  assert.match(code, /LIMITS\.CAPTCHA_REUSE_WINDOW_MS/, '防重放窗口从 config 读取');
  assert.doesNotMatch(code, /PASS_SCORE\s*=\s*59/, '无本地阈值字面量');
  assert.doesNotMatch(code, /REUSE_WINDOW_MS\s*=\s*5\s*\*\s*60/, '无本地窗口字面量');
});
