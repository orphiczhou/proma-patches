#!/usr/bin/env node
/**
 * a5-edge.cjs — A5 新攻击面/边界 case 探索（任务 6）
 *
 * 重点验证：
 *   E1: worker 给 root 调 audit_gate verdict=skip（不是 pass）—— resolveAuditorIndep 是否被绕过
 *   E2: worker 借 root.session_id 作 caller 给 root 写 done event —— caller 校验是否被绕过
 *   E3: commander 用自己 session_id 给自己 worker 写 done event（合法 added_by 路径）—— 不能被误拒
 *   E4: 同一树两个 worker（w1.added_by=comm），w1 给 w2 写 done event —— caller 校验拒绝（caller != w2.session_id && != w2.added_by=comm）
 *   E5: root 自己不传 callerSessionId 调 audit_gate（CLI 路径） —— root 自审放行
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SANDBOX = path.join(__dirname, 'a5-edge-sandbox');
if (fs.existsSync(SANDBOX)) fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(SANDBOX, { recursive: true });

const ENG = path.join(__dirname, '..', 'patch-l', 'tree-engine.cjs');
const engine = require(ENG);
engine.setTreesRoot(SANDBOX);

const UUID = {
  root:   'b5b5b5b5-1111-4111-8111-b5b5b5b5b001',
  comm:   'b5b5b5b5-1111-4111-8111-b5b5b5b5b002',
  w1:     'b5b5b5b5-1111-4111-8111-b5b5b5b5b003',
  w2:     'b5b5b5b5-1111-4111-8111-b5b5b5b5b004',
};
async function call(args, caller) {
  if (caller) return await engine.run(args[0], args.slice(1), null, caller);
  return await engine.run(args[0], args.slice(1));
}
function readLeaf(tid, lid) {
  return JSON.parse(fs.readFileSync(path.join(SANDBOX, tid, 'tree-state.json'), 'utf8')).leaves[lid];
}
function banner(s) { console.log('\n' + '='.repeat(72) + '\n' + s + '\n' + '='.repeat(72)); }

(async () => {
  // E1: worker 给 root 调 audit_gate verdict=skip（不是 pass/required）
  //     resolveAuditorIndep 只在 verdict ∈ {pass,required} 时调用,skip/fail 跳过独立性校验。
  //     所以 worker 给 root 调 skip **不会**走 caller 校验链路。问题是：worker 能把 root.audit_gate 改成 skip 吗？
  banner('E1: worker 给 root 调 audit_gate verdict=skip（verdict=skip 跳独立性校验）');
  const t1 = 'edge1';
  await call(['init', t1, '--root-brief', JSON.stringify({parent_intent:'e1'}), '--root-dod', JSON.stringify({deliverables:[],node_budget:10,max_depth:3}), '--session-id', UUID.root, '--model', 'm', '--channel', 'c']);
  await call(['event', 'append', t1, `${t1}-root`, '--type', 'done', '--json', JSON.stringify({self_check:[{item:'r',pass:true,evidence:'e'}]})], UUID.root);
  const root1 = `${t1}-root`;
  const before1 = readLeaf(t1, root1).audit_gate;
  console.log('攻击前 root.audit_gate:', JSON.stringify(before1));
  // worker 给 root 调 skip（caller=worker）
  const r1 = await call(['audit', 'gate', t1, root1, '--verdict', 'skip', '--reason', 'worker trying skip'], UUID.worker);
  console.log(`worker 给 root 调 skip: ${r1.ok ? '放行' : `拒（${r1.error && r1.error.code}）`}`);
  if (r1.error) console.log(`  msg: ${(r1.error.msg||'').slice(0,200)}`);
  const after1 = readLeaf(t1, root1).audit_gate;
  console.log('攻击后 root.audit_gate:', JSON.stringify(after1));
  // 注：cmdAuditGate 行 2269 caller 校验是 `audit_session_id && callerSessionId && audit_session_id !== callerSessionId`
  // audit_session_id 在 skip 路径下也没传时为 null,短路跳过 caller 校验。然后 verdict 不是 pass/required,
  // 跳过 resolveAuditorIndep。所以理论上 worker 可以给 root 调 skip。这是潜在新攻击：worker 抹掉 root.audit_gate.verdict=pass 改成 skip。
  console.log(`\n*** E1 结论：worker ${r1.ok ? '能' : '不能'} 把 root.audit_gate 改成 skip ${r1.ok && before1.verdict === 'pass' && after1.verdict === 'skip' ? '(降级攻击成功 = 新 P0)' : ''}`);

  // E2: worker 借 root.session_id 作 caller（caller 注入攻击）
  //     现实威胁：MCP wrapper 从 __proma_getMcpServers__(sessionId) 提取 caller,worker 不能伪造。
  //     但如果 wrapper 被绕过/有 bug 让 worker 控制传入的 callerSessionId 参数,worker 能否攻击？
  //     这里直接 engine.run(... callerSessionId=UUID.root) 模拟"假如 worker 能控制 caller"。
  banner('E2: 假如 worker 能控制 caller=root.session_id（wrapper 绕过场景）');
  const t2 = 'edge2';
  await call(['init', t2, '--root-brief', JSON.stringify({parent_intent:'e2'}), '--root-dod', JSON.stringify({deliverables:[],node_budget:10,max_depth:3}), '--session-id', UUID.root, '--model', 'm', '--channel', 'c']);
  await call(['leaf', 'add', t2, '--json', JSON.stringify({leaf_id:`${t2}-C-commander`,session_id:UUID.comm,parent:`${t2}-root`,path:'C',role:'commander',model:'m',channel:'c',added_by:UUID.root})], UUID.root);
  const root2 = `${t2}-root`;
  const before2 = readLeaf(t2, root2).audit_gate;
  console.log('攻击前 root.audit_gate:', JSON.stringify(before2));
  // 模拟：worker 控制了 caller，伪装成 root.session_id
  const r2 = await call(['event', 'append', t2, root2, '--type', 'done', '--json', JSON.stringify({self_check:[{item:'attacker spoof caller',pass:true,evidence:'e'}]})], UUID.root);
  console.log(`worker 借 caller=root.session_id 给 root 写 done: ${r2.ok ? '放行（auto_upgrade 触发）' : `拒（${r2.error && r2.error.code}）`}`);
  const after2 = readLeaf(t2, root2).audit_gate;
  console.log('攻击后 root.audit_gate:', JSON.stringify(after2));
  console.log(`*** E2 结论：${r2.ok && after2.auto_upgrade ? '若 wrapper 被绕过,worker 借 root.session_id 可触发 auto_upgrade（依赖 MCP wrapper 不可绕过）' : 'caller 校验已堵'}`);

  // E3: commander 用自己 session_id 给自己的 worker 写 done event（合法路径）
  //     worker.added_by=commander.session_id,所以 caller=commander === worker.added_by 通过校验。
  //     这是 C5 设计承认的"commander 可代 worker 报 done"合法路径。
  banner('E3: commander 给自己的 worker 写 done event（合法 added_by 路径,应放行）');
  const t3 = 'edge3';
  await call(['init', t3, '--root-brief', JSON.stringify({parent_intent:'e3'}), '--root-dod', JSON.stringify({deliverables:[],node_budget:10,max_depth:3}), '--session-id', UUID.root, '--model', 'm', '--channel', 'c']);
  await call(['leaf', 'add', t3, '--json', JSON.stringify({leaf_id:`${t3}-C-commander`,session_id:UUID.comm,parent:`${t3}-root`,path:'C',role:'commander',model:'m',channel:'c',added_by:UUID.root})], UUID.root);
  await call(['leaf', 'add', t3, '--json', JSON.stringify({leaf_id:`${t3}-Cw-worker`,session_id:UUID.w1,parent:`${t3}-C-commander`,path:'Cw',role:'worker',model:'m',channel:'c',added_by:UUID.comm})], UUID.comm);
  const wId3 = `${t3}-Cw-worker`;
  const r3 = await call(['event', 'append', t3, wId3, '--type', 'done', '--json', JSON.stringify({self_check:[{item:'c reports for w',pass:true,evidence:'e'}]})], UUID.comm);
  console.log(`commander 给 worker 写 done: ${r3.ok ? '放行（合法路径）' : `拒（${r3.error && r3.error.code}: ${(r3.error && r3.error.msg||'').slice(0,150)}）`}`);
  console.log(`*** E3 结论：${r3.ok ? 'commander 代 worker 报 done 放行（符合 C5 设计）' : '误拒（过严风险）'}`);

  // E4: w1 给 w2 写 done event（caller=w1, w2.session_id=w2, w2.added_by=comm,w1 都不等）
  banner('E4: w1 给 w2 写 done event（兄弟 worker 之间,应拒）');
  const t4 = 'edge4';
  await call(['init', t4, '--root-brief', JSON.stringify({parent_intent:'e4'}), '--root-dod', JSON.stringify({deliverables:[],node_budget:10,max_depth:3}), '--session-id', UUID.root, '--model', 'm', '--channel', 'c']);
  await call(['leaf', 'add', t4, '--json', JSON.stringify({leaf_id:`${t4}-C-commander`,session_id:UUID.comm,parent:`${t4}-root`,path:'C',role:'commander',model:'m',channel:'c',added_by:UUID.root})], UUID.root);
  await call(['leaf', 'add', t4, '--json', JSON.stringify({leaf_id:`${t4}-Cw1-worker`,session_id:UUID.w1,parent:`${t4}-C-commander`,path:'Cw1',role:'worker',model:'m',channel:'c',added_by:UUID.comm})], UUID.comm);
  await call(['leaf', 'add', t4, '--json', JSON.stringify({leaf_id:`${t4}-Cw2-worker`,session_id:UUID.w2,parent:`${t4}-C-commander`,path:'Cw2',role:'worker',model:'m',channel:'c',added_by:UUID.comm})], UUID.comm);
  const r4 = await call(['event', 'append', t4, `${t4}-Cw2-worker`, '--type', 'done', '--json', JSON.stringify({self_check:[{item:'w1 attacks w2',pass:true,evidence:'e'}]})], UUID.w1);
  console.log(`w1 给 w2 写 done: ${r4.ok ? '放行（兄弟互写 = 失守）' : `拒（${r4.error && r4.error.code}）`}`);
  if (r4.error) console.log(`  msg: ${(r4.error.msg||'').slice(0,200)}`);
  console.log(`*** E4 结论：${r4.ok ? '失守：兄弟 worker 互写 done event' : '已堵'}`);

  // E5: root CLI 自审 audit_gate（无 caller,合法自审）
  banner('E5: root CLI 自审 audit_gate pass（无 caller,合法 root 自审）');
  const t5 = 'edge5';
  await call(['init', t5, '--root-brief', JSON.stringify({parent_intent:'e5'}), '--root-dod', JSON.stringify({deliverables:[],node_budget:10,max_depth:3}), '--session-id', UUID.root, '--model', 'm', '--channel', 'c']);
  await call(['event', 'append', t5, `${t5}-root`, '--type', 'done', '--json', JSON.stringify({self_check:[{item:'r',pass:true,evidence:'e'}]})], UUID.root);
  // root 自审 pass（无 caller）
  const r5 = await call(['audit', 'gate', t5, `${t5}-root`, '--verdict', 'pass', '--audit-session-id', UUID.root, '--reason', 'root self-audit via CLI']);
  console.log(`root 无 caller 自审 pass: ${r5.ok ? '放行（合法）' : `拒（${r5.error && r5.error.code}: ${(r5.error && r5.error.msg||'').slice(0,150)}）`}`);
  console.log(`*** E5 结论：${r5.ok ? 'CLI root 自审正常工作（向后兼容）' : '误拒（过严风险）'}`);

  // 总结
  banner('E1-E5 总结');
  console.log('E1 (worker 给 root 调 skip 降级):', r1.ok && before1.verdict === 'pass' && after1.verdict === 'skip' ? '新 P0 失守' : (r1.ok ? '放行但未降级（low risk）' : '已拒'));
  console.log('E2 (wrapper 绕过场景):', r2.ok && after2.auto_upgrade ? '依赖 wrapper' : '已堵');
  console.log('E3 (commander 代 worker 报 done):', r3.ok ? '合法放行' : '误拒');
  console.log('E4 (兄弟 worker 互写 done):', r4.ok ? '失守' : '已堵');
  console.log('E5 (root CLI 自审):', r5.ok ? '正常' : '误拒');
})().catch(e => { console.error('FATAL:', e.stack || e); process.exit(1); });
