/**
 * V-0-4 架构 v2 契约测试（先落红：当前 v1 结构不满足，迁移过程中逐条转绿）
 *
 * 契约：
 *   1. 部署对象只有 dist/，构建脚本存在；
 *   2. 后端域自持：src/server/domains/<域>/{schema.js,repo.js,api.js}；
 *   3. 声明式路由：src/server/app.js 导出 routes，_worker.js 不再有 if 路由；
 *   4. SQL 只在 repo：server/routes-*.js 与 _worker.js 无 db.prepare/batch；
 *   5. 前端模块自持：src/client/core + src/client/features；
 *   6. fetch 只在 api.js；前端无内联 onclick/style/中文文案。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

test('构建契约：scripts/build.mjs 存在，package deploy 指向 dist', () => {
  assert.ok(existsSync(join(root, 'scripts/build.mjs')), 'build 脚本存在');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(String(pkg.scripts.deploy).includes('dist'), 'deploy 只部署 dist');
  assert.ok(String(pkg.scripts.build).includes('scripts/build.mjs'), 'build 脚本接线');
});

test('后端域自持：src/server/domains/<域>/ 存在 schema/repo/api 三件', () => {
  const base = join(root, 'src/server/domains');
  assert.ok(existsSync(base), 'src/server/domains 存在');
  const domains = ['auth', 'teacher', 'demand', 'chat', 'contract', 'admin', 'posts', 'complaints', 'reviews', 'awards', 'settings'];
  for (const d of domains) {
    for (const f of ['schema.js', 'repo.js', 'api.js']) {
      assert.ok(existsSync(join(base, d, f)), `${d}/${f} 存在`);
    }
  }
});

test('声明式路由：_worker.js 只装配，不再有 if 路由', () => {
  const worker = read('_worker.js');
  assert.ok(!worker.includes("p === '/api/"), '_worker.js 没有手写 if 路由');
  const app = read('src/server/app.js');
  assert.ok(app.includes('export const routes'), '路由声明表存在');
});

test('SQL 边界：业务路由/编排层无 db.prepare', () => {
  for (const f of ['_worker.js']) {
    const s = read(f);
    assert.ok(!s.includes('db.prepare'), `${f} 不直接写 SQL`);
  }
  for (const f of readdirSync(join(root, 'server')).filter(f => f.startsWith('routes-') && f.endsWith('.js'))) {
    const s = read(join('server', f));
    assert.ok(!s.includes('db.prepare'), `server/${f} 不直接写 SQL`);
  }
});

test('前端模块自持：src/client/core 与 src/client/features 存在', () => {
  assert.ok(existsSync(join(root, 'src/client/app.js')), 'client 入口存在');
  for (const d of ['core', 'features', 'constants']) {
    assert.ok(existsSync(join(root, 'src/client', d)), `client/${d} 存在`);
  }
});

test('前端边界：fetch 只在 api.js；feature 无内联 onclick/style/中文文案', () => {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const coreFiles = existsSync(join(root, 'src/client/core')) ? walk(join(root, 'src/client/core')) : [];
  const featureFiles = existsSync(join(root, 'src/client/features')) ? walk(join(root, 'src/client/features')) : [];
  assert.ok(coreFiles.length > 0 && featureFiles.length > 0, 'core/features 文件非空');
  for (const f of [...coreFiles, ...featureFiles]) {
    const s = readFileSync(f, 'utf8');
    if (!f.endsWith('core/api.js')) assert.ok(!s.includes('fetch('), `${f.replaceAll('\\', '/')} 不直接 fetch`);
    assert.ok(!/onclick="/.test(s), `${f.replaceAll('\\', '/')} 无内联 onclick`);
    assert.ok(!/style="/.test(s), `${f.replaceAll('\\', '/')} 无内联 style`);
    assert.ok(!/[\u4e00-\u9fff]/.test(s), `${f.replaceAll('\\', '/')} 无中文文案`);
  }
});
