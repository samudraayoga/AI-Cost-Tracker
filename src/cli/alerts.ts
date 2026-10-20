import { listBudgetAlertAttempts, sendBudgetAlerts } from '../alerts/budget-alerts.js';
import { openDatabase } from '../db/database.js';
import { loadConfig } from '../server/config.js';

try {
  const command = process.argv[2] ?? 'status';
  if (!['send', 'status'].includes(command)) throw new Error(`Perintah alert tidak dikenal: ${command}. Gunakan send atau status.`);
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  try {
    if (command === 'status') {
      const attempts = listBudgetAlertAttempts(db);
      console.log(JSON.stringify({
        attempts,
        counts: {
          succeeded: attempts.filter(attempt => attempt.status === 'succeeded').length,
          failed: attempts.filter(attempt => attempt.status === 'failed').length,
          sending: attempts.filter(attempt => attempt.status === 'sending').length,
        },
      }, null, 2));
    } else {
      if (!config.webhookUrl) throw new Error('WEBHOOK_URL wajib diisi untuk mengirim alert.');
      const result = await sendBudgetAlerts(db, { webhookUrl: config.webhookUrl, timeoutMs: config.webhookTimeoutMs });
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'blocked' || result.results.some(item => item.status === 'failed')) process.exitCode = 1;
    }
  } finally { db.close(); }
} catch (error) {
  console.error(`Alert gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
