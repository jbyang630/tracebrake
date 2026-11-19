import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { Interface } from 'ethers';
import { compile, functionSelectors, POLICY_ID, REGISTRY } from '../scripts/artifact.mjs';
import { staticServer, listen } from '../scripts/static-server.mjs';

const base = new URL('../site/dist/', import.meta.url);
const fixtureAddress = '0x' + '17'.repeat(20);
const fixtureHolder = '0x' + '28'.repeat(20);
const mockRpc = 'https://fixture.tracebrake.invalid';
const artifact = compile();
const activeSiteConfig = JSON.stringify({ chainId: 56, address: fixtureAddress,
  deploymentTx: '0x' + '44'.repeat(32), registry: REGISTRY, policy: POLICY_ID, runtime: artifact.runtime,
  selectors: functionSelectors(artifact.abi), rpcUrls: [mockRpc] });

const server = staticServer(base);
const url = await listen(server);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.TRACEBRAKE_PUBLIC_URL || url);
  const check = async (id, expected) => assert.match(await page.locator('#' + id).innerText(), expected);
  await page.locator('#send-order').click();
  await check('run-badge', /冻结/);
  await page.locator('#attempt-order').click();
  await check('replay-result', /阻断/);
  await page.locator('#query-order').click();
  await check('run-badge', /核对原单/);
  await check('submit-count', /^1$/);
  await check('query-count', /^1$/);
  const download = page.waitForEvent('download');
  await page.locator('#download-log').click();
  const log = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  assert.deepEqual(log.entries.map((e) => e.type), ['SIMULATED_SUBMIT', 'TIMEOUT_UNKNOWN', 'BLOCKED_RESUBMIT', 'ORIGINAL_RECEIPT']);
  await page.locator('#reset-replay').click();
  await page.getByLabel('仍未查明').check();
  await page.locator('#send-order').click();
  await page.locator('#query-order').click();
  await check('run-badge', /人工核对/);
  await check('submit-count', /^1$/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('浏览器：两种回执、阻断重发、日志下载和手机布局通过。');

  if (process.env.TRACEBRAKE_PUBLIC_URL) console.log('公开页面匿名浏览验证通过。');
  else {
    const live = await browser.newPage();
    const liveErrors = [];
    live.on('pageerror', (e) => liveErrors.push(e.message));
    await live.route('**/chain-config.js', (route) => route.fulfill({
      contentType: 'text/javascript', body: `export default ${activeSiteConfig};`
    }));
    const iface = new Interface(artifact.abi);
    let permissions = 'none';
    let session = '0x' + 'ff'.repeat(32);
    let trafficBlocked = false;
    const now = Math.floor(Date.now() / 1000);
    await live.route(`${mockRpc}/`, async (route) => {
      if (trafficBlocked) { await route.abort(); return; }
      const { method, params } = route.request().postDataJSON();
      let result;
      if (method === 'eth_chainId') result = '0x38';
      else if (method === 'eth_getBlockByNumber') result = { number: '0x123', timestamp: '0x' + now.toString(16) };
      else if (method === 'eth_getCode') result = artifact.runtime;
      else {
        assert.equal(method, 'eth_call');
        assert.equal(iface.decodeFunctionData('permissionState', params[0].data)[0].toLowerCase(), fixtureHolder);
        const allowed = permissions !== 'none';
        result = iface.encodeFunctionResult('permissionState', [allowed ? now + 3600 : 0, now, true, allowed, session]);
      }
      await route.fulfill({ json: { id: 1, jsonrpc: '2.0', result } });
    });
    await live.goto(url);
    await live.locator('#holder').fill(fixtureHolder);
    await live.locator('#prepare-grant').click();
    const command = await live.locator('#call-command').innerText();
    assert.match(command, /--binanceChainId 56.*--value 0/);
    const args = iface.decodeFunctionData('grantDemoPermission', command.match(/--inputData (0x[0-9a-f]+)/)[1]);
    assert.equal(args[0], 3600n);
    permissions = 'another_page';
    await live.locator('#send-gated').click();
    await live.getByText('地址有权限，但未授权当前演示会话。', { exact: false }).waitFor();
    assert.equal(await live.locator('#submit-count').innerText(), '0');
    session = args[1];
    permissions = 'this_page';
    await live.locator('#send-gated').click();
    await live.getByText('当前会话权限有效', { exact: false }).waitFor();
    assert.equal(await live.locator('#submit-count').innerText(), '1');
    await live.locator('#reset-replay').click();
    await live.locator('#prepare-revoke').click();
    const revoke = await live.locator('#call-command').innerText();
    assert.equal(iface.parseTransaction({data:revoke.match(/--inputData (0x[0-9a-f]+)/)[1]}).name, 'revokeDemoPermission');
    permissions = 'none';
    await live.locator('#send-gated').click();
    await live.getByText('当前没有有效权限', { exact: false }).waitFor();
    assert.equal(await live.locator('#submit-count').innerText(), '0');
    trafficBlocked = true;
    await live.locator('#send-gated').click();
    await live.getByText('无法确认当前链上权限', { exact: false }).waitFor();
    assert.deepEqual(liveErrors, []);
    console.log('浏览器（模拟 RPC）：其他会话拒绝、本人权限启用、撤回与连接失败阻断通过。');

    const deployServer = staticServer(new URL('../release/', import.meta.url), { page: 'deploy.html' });
    const deployUrl = await listen(deployServer);
    try {
      const deployPage = await browser.newPage();
      await deployPage.addInitScript(({ holder, creation }) => {
        window.ethereum = { request: async ({ method, params }) => {
          if (method === 'eth_requestAccounts') return [holder];
          if (method === 'eth_chainId') return '0x38';
          if (method === 'eth_estimateGas') return '0x40000';
          if (method === 'eth_gasPrice') return '0x5';
          if (method === 'eth_getBalance') return '0x1000000000000000';
          sessionStorage.setItem('fake-wallet-calls', String(Number(sessionStorage.getItem('fake-wallet-calls')) + 1));
          if (method !== 'eth_sendTransaction' || params[0].value !== '0x0' || params[0].to !== undefined || params[0].data !== creation) {
            throw new Error('意外的签名请求');
          }
          throw new Error('模拟钱包回执丢失');
        }};
      }, { holder: fixtureHolder, creation: artifact.bytecode });
      await deployPage.goto(deployUrl);
      await deployPage.locator('#inspect').click();
      await deployPage.getByText('预计 Gas：约', { exact: false }).waitFor();
      assert.equal(await deployPage.evaluate(() => sessionStorage.getItem('fake-wallet-calls')), null);
      await deployPage.locator('#request').click();
      await deployPage.getByText('本页已阻止再次提交', { exact: false }).waitFor();
      await deployPage.reload();
      await deployPage.getByText('已有钱包请求的结果未明', { exact: false }).waitFor();
      assert.equal(await deployPage.locator('#request').isDisabled(), true);
      assert.equal(await deployPage.evaluate(() => sessionStorage.getItem('fake-wallet-calls')), '1');
      console.log('浏览器（模拟钱包）：估费不触发签名，未知部署状态重载后仍阻止重复提交。');
    } finally { deployServer.close(); }
  }
} finally {
  await browser.close();
  server.close();
}
