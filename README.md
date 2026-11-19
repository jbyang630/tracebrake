# TraceBrake｜交易 Agent 风控与审计

独立的黑客松参赛版。访客可直接回放订单响应超时；链上模式用 Agent ID 限定本人的模拟策略权限。网站和合约均没有实盘交易或代币授权功能，不需要原项目的账本、交易凭据或任何个人回执。

[公开试玩](https://tracebrake-demo.zhiqiyang621.chatgpt.site/) · [60 秒演示](https://tracebrake-demo.zhiqiyang621.chatgpt.site/demo.html) · [BscScan 验证源码](https://bscscan.com/address/0xb9CC528eF28E28295e2691Ced02d5f7c6B13976c#code)

## 本地运行

```sh
npm ci --ignore-scripts
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm run preview
```

浏览器测试使用 Playwright Chromium；测试脚本只用本机页面和模拟链上节点。公开试玩页的真实浏览器检查可通过 TRACEBRAKE_PUBLIC_URL 指向发布后的页面。

## 合约与边界

- 源码：contracts/TraceBrake.sol；MIT。正式网络为 BNB 智能链主网（56），部署时要求官方 Agent ID 合约地址上已有代码。
- Agent ID 持有者用实际调用地址为自己的随机演示会话登记权限；页面默认 1 小时，合约上限 24 小时。权限可以撤回，失去身份或到期后不可用。同一地址新的授权会替换该地址的上一项授权。
- 发起新模拟订单前，页面读取足够新的区块、核对实际运行代码，再核对地址和随机会话。撤回以后需等待链上确认；响应未知时不发起模拟订单。网站不记录或收集输入的钱包地址；链上确认地址和公开 RPC 请求属于公开链数据。
- 订单和日志均为合成数据；链上授权事件不证明真实订单成交。没有管理员、代理升级、收款或提款入口，合约部署后无法由作者修改。

## 主网部署与 BscScan

1. 普通 EVM 部署钱包在主网需要少量 BNB 支付 Gas，不要求持有 Agent ID。原交易账户、原密钥无需参与。运行 node scripts/deploy-preview.mjs 后，在安装自己钱包的浏览器中打开终端给出的本机网址，连接钱包、核对估费并由本人确认。该页只在本机运行，不随试玩站发布。
2. 交易创建合约，目标为空、转账金额为 0。部署页面会显示哈希；若签名结果未知，先看钱包历史，不要再次部署。
3. 拿到公开部署哈希后，运行 npm run check:chain -- 0x实际部署哈希 --record。程序只读两处公开主网节点，核对部署原始数据、回执、运行代码、Agent ID 及策略版本。核验后生成 deployment.json，再运行 npm run build 把真实地址写进网站配置。
4. 到 BscScan 的 Verify and Publish，选择 Solidity (Standard-Json-Input)，版本 v0.8.30+commit.73712a01，MIT，上传 release/standard-input.json。合约名 TraceBrake.sol:TraceBrake，无构造参数。以 BscScan 合约页明确展示已验证源码为准；只核对字节码不等同于源码已验证。
5. 发布带真实配置的页面，并由持有 Agent ID 的用户在自己的官方开发者环境预览和确认一笔授权，回到网页验证。再确认撤回后新模拟订单被拦。不要把匿名试玩计作链上交互。

[BscScan 源码验证说明](https://info.bscscan.com/how-to-verify-contracts/) · [Agentic Wallet 开发者模式](https://web3.binance.com/zh-CN/dev-docs/products/agentic-wallet/use-cases/developer-mode) · [比赛公告](https://www.binance.com/zh-CN/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf)
