import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadConfig() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT harus berupa integer antara 1 dan 65535.');
  const vendorCTimeoutMs = Number(process.env.VENDOR_C_TIMEOUT_MS ?? 10_000);
  const vendorCMaxRetries = Number(process.env.VENDOR_C_MAX_RETRIES ?? 4);
  if (!Number.isInteger(vendorCTimeoutMs) || vendorCTimeoutMs < 1) throw new Error('VENDOR_C_TIMEOUT_MS harus integer positif.');
  if (!Number.isInteger(vendorCMaxRetries) || vendorCMaxRetries < 0 || vendorCMaxRetries > 10) throw new Error('VENDOR_C_MAX_RETRIES harus integer 0–10.');
  return {
    port,
    host: process.env.HOST || '127.0.0.1',
    databasePath: resolve(process.env.DATABASE_PATH || 'data/runtime/cost-tracker.sqlite'),
    dataDir: resolve(process.env.DATA_DIR || 'data/input'),
    aliasesPath: resolve(process.env.PROJECT_ALIASES_PATH || 'config/project-aliases.json'),
    vendorCBaseUrl: process.env.VENDOR_C_BASE_URL || 'http://127.0.0.1:4010',
    vendorCApiKey: process.env.VENDOR_C_API_KEY || '',
    vendorCTimeoutMs,
    vendorCMaxRetries,
  };
}
