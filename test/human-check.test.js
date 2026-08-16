/**
 * v1.4.16 拼图验证码人机判定单元测试（server/human-check.js）
 *
 * 覆盖：
 *   - 人样轨迹（慢-快-慢速度曲线 + 垂直抖动 + 800ms 时长 + 60 点）→ 通过
 *   - 机器轨迹（匀速直线 + 瞬时完成 + y 恒定）→ 拒绝
 *   - 轨迹缺失 / 点数过少 / 非法点 → 拒绝
 *   - 防重放：同 captchaId 放行后重复提交拒绝（markChallengePassed）
 *   - 路由：handleCaptchaVerify 通过/拒绝/重放
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanTrajectoryCheck, markChallengePassed, handleCaptchaVerify } from '../server/human-check.js';

/** 人样轨迹：慢-快-慢（frac - sin(2π·frac)/2π 位移，两端慢中间快）+ y 抖动 + 800ms + 60 点 */
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

/** 机器轨迹：匀速直线、48ms 完成、y 恒定 */
function botTrack() {
  const pts = [];
  for (let i = 0; i < 40; i++) pts.push({ t: i * 1.2, x: i * 5, y: 100 });
  return pts;
}

test('人样轨迹：慢快慢 + 抖动 + 合理时长 → 通过', () => {
  for (let i = 0; i < 5; i++) { // 多次随机抖动应稳定通过
    const r = humanTrajectoryCheck(humanTrack());
    assert.equal(r.ok, true, `第 ${i + 1} 条人样轨迹应通过，实际 score=${r.score} reason=${r.reason}`);
    assert.ok(r.score >= 70);
  }
});

test('机器轨迹：匀速 + 瞬时 + 无抖动 → 拒绝', () => {
  const r = humanTrajectoryCheck(botTrack());
  assert.equal(r.ok, false, `机器轨迹应拒绝，实际 score=${r.score}`);
  assert.ok(r.score < 70);
});

test('轨迹缺失 / 点数过少 / 非法点 → 拒绝', () => {
  assert.equal(humanTrajectoryCheck(null).ok, false, 'null 轨迹拒绝');
  assert.equal(humanTrajectoryCheck([]).ok, false, '空轨迹拒绝');
  assert.equal(humanTrajectoryCheck([{ t: 0, x: 0, y: 0 }]).ok, false, '单点拒绝');
  const bad = humanTrack().slice(0, 8);
  assert.equal(humanTrajectoryCheck(bad).ok, false, '少于 10 点拒绝');
  const garbage = humanTrack().map(p => ({ t: 'a', x: null, y: undefined }));
  assert.equal(humanTrajectoryCheck(garbage).ok, false, '非法点拒绝');
});

test('防重放：同 captchaId 放行后 5 分钟内重复提交拒绝', () => {
  assert.equal(markChallengePassed('challenge-abc'), true, '首次放行');
  assert.equal(markChallengePassed('challenge-abc'), false, '同挑战重复提交拒绝（防重放）');
  assert.equal(markChallengePassed('challenge-xyz'), true, '新挑战可放行');
});

test('路由 handleCaptchaVerify：人样轨迹通过 / 机器轨迹 403 / 重放 403', async () => {
  const req = { headers: new Headers() };
  const okR = await handleCaptchaVerify(null, { captchaId: 'r1', offset: 0.5, track: humanTrack() }, req);
  assert.equal(okR.ok, true, '人样轨迹路由通过');
  const botR = await handleCaptchaVerify(null, { captchaId: 'r2', offset: 0.5, track: botTrack() }, req);
  assert.equal(botR.status, 403, '机器轨迹 403');
  const replayR = await handleCaptchaVerify(null, { captchaId: 'r1', offset: 0.5, track: humanTrack() }, req);
  assert.equal(replayR.status, 403, '同挑战重放 403');
  const noTrack = await handleCaptchaVerify(null, { captchaId: 'r3' }, req);
  assert.equal(noTrack.status, 400, '轨迹缺失 400');
});
