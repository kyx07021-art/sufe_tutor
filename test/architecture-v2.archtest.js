/**
 * V-0-4 架构 v2 契约测试（先落红：当前 v1 结构不满足，迁移过程中逐条转绿）
 *
 * 契约：
 *   1. 部署对象只有 dist/，构建脚本存在；
 *   2. 后端域自持：src/server/domains/<域>/{schema.js,repo.js,api.js}；
 *   3. 声明式路由：src/server/app.js 导出 routes，_worker.js 不再有 if 路由；
 *   4. SQL 只在 repo：src/server/domains/各域 api.js 与 _worker.js 无 db.prepare/batch；
 *   5. 前端模块自持：src/client/core + src/client/features；
 *   6. fetch 只在 api.js；前端无内联 onclick/onload/style/中文文案；
 *   7. V-3-1c3 CSP：core/features 零 <style> 元素注入（动态样式只走 CSS 自定义属性数据通道）；
 *   8. V-3-1d3 CSP：web/index.html 严格 meta CSP（script-src/style-src-elem 无 unsafe-inline）；
 *   9. V-3-2a0：region-data 单源（SUFE_REGIONS 唯一定义于 shared，client re-export）；
 *  10. V-3-2a0：CSS 分层加载序（tokens→base→features→responsive→glass）；
 *  11. V-3-2c：文档↔契约互检（architecture.md 契约清单与 archtest 双向对应，防文档漂移）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
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

test('声明式路由：routeApi 只装配，不再有 if 路由', () => {
  const worker = read('_worker.js');
  const block = worker.slice(worker.indexOf('export async function routeApi'), worker.indexOf('// B6 公开列表边缘缓存'));
  assert.ok(!block.includes("p === '/api/"), 'routeApi 内没有手写 if 路由');
  const app = read('src/server/app.js');
  assert.ok(app.includes('export const routes'), '路由声明表存在');
});

test('SQL 边界：业务路由/编排层无 db.prepare（保活 ping 除外）', () => {
  const worker = read('_worker.js');
  const keep = worker.slice(worker.indexOf('function keepD1Warm'), worker.indexOf('export default'));
  assert.ok(!worker.replace(keep, '').includes('db.prepare'), '_worker.js 除保活外不直接写 SQL');
  // Z-15-F1：server 下 routes-* 死 shim 已删，契约扫描目标改为 src/server/domains 各域 api.js（业务 SQL 仍只在 repo.js）
  const apiFiles = readdirSync(join(root, 'src/server/domains'), { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => join('src/server/domains', d.name, 'api.js'));
  assert.ok(apiFiles.length >= 10, 'domains api 文件齐备（契约有牙齿）');
  for (const f of apiFiles) {
    const s = read(f);
    assert.ok(!s.includes('db.prepare'), `${f} 不直接写 SQL`);
  }
});

test('前端模块自持：src/client/core 与 src/client/features 存在', () => {
  assert.ok(existsSync(join(root, 'src/client/app.js')), 'client 入口存在');
  for (const d of ['core', 'features', 'constants']) {
    assert.ok(existsSync(join(root, 'src/client', d)), `client/${d} 存在`);
  }
});

test('前端边界：fetch 只在 api.js；core/features 零内联事件/样式属性 + 零 <style> 注入 + 零中文文案', () => {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const coreFiles = existsSync(join(root, 'src/client/core')) ? walk(join(root, 'src/client/core')) : [];
  const featureFiles = existsSync(join(root, 'src/client/features')) ? walk(join(root, 'src/client/features')) : [];
  // Q-1-F2 复审计修复: 扫描范围扩到 src/client/constants——text.js 是中文哨兵实际落点（CONTRACT_BIZ_END），
  // 不在扫描内会让「防 fromCharCode 回退」断言对哨兵所在模块零约束（变异验证: text.js 改回 fromCharCode 不红）。
  const constantFiles = existsSync(join(root, 'src/client/constants')) ? walk(join(root, 'src/client/constants')) : [];
  assert.ok(coreFiles.length > 0 && featureFiles.length > 0, 'core/features 文件非空');
  assert.ok(constantFiles.length > 0, 'constants 文件非空');
  for (const f of [...coreFiles, ...featureFiles, ...constantFiles]) {
    const s = readFileSync(f, 'utf8');
    const rel = f.replaceAll('\\', '/');
    if (f.endsWith('.js') && !rel.endsWith('core/api.js')) assert.ok(!/\bfetch\s*\(/.test(s), `${rel} 不直接 fetch`);
    // V-3-1c3 CSP 收口契约：动态样式只能走 CSS 自定义属性数据通道（el.style.setProperty），
    // 零 <style> 元素注入（style-src-elem 'self' 硬约束）+ 零内联事件/样式属性（onload 曾漏查，V-3-1a 补）
    assert.ok(!/createElement\(["']style["']\)/.test(s), `${rel} 零 <style> 元素注入`);
    assert.ok(!/onload=/.test(s), `${rel} 无内联 onload`);
    assert.ok(!/onclick=/.test(s), `${rel} 无内联 onclick`);
    assert.ok(!/style=/.test(s), `${rel} 无内联 style`);
    // 中文仅允许 constants/ 数据单源模块（text.js 文案 / region-data.js 省份 / theme.js 主题值）；
    // core/features 禁中文（契约 6）；constants 中文字面量 OK 但 fromCharCode 全禁。
    const isTextModule = rel.endsWith('/text.js') || rel.includes('/src/client/constants/');
    assert.ok(isTextModule || !/[一-鿿]/.test(s), `${rel} 无中文文案`);
    // Chinese may only live in text.js literal form; fromCharCode banned in every module (text.js included).
    assert.ok(!/String\.fromCharCode/.test(s), `${rel} 禁 String.fromCharCode 藏中文（含 text.js——中文只能字面量）`);
  }
});

test('web/index.html 是干净 ESM 壳：无内联脚本/事件/样式', () => {
  const html = read('web/index.html');
  assert.ok(html.includes('type="module"'), 'module 入口存在');
  assert.ok(!/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/.test(html), '无内联 script');
  assert.ok(!/onclick=/.test(html) && !/onload=/.test(html) && !/style=/.test(html), '无内联事件/样式属性');
});

// V-3-1d3 + V-4-1h h5a-g6 CSP 收口契约（架构层）：v2 页严格 meta CSP——script-src/style-src-elem/
// style-src-attr 均无 unsafe-inline（style-src-attr 'none'，h5a-g6 实测定案：CSSOM cssText/setProperty 不受
// 该指令管辖，app 零内联 style 属性），锁严格策略不退化（文档化来源，V-3-2a0）。
// 最小化声明无 default-src（交集不收紧 data:/blob:）。
test('web/index.html 严格 meta CSP：script-src/style-src-elem/style-src-attr 均无 unsafe-inline；style-src-attr 为 none', () => {
  const html = read('web/index.html');
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(meta, 'v2 页 meta CSP 存在');
  assert.ok(/script-src 'self'(?!\s*'unsafe-inline')/.test(meta[1]), 'script-src 严格（无 unsafe-inline）');
  assert.ok(!/script-src[^;]*'unsafe-eval'/.test(meta[1]), '无 unsafe-eval');
  assert.ok(/style-src-elem 'self'(?!\s*'unsafe-inline')/.test(meta[1]), 'style-src-elem 严格（无 unsafe-inline）');
  assert.ok(/style-src-attr 'none'/.test(meta[1]), 'style-src-attr 为 none（h5a-g6：CSSOM 不受辖，app 零内联 style 属性）');
  assert.ok(!/style-src-attr[^;]*'unsafe-inline'/.test(meta[1]), 'style-src-attr 无 unsafe-inline（h5a-g6 收紧）');
  assert.ok(!/default-src/.test(meta[1]) || /img-src[^;]*data:/.test(meta[1]), '无 default-src 收紧 data: 通道（或 img-src 含 data:）');
  const dirs = meta[1].split(';').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
  assert.equal(new Set(dirs).size, dirs.length, '无重复指令（审计 O1：防分号后追加同指令等效放宽）');
});

// V-3-2a0：region-data 单源——SUFE_REGIONS 唯一定义在 src/shared/region-data.js（服务端亦复用），
// client 侧经 constants/region-data.js re-export 保持分层入口，v2 侧零重定义。
test('region-data 单源：SUFE_REGIONS 唯一定义于 shared/region-data.js，client 侧零重定义', () => {
  const shared = read('src/shared/region-data.js');
  assert.match(shared, /export const SUFE_REGIONS/, 'shared/region-data.js 定义 SUFE_REGIONS');
  const clientEntry = read('src/client/constants/region-data.js');
  assert.match(clientEntry, /export \{ SUFE_REGIONS \} from/, 'client 常量层为纯 re-export（分层入口）');
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const defs = [...walk(join(root, 'src/client')), ...walk(join(root, 'src/shared'))]
    .filter(f => f.endsWith('.js'))
    .filter(f => /\bconst SUFE_REGIONS\s*=/.test(readFileSync(f, 'utf8')));
  assert.equal(defs.length, 1, 'v2 侧（client+shared）仅一处 SUFE_REGIONS 定义');
  assert.equal(defs[0], join(root, 'src/shared', 'region-data.js'), '定义落位 shared 层');
});

// V-3-2a0：CSS 分层加载序——web/index.html stylesheet 依 tokens→base→features→responsive→glass 层叠
test('CSS 分层加载序：web/index.html stylesheet 依 tokens→base→features→responsive→glass 层叠', () => {
  const html = read('web/index.html');
  const links = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="\/([^"]+)"/g)].map(m => m[1]);
  const layers = [
    ['tokens.css', 'tokens'],
    ['base.css', 'base'],
    ['features/', 'features'],
    ['responsive.css', 'responsive'],
    ['glass.css', 'glass'],
  ];
  let prevName = null;
  let prevIdx = -1;
  for (const [prefix, name] of layers) {
    const idx = links.findIndex(l => l.startsWith(prefix));
    assert.ok(idx > -1, `CSS 层 ${name} 存在（${prefix}）`);
    assert.ok(idx > prevIdx, `CSS 层序：${name} 在 ${prevName || '层首'} 之后（V-2-5b 加载序铁律）`);
    prevIdx = idx;
    prevName = name;
  }
});

// V-3-2c 文档↔契约互检：docs/architecture.md 契约清单与 archtest 双向对应（防文档漂移）。
// 文档新增/删除契约而测试不同步 → 本测试红。关键词 = 文档章节标题与 archtest 测试标题的共同子串。
test('文档↔契约互检：architecture.md 契约清单与 archtest 双向对应（防文档漂移）', () => {
  const doc = read('docs/architecture.md');
  const testSrc = read('test/architecture-v2.archtest.js');
  const titles = [...testSrc.matchAll(/^test\('([^']+)'/gm)].map(m => m[1]);
  const keys = ['构建契约', '后端域自持', '声明式路由', 'SQL 边界', '前端模块自持', '前端边界', 'ESM 壳', '严格 meta CSP', 'region-data 单源', 'CSS 分层加载序'];
  const tableRows = [...doc.matchAll(/^\|\s*(\d+)\s*\|/gm)].map(m => Number(m[1]));
  assert.deepEqual(tableRows, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '文档契约清单恰为 1..10');
  for (const k of keys) {
    const hits = titles.filter(t => t.includes(k));
    assert.equal(hits.length, 1, `archtest 恰一个 test 对应「${k}」（实 ${hits.length}）`);
  }
  for (const t of titles) {
    if (t.startsWith('文档↔契约互检')) continue; // 本互检元测试自身，非业务契约
    const covered = keys.some(k => t.includes(k));
    assert.ok(covered, `archtest 契约 test「${t}」在文档关键词中有对应（无孤儿契约）`);
  }
});
