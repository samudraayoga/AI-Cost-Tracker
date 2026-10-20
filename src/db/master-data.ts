import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { Decimal } from 'decimal.js';
import { parseIdr, parseCredits, type Rates } from '../domain/money.js';
import { createProjectResolver, type Project, type ProjectAlias } from '../domain/projects.js';
import { inTransaction, type Database } from './database.js';

export function parseProjectsCsv(text: string): Project[] {
  let headers: string[] = [];
  const rows = parse(text, {
    bom: true, skip_empty_lines: true, trim: true,
    columns: (values: string[]) => { headers = values; return values; },
  }) as Record<string, string>[];
  const required = ['project_code', 'project_name', 'client', 'budget_idr'];
  if (new Set(headers).size !== headers.length || required.some(key => !headers.includes(key))) {
    throw new Error(`projects.csv membutuhkan header unik: ${required.join(', ')}.`);
  }
  if (!rows.length) throw new Error('projects.csv tidak memiliki proyek.');
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const code = row.project_code?.trim();
    const name = row.project_name?.trim();
    const client = row.client?.trim();
    if (!code || !name || !client || !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code)) {
      throw new Error(`projects.csv baris ${index + 2}: kode, nama, atau client tidak valid.`);
    }
    const canonical = code.replaceAll('-', '');
    if (seen.has(canonical)) throw new Error(`Kode proyek duplikat: ${code}.`);
    seen.add(canonical);
    const budgetIdr = parseIdr(row.budget_idr ?? '');
    if (!new Decimal(budgetIdr).gt(0)) throw new Error(`Budget ${code} harus lebih dari nol.`);
    return { code, name, client, budgetIdr };
  });
}

export function parseRatesJson(text: string): Rates {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('rates.json harus berupa object.');
  const values = raw as Record<string, unknown>;
  function rate(key: string): string {
    const value = values[key];
    if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`Kurs ${key} wajib diisi.`);
    const parsed = parseCredits(value);
    if (!new Decimal(parsed).gt(0)) throw new Error(`Kurs ${key} harus lebih dari nol.`);
    return parsed;
  }
  return { creditsToIdr: rate('credit_to_idr'), usdToIdr: rate('usd_to_idr') };
}

export function readAliases(path: string): ProjectAlias[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Konfigurasi alias harus berupa array.');
  for (const value of raw) {
    if (!value || typeof value !== 'object' || typeof value.alias !== 'string' || typeof value.projectCode !== 'string') {
      throw new Error('Setiap alias harus memiliki alias dan projectCode berupa string.');
    }
  }
  return raw as ProjectAlias[];
}

export function listProjects(db: Database): Project[] {
  return db.prepare('SELECT code, name, client, budget_idr AS budgetIdr FROM projects ORDER BY code').all() as unknown as Project[];
}

export function getRates(db: Database): Rates {
  const rows = db.prepare('SELECT key, value FROM exchange_rates').all();
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return parseRatesJson(JSON.stringify(values));
}

export function loadMasterData(db: Database, dataDir: string, aliases: ProjectAlias[]): { projectCount: number; rates: Rates } {
  const projectsText = readFileSync(join(dataDir, 'projects.csv'), 'utf8');
  const ratesText = readFileSync(join(dataDir, 'rates.json'), 'utf8');
  const projects = parseProjectsCsv(projectsText);
  const rates = parseRatesJson(ratesText);
  createProjectResolver(projects, aliases); // Fail before any write if aliases target an unknown project.
  const nextCodes = new Set(projects.map(project => project.code));
  inTransaction(db, () => {
    const removed = listProjects(db).filter(project => !nextCodes.has(project.code));
    if (removed.length) throw new Error(`Master baru menghapus proyek ${removed.map(project => project.code).join(', ')}. Perubahan ini membutuhkan migrasi eksplisit.`);
    if (Number(db.prepare('SELECT count(*) AS count FROM transactions').get()?.count) > 0) {
      const existingRates = getRates(db);
      if (existingRates.creditsToIdr !== rates.creditsToIdr || existingRates.usdToIdr !== rates.usdToIdr) {
        throw new Error('Kurs tidak dapat diubah setelah ada transaksi. Gunakan database baru atau migrasi konversi eksplisit.');
      }
    }
    const insertProject = db.prepare(`INSERT INTO projects (code, name, client, budget_idr) VALUES (?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET name = excluded.name, client = excluded.client, budget_idr = excluded.budget_idr`);
    for (const project of projects) insertProject.run(project.code, project.name, project.client, project.budgetIdr);
    const insertRate = db.prepare('INSERT INTO exchange_rates (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    insertRate.run('credit_to_idr', rates.creditsToIdr);
    insertRate.run('usd_to_idr', rates.usdToIdr);
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    db.prepare('INSERT INTO master_loads (loaded_at, projects_sha256, rates_sha256, project_count) VALUES (?, ?, ?, ?)')
      .run(new Date().toISOString(), hash(projectsText), hash(ratesText), projects.length);
  });
  return { projectCount: projects.length, rates };
}
