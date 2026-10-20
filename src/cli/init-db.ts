import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { openDatabase } from '../db/database.js';
import { loadMasterData, readAliases } from '../db/master-data.js';
import { loadConfig } from '../server/config.js';

try {
  const { values } = parseArgs({ options: { 'data-dir': { type: 'string' } }, strict: true });
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  try {
    const result = loadMasterData(db, values['data-dir'] ? resolve(values['data-dir']) : config.dataDir, readAliases(config.aliasesPath));
    console.log(JSON.stringify({ status: 'master_ready', ...result, message: 'Master tersimpan. Transaksi biaya belum diimpor oleh perintah ini.' }, null, 2));
  } finally { db.close(); }
} catch (error) {
  console.error(`Inisialisasi gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
