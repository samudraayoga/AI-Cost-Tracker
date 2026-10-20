import { openDatabase } from '../db/database.js';
import { getRates, listProjects } from '../db/master-data.js';
import { loadConfig } from '../server/config.js';
import { Decimal } from 'decimal.js';

try {
  const db = openDatabase(loadConfig().databasePath);
  try {
    const transactions = db.prepare('SELECT amount_idr FROM transactions').all() as Array<{ amount_idr: string }>;
    console.log(JSON.stringify({
      projects: listProjects(db), rates: getRates(db),
      transactions: transactions.length,
      totalIdr: transactions.reduce((sum, row) => sum.plus(row.amount_idr), new Decimal(0)).toFixed(),
      rawRecords: db.prepare('SELECT count(*) AS count FROM raw_records').get()?.count,
      deduplicatedRecords: db.prepare('SELECT count(*) AS count FROM record_deduplications').get()?.count,
      needsReview: db.prepare("SELECT count(*) AS count FROM raw_records WHERE status = 'needs_review'").get()?.count,
      latestImportRuns: db.prepare(`SELECT source, status, records_read AS recordsRead,
        records_accepted AS accepted, records_duplicate AS duplicate, records_review AS review, error
        FROM import_runs WHERE id IN (SELECT max(id) FROM import_runs GROUP BY source) ORDER BY source`).all(),
    }, null, 2));
  } finally { db.close(); }
} catch (error) {
  console.error(`Status database gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
