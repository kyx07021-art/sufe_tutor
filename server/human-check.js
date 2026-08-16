/**
 * 拼图验证码人机判定（v1.4.16，业务逻辑内判定，无外部服务/无状态存储）
 *
 * 成熟方案（极验 / 顶象 / 易盾滑块风控原理，调研见会话记录）：
 * 风控判定人类轨迹的核心不是「终点对不对」，而是「过程像不像人」——机器轨迹
 * （匀速、笔直、瞬间到达、无噪声）与人类轨迹（慢-快-慢变速、自然抖动、终点微调）差异显著。
 *
 * 本模块提取以下特征做多特征加权评分（满分 100，阈值 70 放行）：
 *   - 总时长区间      （人类 ~400-3000ms；机器常 <250ms 瞬时到达或匀速拖满）       权重 15
 *   - 轨迹点密度      （20-120 点；太少=跳点伪造、太多=事件刷屏）                   权重 10
 *   - 速度曲线        （人类 慢-快-慢：起段加速 + 末段减速；机器单调/匀速）          权重 25
 *   - 非匀速性 CV     （速度变异系数：人类高波动、机器近 0）                        权重 20
 *   - 垂直抖动        （人类手抖 y 方向 ±1-10px 自然微颤；机器 y 恒定）             权重 15
 *   - 终点微调        （接近目标减速/回拉；机器钉死在终点）                         权重 15
 *
 * 防重放：captchaId 短窗口内存缓存（同挑战放行后 5 分钟内重复提交拒绝）。
 * 多实例下缓存按 isolate 生效（宽松可接受——captcha 是叠加防线，服务端 rate_limits 兜底）。
 * 无状态性：判定为纯函数（track 特征 → 评分），不依赖服务端存储的答案（前端自算缺口答案，
 * 本模块只判人机，不校验 offset 正确性——答案校验仍在前端本地比对）。
 */
import { error } from './util.js';

const PASS_SCORE = 70;
const MIN_POINTS = 10;
const REUSE_WINDOW_MS = 5 * 60 * 1000;

// 防重放：captchaId → 放行时间戳（内存 Map，isolate 内有效）
const passedChallenges = new Map();

/** 判定轨迹人机特征。返回 { ok, score(0-100), reason } */
export function humanTrajectoryCheck(track) {
  if (!Array.isArray(track) || track.length < MIN_POINTS) {
    return { ok: false, score: 0, reason: '轨迹缺失或点数过少' };
  }
  const pts = track
    .map(p => ({ t: Number(p && p.t), x: Number(p && p.x), y: Number(p && p.y) }))
    .filter(p => Number.isFinite(p.t) && Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.t - b.t);
  if (pts.length < MIN_POINTS) return { ok: false, score: 0, reason: '轨迹点非法' };

  const t0 = pts[0].t, x0 = pts[0].x;
  const xs = pts.map(p => p.x - x0);   // 相对起始的横向位移
  const ts = pts.map(p => p.t - t0);   // 相对起始的时间 ms
  const dur = ts[ts.length - 1];
  const dist = Math.abs(xs[xs.length - 1]);
  if (!(dur > 0) || dist <= 0) return { ok: false, score: 0, reason: '轨迹无位移或时长非法' };

  // 逐段速度（px/ms）
  const speeds = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = ts[i] - ts[i - 1];
    if (dt > 0) speeds.push(Math.abs(xs[i] - xs[i - 1]) / dt);
  }
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const sd = Math.sqrt(speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / speeds.length);
  const cv = mean > 0 ? sd / mean : 0; // 变异系数：人类高（变速），机器近 0（匀速）

  // 三段速度：起段(0-30%) / 中段(30-70%) / 末段(70-100%) —— 人类 慢-快-慢
  const segAvg = (from, to) => {
    const seg = speeds.filter((_, i) => { const frac = i / speeds.length; return frac >= from && frac < to; });
    return seg.length ? seg.reduce((a, b) => a + b, 0) / seg.length : mean;
  };
  const vStart = segAvg(0, 0.3), vMid = segAvg(0.3, 0.7), vEnd = segAvg(0.7, 1);

  // 垂直抖动：y 的标准差（人类手抖 ±1-10px；机器恒 0）
  const yMean = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const ySd = Math.sqrt(pts.reduce((a, p) => a + (p.y - yMean) ** 2, 0) / pts.length);

  let score = 0;
  const reasons = [];

  // 1) 总时长区间（15）
  if (dur >= 400 && dur <= 3000) score += 15;
  else if (dur >= 250 && dur <= 4000) score += 8;
  else reasons.push('时长异常');

  // 2) 轨迹点密度（10）
  if (pts.length >= 20 && pts.length <= 120) score += 10;
  else if (pts.length >= 12) score += 5;
  else reasons.push('点数过少');

  // 3) 速度曲线 慢-快-慢（25）：中段显著快于两端；末段减速（人类终点找手感）
  if (vMid > vStart * 1.2 && vMid > vEnd * 1.15 && vEnd < vMid * 0.9) score += 25;
  else if (vMid > vStart && vMid > vEnd) score += 12;
  else reasons.push('速度曲线单调');

  // 4) 非匀速性 CV（20）：人类 0.4+，机器匀速 <0.15
  if (cv >= 0.4) score += 20;
  else if (cv >= 0.2) score += 10;
  else reasons.push('近匀速');

  // 5) 垂直抖动（15）：人类 1-12px 自然微颤；机器 0 或过大
  if (ySd >= 1 && ySd <= 12) score += 15;
  else if (ySd > 0 && ySd <= 20) score += 7;
  else reasons.push('无垂直抖动');

  // 6) 终点减速（15）：末段平均速度 < 中段（人类接近目标减速；机器匀速全程）
  if (vEnd < vMid * 0.85) score += 15;
  else if (vEnd < vMid) score += 8;
  else reasons.push('终点未减速');

  return { ok: score >= PASS_SCORE, score, reason: score >= PASS_SCORE ? '' : reasons.join('、') };
}

/** 防重放：挑战放行登记；重复提交（窗口内）返回 false */
export function markChallengePassed(captchaId) {
  if (!captchaId) return false;
  const now = Date.now();
  const prev = passedChallenges.get(captchaId);
  if (prev && now - prev < REUSE_WINDOW_MS) return false; // 已放行过 → 拒绝重放
  // 清理过期键（防 Map 膨胀）
  if (passedChallenges.size > 5000) {
    for (const [k, v] of passedChallenges) if (now - v >= REUSE_WINDOW_MS) passedChallenges.delete(k);
  }
  passedChallenges.set(captchaId, now);
  return true;
}

// POST /api/captcha/verify { captchaId, offset, track } —— 拼图验证人机判定（无需鉴权，限流兜底）
export async function handleCaptchaVerify(db, body, req) {
  const track = body && body.track;
  if (!Array.isArray(track)) return error('轨迹数据缺失', 400);
  const captchaId = String((body && body.captchaId) || '').slice(0, 64);
  const check = humanTrajectoryCheck(track);
  if (!check.ok) return error(`验证失败：${check.reason || '轨迹特征异常'}`, 403);
  // 判定通过 → 一次性放行（防同一挑战重复使用）
  if (!markChallengePassed(captchaId)) return error('验证已使用，请重新验证', 403);
  return { ok: true, score: check.score };
}
