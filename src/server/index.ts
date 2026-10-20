import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { openDatabase } from '../db/database.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const webDirectory = resolve('dist/web');
const server = createServer(createApp(db, existsSync(webDirectory) ? webDirectory : undefined))
  .listen(config.port, config.host, () => console.log(`API siap di http://${config.host}:${config.port}`));

server.on('error', error => {
  console.error(`Server gagal dimulai: ${error.message}`);
  db.close();
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { server.close(() => { db.close(); process.exit(0); }); });
}
