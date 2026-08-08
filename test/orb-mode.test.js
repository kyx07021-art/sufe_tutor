/**
 * 需求八·item3 背景光球外观三档（鲜艳=当前 / 淡雅=柔化 / 隐藏=纯净底）
 *
 * 真实 index.html DOM（内联光球 IIFE 首绘运行）+ 全脚本 vm 沙箱：
 *   - 默认 vivid：桌面 36 光球（matchMedia coarse=false），透明度 0.52~0.73、尺寸 10~28vmax；
 *   - __applyOrbs 可重入切档：hidden=0 光球 + 鼠标光隐藏；elegant=24 光球、透明度 0.13~0.26、尺寸 8~18vmax；
 *   - getOrbPref 默认 vivid / 非法值回落 vivid；
 *   - 设置页渲染光球三档（鲜艳/淡雅/隐藏），setOrbPref 写 localStorage + 调 __applyOrbs + 切选中态，
 *     且不影响主题选中态。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-style.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously',
  });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console,
    fetch: async (url, opts = {}) => {
      const u = String(url);
      if (u === '/api/notifications') return { ok: true, status: 200, json: async () => ({ notifications: [] }) };
      if (u.includes('/api/student/demands')) return { ok: true, status: 200, json: async () => ({ demands: [] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext(`globalThis.__toasts = []; showToast = (msg) => __toasts.push(msg);`, ctx);
  return { dom, ctx };
}

async function setup(ctx, user) {
  vm.runInContext(`try { localStorage.setItem('sufe_returning', '1'); } catch (e) {}`, ctx);
  await tick(30);
  vm.runInContext(`state.user = ${JSON.stringify(user)}; renderSidebar(); showView('client');`, ctx);
}

// 读取当前光球快照：数量 / 透明度区间 / 尺寸区间 / 鼠标光显隐
function orbSnapshot(ctx) {
  return vm.runInContext(`(() => {
    const orbs = [...document.querySelectorAll('.lg-orb')];
    const op = orbs.map(o => parseFloat((o.style.background.match(/rgba\\(var\\(--lg-orb-[a-i]\\),([0-9.]+)/) || [])[1] || '0'));
    const sizes = orbs.map(o => parseFloat(o.style.width));
    const glow = document.querySelector('.lg-mouseglow');
    return {
      count: orbs.length,
      opMin: op.length ? Math.min(...op) : null,
      opMax: op.length ? Math.max(...op) : null,
      sizeMin: sizes.length ? Math.min(...sizes) : null,
      sizeMax: sizes.length ? Math.max(...sizes) : null,
      glowDisplay: glow ? glow.style.display : null,
    };
  })()`, ctx);
}

test('背景光球默认鲜艳：桌面 36 个、透明度 0.52~0.73、尺寸 10~28vmax', () => {
  const { ctx } = makeCtx();
  const s = orbSnapshot(ctx);
  assert.equal(s.count, 36, '桌面 36 光球（matchMedia coarse=false）');
  assert.ok(s.opMin >= 0.50 && s.opMin <= 0.54, `vivid 透明度下界 ~0.52，实际 ${s.opMin}`);
  assert.ok(s.opMax >= 0.71 && s.opMax <= 0.75, `vivid 透明度上界 ~0.73，实际 ${s.opMax}`);
  assert.ok(s.sizeMin >= 9 && s.sizeMin <= 11, `vivid 尺寸下界 ~10vmax，实际 ${s.sizeMin}`);
  assert.ok(s.sizeMax >= 26 && s.sizeMax <= 30, `vivid 尺寸上界 ~28vmax，实际 ${s.sizeMax}`);
});

test('__applyOrbs 可重入切档：hidden 零光球+鼠标光隐藏；elegant 24 个柔化', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`try { localStorage.setItem('sufe_orb', 'hidden'); } catch (e) {} window.__applyOrbs();`, ctx);
  let s = orbSnapshot(ctx);
  assert.equal(s.count, 0, '隐藏档零光球（连球都不生成）');
  assert.equal(s.glowDisplay, 'none', '隐藏档鼠标光一并隐藏');

  vm.runInContext(`try { localStorage.setItem('sufe_orb', 'elegant'); } catch (e) {} window.__applyOrbs();`, ctx);
  s = orbSnapshot(ctx);
  assert.equal(s.count, 24, '淡雅桌面 24 光球');
  assert.ok(s.opMin >= 0.11 && s.opMin <= 0.15, `淡雅透明度下界 ~0.13，实际 ${s.opMin}`);
  assert.ok(s.opMax >= 0.24 && s.opMax <= 0.28, `淡雅透明度上界 ~0.26，实际 ${s.opMax}`);
  assert.ok(s.sizeMin >= 7 && s.sizeMin <= 9, `淡雅尺寸下界 ~8vmax，实际 ${s.sizeMin}`);
  assert.ok(s.sizeMax >= 16 && s.sizeMax <= 20, `淡雅尺寸上界 ~18vmax，实际 ${s.sizeMax}`);
});

test('getOrbPref：缺省鲜艳 / 非法值回落鲜艳', () => {
  const { ctx } = makeCtx();
  assert.equal(vm.runInContext(`getOrbPref()`, ctx), 'vivid', '无偏好缺省鲜艳');
  vm.runInContext(`try { localStorage.setItem('sufe_orb', 'bogus'); } catch (e) {}`, ctx);
  assert.equal(vm.runInContext(`getOrbPref()`, ctx), 'vivid', '非法值回落鲜艳');
  vm.runInContext(`try { localStorage.setItem('sufe_orb', 'elegant'); } catch (e) {}`, ctx);
  assert.equal(vm.runInContext(`getOrbPref()`, ctx), 'elegant', '淡雅可读');
});

test('设置页渲染光球三档；setOrbPref 写偏好+重生成背景+切选中态，主题选中独立', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  await setup(ctx, { role: 'student', id: 1, username: 's', avatar: '' });
  await vm.runInContext(`state.page = 'account-settings'; enterAccountSettings()`, ctx);
  const opts = [...doc.querySelectorAll('.orb-opt')];
  assert.equal(opts.length, 3, '光球三档渲染');
  assert.deepEqual(opts.map(o => o.textContent), ['鲜艳', '淡雅', '隐藏'], '三档文案');
  assert.equal(doc.querySelector('.orb-opt--on').dataset.pref, 'vivid', '默认鲜艳选中');
  assert.equal(doc.querySelectorAll('.theme-opt--on').length, 1, '主题选中态在位');

  await vm.runInContext(`setOrbPref('hidden')`, ctx);
  assert.equal(doc.querySelector('.orb-opt--on').dataset.pref, 'hidden', '选中态切到隐藏');
  assert.equal(vm.runInContext(`(() => { try { return localStorage.getItem('sufe_orb'); } catch (e) { return ''; } })()`, ctx), 'hidden', '偏好持久化');
  assert.equal(doc.querySelectorAll('.lg-orb').length, 0, '隐藏档立即生效');
  assert.equal(doc.querySelectorAll('.theme-opt--on').length, 1, '主题选中态不受光球切换影响');

  await vm.runInContext(`setOrbPref('elegant')`, ctx);
  assert.equal(doc.querySelector('.orb-opt--on').dataset.pref, 'elegant', '选中态切到淡雅');
  assert.equal(doc.querySelectorAll('.lg-orb').length, 24, '淡雅档立即生效');
});
