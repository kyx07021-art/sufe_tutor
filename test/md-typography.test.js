/**
 * 需求二十一（R21）·markdown 解析器排版优化
 *
 * 用户反馈五项：
 *   ① 行距不够 → 正文/列表行高 1.7→1.8、段距加大；
 *   ② 标题与正文同线左对齐、有序列表编号左突出 → 正文比标题统一右缩进 12px、
 *      列表容器再右缩进 20px（编号在 20px、列表文字 36px），层级分明；
 *   ③ md 正文字号 .84rem → .86rem（与平台普通文本一致）；
 *   ④ 标题字太大 → 1/2 级标题紧缩小阶梯（1.02rem/900），各级递增 ~.04rem，优先 3/5 级；
 *   ⑤ 细节：h1-h6 全覆盖样式（原 h1/h2/h5/h6 吃浏览器巨大默认）、blockquote 随正文缩进。
 *
 * 应用范围：.md-preview（帖子/预览）与 .policy-body（协议/政策/合同浮窗）同口径。
 *
 * v0.25.94（用户反馈「列表编号从左戳出」）根因：style.css:77 全局 *{margin:0;padding:0}
 * 清零 ol/ul 浏览器默认缩进。.md-preview/.policy-body 有 R21 规则兜住，但 .post-detail-body
 * （帖子详情）、.contract-md（合同浮窗）、.module-info-md（模块介绍）没有 → 编号画在负空间
 * 从左戳出正文。修复：md 排版口径扩展到这三个容器（列表 padding-left 16px 是编号立足区）。
 *
 * 本测试为 CSS 内容回归护栏（Chrome 实证：h2 16.32px / h3 15.36px / p 13.76px、
 * 标题 x=44 / 正文 x=56 / 列表 x=64；详情正文同口径后编号不再出界）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const posts = readFileSync('./style-posts.css', 'utf8');
const style = readFileSync('./style.css', 'utf8');

test('R21④ 标题紧缩小阶梯：h1/h2 小字号（非浏览器巨大默认）', () => {
  assert.ok(/\.md-preview h1, \.md-preview h2[\s\S]*?font-size: 1\.02rem/.test(posts), 'md h1/h2 收敛到 1.02rem');
  assert.ok(/\.policy-body h1, \.policy-body h2[\s\S]*?font-size: 1\.05rem/.test(style), 'policy h1/h2 收敛到 1.05rem');
});

test('v0.25.94 详情/合同/模块介绍容器同口径（标题不再巨大、正文缩进、列表编号不戳出）', () => {
  // 帖子详情：正文 12px 缩进 + .86rem/1.8
  assert.ok(/\.md-preview p, \.post-detail-body p \{[\s\S]*?font-size: \.86rem; line-height: 1\.8[\s\S]*?margin: 4px 0 4px 12px/.test(posts),
    'post-detail-body 正文与 md-preview 同口径（12px 缩进 + .86rem/1.8）');
  // 帖子详情：列表容器 20px + 编号立足 padding 16px（全局 *{padding:0} 下无 padding 编号即戳出）
  assert.ok(/\.md-preview ul, \.md-preview ol, \.post-detail-body ul, \.post-detail-body ol \{ margin: 4px 0 4px 20px; padding-left: 16px; \}/.test(posts),
    'post-detail-body 列表容器同口径（20px + 16px 编号立足）');
  assert.ok(/\.md-preview h3, \.post-detail-body h3 \{ font-size: \.96rem/.test(posts), 'post-detail-body h3 收敛');
  // 合同浮窗：正文/列表/标题同 policy 口径
  assert.ok(/\.policy-body p, \.contract-md p \{ margin: 0 0 8px 12px/.test(style), 'contract-md 正文缩进 12px');
  assert.ok(/\.policy-body ul, \.policy-body ol, \.contract-md ul, \.contract-md ol \{ margin: 0 0 8px 20px; padding-left: 16px; \}/.test(style),
    'contract-md 列表容器同口径（20px + 16px 编号立足）');
  assert.ok(/\.policy-body h1, \.policy-body h2, \.contract-md h1, \.contract-md h2 \{ font-size: 1\.05rem/.test(style),
    'contract-md h1/h2 收敛');
  // 模块介绍：列表同口径
  assert.ok(/\.module-info-md ul, \.module-info-md ol \{ margin: 6px 0 6px 20px; padding-left: 16px; \}/.test(style),
    'module-info-md 列表容器同口径');
  // v0.25.94 审计补漏：policy/contract 补 blockquote/img/code；module-info 补 h1/h3-h6 + blockquote/img/code
  assert.ok(/\.policy-body blockquote, \.contract-md blockquote \{[\s\S]*?margin: 6px 0 6px 12px/.test(style),
    'policy/contract blockquote 随正文缩进');
  assert.ok(/\.policy-body img, \.contract-md img \{ display: block; max-width: 100%/.test(style),
    'policy/contract 图片限宽');
  assert.ok(/\.policy-body code, \.contract-md code \{/.test(style), 'policy/contract 行内代码样式');
  assert.ok(/\.module-info-md h3 \{ font-size: \.96rem/.test(style), 'module-info h3 收敛（非浏览器默认）');
  assert.ok(/\.module-info-md blockquote \{/.test(style), 'module-info blockquote 样式');
  assert.ok(/\.module-info-md img \{ display: block; max-width: 100%/.test(style), 'module-info 图片限宽');
  assert.ok(/\.module-info-md code \{/.test(style), 'module-info 行内代码样式');
});

test('R21② 层级缩进：正文右缩进 12px、列表容器再缩进 20px', () => {
  assert.ok(/\.md-preview p, \.post-detail-body p \{[\s\S]*?margin: 4px 0 4px 12px/.test(posts), 'md 正文比标题右缩进 12px');
  assert.ok(/\.md-preview ul, \.md-preview ol, \.post-detail-body ul, \.post-detail-body ol \{ margin: 4px 0 4px 20px/.test(posts), 'md 列表容器再右缩进 20px');
  assert.ok(/\.policy-body p, \.contract-md p \{ margin: 0 0 8px 12px/.test(style), 'policy 正文右缩进');
  assert.ok(/\.policy-body ul, \.policy-body ol, \.contract-md ul, \.contract-md ol \{ margin: 0 0 8px 20px/.test(style), 'policy 列表右缩进');
});

test('R21③ 正文行距与字号：1.8 行高 + .86rem（平台普通文本一致）', () => {
  assert.ok(/\.md-preview p, \.post-detail-body p \{[\s\S]*?font-size: \.86rem; line-height: 1\.8/.test(posts), 'md 正文 .86rem/1.8');
  assert.ok(/\.md-preview li, \.post-detail-body li \{ font-size: \.86rem; line-height: 1\.8/.test(posts), 'md 列表项 .86rem/1.8');
  assert.ok(!/\.md-preview p, \.post-detail-body p \{[\s\S]*?font-size: \.84rem/.test(posts), '不再用 .84rem');
});

test('R21⑤ h1-h6 全覆盖样式（无浏览器默认巨大标题）', () => {
  for (const tag of ['h4', 'h5', 'h6']) {
    assert.ok(new RegExp(`\\.md-preview ${tag}, \\.post-detail-body ${tag} \\{`).test(posts), `md ${tag} 有样式`);
    assert.ok(new RegExp(`\\.policy-body ${tag}, \\.contract-md ${tag} \\{`).test(style), `policy ${tag} 有样式`);
  }
});
