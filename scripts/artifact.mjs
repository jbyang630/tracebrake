import { readFileSync } from "node:fs";
import { Interface, id, keccak256 } from "ethers";
import solc from "solc";

export const ROOT = new URL("../", import.meta.url);
export const CHAIN_ID = 56;
export const REGISTRY = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";
export const POLICY_TEXT = "TraceBrake/v1:btc-demo:freeze-on-timeout:reconcile-original:no-resubmit";
export const POLICY_ID = id(POLICY_TEXT);
export const RPC_URLS = [
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed-public.bnbchain.org"
];
export const SOURCE_NAME = "TraceBrake.sol";
export const CONTRACT_NAME = "TraceBrake";

export function compile() {
  const source = readFileSync(new URL("contracts/TraceBrake.sol", ROOT), "utf8");
  const input = {
    language: "Solidity",
    sources: { [SOURCE_NAME]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const { abi, evm } = output.contracts[SOURCE_NAME][CONTRACT_NAME];
  const bytecode = "0x" + evm.bytecode.object;
  const runtime = "0x" + evm.deployedBytecode.object;
  return {
    source, input, compiler: solc.version().split(".Emscripten")[0], abi, bytecode, runtime,
    creationHash: keccak256(bytecode), runtimeHash: keccak256(runtime)
  };
}

export function functionSelectors(abi) {
  const iface = new Interface(abi);
  return Object.fromEntries(
    ["permissionState", "grantDemoPermission", "revokeDemoPermission"]
      .map((name) => [name, iface.getFunction(name).selector])
  );
}

export async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(6500)
  });
  if (!response.ok) throw new Error(`RPC 请求失败：HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error || payload.result === undefined) {
    throw new Error(`RPC ${method} 无有效结果（${payload.error?.code ?? "unknown"}）`);
  }
  return payload.result;
}
