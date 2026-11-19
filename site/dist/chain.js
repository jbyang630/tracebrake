import config from './chain-config.js';

export const explorer = 'https://bscscan.com';
export { config };
export const isAddress = (value) => /^0x[0-9a-f]{40}$/i.test(value ?? '') && !/^0x0{40}$/i.test(value);
const word = (value) => value.toString(16).padStart(64, '0');

export function encodeCall(type, input = {}) {
  if (type === 'revoke') return config.selectors.revokeDemoPermission;
  if (type === 'permission') {
    if (!isAddress(input.holder)) throw new Error('请输入有效的 0x 钱包地址。');
    return config.selectors.permissionState + input.holder.slice(2).toLowerCase().padStart(64, '0');
  }
  if (type === 'grant' && /^0x[0-9a-f]{64}$/.test(input.sessionId ?? '') &&
      Number.isSafeInteger(input.duration) && input.duration >= 1 && input.duration <= 86400) {
    return config.selectors.grantDemoPermission + word(input.duration) + input.sessionId.slice(2);
  }
  throw new Error('无法生成这个链上调用。');
}

export async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
    credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(4800)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.error || data.result === undefined) throw new Error('公开节点暂不可用。');
  return data.result;
}

export async function readPermission(holder) {
  if (!isAddress(config.address)) throw new Error('项目合约尚未部署。');
  const data = encodeCall('permission', { holder });
  for (const url of config.rpcUrls) {
    try {
      const [id, block] = await Promise.all([rpc(url, 'eth_chainId'), rpc(url, 'eth_getBlockByNumber', ['latest', false])]);
      const when = Number(block?.timestamp);
      // 判断收回/过期必须用足够新的链上状态，不能从缓存沿用曾经的授权。
      if (Number(id) !== config.chainId || !/^0x[0-9a-f]+$/i.test(block?.number ?? '') ||
          !Number.isSafeInteger(when) || Math.abs(Date.now() / 1000 - when) > 120) continue;
      const [code, result] = await Promise.all([
        rpc(url, 'eth_getCode', [config.address, block.number]),
        rpc(url, 'eth_call', [{ to: config.address, data }, block.number])
      ]);
      if (code !== config.runtime || !/^0x[0-9a-f]{320}$/i.test(result)) continue;
      const words = result.slice(2).match(/.{64}/g);
      const [expiry, timestamp, held, allowed] = words.slice(0, 4).map((raw) => BigInt('0x' + raw));
      if (expiry > BigInt(Number.MAX_SAFE_INTEGER) || timestamp !== BigInt(when) ||
          held > 1n || allowed > 1n || (allowed === 1n) !== (held === 1n && expiry > timestamp)) continue;
      return { expiry: Number(expiry), timestamp: when, held: held === 1n, active: allowed === 1n, sessionId: '0x' + words[4].toLowerCase() };
    } catch {
      // 第一个公开节点失效时只改用备用，只读、本地禁用该次运行许可。
    }
  }
  throw new Error('无法确认当前链上权限，已阻断新的模拟订单。');
}
