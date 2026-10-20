import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

const migrations = [{ version: 1, sql: `
  CREATE TABLE projects (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    client TEXT NOT NULL,
    budget_idr TEXT NOT NULL
  ) STRICT;
  CREATE TABLE exchange_rates (
    key TEXT PRIMARY KEY CHECK(key IN ('credit_to_idr', 'usd_to_idr')),
    value TEXT NOT NULL
  ) STRICT;
  CREATE TABLE master_loads (
    id INTEGER PRIMARY KEY,
    loaded_at TEXT NOT NULL,
    projects_sha256 TEXT NOT NULL,
    rates_sha256 TEXT NOT NULL,
    project_count INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE import_runs (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL CHECK(source IN ('vendor_a','vendor_b','vendor_c','manual')),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('running','succeeded','partial','failed')),
    records_read INTEGER NOT NULL DEFAULT 0 CHECK(records_read >= 0),
    records_accepted INTEGER NOT NULL DEFAULT 0 CHECK(records_accepted >= 0),
    records_duplicate INTEGER NOT NULL DEFAULT 0 CHECK(records_duplicate >= 0),
    records_review INTEGER NOT NULL DEFAULT 0 CHECK(records_review >= 0),
    error TEXT
  ) STRICT;
  CREATE TABLE raw_records (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL CHECK(source IN ('vendor_a','vendor_b','vendor_c','manual')),
    source_record_id TEXT NOT NULL,
    source_file TEXT NOT NULL,
    source_row INTEGER CHECK(source_row IS NULL OR source_row > 0),
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    payload_sha256 TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('accepted','needs_review')),
    review_reason TEXT,
    review_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source, source_record_id)
  ) STRICT;
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    raw_record_id INTEGER NOT NULL UNIQUE REFERENCES raw_records(id),
    project_code TEXT NOT NULL REFERENCES projects(code),
    vendor TEXT NOT NULL,
    original_amount TEXT NOT NULL,
    original_unit TEXT NOT NULL CHECK(original_unit IN ('credits','USD','USD_cents','IDR')),
    amount_idr TEXT NOT NULL,
    rate_to_idr TEXT NOT NULL,
    occurred_at_utc TEXT NOT NULL,
    occurred_at_wib TEXT NOT NULL,
    date_wib TEXT NOT NULL,
    week_start_wib TEXT NOT NULL,
    reference TEXT,
    refund_of_source_id TEXT,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX transactions_project_date ON transactions(project_code, date_wib);
  CREATE INDEX raw_records_review ON raw_records(status);
` }, { version: 2, sql: `
  CREATE TABLE record_deduplications (
    raw_record_id INTEGER PRIMARY KEY REFERENCES raw_records(id),
    canonical_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
    reason TEXT NOT NULL CHECK(reason IN (
      'same_source_id',
      'manual_invoice',
      'manual_vendor_a_ref',
      'manual_vendor_a_match'
    )),
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX record_deduplications_canonical ON record_deduplications(canonical_transaction_id);
` }];

export function inTransaction<T>(db: Database, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;');
    for (const migration of migrations) {
      inTransaction(db, () => {
        if (db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version)) return;
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString());
      });
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
