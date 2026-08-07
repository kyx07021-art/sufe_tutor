/**
 * server/cache.js 公开读缓存回归（v0.22.5）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCacheGet, readCachePut, readCacheClear, readCacheClearAll } from '../server/cache.js';

test('公开读缓存：写入命中、前缀清、全清', () => {
  readCacheClearAll();
  assert.equal(readCacheGet('missing'), null, '未命中返回 null');
  readCachePut('/api/teachers', { teachers: [] });
  assert.deepEqual(readCacheGet('/api/teachers'), { teachers: [] }, '写入后命中');
  // 前缀清
  readCachePut('/api/teachers?x=1', [1]);
  readCacheClear('/api/teachers');
  assert.equal(readCacheGet('/api/teachers'), null);
  assert.equal(readCacheGet('/api/teachers?x=1'), null);
  // 全清
  readCachePut('/api/posts', { posts: [] });
  readCacheClearAll();
  assert.equal(readCacheGet('/api/posts'), null);
});
