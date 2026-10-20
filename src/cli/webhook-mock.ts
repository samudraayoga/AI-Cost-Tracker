import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');
const port = Number(process.env.WEBHOOK_MOCK_PORT ?? 4020);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WEBHOOK_MOCK_PORT harus berupa integer antara 1 dan 65535.');
const logPath = resolve(process.env.WEBHOOK_MOCK_LOG?.trim() || 'data/runtime/webhook-received.ndjson');
mkdirSync(dirname(logPath), { recursive: true });

const server = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/webhook') {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Gunakan POST /webhook.' }));
    return;
  }
  let body = '';
  request.setEncoding('utf8');
  request.on('data', chunk => {
    body += chunk;
    if (body.length > 64 * 1024) request.destroy(new Error('Payload terlalu besar.'));
  });
  request.on('end', () => {
    try {
      const payload: unknown = JSON.parse(body);
      appendFileSync(logPath, `${JSON.stringify({ receivedAt: new Date().toISOString(), payload })}\n`, 'utf8');
      const project = payload && typeof payload === 'object' && 'project' in payload
        ? (payload as { project?: { code?: unknown } }).project?.code
        : undefined;
      console.log(`Webhook diterima${typeof project === 'string' ? ` untuk ${project}` : ''}.`);
      response.writeHead(204);
      response.end();
    } catch {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Payload harus berupa JSON valid.' }));
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock webhook siap di http://127.0.0.1:${port}/webhook`);
  console.log(`Request tersimpan di ${logPath}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
