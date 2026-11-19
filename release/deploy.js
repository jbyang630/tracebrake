import data from './deployment-data.js';

const $ = (id) => document.getElementById(id);
const status = (message) => { $('result').textContent = message; };
const explorer = 'https://bscscan.com';
const provider = window.ethereum;
const storageKey = `tracebrake-deployment:${data.creationHash}`;
let estimate = null;
const existing = localStorage.getItem(storageKey);
const isHash = (value) => /^0x[0-9a-f]{64}$/i.test(value ?? '');
let signed = isHash(existing) ? existing : null;
let unresolved = existing === 'pending';
let busy = false;
$('compiler').textContent = $('version').textContent = `v${data.compiler}`;
$('creation').textContent = data.creationHash;

function controls() {
  $('inspect').disabled = busy || unresolved || Boolean(signed);
  $('request').disabled = busy || unresolved || Boolean(signed) || !estimate;
}

async function inspect() {
  if (!provider?.request) throw new Error('未检测到 EVM 浏览器钱包。请在已安装钱包扩展的浏览器打开本页。');
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const from = accounts?.[0];
  if (!/^0x[0-9a-f]{40}$/i.test(from ?? '')) throw new Error('没有已选择的部署钱包地址。');
  const network = await provider.request({ method: 'eth_chainId' });
  if (Number(network) !== data.chainId) throw new Error('请本人先在钱包中切换到 BNB 智能链主网（56）。');
  const tx = { from, value: '0x0', data: data.bytecode };
  const [gas, gasPrice, balance] = await Promise.all([
    provider.request({ method: 'eth_estimateGas', params: [tx] }),
    provider.request({ method: 'eth_gasPrice' }),
    provider.request({ method: 'eth_getBalance', params: [from, 'latest'] })
  ]);
  const fee = BigInt(gas) * BigInt(gasPrice);
  const bnb = (Number(fee) / 1e18).toPrecision(5);
  if (BigInt(balance) < fee) throw new Error(`当前部署地址的 BNB 不足以支付预计 Gas：约 ${bnb} BNB。`);
  return { tx, bnb, from };
}

async function read(method, params) {
  for (const url of data.rpcUrls) {
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(4000)
      });
      const value = response.ok && await response.json();
      if (value && !value.error && value.result !== undefined) return value.result;
    } catch {
      // 切换备用公开 RPC；查询回执绝不重新发送部署交易。
    }
  }
  throw new Error('暂时无法读取公开链上数据。');
}

async function follow(hash) {
  $('known-tx').hidden = false;
  $('tx-output').value = hash;
  status(`钱包已返回部署交易哈希：${hash}\n等待链上回执，请勿重发。`);
  for (let i = 0; i < 14; i++) {
    const receipt = await read('eth_getTransactionReceipt', [hash]);
    if (receipt) {
      if (receipt.status !== '0x1' || !receipt.contractAddress) throw new Error('链上未成功创建合约。请核对原交易回执，再决定下一步。');
      const [bytecode, actual] = await Promise.all([
        read('eth_getCode', [receipt.contractAddress, receipt.blockNumber]),
        read('eth_getTransactionByHash', [hash])
      ]);
      if (!actual || actual.to != null || actual.input !== data.bytecode || BigInt(actual.value) !== 0n || bytecode !== data.runtime) {
        throw new Error('回执与本项目的零金额部署字节码不同；请勿使用此地址提交。');
      }
      status(`链上部署已确认。\n合约地址：${receipt.contractAddress}\n部署交易哈希：${hash}\n把这条公开交易哈希发回给我，用于更新参赛页面。`);
      $('verify').hidden = false;
      $('verify-link').href = `${explorer}/verifyContract?a=${receipt.contractAddress}`;
      $('receipt-link').href = `${explorer}/tx/${hash}`;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  status(`暂未收到链上回执。\n部署交易哈希：${hash}\n请先核对 BscScan，不要重复提交。`);
}

$('inspect').addEventListener('click', async () => {
  if (busy || signed) return;
  busy = true; estimate = null; controls();
  try {
    estimate = await inspect();
    status(`部署钱包：${estimate.from}\n预计 Gas：约 ${estimate.bnb} BNB。最终费用以钱包为准。`);
  } catch (error) { status(error.message); }
  finally { busy = false; controls(); }
});
$('request').addEventListener('click', async () => {
  if (busy || unresolved || signed || !estimate) return;
  busy = true; controls();
  let requested = false;
  try {
    const current = await inspect();
    if (current.from.toLowerCase() !== estimate.from.toLowerCase()) throw new Error('部署钱包已切换，请重新估费。');
    if (localStorage.getItem(storageKey)) {
      unresolved = true;
      throw new Error('已有部署交易或请求正在等待确认，请核对已有的部署页和钱包历史。');
    }
    status('请在钱包核对合约创建、零转账金额及 Gas 后自行确认。');
    // 在调用钱包前保留未知状态，防止关闭或重载页面后无意间再提交。
    localStorage.setItem(storageKey, 'pending');
    requested = true;
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [current.tx] });
    if (!isHash(hash)) throw new Error('钱包没有返回可识别的交易哈希。');
    signed = hash;
    localStorage.setItem(storageKey, hash);
    await follow(hash);
  } catch (error) {
    estimate = null;
    if (requested && !signed) {
      unresolved = Number(error.code) !== 4001;
      if (!unresolved) localStorage.removeItem(storageKey);
    }
    status(signed ? `${error.message}\n部署交易哈希：${signed}`
      : unresolved ? `${error.message}\n钱包回执状态未知，本页已阻止再次提交。请在钱包历史寻找原部署交易。`
      : error.message);
  } finally { busy = false; controls(); }
});
controls();
$('copy-tx').addEventListener('click', async () => {
  const input = $('tx-output');
  try {
    await navigator.clipboard.writeText(input.value);
    $('copy-tx').textContent = '已复制';
  } catch {
    input.focus(); input.select();
  }
});
if (signed) follow(signed).catch((e) => status(`${e.message}\n部署交易哈希：${signed}`));
else if (unresolved) status('已有钱包请求的结果未明。请先到钱包历史查询原部署交易，不要重复部署。');
