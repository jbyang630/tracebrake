import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Interface, ZeroHash } from 'ethers';
import { createVM } from '@ethereumjs/vm';
import { createBlock } from '@ethereumjs/block';
import { Hardfork, Mainnet, createCustomCommon } from '@ethereumjs/common';
import { createAddressFromString, bytesToHex, hexToBytes } from '@ethereumjs/util';
import { compile, REGISTRY, POLICY_ID } from '../scripts/artifact.mjs';

const artifact = compile();
const iface = new Interface(artifact.abi);
const registry = createAddressFromString(REGISTRY);
const alice = createAddressFromString('0x0000000000000000000000000000000000002001');
const bob = createAddressFromString('0x0000000000000000000000000000000000002002');
const noId = createAddressFromString('0x0000000000000000000000000000000000002003');
const SESSION = '0x' + 'ab'.repeat(32);
const SESSION_2 = '0x' + 'cd'.repeat(32);

async function chain(chainId = 56, hasRegistry = true) {
  const common = createCustomCommon({ chainId }, Mainnet, { hardfork: Hardfork.Shanghai });
  const vm = await createVM({ common });
  let timestamp = 1000n;
  const block = () => createBlock({ header: { timestamp } }, { common });
  // 本地测试身份合约：仅两个固定测试地址返回非零；从不向公网发送请求。
  if (hasRegistry) await vm.stateManager.putCode(registry, hexToBytes('0x60043561200114600435612002141760005260206000f3'));
  const deploy = await vm.evm.runCall({ caller: alice, data: hexToBytes(artifact.bytecode), gasLimit: 2_000_000n, block: block() });
  const addr = deploy.createdAddress;
  const call = (caller, name, args = [], extras = {}) => vm.evm.runCall({
    caller, to: addr, data: hexToBytes(iface.encodeFunctionData(name, args)), gasLimit: 500_000n, block: block(), ...extras
  });
  async function permission(holder) {
    const result = await call(holder, 'permissionState', [holder.toString()]);
    assert.equal(result.execResult.exceptionError, undefined);
    return [...iface.decodeFunctionResult('permissionState', bytesToHex(result.execResult.returnValue))];
  }
  return {
    vm, addr, deploy, call, permission, advance: (n) => { timestamp += BigInt(n); },
    removeId: () => vm.stateManager.putCode(registry, hexToBytes('0x600060005260206000f3'))
  };
}

function reverts(result, reason) {
  assert.ok(result.execResult.exceptionError);
  if (reason) assert.equal(iface.parseError(bytesToHex(result.execResult.returnValue))?.name, reason);
}

describe('实际部署字节码在隔离 EVM 上的行为', () => {
  test('仅在 BSC 56 且有官方身份合约代码时部署；运行代码与构建一致', async () => {
    reverts((await chain(1)).deploy, 'WrongNetwork');
    reverts((await chain(56, false)).deploy, 'WrongNetwork');
    const good = await chain();
    assert.equal(good.deploy.execResult.exceptionError, undefined);
    assert.equal(bytesToHex(await good.vm.stateManager.getCode(good.addr)), artifact.runtime);
  });
  test('实际持有地址可登记自己的会话，事件绑定到本人、版本和到期时间', async () => {
    const c = await chain();
    const result = await c.call(alice, 'grantDemoPermission', [3600, SESSION]);
    assert.equal(result.execResult.exceptionError, undefined);
    const event = result.execResult.logs.map(([, topics, data]) => iface.parseLog({ topics: topics.map(bytesToHex), data: bytesToHex(data) })).at(-1);
    assert.equal(event.name, 'DemoPermissionGranted');
    assert.deepEqual([...event.args].map((v, i) => i === 0 ? v.toLowerCase() : v), [alice.toString(), POLICY_ID, SESSION, 4600n]);
    assert.deepEqual(await c.permission(alice), [4600n, 1000n, true, true, SESSION]);
    assert.deepEqual(await c.permission(bob), [0n, 1000n, true, false, ZeroHash]);
  });
  test('非持有人、空会话和非法期限不能留下有效权限', async () => {
    const c = await chain();
    reverts(await c.call(noId, 'grantDemoPermission', [3600, SESSION]), 'NoAgentId');
    reverts(await c.call(alice, 'grantDemoPermission', [3600, ZeroHash]), 'InvalidSession');
    for (const n of [0, 86401]) reverts(await c.call(alice, 'grantDemoPermission', [n, SESSION]), 'InvalidDuration');
    assert.deepEqual(await c.permission(noId), [0n, 1000n, false, false, ZeroHash]);
  });
  test('别人不能撤回本人的权限，撤回和重新授权分别影响相应会话', async () => {
    const c = await chain();
    await c.call(alice, 'grantDemoPermission', [60, SESSION]);
    reverts(await c.call(bob, 'revokeDemoPermission'), 'NoPermission');
    const revoke = await c.call(alice, 'revokeDemoPermission');
    assert.equal(revoke.execResult.exceptionError, undefined);
    assert.deepEqual(await c.permission(alice), [0n, 1000n, true, false, ZeroHash]);
    await c.call(alice, 'grantDemoPermission', [60, SESSION_2]);
    assert.deepEqual(await c.permission(alice), [1060n, 1000n, true, true, SESSION_2]);
  });
  test('到期和失去身份即失效，失去身份后仍可自行撤回', async () => {
    const c = await chain();
    await c.call(alice, 'grantDemoPermission', [30, SESSION]);
    c.advance(30);
    assert.deepEqual(await c.permission(alice), [1030n, 1030n, true, false, SESSION]);
    await c.call(alice, 'grantDemoPermission', [30, SESSION]);
    await c.removeId();
    assert.deepEqual(await c.permission(alice), [1060n, 1030n, false, false, SESSION]);
    const r = await c.call(alice, 'revokeDemoPermission');
    assert.equal(r.execResult.exceptionError, undefined);
    assert.deepEqual(await c.permission(alice), [0n, 1030n, false, false, ZeroHash]);
  });
  test('部署与公开函数均不接受转入金额；没有管理员、提款或代授权入口', async () => {
    const c = await chain();
    for (const [fn, args] of [['grantDemoPermission', [60, SESSION]], ['permissionState', [alice.toString()]], ['revokeDemoPermission', []]]) {
      reverts(await c.call(alice, fn, args, { value: 1n, skipBalance: true }));
    }
    assert.deepEqual(artifact.abi.map((x) => x.name).filter(Boolean).filter((n) => /admin|owner|withdraw|transfer|approve/i.test(n)), []);
    assert.equal(artifact.abi.some((x) => ['receive', 'fallback'].includes(x.type) || x.stateMutability === 'payable'), false);
  });
});
