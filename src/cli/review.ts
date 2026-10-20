import { openDatabase } from '../db/database.js';
import { getRates, listProjects, readAliases } from '../db/master-data.js';
import { listReviewRecords, retryReviewRecords } from '../db/records.js';
import { createProjectResolver } from '../domain/projects.js';
import { loadConfig } from '../server/config.js';

try {
  const command = process.argv[2];
  if (!['list', 'retry'].includes(command ?? '') || process.argv.length > 3) throw new Error('Gunakan review:list atau review:retry.');
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  try {
    const results = command === 'list' ? listReviewRecords(db) : retryReviewRecords(db,
      createProjectResolver(listProjects(db), readAliases(config.aliasesPath)), getRates(db));
    console.log(JSON.stringify({ command, count: results.length, records: results }, null, 2));
  } finally { db.close(); }
} catch (error) {
  console.error(`Peninjauan gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
