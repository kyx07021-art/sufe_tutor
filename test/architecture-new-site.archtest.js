/**
 * S0-26 新站架构契约（`npm run test:arch` 对新站架构锁定）
 * ------------------------------------------------------------------
 * 由 v2 时代 test/architecture-v2.archtest.js 的 11 契约评估而来：
 *   保留/改写：构建契约 / 后端域自持 / 声明式路由 / SQL 边界 / region-data 单源；
 *   改写为新站形态：前端模块自持（new-frontend/src/modules） / 前端边界（fetch 单点 + 零 v-html /
 *   零内联事件样式 / 零 <style> 注入 / 中文单源） / ESM 壳（new-frontend/index.html） /
 *   严格 meta CSP（Vite 注入 + 三源锁）；
 *   删除（引用已删/废弃的 v2 结构）：web/index.html 层叠加载序、src/client 分层、architecture.md 互检
 *   （新站自有文档体系，v2 文档不承担契约互检）。
 *   新增：dist 不含 manifest.js（S0-24 Vite 内容哈希取代 v2 manifest 管线）；
 *   app.js 引 core/human-check（S0-21，非 server/human-check）；前端样式单源（tokens→base 依序）。
 *
 * 契约清单（S0-26 验收边界：结构契约 + CSP 三源锁 + 零裸值 + 变异负例）：
 *   1. 构建契约：scripts/build.mjs 存在，deploy/build 接线 dist；dist 不含 manifest.js；
 *   2. 后端域自持：src/server/domains/<域>/{schema,repo,api} 三件套；
 *   3. 声明式路由：app.js 导出 routes（域拼接 + core 特殊路由）；app.js 引 core/human-check；
 *      _worker.js routeApi 只装配（createRouter）零手写 if 路由；
 *   4. SQL 边界：domains/<域>/api.js 与 _worker.js（除保活）零 db.prepare；
 *   5. 前端模块自持：new-frontend/src/modules/<域>/ 自持页注册 + core/components/constants/router 分层；
 *   6. 前端边界：fetch 只在 core/api.js + core/datahub.js；零 v-html / 零内联事件样式属性 /
 *      零 <style> 注入 / 零 String.fromCharCode；中文只在 src/constants/ + 显式数据模块；
 *   7. 新前端入口壳：new-frontend/index.html 干净 module 入口，零内联脚本/事件/样式；
 *   8. CSP 三源锁（S0-23）：META_CSP / _headers / SECURITY_HEADERS 三共享指令逐字一致，零 unsafe-inline/eval/default-src；
 *   9. region-data 单源：SUFE_REGIONS 唯一定义于 src/shared/region-data.js，全仓零重定义；
 *  10. 前端样式单源：styles/{tokens,base}.css 存在，main.js 依序 import（tokens 先于 base）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { META_CSP } from '../new-frontend/src/constants/csp.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
// 去除注释后再跑「代码形态」断言：契约自述注释（如 "zero createElement('style')"）不误伤，
// 中文单源检查仍用原文（注释中文也要抓）。
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* ------------------------------------------------------------------ *
 * 1. 构建契约
 * ------------------------------------------------------------------ */
test('构建契约：scripts/build.mjs 存在，deploy 指向 dist，dist 不含 manifest.js（S0-24）', () => {
  assert.ok(existsSync(join(root, 'scripts/build.mjs')), 'build 脚本存在');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(String(pkg.scripts.deploy).includes('dist'), 'deploy 只部署 dist');
  assert.ok(String(pkg.scripts.build).includes('scripts/build.mjs'), 'build 脚本接线');
  // S0-24：Vite 原生内容哈希 + _headers /assets/* immutable 取代 v2 hash-assets→manifest 管线；
  // 部署对象 dist 不得含 manifest.js（哈希改写职责已由 Vite 承担）。
  const dist = join(root, 'dist');
  if (existsSync(dist)) {
    assert.ok(!existsSync(join(dist, 'manifest.js')), 'dist 不含 manifest.js');
  }
});

/* ------------------------------------------------------------------ *
 * 2. 后端域自持
 * ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ *
 * 3. 声明式路由 + core/human-check 落位
 * ------------------------------------------------------------------ */
test('声明式路由：app.js 导出 routes；routeApi 只装配零手写 if 路由', () => {
  const app = read('src/server/app.js');
  assert.ok(app.includes('export const routes'), 'app.js 导出 routes（域 routes + 特殊路由拼接）');
  // S0-21：captcha handler 落位 src/server/core/human-check.js，禁止回退根 server/human-check。
  assert.ok(app.includes("from './core/human-check.js'"), 'app.js 引 core/human-check');
  assert.ok(!app.includes('server/human-check'), 'app.js 不引 server/human-check');
  const worker = read('_worker.js');
  const start = worker.indexOf('export async function routeApi');
  const brace = worker.indexOf('{', start);
  let depth = 0, i = brace;
  for (; i < worker.length; i++) {
    if (worker[i] === '{') depth++;
    else if (worker[i] === '}') { depth--; if (depth === 0) break; }
  }
  const routeApiBlock = worker.slice(start, i + 1);
  assert.ok(routeApiBlock.includes('createRouter(['), 'routeApi 经 createRouter 装配');
  assert.ok(!routeApiBlock.includes("p === '/api/"), 'routeApi 内零手写 if 路由');
  // 业务路由全部来自 app.js（...apiRoutes 展开）；routeApi 只允许内联 3 条编排层特殊路由
  // （batch / health / keepalive）。若业务路由被内联进来，计数必 > 3（契约有牙齿）。
  const inlinePaths = routeApiBlock.match(/path:\s*['"]\/api\//g) || [];
  assert.equal(inlinePaths.length, 3, `routeApi 内联特殊路由恰 3 条（batch/health/keepalive，实 ${inlinePaths.length}）`);
  for (const p of ['/api/batch', '/api/health', '/api/keepalive']) {
    assert.ok(routeApiBlock.includes(`path: '${p}'`), `routeApi 含 ${p} 特殊路由`);
  }
});

/* ------------------------------------------------------------------ *
 * 4. SQL 边界
 * ------------------------------------------------------------------ */
test('SQL 边界：业务路由/编排层无 db.prepare（保活 ping 除外）', () => {
  const worker = read('_worker.js');
  const keepStart = worker.indexOf('function keepD1Warm');
  const exportStart = worker.indexOf('export default');
  const keep = keepStart >= 0 && exportStart > keepStart ? worker.slice(keepStart, exportStart) : '';
  assert.ok(!worker.replace(keep, '').includes('db.prepare'), '_worker.js 除保活外不直接写 SQL');
  const apiFiles = readdirSync(join(root, 'src/server/domains'), { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => join('src/server/domains', d.name, 'api.js'));
  assert.ok(apiFiles.length >= 10, 'domains api 文件齐备（契约有牙齿）');
  for (const f of apiFiles) {
    assert.ok(!read(f).includes('db.prepare'), `${f} 不直接写 SQL`);
  }
  assert.ok(!read('src/server/app.js').includes('db.prepare'), 'app.js 不直接写 SQL');
  assert.ok(!read('src/server/router.js').includes('db.prepare'), 'router.js 不直接写 SQL');
});

/* ------------------------------------------------------------------ *
 * 5. 前端模块自持
 * ------------------------------------------------------------------ */
test('前端模块自持：new-frontend/src/modules 自持页注册 + core/components/constants 分层', () => {
  const src = join(root, 'new-frontend/src');
  for (const d of ['modules', 'core', 'components', 'constants', 'router', 'styles']) {
    assert.ok(existsSync(join(src, d)), `new-frontend/src/${d} 存在`);
  }
  assert.ok(existsSync(join(src, 'core/api.js')), 'core/api.js 存在（fetch 单点）');
  assert.ok(existsSync(join(src, 'core/datahub.js')), 'core/datahub.js 存在（缓存层）');
  assert.ok(existsSync(join(src, 'modules/shell/page-registry.js')), 'shell/page-registry.js 存在');
  const registry = read('new-frontend/src/modules/shell/page-registry.js');
  assert.ok(/import\.meta\.glob/.test(registry), 'page-registry 经 import.meta.glob 收集模块页');
  const modules = readdirSync(join(src, 'modules'), { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);
  assert.ok(modules.length >= 5, '至少 5 个前端模块（契约有牙齿）');
  // auth 是认证宿主（AuthHost），不注册页；其余页面模块必须自持 pages.js。
  for (const m of modules) {
    if (m === 'auth') continue;
    assert.ok(existsSync(join(src, 'modules', m, 'pages.js')), `modules/${m}/pages.js 存在`);
  }
});

/* ------------------------------------------------------------------ *
 * 6. 前端边界（契约 6 新站落位）
 * ------------------------------------------------------------------ */
const DATA_ALLOWLIST = new Set([
  'new-frontend/src/modules/chat/demoData.js',          // C2 骨架演示夹具（非用户文案）
  'new-frontend/src/modules/teacher-square/mock-data.js', // M7 I-29 预览 mock
  'new-frontend/src/modules/notifications/data.js',      // M5 通知数据层（含时间格式注释）
  'new-frontend/src/modules/my-demands/region.js',       // M8 域数据（S3 region 契约落地后改 re-export）
  'new-frontend/src/modules/my-demands/MyDemandsPreview.vue', // M9 dev-only 预览夹具
  'new-frontend/src/modules/my-demands/steps/TimeSlotEditor.vue', // M9 WIP 时段默认值
]);

test('前端边界：fetch 单点；零 v-html/内联事件/样式属性/<style> 注入/fromCharCode；中文只在常量+数据模块', () => {
  const src = join(root, 'new-frontend/src');
  const files = walk(src).filter(f => f.endsWith('.js') || f.endsWith('.vue'));
  assert.ok(files.length > 50, '扫描面非空（契约有牙齿）');
  const cjk = /[一-鿿]/;
  const srcPrefix = join(root, 'new-frontend', 'src').replaceAll('\\', '/');
  for (const abs of files) {
    const s = readFileSync(abs, 'utf8');
    const code = stripComments(s);
    const absSlash = abs.replaceAll('\\', '/');
    const rel = absSlash.startsWith(srcPrefix) ? absSlash.slice(srcPrefix.length + 1) : absSlash;
    const inConstants = rel.startsWith('constants/');
    const inAllowlist = DATA_ALLOWLIST.has('new-frontend/src/' + rel);
    // fetch 单点：core/api.js + core/datahub.js 是唯一允许直 fetch 的模块。
    if (rel !== 'core/api.js' && rel !== 'core/datahub.js') {
      assert.ok(!/\bfetch\s*\(/.test(code), `${rel} 不直接 fetch（单点 core/api.js）`);
    }
    assert.ok(!/createElement\(\s*['"]style['"]\s*\)/.test(code), `${rel} 零 <style> 元素注入`);
    assert.ok(!/String\.fromCharCode/.test(code), `${rel} 禁 String.fromCharCode 藏中文（中文只能字面量）`);
    // 内联事件属性字面量（HTML 注入面；Vue @click 是绑定非字面量，不在此列）。
    assert.ok(!/\bon(?:click|load|change|mouseover|mouseout|submit|keydown|keyup|blur|focus)=/.test(code), `${rel} 零内联事件属性`);
    if (abs.endsWith('.vue')) {
      assert.ok(!/v-html\s*=/.test(code), `${rel} 零 v-html（XSS 面）`);
      // 字面 HTML style 属性被 style-src-attr 'none' 拦截；:style 绑定走 CSSOM 数据通道（豁免）。
      assert.ok(!/(?<!:)\bstyle=['"]/.test(code), `${rel} 零内联 style 属性字面量（:style 绑定豁免）`);
    } else {
      assert.ok(!/setAttribute\(\s*['"]style['"]\s*/.test(code), `${rel} 零 setAttribute('style')（CSP3 检查面）`);
    }
    // 中文单源：常量目录（文案）与显式数据模块允许；其余整文件零中文（含注释）。
    if (inConstants || inAllowlist) continue;
    assert.ok(!cjk.test(s), `${rel} 零中文（文案只进 src/constants/）`);
  }
});

/* ------------------------------------------------------------------ *
 * 7. 新前端入口壳
 * ------------------------------------------------------------------ */
test('new-frontend/index.html 干净 module 入口：无内联脚本/事件/样式', () => {
  const html = read('new-frontend/index.html');
  assert.ok(html.includes('type="module"'), 'module 入口存在');
  assert.ok(!/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/.test(html), '无内联 script');
  assert.ok(!/onclick=/.test(html) && !/onload=/.test(html) && !/style=/.test(html), '无内联事件/样式属性');
});

/* ------------------------------------------------------------------ *
 * 8. CSP 三源锁（S0-23）
 * ------------------------------------------------------------------ */
const SHARED_DIRECTIVES = ['script-src', 'style-src-elem', 'style-src-attr'];
function extractDirective(policy, name) {
  const part = policy.split(';').map(s => s.trim()).find(s => s.split(/\s+/)[0] === name);
  return part ? part.split(/\s+/).slice(1).join(' ') : null;
}
function sharedDirectives(policy) {
  return SHARED_DIRECTIVES.map(name => {
    const value = extractDirective(policy, name);
    assert.ok(value !== null, `directive ${name} present in policy`);
    return `${name} ${value}`;
  }).join('; ');
}
function extractHeadersCsp(text) {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^Content-Security-Policy:\s*(.*)$/);
    if (m) return m[1].trim();
  }
  return '';
}

test('CSP 三源锁：META_CSP / _headers / SECURITY_HEADERS 三共享指令逐字一致（S0-23）', () => {
  const headersPolicy = extractHeadersCsp(read('_headers'));
  const configPolicy = read('src/shared/config.js').match(/Content-Security-Policy['"]:\s*"([^"]+)"/)?.[1] ?? '';
  assert.ok(headersPolicy && configPolicy, '_headers 与 SECURITY_HEADERS 均声明 CSP');
  for (const [label, policy] of [['_headers', headersPolicy], ['SECURITY_HEADERS', configPolicy]]) {
    assert.equal(sharedDirectives(policy), META_CSP, `${label} 三共享指令与 META_CSP 逐字一致`);
  }
  assert.equal(extractDirective(META_CSP, 'script-src'), "'self'", 'script-src 仅 self');
  assert.equal(extractDirective(META_CSP, 'style-src-elem'), "'self'", 'style-src-elem 仅 self');
  assert.equal(extractDirective(META_CSP, 'style-src-attr'), "'none'", 'style-src-attr 为 none');
  assert.ok(!/unsafe-inline/.test(META_CSP), '无 unsafe-inline');
  assert.ok(!/unsafe-eval/.test(META_CSP), '无 unsafe-eval');
  assert.ok(!/default-src/.test(META_CSP), '无 default-src（不收紧 data:/blob:）');
  // Vite 构建注入单源：vite.config.js 消费 META_CSP_TAG，零私有字面量副本。
  const viteCfg = read('new-frontend/vite.config.js');
  assert.match(viteCfg, /import\s*\{[^}]*META_CSP_TAG[^}]*\}\s*from\s*['"]\.\/src\/constants\/csp\.js['"]/, 'vite.config.js 消费 META_CSP_TAG 单源');
  assert.ok(!/script-src 'self'; style-src-elem/.test(viteCfg), 'vite.config.js 零内联 CSP 字面量');
});

/* ------------------------------------------------------------------ *
 * 9. region-data 单源
 * ------------------------------------------------------------------ */
test('region-data 单源：SUFE_REGIONS 唯一定义于 src/shared/region-data.js，全仓零重定义', () => {
  const shared = read('src/shared/region-data.js');
  assert.match(shared, /export const SUFE_REGIONS/, 'shared/region-data.js 定义 SUFE_REGIONS');
  const defs = [];
  for (const dir of ['src', 'new-frontend/src']) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const f of walk(base).filter(f => f.endsWith('.js') || f.endsWith('.vue'))) {
      if (/\bconst SUFE_REGIONS\s*=/.test(readFileSync(f, 'utf8'))) defs.push(f);
    }
  }
  assert.equal(defs.length, 1, '全仓恰一处 SUFE_REGIONS 定义');
  assert.equal(defs[0], join(root, 'src/shared/region-data.js'), '唯一定义落位 src/shared/region-data.js');
});

/* ------------------------------------------------------------------ *
 * 10. 前端样式单源
 * ------------------------------------------------------------------ */
test('前端样式单源：styles/{tokens,base}.css 存在，main.js 依序 import（tokens 先于 base）', () => {
  const styles = join(root, 'new-frontend/src/styles');
  assert.ok(existsSync(join(styles, 'tokens.css')), 'tokens.css 存在（设计令牌单源）');
  assert.ok(existsSync(join(styles, 'base.css')), 'base.css 存在');
  const main = read('new-frontend/src/main.js');
  const tokensIdx = main.indexOf("import './styles/tokens.css'");
  const baseIdx = main.indexOf("import './styles/base.css'");
  assert.ok(tokensIdx > -1 && baseIdx > -1, 'main.js import tokens.css + base.css');
  assert.ok(tokensIdx < baseIdx, 'tokens.css 在 base.css 之前（令牌先于组件基线）');
});
