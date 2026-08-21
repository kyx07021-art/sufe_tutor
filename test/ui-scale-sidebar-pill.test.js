/**
 * 侧边栏选中高亮普通组件化（B4：直接 import core/router renderSidebar）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderSidebar } from '../src/client/core/router.js';
import { state } from '../src/client/core/state.js';
import { STYLE_CSS } from './_css.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="sidebar-nav"></div><div id="sidebar-user"></div><div id="sidebar-invite"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  return dom;
}

test('渲染后无 #sidebar-pill；active 高亮由条目自身承载', () => {
  const dom = setup();
  state.user = { role: 'student', id: 1, username: 's', avatar: '' };
  state.page = 'about';
  renderSidebar();
  assert.equal(dom.window.document.getElementById('sidebar-pill'), null);
  const item = dom.window.document.querySelector('#sidebar-nav .sidebar-item[data-page="about"]');
  assert.ok(item && item.classList.contains('active'));
  const styleCss = STYLE_CSS;
  const activeRule = styleCss.match(/\.sidebar-item\.active\s*\{[^}]*\}/);
  assert.ok(activeRule);
  state.page = 'about';
  renderSidebar();
  assert.ok(dom.window.document.querySelector('#sidebar-nav .sidebar-item[data-page="about"]').classList.contains('active'));
  delete globalThis.document;
});
