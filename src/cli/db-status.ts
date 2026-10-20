import { openDatabase } from '../db/database.js';
import { getRates, listProjects } from '../db/master-data.js';
import { loadConfig } from '../server/config.js';

try {
  const db = openDatabase(loadConfig().databasePath);
  try {
    console.log(JSON.stringify({
      projects: listProjects(db), rates: getRates(db),
      transactions: db.prepare('SELECT count(*) AS count FROM transactions').get()?.count,
      needsReview: db.prepare("SELECT count(*) AS count FROM raw_records WHERE status = 'needs_review'").get()?.count,
    }, null, 2));
  } finally { db.close(); }
} catch (error) {
  console.error(`Status database gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
