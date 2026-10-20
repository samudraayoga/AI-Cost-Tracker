import { parseArgs } from 'node:util';
import type { CostSource } from '../domain/money.js';
import { createProjectResolver } from '../domain/projects.js';
import { openDatabase } from '../db/database.js';
import { getRates, listProjects, loadMasterData, readAliases } from '../db/master-data.js';
import { runImports } from '../import/runner.js';
import { loadConfig } from '../server/config.js';

const allowed = new Set<CostSource>(['vendor_a', 'vendor_b', 'vendor_c', 'manual']);

try {
  const { values } = parseArgs({ options: { source: { type: 'string', multiple: true } }, strict: true });
  const sources = values.source?.map(value => {
    if (!allowed.has(value as CostSource)) throw new Error(`Source tidak dikenal: ${value}.`);
    return value as CostSource;
  });
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  try {
    const aliases = readAliases(config.aliasesPath);
    if (!listProjects(db).length) loadMasterData(db, config.dataDir, aliases);
    const reports = await runImports(db, createProjectResolver(listProjects(db), aliases), getRates(db), {
      dataDir: config.dataDir,
      vendorC: {
        baseUrl: config.vendorCBaseUrl,
        apiKey: config.vendorCApiKey,
        timeoutMs: config.vendorCTimeoutMs,
        maxRetries: config.vendorCMaxRetries,
      },
      ...(sources ? { sources } : {}),
    });
    const succeeded = reports.every(report => report.status === 'succeeded');
    console.log(JSON.stringify({ status: succeeded ? 'complete' : 'incomplete', reports }, null, 2));
    if (!succeeded) process.exitCode = 1;
  } finally { db.close(); }
} catch (error) {
  console.error(`Import gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
