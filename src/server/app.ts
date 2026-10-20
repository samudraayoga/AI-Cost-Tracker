import express from 'express';
import type { Database } from '../db/database.js';
import { getDashboardData } from '../db/dashboard.js';
import { listProjects } from '../db/master-data.js';

export function createApp(db: Database, webDirectory?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (_request, response) => {
    db.prepare('SELECT 1').get();
    response.json({ status: 'ok' });
  });
  app.get('/api/projects', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json({ projects: listProjects(db) });
  });
  app.get('/api/dashboard', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json(getDashboardData(db));
  });
  app.get('/api/status', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json({
      projectCount: db.prepare('SELECT count(*) AS count FROM projects').get()?.count,
      transactionCount: db.prepare('SELECT count(*) AS count FROM transactions').get()?.count,
      reviewCount: db.prepare("SELECT count(*) AS count FROM raw_records WHERE status = 'needs_review'").get()?.count,
      deduplicatedCount: db.prepare('SELECT count(*) AS count FROM record_deduplications').get()?.count,
      costImportAvailable: true,
    });
  });
  app.use('/api', (_request, response) => { response.status(404).json({ error: 'Endpoint tidak ditemukan.' }); });
  if (webDirectory) app.use(express.static(webDirectory));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error('Request gagal:', error instanceof Error ? error.message : 'unknown error');
    response.status(500).json({ error: 'Data belum dapat dibaca. Periksa log server.' });
  });
  return app;
}
