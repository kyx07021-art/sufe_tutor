/**
 * ZM 教师详情面板重新排版（用户原话：「教师详情卡片不含简介和头像，而且用户id居然是普通字体」）
 *   ZM-1 详情面板头部：头像最左 + 右侧姓名/星级并排（心智「头像最左，头像右边用户id和星级」）。
 *   ZM-2 简介行：p.intro 非空渲染 / 空跳过（对齐既有 `if (!v) continue` 模式）。
 *   ZM-3 .profile-name 样式补齐（加粗加大 + ellipsis）+ 死类清理（W18）。
 * 每条断言 G2 变异实证：删实现 → 红 → 还原绿（报告逐组记录）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderProfilePanel } from '../src/client/features/teacher/render.js';
import { TEXT } from '../src/client/constants/text.js';

const CSS = readFileSync('./features/teacher.css', 'utf8');

test('ZM-1 头像渲染：头像最左 + 惰性装饰语义（aria-hidden、无 avatar-btn）', () => {
  const html = renderProfilePanel({ user_id: 1, username: 'wang', real_name: '王老师', avatar: '/a.png', rating: 4.5 }, '');
  assert.ok(html.includes('profile-avatar'), '头像容器类在面板头部');
  assert.ok(html.includes('src="/a.png"'), '头像 img src 落位');
  assert.ok(html.includes('aria-hidden="true"'), '惰性装饰（无 profileUserId → 不弹新面板）');
  assert.ok(!html.includes('avatar-btn'), '非交互（无 role=button/tabindex）');
  // 无头像 → 回落姓名首字符（renderAvatarHtml 用 username||real_name 首字母）
  const noAvatar = renderProfilePanel({ user_id: 1, username: 'wang', rating: 4.5 }, '');
  assert.ok(noAvatar.includes('>W<'), '无头像回落姓名首字符');
});

test('ZM-1 姓名区含星级：p.rating 存在渲染评分区，缺省跳过', () => {
  const html = renderProfilePanel({ user_id: 1, username: 'wang', real_name: '王老师', rating: 4.5 }, '');
  assert.ok(html.includes('profile-rating'), '评分容器');
  assert.ok(html.includes('profile-rating-num'), '评分数字容器');
  assert.ok(html.includes('4.5'), '评分文本');
  assert.ok(html.includes('★'), '星级');
  const noRating = renderProfilePanel({ user_id: 1, username: 'wang' }, '');
  assert.ok(!noRating.includes('profile-rating'), '无 rating 不渲染评分区');
});

test('ZM-2 简介行：非空渲染 / 空跳过（if (!v) continue 模式）', () => {
  const html = renderProfilePanel({ user_id: 1, username: 'wang', intro: '资深数学老师，十年教龄' }, '');
  assert.ok(html.includes(TEXT.LABEL_INTRO), '简介 label 落位');
  assert.ok(html.includes('资深数学老师，十年教龄'), '简介正文落位');
  const empty = renderProfilePanel({ user_id: 1, username: 'wang', intro: '' }, '');
  assert.ok(!empty.includes(TEXT.LABEL_INTRO), '空字符串简介整行跳过');
  const missing = renderProfilePanel({ user_id: 1, username: 'wang' }, '');
  assert.ok(!missing.includes(TEXT.LABEL_INTRO), '缺省简介整行跳过');
});

test('ZM-3 .profile-name 样式落位：加粗加大 + ellipsis（源级契约）', () => {
  const block = CSS.match(/\.profile-name \{[\s\S]*?\}/);
  assert.ok(block, '.profile-name 规则存在');
  assert.ok(/font-weight:\s*700/.test(block[0]), '字重 700');
  assert.ok(/font-size:\s*1\.\d{2}rem/.test(block[0]), '字号 1.0x-1.2rem 区间');
  assert.ok(/overflow:\s*hidden/.test(block[0]), 'ellipsis 前提 overflow hidden');
  assert.ok(/text-overflow:\s*ellipsis/.test(block[0]), 'text-overflow ellipsis');
  assert.ok(/white-space:\s*nowrap/.test(block[0]), 'white-space nowrap');
});

test('ZM-3 死类清理（W18）：旧详情面板死类在 teacher.css 零规则残留', () => {
  for (const cls of [
    'profile-panel-head', 'profile-panel-title', 'profile-panel-body',
    'profile-id-top', 'profile-signed-tag', 'profile-id-name', 'profile-id-role',
    'profile-row-k', 'profile-row-v', 'profile-row-v--muted',
  ]) {
    assert.ok(!new RegExp(`\\.${cls}\\s*\\{`).test(CSS), `${cls} 规则已删`);
  }
});
