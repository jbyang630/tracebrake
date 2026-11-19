import { config, explorer, isAddress, encodeCall, readPermission } from './chain.js';
import { initialReplay, reduceReplay, sessionAllowed } from './replay.js';

const $ = (id) => document.getElementById(id);
const scenarios = [...document.querySelectorAll('input[name=scenario]')];
const holderInput = $('holder');
let state = initialReplay();
let session = null;
let busy = false;

function setBadge(id, label, tone = '') {
  $(id).textContent = label;
  $(id).dataset.tone = tone;
}
const results = {
  ready: ['就绪', '', '尚未发出请求。'],
  frozen: ['状态未知 · 已冻结', 'warn', '请求已发出但回执超时。现在只能查询原单或查看拦截结果。'],
  reconciled: ['已核对原单', 'good', '模拟端已受理原单。提交次数仍为 1。'],
  unclear: ['仍未知 · 请人工核对', 'warn', '模拟端未能提供确定回执。仍保持冻结，提交次数仍为 1。']
};

function render() {
  const [label, tone, message] = results[state.phase];
  const last = state.events.at(-1);
  setBadge('run-badge', label, tone);
  $('submit-count').textContent = state.submissions;
  $('query-count').textContent = state.queries;
  $('replay-result').textContent = last?.type === 'BLOCKED_RESUBMIT' ? last.message : message;
  $('send-order').disabled = busy || state.phase !== 'ready';
  $('query-order').disabled = busy || state.phase !== 'frozen';
  $('attempt-order').disabled = busy || state.phase === 'ready';
  $('reset-replay').disabled = busy;
  $('download-log').disabled = !state.events.length;
  $('send-gated').disabled = busy || !session || state.phase !== 'ready';
  for (const item of scenarios) item.disabled = busy || state.phase !== 'ready';
  for (const id of ['prepare-grant', 'prepare-revoke', 'refresh-chain', 'holder']) $(id).disabled = busy;
  const steps = { send: state.submissions > 0, freeze: state.submissions > 0, query: state.queries > 0 };
  for (const [key, done] of Object.entries(steps)) {
    const el = document.querySelector(`[data-step="${key}"]`);
    el.dataset.done = done;
    el.lastElementChild.textContent = done ? '✓' : '○';
  }
  $('journal').replaceChildren(...state.events.map((event, index) => {
    const li = document.createElement('li');
    const number = document.createElement('code');
    number.textContent = String(index + 1).padStart(2, '0');
    li.append(number, document.createTextNode(event.message));
    return li;
  }));
}

function act(type, origin = 'sample') {
  state = reduceReplay(state, { type, origin });
  render();
}
$('send-order').addEventListener('click', () => act('send'));
$('query-order').addEventListener('click', () => act('query'));
$('attempt-order').addEventListener('click', () => act('attempt'));
$('reset-replay').addEventListener('click', () => { state = initialReplay(state.scenario); render(); });
for (const item of scenarios) item.addEventListener('change', () => { state = initialReplay(item.value); render(); });
$('download-log').addEventListener('click', () => {
  const payload = {
    type: 'SYNTHETIC_TRACEBRAKE_REPLAY', policy: config.policy, scenario: state.scenario,
    requestCount: state.submissions, readOnlyQueries: state.queries, stage: state.phase,
    mode: state.origin, entries: state.events
  };
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  link.href = url;
  link.download = 'tracebrake-simulated-demo-001.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function address() {
  const value = holderInput.value.trim().toLowerCase();
  if (!isAddress(value)) throw new Error('请输入你自己的有效 Agent ID 钱包地址。');
  return value;
}
function generateSession() {
  return '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, '0')).join('');
}
function prepare(type) {
  try {
    const holder = address();
    const grant = type === 'grant';
    const duration = 3600;
    if (grant) session = { holder, id: generateSession() };
    const call = encodeCall(type, { duration, sessionId: session?.id });
    $('call-card').hidden = false;
    $('call-title').textContent = grant ? '授权当前演示会话 · 1 小时' : '撤回当前地址的演示权限';
    $('call-detail').textContent = grant
      ? '这笔调用只为当前页面生成的随机会话登记模拟权限。保留本页面，确认后回来核验。'
      : '确认此调用后，该地址的演示权限即被撤回。下次发起模拟订单前将重新核验。';
    $('call-command').textContent = `baw contract-call preview --binanceChainId 56 --from ${holder} --to ${config.address} --value 0 --inputData ${call} --json`;
    $('chain-result').textContent = '网页仅生成预览命令。请本人核对目标地址及零转账金额后确认，网络手续费以钱包显示为准。';
  } catch (error) {
    $('chain-result').textContent = error.message;
  }
  render();
}

async function check({ start = false } = {}) {
  if (busy) return;
  busy = true;
  $('chain-result').textContent = '正在核验当前链上权限…';
  render();
  try {
    const holder = address();
    const evidence = await readPermission(holder);
    const matched = session?.holder === holder && sessionAllowed(evidence, session.id);
    if (matched) {
      const time = new Date(evidence.expiry * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      $('chain-result').textContent = `当前会话权限有效，截止北京时间 ${time}。`;
      if (start && state.phase === 'ready') { act('send', 'chain_gated_simulation'); $('replay').scrollIntoView(); }
      else if (start) $('chain-result').textContent += ' 请先重置本页回放。';
    } else if (evidence.active) {
      $('chain-result').textContent = '地址有权限，但未授权当前演示会话。请生成本页授权预览。';
    } else {
      $('chain-result').textContent = evidence.held
        ? '当前没有有效权限（未授权、已到期或已撤回），不能发起新模拟订单。'
        : '这个地址未持有 Agent ID，不能登记演示权限。';
    }
  } catch (error) { $('chain-result').textContent = error.message; }
  finally { busy = false; render(); }
}

if (isAddress(config.address)) {
  setBadge('deploy-tag', '链上演示', 'good');
  setBadge('chain-badge', '合约已部署', 'good');
  $('chain-intro').textContent = '使用本人 Agentic Wallet 确认或撤回模拟权限。链上状态决定是否可开启当前会话。';
  $('contract-link').href = `${explorer}/address/${config.address}#code`;
  $('deploy-tx-link').href = `${explorer}/tx/${config.deploymentTx}`;
  $('chain-explorer').hidden = false;
  $('chain-interactions').hidden = false;
  $('prepare-grant').addEventListener('click', () => prepare('grant'));
  $('prepare-revoke').addEventListener('click', () => prepare('revoke'));
  $('check-permission').addEventListener('submit', (e) => { e.preventDefault(); void check(); });
  $('send-gated').addEventListener('click', () => void check({ start: true }));
  holderInput.addEventListener('input', () => {
    session = null;
    $('call-card').hidden = true;
    $('chain-result').textContent = '地址已变化，请重新核验。';
    render();
  });
  $('copy-call').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('call-command').textContent);
      $('chain-result').textContent = '已复制预览命令；请在自己的环境预览并确认。';
    } catch { $('chain-result').textContent = '无法使用剪贴板，可以手动复制上面的预览命令。'; }
  });
}
render();
