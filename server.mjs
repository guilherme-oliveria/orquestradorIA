import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.mjs';
import { createService } from './lib/service.mjs';
import { agents } from './lib/workflow.mjs';

const host = '127.0.0.1';
const port = Number(process.env.ORQ_PORT || 47621);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use uma ORQ_PORT entre 1024 e 65535.');
const data = resolve(process.env.ORQ_DATA_DIR || fileURLToPath(new URL('./data/', import.meta.url)));
mkdirSync(data, { recursive: true });
const service = createService(createStore(resolve(data, 'workspace.sqlite')));
const staticFiles = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']]
]);
const local = new Set([host + ':' + port, 'localhost:' + port]);

function send(response, status, data, type = 'application/json') {
  response.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(type === 'application/json' ? JSON.stringify(data) : data);
}

const server = createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const origin = request.headers.origin;
  if (!local.has(request.headers.host) || (origin && origin !== 'http://' + request.headers.host)) {
    return send(response, 403, { error: 'Acesso limitado ao painel local.' });
  }
  try {
    const path = request.url.split('?', 1)[0];
    const file = staticFiles.get(path);
    if (request.method === 'GET' && file) {
      return send(response, 200, readFileSync(new URL('./public/' + file[0], import.meta.url)), file[1]);
    }
    if (request.method === 'GET' && path === '/api/workspace') {
      return send(response, 200, await service.action('workspace', {}));
    }
    if (request.method === 'POST' && (path === '/api/action' || path === '/api/mcp')) {
      if (request.headers['content-type'] !== 'application/json') return send(response, 415, { error: 'Envie JSON.' });
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 48_000) return send(response, 413, { error: 'Dados demais.' });
        chunks.push(chunk);
      }
      const { action, args, agent } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (path === '/api/mcp' && !Object.hasOwn(agents, agent)) {
        return send(response, 403, { error: 'Identidade local inválida.' });
      }
      return send(response, 200, await service.action(action, args || {}, path === '/api/mcp' ? agent : 'user'));
    }
    return send(response, 404, { error: 'Página não encontrada.' });
  } catch (error) {
    return send(response, 400, { error: error.message });
  }
});

server.listen(port, host, () => process.stdout.write('Orquestrador IA disponível em http://' + host + ':' + port + '\n'));
setInterval(() => service.refresh().catch(error => process.stderr.write(error.message + '\n')), 60_000).unref();
