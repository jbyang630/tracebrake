import { existsSync, writeFileSync } from "node:fs";
import { getAddress, Interface } from "ethers";
import { CHAIN_ID, REGISTRY, POLICY_ID, RPC_URLS, ROOT, compile, rpc } from "./artifact.mjs";

try {
  const hash = process.argv[2];
  const record = process.argv.includes("--record");
  if (!/^0x[0-9a-f]{64}$/i.test(hash ?? "")) {
    throw new Error("用法：npm run check:chain -- 0x部署交易哈希 [--record]");
  }
  const a = compile();
  const iface = new Interface(a.abi);
  const urls = RPC_URLS;
  // 部分公开节点已裁剪部署时的历史状态。两节点在同一个近期区块核对现存代码与策略，部署原文仍逐字节核对。
  const tips = await Promise.all(urls.map((url) => rpc(url, "eth_blockNumber")));
  const stateHeight = Math.min(...tips.map(Number)) - 2;
  const stateTag = "0x" + stateHeight.toString(16);
  const reports = await Promise.all(urls.map(async (url) => {
    const [chain, tx, receipt] = await Promise.all([
      rpc(url, "eth_chainId"),
      rpc(url, "eth_getTransactionByHash", [hash]),
      rpc(url, "eth_getTransactionReceipt", [hash])
    ]);
    if (Number(chain) !== CHAIN_ID || !tx || !receipt || receipt.status !== "0x1" ||
        tx.to != null || (tx.hash ?? "").toLowerCase() !== hash.toLowerCase() ||
        (tx.input ?? "").toLowerCase() !== a.bytecode || BigInt(tx.value) !== 0n ||
        !receipt.contractAddress) {
      throw new Error("没有成功的零金额合约创建回执，或链上部署数据与本项目不同。");
    }
    const address = getAddress(receipt.contractAddress);
    const [code, registry, policy, stateBlock] = await Promise.all([
      rpc(url, "eth_getCode", [address, stateTag]),
      rpc(url, "eth_call", [{ to: address, data: iface.encodeFunctionData("AGENT_ID") }, stateTag]),
      rpc(url, "eth_call", [{ to: address, data: iface.encodeFunctionData("POLICY_ID") }, stateTag]),
      rpc(url, "eth_getBlockByNumber", [stateTag, false])
    ]);
    if (code.toLowerCase() !== a.runtime ||
        iface.decodeFunctionResult("AGENT_ID", registry)[0].toLowerCase() !== REGISTRY ||
        iface.decodeFunctionResult("POLICY_ID", policy)[0] !== POLICY_ID ||
        Number(receipt.blockNumber) > stateHeight || !stateBlock?.hash || Number(stateBlock.number) !== stateHeight) {
      throw new Error("运行代码、官方身份合约、策略版本或确认数尚未通过核验。");
    }
    return {
      chainId: CHAIN_ID, contractAddress: address, deploymentTx: hash.toLowerCase(),
      block: Number(receipt.blockNumber), blockHash: receipt.blockHash,
      verifiedAtBlock: stateHeight, verifiedAtBlockHash: stateBlock.hash,
      runtimeHash: a.runtimeHash, creationHash: a.creationHash
    };
  }));
  if (JSON.stringify(reports[0]) !== JSON.stringify(reports[1])) {
    throw new Error("两个 RPC 对应的主网回执不一致。");
  }
  const data = reports[0];
  console.log(JSON.stringify({
    ...data, sourceVerifiedOnBscScan: "需要检查 BscScan 源码页",
    explorer: `https://bscscan.com/address/${data.contractAddress}#code`,
    explorerVerification: `https://bscscan.com/verifyContract?a=${data.contractAddress}`
  }, null, 2));
  if (record) {
    const destination = new URL("deployment.json", ROOT);
    if (existsSync(destination)) throw new Error("已有部署记录；本命令不会覆盖。");
    writeFileSync(destination, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
    console.log("已记录部署回执；运行 npm run build 更新公开试玩页。");
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
