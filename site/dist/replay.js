export const ORDER_ID = 'DEMO-001';

export function initialReplay(scenario = 'accepted') {
  if (!['accepted', 'unknown'].includes(scenario)) throw new Error('未知回执场景。');
  return { scenario, phase: 'ready', submissions: 0, queries: 0, events: [], origin: null };
}

// 同一回放会话的写请求只发一次，后续动作基于原编号对账。
export function reduceReplay(state, action, at = new Date().toISOString()) {
  const add = (next, ...rows) => ({
    ...state, ...next, events: [...state.events, ...rows.map(([type, message]) => ({ at, type, orderId: ORDER_ID, message }))]
  });
  switch (action.type) {
    case 'send':
      if (state.phase !== 'ready') return state;
      return add({ phase: 'frozen', submissions: 1, origin: action.origin },
        ['SIMULATED_SUBMIT', '发出了原始模拟订单 DEMO-001。'],
        ['TIMEOUT_UNKNOWN', '回执超时；订单状态未知，冻结新请求。']);
    case 'attempt':
      if (state.phase === 'ready') return state;
      return add({}, ['BLOCKED_RESUBMIT', '阻断重复提交，模拟提交数仍为 1。']);
    case 'query':
      if (state.phase !== 'frozen') return state;
      return state.scenario === 'accepted'
        ? add({ phase: 'reconciled', queries: state.queries + 1 },
          ['ORIGINAL_RECEIPT', '查询 DEMO-001：模拟端已受理。仅记录原单，不再提交。'])
        : add({ phase: 'unclear', queries: state.queries + 1 },
          ['STILL_UNKNOWN', '查询 DEMO-001：仍无确定回执，保持冻结，等待人工核对。']);
    default:
      return state;
  }
}

export function sessionAllowed(permission, expectedSession) {
  return Boolean(permission?.active && expectedSession && permission.sessionId === expectedSession);
}
