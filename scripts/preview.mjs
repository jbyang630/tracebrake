import { listen, staticServer } from './static-server.mjs';
const base = new URL('../site/dist/', import.meta.url);
const server = staticServer(base);
const url = await listen(server, Number(process.argv[2] || 0));
console.log(`试玩预览：${url}`);
