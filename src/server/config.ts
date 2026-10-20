import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadConfig() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT harus berupa integer antara 1 dan 65535.');
  return {
    port,
    host: process.env.HOST || '127.0.0.1',
    databasePath: resolve(process.env.DATABASE_PATH || 'data/runtime/cost-tracker.sqlite'),
    dataDir: resolve(process.env.DATA_DIR || 'data/input'),
    aliasesPath: resolve(process.env.PROJECT_ALIASES_PATH || 'config/project-aliases.json'),
  };
}
