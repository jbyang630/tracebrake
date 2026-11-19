import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialReplay, ORDER_ID, reduceReplay, sessionAllowed } from '../site/dist/replay.js';
import { encodeCall } from '../site/dist/chain.js';
import { Interface } from 'ethers';
import { compile } from '../scripts/artifact.mjs';

for (const [scenario, end] of [['accepted', 'reconciled'], ['unknown', 'unclear']]) {
  test(`原单回执场景：${scenario}；阻断再次提交且保留原编号`, () => {
    let state = reduceReplay(initialReplay(scenario), { type: 'send', origin: 'sample' });
    assert.equal(state.phase, 'frozen');
    state = reduceReplay(state, { type: 'attempt' });
    state = reduceReplay(state, { type: 'query' });
    state = reduceReplay(state, { type: 'send' });
    assert.equal(state.phase, end);
    assert.equal(state.submissions, 1);
    assert.equal(state.queries, 1);
    assert.equal(state.events.filter((e) => e.type === 'SIMULATED_SUBMIT').length, 1);
    assert.ok(state.events.every((e) => e.orderId === ORDER_ID));
  });
}

test('激活的其他会话、已撤回、或缺失的权限不能启动本会话', () => {
  assert.equal(sessionAllowed({ active: true, sessionId: 'abc' }, 'abc'), true);
  assert.equal(sessionAllowed({ active: true, sessionId: 'abc' }, 'xyz'), false);
  assert.equal(sessionAllowed({ active: false, sessionId: 'abc' }, 'abc'), false);
  assert.equal(sessionAllowed(null, 'abc'), false);
});

test('浏览器生成的预览调用可用当前编译 ABI 解码，未用转账或授权代币接口', () => {
  const iface = new Interface(compile().abi);
  const sessionId = '0x' + 'aa'.repeat(32);
  const holder = '0x' + '71'.repeat(20);
  assert.deepEqual([...iface.decodeFunctionData('grantDemoPermission', encodeCall('grant', { duration: 3600, sessionId }))], [3600n, sessionId]);
  assert.equal(iface.parseTransaction({ data: encodeCall('revoke') }).name, 'revokeDemoPermission');
  assert.equal(iface.decodeFunctionData('permissionState', encodeCall('permission', { holder }))[0].toLowerCase(), holder);
});
