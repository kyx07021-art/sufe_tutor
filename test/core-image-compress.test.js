/**
 * ZZ-6/4/5（2026-08-27）：core/image.js compressImage 共享压缩 helper 守护测试。
 * 用户①：「给站点加个图片压缩环节，上传图片如果过大，自动压缩到限额以内，不再toast让用户自己压缩」。
 *
 * 用可控模型模拟 JPEG 体积（与面积×质量系数成正比），锁定三条行为：
 *   ① maxBytes 字节预算：质量递降 → 尺寸递降，最终 dataUrl.length ≤ maxBytes（收敛）；
 *   ② maxSide 最长边钳制：输出画布最长边 ≤ maxSide；
 *   ③ thumbSide：生成更小缩略图。
 * 变异守护：把字节预算循环删掉（只画一次直接返回）→ ①断言红；把侧边钳制去掉 → ②红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { compressImage } from '../src/client/core/image.js';
import { CONFIG, LIMITS } from '../src/shared/config.js';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.Image = class {
  constructor() { this.width = 2000; this.height = 2000; }
  set src(_v) { queueMicrotask(() => this.onload && this.onload()); }
};
// 模型：JPEG 体积 ≈ 面积/12 × (0.35 + 0.65×quality)；画布记录最后一次尺寸供断言。
let lastW = 0, lastH = 0;
globalThis.document.createElement = function (tag) {
  if (tag !== 'canvas') return dom.window.document.createElement(tag);
  const c = {
    width: 0, height: 0,
    getContext: () => ({ drawImage() { lastW = c.width; lastH = c.height; } }),
    toDataURL: (_t, q) => 'data:image/jpeg;base64,' + 'A'.repeat(Math.max(1, Math.round(c.width * c.height / 12 * (0.35 + (q ?? 0.82) * 0.65)))),
  };
  return c;
};

test('ZZ-6 字节预算：maxBytes 收敛（数据 URL 长度 ≤ 限额）', async () => {
  const { dataUrl } = await compressImage('data:image/jpeg;base64,SRC', { maxBytes: 20000 });
  assert.ok(dataUrl.length <= 20000, `压缩后应 ≤ 20000（实测 ${dataUrl.length}）——变异：删字节预算循环 → 红`);
});

test('ZZ-6 字节预算：AVATAR_MAX_BYTES 收敛（头像 20KB 硬约束）', async () => {
  const { dataUrl } = await compressImage('data:image/jpeg;base64,SRC', { maxBytes: LIMITS.AVATAR_MAX_BYTES });
  assert.ok(dataUrl.length <= LIMITS.AVATAR_MAX_BYTES, `头像压缩后应 ≤ ${LIMITS.AVATAR_MAX_BYTES}（实测 ${dataUrl.length}）`);
});

test('ZZ-6 字节预算：ADMISSION_IMG_MAX 收敛（录取通知 500KB 硬约束）', async () => {
  const { dataUrl } = await compressImage('data:image/jpeg;base64,SRC', { maxBytes: CONFIG.ADMISSION_IMG_MAX });
  assert.ok(dataUrl.length <= CONFIG.ADMISSION_IMG_MAX, `录取通知压缩后应 ≤ ${CONFIG.ADMISSION_IMG_MAX}（实测 ${dataUrl.length}）`);
});

test('ZZ-6 最长边钳制：maxSide 生效（2000×2000 → 最长边 ≤ 900）', async () => {
  lastW = 0; lastH = 0;
  await compressImage('data:image/jpeg;base64,SRC', { maxSide: CONFIG.CHAT_IMG_MAX_SIDE });
  assert.ok(Math.max(lastW, lastH) <= CONFIG.CHAT_IMG_MAX_SIDE, `最长边应 ≤ ${CONFIG.CHAT_IMG_MAX_SIDE}（实测 ${lastW}×${lastH}）——变异：删侧边钳制 → 红`);
});

test('ZZ-6 缩略图：thumbSide 生成更小缩略图', async () => {
  lastW = 0; lastH = 0;
  const { dataUrl, thumb } = await compressImage('data:image/jpeg;base64,SRC', { maxSide: 900, thumbSide: CONFIG.CHAT_IMG_THUMB_SIDE });
  assert.ok(thumb.length > 0, '应生成缩略图');
  assert.ok(Math.max(lastW, lastH) <= CONFIG.CHAT_IMG_THUMB_SIDE, `缩略图最长边应 ≤ ${CONFIG.CHAT_IMG_THUMB_SIDE}（实测 ${lastW}×${lastH}）`);
  assert.ok(thumb.length < dataUrl.length, '缩略图应小于原图');
});

test('ZZ-6 解码失败 → reject（调用方落既有 toast 路径）', async () => {
  globalThis.Image = class {
    constructor() { this.width = 0; this.height = 0; }
    set src(_v) { queueMicrotask(() => this.onerror && this.onerror(new Error('decode'))); }
  };
  await assert.rejects(compressImage('data:image/jpeg;base64,SRC'), /IMAGE_DECODE_FAILED/);
  globalThis.Image = class {
    constructor() { this.width = 2000; this.height = 2000; }
    set src(_v) { queueMicrotask(() => this.onload && this.onload()); }
  };
});

test('ZZ-4/5 接线契约：stageAdmissionFile/handleAvatarUpload 均走 compressImage 字节预算（maxBytes 参数在场）', () => {
  const teacher = readFileSync(join(process.cwd(), 'src/client/features/teacher/actions.js'), 'utf8');
  const settings = readFileSync(join(process.cwd(), 'src/client/features/settings/actions.js'), 'utf8');
  assert.match(teacher, /compressImage\(dataUrl, \{ maxBytes: CONFIG\.ADMISSION_IMG_MAX \}\)/, '学信网压缩接线在场');
  assert.match(settings, /compressImage\(dataUrl, \{ maxBytes: LIMITS\.AVATAR_MAX_BYTES \}\)/, '头像压缩接线在场');
});
