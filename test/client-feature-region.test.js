import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderProvinceSelect, regionLockNote, buildStudentSubjectsHtml, buildStudentScoreRows, regionResolvePolicy } from '../src/client/features/region/render.js';
import { actions } from '../src/client/features/region/index.js';
import { switchScoreMode } from '../src/client/features/region/actions.js';

test('region render: province select has no inline handler and contains all provinces', () => {
  // Q-4b-L2: inert changeAction param removed — data-region-change was never consumed anywhere
  // (callers bind change directly); assert it no longer leaks into the DOM
  const html = renderProvinceSelect('d-province', 'shanghai');
  assert.ok(html.includes('id="d-province"'));
  assert.ok(!/onchange=/.test(html));
  assert.ok(html.includes('>上海</option>'));
});

test('region render: lock note only for offline-disabled provinces', () => {
  assert.equal(regionLockNote('shanghai'), '');
  assert.ok(regionLockNote('beijing').includes('region-hint'));
});

test('region render: student subjects require grade and no inline', () => {
  const html = buildStudentSubjectsHtml('shanghai', 'p1');
  assert.ok(html.includes('checkbox-item'));
  assert.ok(!/onclick=/.test(html));
  const empty = buildStudentSubjectsHtml('shanghai', '');
  assert.ok(empty.includes('text-sm text-muted'));
});

test('region render: score rows contain seg tabs with data-tab-action and no inline', () => {
  const html = buildStudentScoreRows('shanghai', 'senior1', ['chinese', 'math', 'physics']);
  assert.ok(html.includes('region-score-row'));
  assert.ok(html.includes('data-score-subject="chinese"'));
  assert.ok(html.includes('data-tab-action="grade"'));
  assert.ok(!/onclick=/.test(html));
});

test('region actions: pickGrade toggles selected in grade selector', () => {
  const dom = new JSDOM('<html><body><div class="grade-selector"><span class="grade-option" data-grade="A">A</span><span class="grade-option" data-grade="B">B</span></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  const els = dom.window.document.querySelectorAll('.grade-option');
  actions.pickGrade(els[1]);
  assert.equal(els[0].classList.contains('selected'), false);
  assert.equal(els[1].classList.contains('selected'), true);
  delete globalThis.document;
});

test('region pure: policy resolve returns typed policy', () => {
  const pol = regionResolvePolicy('zhejiang', 2019);
  assert.ok(pol && pol.type);
});


test('region actions: switchScoreMode toggles panes', () => {
  const dom = new JSDOM('<html><body><div class="score-row"><button class="seg-tab active" data-mode="grade">G</button><button class="seg-tab" data-mode="score">S</button><div class="score-mode-pane" data-mode="grade"></div><div class="score-mode-pane hidden" data-mode="score"></div></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  const btns = dom.window.document.querySelectorAll('.seg-tab');
  switchScoreMode(btns[1]);
  assert.ok(btns[1].classList.contains('active'));
  assert.ok(dom.window.document.querySelector('[data-mode="score"]').classList.contains('hidden') === false);
  delete globalThis.document;
});
