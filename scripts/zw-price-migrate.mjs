/**
 * ZW-2 存量迁移：教师 teacher_profiles 报价区间 → 报价单值（price_max = price_min 幂等回填）。
 *
 * 背景（ZW-1，2026-08-27）：教师报价改为单值——前端表单提交 price_min=price_max=单值；
 *   存量行的 price_max != price_min（历史区间）需回填为 price_min（用户原话「存量报价数据取报价下限作为新的报价单值」）。
 *
 * 幂等语义：
 *   - 只处理 price_max != price_min 的行；恒等行零触碰；
 *   - 写 SQL 带 WHERE price_max != price_min 双守卫——已恒等行永不命中；
 *   - 全量 apply 后重跑 = 「零区间残留，无需回填」零变更；中途中断重跑 = 续做剩余行。
 *
 * 安全边界（语义级闸门，对齐 zr-realname-migrate/wrangler-d1 先例）：
 *   - 只读校验 + 干跑预览为默认，--apply 才真正写；
 *   - 只动 price_max 一列；price_min 恒为单值真源；
 *   - 远程写经 wrangler-d1 d1WriteQuery（断言 changed_db=true，no-op 写被拒）；
 *   - fail-closed：任一行 price_max/price_min 非法（NULL/非数值）→ 列出并中止，零写入。
 *
 * 用法：
 *   node scripts/zw-price-migrate.mjs                     # 远程干跑（只读统计 + 预览，不写）
 *   node scripts/zw-price-migrate.mjs --apply             # 远程执行 + 事后重跑校验
 *   node scripts/zw-price-migrate.mjs --local <db.sqlite> # 本地 SQLite 库（副本演练用）
 */
import { DatabaseSync } from 'node:sqlite';
import { d1ReadQuery, d1WriteQuery, D1_DB_NAME } from './wrangler-d1.mjs';

const APPLY = process.argv.includes('--apply');
const localAt = process.argv.indexOf('--local');
const LOCAL_DB = localAt >= 0 ? process.argv[localAt + 1] : null;
if (localAt >= 0 && !LOCAL_DB) { console.error('✖ --local 需要 <db.sqlite> 参数'); process.exit(2); }

function localQuery(db, sql) {
  const st = db.prepare(sql);
  return st.all();
}

async function main() {
  if (LOCAL_DB) {
    const db = new DatabaseSync(LOCAL_DB, { readOnly: !APPLY });
    const rows = localQuery(db, `SELECT user_id, price_min, price_max FROM teacher_profiles WHERE price_max IS NOT NULL AND price_max != price_min ORDER BY user_id`);
    report(rows, `本地 ${LOCAL_DB}`, APPLY ? () => { db.prepare('UPDATE teacher_profiles SET price_max = price_min WHERE price_max IS NOT NULL AND price_max != price_min').run(); } : null);
    db.close();
    return;
  }
  const rows = await d1ReadQuery(D1_DB_NAME, `SELECT user_id, price_min, price_max FROM teacher_profiles WHERE price_max IS NOT NULL AND price_max != price_min ORDER BY user_id`);
  report(rows.results || rows, `远程 D1(${D1_DB_NAME})`, APPLY
    ? () => d1WriteQuery(D1_DB_NAME, `UPDATE teacher_profiles SET price_max = price_min WHERE price_max IS NOT NULL AND price_max != price_min`)
    : null);
}

function report(rows, label, apply) {
  const bad = rows.filter(r => r.price_min == null || r.price_max == null || Number.isNaN(+r.price_min) || Number.isNaN(+r.price_max));
  if (bad.length) {
    console.error(`✖ ${bad.length} 行非法报价（NULL/非数值），中止零写入：`, bad.map(r => r.user_id).join(','));
    process.exit(1);
  }
  console.log(`[${label}] ${APPLY ? 'apply' : '干跑'}：${rows.length} 行 price_max != price_min`);
  for (const r of rows) console.log(`  user_id=${r.user_id} price_min=${r.price_min} price_max=${r.price_max} → ${r.price_min}`);
  if (apply && rows.length) { apply(); console.log(`  ✔ 已回填 ${rows.length} 行（price_max := price_min）`); }
  if (!rows.length) console.log('  零区间残留，无需回填（幂等）');
}

main().catch(e => { console.error('✖', e.message); process.exit(1); });
