/**
 * 网安报告 F-07 哈希链完整性 —— verifyChain 回归测试（纯函数注入）
 * 固定向量：测试内实现与 server/contract.js ledgerContentHash 相同的拼装规则
 * （sha256(bodyHash|contractId|createdAt|prevHash)，bodyHash=sha256(正文)）构造合法链；
 * 实现一旦漂移，构造出的「合法链」必然验不过（golden-vector 对拍）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyChain } from '../server/contract.js';

const hexOf = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(hexOf);
const contentHashOf = async (contractId, contractMd, createdAt, prevHash) => {
  const bodyHash = await sha256Hex(contractMd);
  return sha256Hex(`${bodyHash}|${contractId}|${createdAt}|${prevHash}`);
};

const CONTRACT_ID = 7;
// 构造 3 条合法链（第 i 条正文 = 合同正文i，created_at 递增）
async function makeChain() {
  const rows = [];
  let prev = 'GENESIS';
  for (let i = 1; i <= 3; i++) {
    const md = `合同正文${i}`;
    const createdAt = `2026-07-2${i} 10:0${i}:00`;
    rows.push({
      id: i, contract_id: CONTRACT_ID,
      content_hash: await contentHashOf(CONTRACT_ID, md, createdAt, prev),
      prev_hash: prev, seq: i, body_hash: await sha256Hex(md), created_at: createdAt,
    });
    prev = rows[i - 1].content_hash;
  }
  return rows;
}

test('合法链：headValid/linksValid/seqValid/lastRehashValid 全通过', async () => {
  const rows = await makeChain();
  const r = await verifyChain(rows, { contractId: CONTRACT_ID, contractMd: '合同正文3' });
  assert.equal(r.headValid, true);
  assert.equal(r.linksValid, true);
  assert.equal(r.seqValid, true);
  assert.equal(r.lastRehashValid, true);
  assert.equal(r.ok, true);
});

test('中间条目 content_hash 被篡改 → 断链检出', async () => {
  const rows = await makeChain();
  rows[1].content_hash = rows[1].content_hash.replace(/^./, 'f');
  const r = await verifyChain(rows, { contractId: CONTRACT_ID, contractMd: '合同正文3' });
  assert.equal(r.linksValid, false);
  assert.equal(r.ok, false);
});

test('链头 prev_hash 不是 GENESIS → 检出', async () => {
  const rows = await makeChain();
  rows[0].prev_hash = 'DEADBEEF';
  const r = await verifyChain(rows, { contractId: CONTRACT_ID, contractMd: '合同正文3' });
  assert.equal(r.headValid, false);
  assert.equal(r.ok, false);
});

test('seq 断号 → 检出', async () => {
  const rows = await makeChain();
  rows[2].seq = 99;
  const r = await verifyChain(rows, { contractId: CONTRACT_ID, contractMd: '合同正文3' });
  assert.equal(r.seqValid, false);
  assert.equal(r.ok, false);
});

test('中间条目被删除（prev 链缺口）→ 检出', async () => {
  const rows = await makeChain();
  rows.splice(1, 1); // 抽走第 2 条：第 3 条的 prev_hash 指向已删除的第 2 条
  const r = await verifyChain(rows, { contractId: CONTRACT_ID, contractMd: '合同正文3' });
  assert.equal(r.linksValid, false);
  assert.equal(r.ok, false);
});

test('最新条目正文被改 → lastRehashValid=false（链结构 intact：ok 只看结构，合并判断在 verifyContractLedger）', async () => {
  const rows = await makeChain();
  const r = await verifyChain(rows, { contractId: CONTRACT_ID, contractMd: '被篡改过的正文' });
  assert.equal(r.lastRehashValid, false);
  assert.equal(r.ok, true); // ok=链结构；正文重放由调用方 chain.ok && lastRehashValid !== false 合并判定
});

test('已撤销合同（archived，无正文）只做链结构校验', async () => {
  const rows = await makeChain();
  const r = await verifyChain(rows, { archived: true });
  assert.equal(r.lastRehashValid, null);
  assert.equal(r.ok, true);
});

test('空链 → ok=false', async () => {
  const r = await verifyChain([]);
  assert.equal(r.ok, false);
});
