/**
 * 教师端高考赋分组件按（省份, 毕业年份）选政策渲染回归（B4：直接 import region ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTeacherGaokaoEditor, gaokaoPolicyMismatchCount } from '../src/client/features/region/render.js';
import { SUFE_REGIONS } from '../src/client/constants/region-data.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="profile-subjects"></div><div id="profile-gaokao-scores"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  return dom;
}
function mountSubjects(doc, subjectIds) {
  const box = doc.getElementById('profile-subjects');
  box.innerHTML = subjectIds.map(sid => `<label><input type="checkbox" value="${sid}" checked>${sid}</label>`).join('');
}

test('renderTeacherGaokaoEditor：浙江 2021 → 21 档旧制，2022/未填 → 20 区间新制', () => {
  const dom = setup(); mountSubjects(dom.window.document, ['physics']);
  const container = dom.window.document.getElementById('profile-gaokao-scores');
  container.innerHTML = renderTeacherGaokaoEditor('zhejiang', 2021, []);
  const sel2021 = container.querySelector('select.gk-grade-select[data-gk-subject="physics"]');
  assert.ok(sel2021);
  const opt2021 = [...sel2021.options].map(o => o.value);
  assert.ok(opt2021.includes('L1') && opt2021.includes('L21'));
  assert.ok(!opt2021.includes('I1'));
  container.innerHTML = renderTeacherGaokaoEditor('zhejiang', 2022, []);
  const opt2022 = [...container.querySelector('select.gk-grade-select[data-gk-subject="physics"]').options].map(o => o.value);
  assert.ok(opt2022.includes('I1') && opt2022.includes('I20'));
  assert.ok(!opt2022.includes('L1'));
  container.innerHTML = renderTeacherGaokaoEditor('zhejiang', undefined, []);
  assert.ok([...container.querySelector('select.gk-grade-select[data-gk-subject="physics"]').options].some(o => o.value === 'I1'));
  delete globalThis.document;
});

test('R2-12/H1 存量旧档成绩失配：L 档在 20 区间下警告横幅；填毕业年份消除', () => {
  const dom = setup(); mountSubjects(dom.window.document, ['physics']);
  const container = dom.window.document.getElementById('profile-gaokao-scores');
  container.innerHTML = renderTeacherGaokaoEditor('zhejiang', undefined, [{ subject: 'physics', grade: 'L3' }]);
  assert.ok(container.querySelector('.gaokao-mismatch-warn'));
  assert.equal(gaokaoPolicyMismatchCount(SUFE_REGIONS.policyOf('zhejiang'), [{ subject: 'physics', grade: 'L3' }]), 1);
  assert.equal(gaokaoPolicyMismatchCount(SUFE_REGIONS.policyOf('zhejiang', 2020), [{ subject: 'physics', grade: 'L3' }]), 0);
  container.innerHTML = renderTeacherGaokaoEditor('zhejiang', 2020, [{ subject: 'physics', grade: 'L3' }]);
  assert.equal(container.querySelector('.gaokao-mismatch-warn'), null);
  delete globalThis.document;
});
