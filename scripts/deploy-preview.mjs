import { listen, staticServer } from './static-server.mjs';
const server = staticServer(new URL('../release/', import.meta.url), {
  page: 'deploy.html',
  allowOnly: ['deploy.html', 'deploy.css', 'deploy.js', 'deployment-data.js', 'standard-input.json']
});
const url = await listen(server, Number(process.argv[2] || 0));
console.log(`本机部署确认页：${url}`);
