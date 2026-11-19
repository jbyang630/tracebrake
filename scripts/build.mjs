import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getAddress } from "ethers";
import { CHAIN_ID, REGISTRY, POLICY_ID, RPC_URLS, ROOT, compile, functionSelectors } from "./artifact.mjs";

const artifact = compile();
const release = new URL("release/", ROOT);
const dist = new URL("site/dist/", ROOT);
mkdirSync(release, { recursive: true });
mkdirSync(dist, { recursive: true });
let address = null;
let deploymentTx = null;
// 只有经过只读链上核验的地址才允许进入公开试玩页。
try {
  const deployment = JSON.parse(readFileSync(new URL("deployment.json", ROOT), "utf8"));
  if (deployment.chainId !== CHAIN_ID || deployment.runtimeHash !== artifact.runtimeHash ||
      !/^0x[0-9a-f]{64}$/i.test(deployment.deploymentTx)) {
    throw new Error("已记录的部署与当前编译结果不符；请重新核验，未生成公开链上配置。");
  }
  address = getAddress(deployment.contractAddress);
  deploymentTx = deployment.deploymentTx;
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const config = {
  chainId: CHAIN_ID, registry: REGISTRY, policy: POLICY_ID,
  runtime: artifact.runtime, selectors: functionSelectors(artifact.abi),
  address, deploymentTx, rpcUrls: RPC_URLS
};
const write = (base, name, value) => writeFileSync(new URL(name, base), value);
write(release, "standard-input.json", JSON.stringify(artifact.input, null, 2) + "\n");
write(release, "TraceBrake.abi.json", JSON.stringify(artifact.abi, null, 2) + "\n");
write(release, "TraceBrake.creation.hex", artifact.bytecode + "\n");
write(release, "TraceBrake.runtime.hex", artifact.runtime + "\n");
write(release, "build.json", JSON.stringify({
  compiler: artifact.compiler, chainId: CHAIN_ID, optimizerRuns: 200, evmVersion: "paris",
  source: "TraceBrake.sol:TraceBrake", constructorArguments: "0x", license: "MIT",
  registry: REGISTRY, policy: POLICY_ID, creationHash: artifact.creationHash,
  runtimeHash: artifact.runtimeHash, creationBytes: (artifact.bytecode.length - 2) / 2
}, null, 2) + "\n");
copyFileSync(new URL("contracts/TraceBrake.sol", ROOT), new URL("TraceBrake.sol", release));
write(release, "deployment-data.js", "export default " + JSON.stringify({
  chainId: CHAIN_ID, bytecode: artifact.bytecode, creationHash: artifact.creationHash,
  runtime: artifact.runtime, runtimeHash: artifact.runtimeHash, rpcUrls: RPC_URLS,
  compiler: artifact.compiler
}) + ";\n");
write(dist, "chain-config.js", "export default " + JSON.stringify(config, null, 2) + ";\n");
console.log(`已编译 ${artifact.compiler}；链上地址：${address ?? "等待部署"}。`);
