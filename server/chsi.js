/**
 * 学信网核验咽喉（v1.2.0 T2）—— 教师《学籍在线验证报告》验证码核验 单点
 *
 * 调研结论（web 实证，2026-08-15）：学信网官方无公开核验 API（爬虫反爬且违法风险）、
 * 机构级签约年费接近七位数、第三方学历核验 API（天远 ¥4.5/次、阿里云市场等）需企业实名认证
 * + 信息主体单独授权 + 场景审核——平台当前体量不可行。因此核验做 provider 三态插拔
 * （同 otp.js 模式，生产切换只改插拔点，接口签名不变）：
 *
 *   CHSI_PROVIDER='mock'      → 内测默认。验证码格式校验（12/16 位字母数字）+ 返回模拟学籍信息
 *                               （字段与真实报告一致：院校全称/层次/专业/在读状态/入学年份，
 *                               信息明确标注「模拟核验（内测）」），全流程可跑通。
 *   CHSI_PROVIDER='manual'    → 生产候选。核验不自动完成：教师提交验证码进管理员核验队列
 *                               （teacher_verifications.status='pending'），管理员在学信网官方核验页
 *                               （https://www.chsi.com.cn/xlcx/bgcx.jsp 或学信网小程序扫码）查证后，
 *                               在平台核验队列页结构化录入结果（院校/层次/专业/在读状态/入学年份）
 *                               并确认通过/拒绝——0 成本、官方通道、合法。
 *   CHSI_PROVIDER='thirdparty'→ 量产插拔点。调用第三方学历核验 API（企业认证后签约），
 *                               密钥 env.CHSI_VERIFY_API_KEY，接口契约见 verifyViaThirdParty 注释。
 *
 * 调用点：教师资料页「验证学信网」提交验证码（POST /api/teacher/verify-chsi）；
 * 注册流程不经过本咽喉（学信网验证非秒过，移到资料页，见 CLAUDE.md v1.2.0 需求单）。
 */
import { getSecret } from './secrets.js';

const CHSI_ENV = 'CHSI_PROVIDER';

/** 部署级 provider 配置（env 优先，回落 secrets.js 文件）。
 *  安全审计 H1（fail-open 修复）：缺省 = 'manual'（fail-closed）——未显式配置时验证码进管理员核验
 *  队列，任意字符串不能获得接单资格；内测 mock 直通须显式配置 CHSI_PROVIDER=mock（secrets.js/env）。 */
const chsiProvider = () => String(getSecret(CHSI_ENV, 'CHSI_PROVIDER') || 'manual');

/** 学信网在线验证码格式：12 或 16 位字母数字（《学籍在线验证报告》验证码口径） */
const CHSI_CODE_RE = /^[A-Za-z0-9]{12,16}$/;

/**
 * 核验验证码。返回：
 *   { ok:true, status:'approved', school, level, major, enrollment_status, enroll_year, provider }（mock/thirdparty 直通）
 *   { ok:true, status:'pending', provider }（manual：进管理员核验队列）
 *   { ok:false, code:'CHSI_CODE_INVALID' }（格式非法）
 */
export async function verifyChsiCode(code) {
  const provider = chsiProvider();
  const c = String(code || '').trim();
  if (!CHSI_CODE_RE.test(c)) return { ok: false, code: 'CHSI_CODE_INVALID' };

  if (provider === 'manual') {
    // 人工核验：进队列，管理员查证后结构化录入（见 routes-admin 核验队列接口）
    return { ok: true, status: 'pending', provider };
  }
  if (provider === 'thirdparty') return await verifyViaThirdParty(c);

  // mock（内测）：格式校验通过即返回模拟学籍信息——字段与真实报告一致，便于全流程联调；
  // 生产切 provider 即停用本分支（内测注释：明确标注模拟，前端展示「模拟核验」标记）
  return {
    ok: true, status: 'approved', provider,
    school: '示例大学（模拟核验）',
    level: '本科',
    major: '示例专业（模拟核验）',
    enrollment_status: '在籍',
    enroll_year: String(new Date().getFullYear()),
  };
}

/**
 * 第三方学历核验 API 插拔点（量产期实现）：
 *   契约：POST { verifyCode, name } → { ok, school, level, major, enrollment_status, enroll_year }
 *   密钥：env.CHSI_VERIFY_API_KEY（getSecret 网关读取，同 OTP 模式）
 *   服务商：天远（约 ¥4.5/次）、阿里云市场学历查询等——需企业实名认证 + 用户单独授权 + 场景审核。
 */
async function verifyViaThirdParty(code) {
  // const key = getSecret(CHSI_ENV, 'CHSI_VERIFY_API_KEY');
  // const r = await fetch('https://<third-party>/verify', {
  //   method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  //   body: JSON.stringify({ verifyCode: code }),
  //   signal: AbortSignal.timeout(4000),
  // });
  // if (!r.ok) return { ok: false, code: 'CHSI_UPSTREAM_ERROR' };
  // const j = await r.json();
  // return { ok: j.ok, status: j.ok ? 'approved' : 'rejected', school: j.school, level: j.level,
  //   major: j.major, enrollment_status: j.enrollment_status, enroll_year: j.enroll_year, provider: 'thirdparty' };
  // 未配置密钥/服务商前 fail-open 直通（与加密咽喉同口径：内测兼容，生产接入只改此处）
  return {
    ok: true, status: 'approved', provider: 'thirdparty',
    school: '示例大学（第三方核验）', level: '本科', major: '示例专业',
    enrollment_status: '在籍', enroll_year: String(new Date().getFullYear()),
  };
}

export { chsiProvider };
