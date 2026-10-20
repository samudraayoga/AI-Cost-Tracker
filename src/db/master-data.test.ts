import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectResolver } from '../domain/projects.js';
import { openDatabase, type Database } from './database.js';
import { stageRecord } from './records.js';
import {
  getRates, listProjects, loadMasterData, parseProjectsCsv, parseRatesJson, readAliases,
} from './master-data.js';

const bundledMaster = fileURLToPath(new URL('../../data/master/', import.meta.url));
const aliasesPath = fileURLToPath(new URL('../../config/project-aliases.json', import.meta.url));
const projectsCsv = readFileSync(join(bundledMaster, 'projects.csv'), 'utf8');
const expectedRates = { creditsToIdr: '160', usdToIdr: '16250' };
const headers = 'project_code,project_name,client,budget_idr';
const tempDirectories: string[] = [];
const databases = new Set<Database>();

function fixtureDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ai-cost-master-'));
  tempDirectories.push(directory);
  for (const file of ['projects.csv', 'rates.json']) {
    copyFileSync(join(bundledMaster, file), join(directory, file));
  }
  return directory;
}

function connect(path = ':memory:'): Database {
  const db = openDatabase(path);
  databases.add(db);
  return db;
}

function close(db: Database): void {
  db.close();
  databases.delete(db);
}

function masterSnapshot(db: Database) {
  return {
    projects: listProjects(db),
    rates: db.prepare('SELECT key, value FROM exchange_rates ORDER BY key').all(),
    loads: db.prepare('SELECT * FROM master_loads ORDER BY id').all(),
  };
}

afterEach(() => {
  for (const db of databases) db.close();
  databases.clear();
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('master file validation', () => {
  it('reads all six supplied projects, including UTF-8 BOM and exact budgets', () => {
    const projects = parseProjectsCsv(`\uFEFF${projectsCsv}`);
    expect(projects).toHaveLength(6);
    expect(projects.map(project => project.code)).toEqual(['GBX-01', 'KMD-02', 'GLW-03', 'SNJ-04', 'BRK-05', 'INT-00']);
    expect(projects.find(project => project.code === 'SNJ-04')).toEqual({
      code: 'SNJ-04', name: 'Senja Resort Teaser', client: 'Senja Resort', budgetIdr: '64750000',
    });
  });

  it.each(['0', '-0', '-1', '-0,00', '-1.500,25'])(
    'rejects nonpositive project budget %s',
    (budget) => {
      expect(() => parseProjectsCsv(`${headers}\nDEMO-01,Demo,Client,"${budget}"`)).toThrow(/lebih dari nol/);
    },
  );

  it.each([
    { name: 'missing header', csv: 'project_code,project_name,budget_idr\nA-01,Name,100' },
    { name: 'duplicate header', csv: `${headers},client\nA-01,Name,Client,100,Client` },
    { name: 'empty file', csv: '' },
    { name: 'no project rows', csv: headers },
    { name: 'duplicate code', csv: `${headers}\nA-01,One,Client,100\nA-01,Two,Client,200` },
    { name: 'duplicate normalized code', csv: `${headers}\nA-01,One,Client,100\nA01,Two,Client,200` },
    { name: 'missing code', csv: `${headers}\n,Name,Client,100` },
    { name: 'invalid code', csv: `${headers}\na-01,Name,Client,100` },
    { name: 'missing name', csv: `${headers}\nA-01,,Client,100` },
    { name: 'missing client', csv: `${headers}\nA-01,Name,,100` },
    { name: 'invalid budget', csv: `${headers}\nA-01,Name,Client,not-money` },
  ])('rejects $name in project master', ({ csv }) => {
    expect(() => parseProjectsCsv(csv)).toThrow();
  });

  it('reads the supplied fixed rates and preserves explicit fractional decimal rates', () => {
    expect(parseRatesJson(readFileSync(join(bundledMaster, 'rates.json'), 'utf8'))).toEqual(expectedRates);
    expect(parseRatesJson('{"credit_to_idr":"160.00001","usd_to_idr":"16250.1234567890123456789"}')).toEqual({
      creditsToIdr: '160.00001', usdToIdr: '16250.1234567890123456789',
    });
  });

  it.each(['0', '-0', '-1', '0.000', '-0.00'])('rejects nonpositive rate %s for either currency', (value) => {
    for (const key of ['credit_to_idr', 'usd_to_idr']) {
      expect(() => parseRatesJson(JSON.stringify({ credit_to_idr: 160, usd_to_idr: 16250, [key]: value })))
        .toThrow(/lebih dari nol/);
    }
  });

  it.each([
    'not-json', 'null', '[]', '{}', '{"credit_to_idr":160}',
    '{"credit_to_idr":true,"usd_to_idr":16250}',
    '{"credit_to_idr":160,"usd_to_idr":"NaN"}',
    '{"credit_to_idr":160,"usd_to_idr":"16,250"}',
  ])('rejects malformed rates: %s', (json) => {
    expect(() => parseRatesJson(json)).toThrow();
  });

  it('reads the bundled alias configuration', () => {
    expect(readAliases(aliasesPath)).toContainEqual({ alias: 'Kopi Malam', projectCode: 'KMD-02' });
  });

  it.each(['not-json', '{}', 'null', '[null]', '[{}]', '[{"alias":"Demo","projectCode":12}]'])(
    'rejects malformed alias files: %s',
    (json) => {
      const path = join(fixtureDirectory(), 'aliases.json');
      writeFileSync(path, json);
      expect(() => readAliases(path)).toThrow();
    },
  );
});

describe('SQLite master integration', () => {
  it('persists all supplied masters across close/reopen and runs migrations once', () => {
    const dataDir = fixtureDirectory();
    const dbPath = join(dataDir, 'nested', 'tracker.sqlite');
    let db = connect(dbPath);
    expect(loadMasterData(db, dataDir, readAliases(aliasesPath))).toEqual({ projectCount: 6, rates: expectedRates });
    const before = masterSnapshot(db);
    close(db);
    db = connect(dbPath);
    expect(masterSnapshot(db)).toEqual(before);
    expect(getRates(db)).toEqual(expectedRates);
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }, { version: 2 }]);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('repeated seed leaves project/rate values unchanged and records each load with stable source hashes', () => {
    const dataDir = fixtureDirectory();
    const db = connect();
    const aliases = readAliases(aliasesPath);
    loadMasterData(db, dataDir, aliases);
    const before = masterSnapshot(db);
    loadMasterData(db, dataDir, aliases);
    const after = masterSnapshot(db);
    expect(after.projects).toEqual(before.projects);
    expect(after.rates).toEqual(before.rates);
    expect(after.loads).toHaveLength(2);
    expect(after.loads[1]).toMatchObject({
      project_count: 6,
      projects_sha256: before.loads[0]!.projects_sha256,
      rates_sha256: before.loads[0]!.rates_sha256,
    });
    expect(after.loads[0]!.projects_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(after.loads[0]!.rates_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('stores large fractional IDR budgets as exact text without floating-point conversion', () => {
    const dataDir = fixtureDirectory();
    const path = join(dataDir, 'tracker.sqlite');
    writeFileSync(join(dataDir, 'projects.csv'), `${headers}\nEXACT-01,Exact,Client,"Rp 9.007.199.254.740.993,1234567890123456789"`);
    let db = connect(path);
    loadMasterData(db, dataDir, []);
    close(db);
    db = connect(path);
    expect(listProjects(db)[0]?.budgetIdr).toBe('9007199254740993.1234567890123456789');
    expect(db.prepare('SELECT typeof(budget_idr) AS storage_type FROM projects').get()).toEqual({ storage_type: 'text' });
  });

  it.each(['not-json', '{"credit_to_idr":0,"usd_to_idr":16250}', '{"credit_to_idr":160}'])(
    'invalid rates do not change existing projects, rates, or load history: %s',
    (invalidRates) => {
      const dataDir = fixtureDirectory();
      const db = connect();
      const aliases = readAliases(aliasesPath);
      loadMasterData(db, dataDir, aliases);
      const before = masterSnapshot(db);
      writeFileSync(join(dataDir, 'projects.csv'), projectsCsv.replace('17000000', '18000000'));
      writeFileSync(join(dataDir, 'rates.json'), invalidRates);
      expect(() => loadMasterData(db, dataDir, aliases)).toThrow();
      expect(masterSnapshot(db)).toEqual(before);
    },
  );

  it.each([
    { alias: 'Invalid target', projectCode: 'UNKNOWN-01' },
    { alias: ' ', projectCode: 'GBX-01' },
  ])('invalid alias $alias prevents every master write', (alias) => {
    const dataDir = fixtureDirectory();
    const db = connect();
    loadMasterData(db, dataDir, readAliases(aliasesPath));
    const before = masterSnapshot(db);
    writeFileSync(join(dataDir, 'projects.csv'), projectsCsv.replace('17000000', '18000000'));
    writeFileSync(join(dataDir, 'rates.json'), '{"credit_to_idr":200,"usd_to_idr":17000}');
    const invalidAliasesPath = join(dataDir, 'aliases.json');
    writeFileSync(invalidAliasesPath, JSON.stringify([alias]));
    expect(() => loadMasterData(db, dataDir, readAliases(invalidAliasesPath))).toThrow();
    expect(masterSnapshot(db)).toEqual(before);
  });

  it('invalid project master does not change existing state', () => {
    const dataDir = fixtureDirectory();
    const db = connect();
    loadMasterData(db, dataDir, []);
    const before = masterSnapshot(db);
    writeFileSync(join(dataDir, 'projects.csv'), projectsCsv.replace('17000000', '-0'));
    expect(() => loadMasterData(db, dataDir, [])).toThrow(/lebih dari nol/);
    expect(masterSnapshot(db)).toEqual(before);
  });

  it('requires an explicit migration to remove an existing project', () => {
    const dataDir = fixtureDirectory();
    const db = connect();
    loadMasterData(db, dataDir, []);
    const before = masterSnapshot(db);
    writeFileSync(join(dataDir, 'projects.csv'), projectsCsv.split(/\r?\n/).filter(line => !line.startsWith('INT-00,')).join('\n'));
    expect(() => loadMasterData(db, dataDir, [])).toThrow(/INT-00.*migrasi eksplisit/);
    expect(masterSnapshot(db)).toEqual(before);
  });

  it('rejects rate changes after a transaction exists without changing masters or converted transactions', () => {
    const dataDir = fixtureDirectory();
    const db = connect();
    loadMasterData(db, dataDir, []);
    expect(stageRecord(db, {
      source: 'vendor_a', sourceRecordId: 'rate-guard-fixture', sourceFile: 'fixture.csv',
      projectLabel: 'GBX-01', vendor: 'Vendor A', amount: '2.5', timestamp: '09/01/2026 00:00',
    }, createProjectResolver(listProjects(db), []), getRates(db)).status).toBe('accepted');
    const beforeMaster = masterSnapshot(db);
    const beforeTransactions = db.prepare('SELECT * FROM transactions ORDER BY id').all();
    expect(beforeTransactions[0]).toMatchObject({ amount_idr: '400', rate_to_idr: '160' });
    writeFileSync(join(dataDir, 'projects.csv'), projectsCsv.replace('17000000', '18000000'));
    writeFileSync(join(dataDir, 'rates.json'), '{"credit_to_idr":200,"usd_to_idr":17000}');
    expect(() => loadMasterData(db, dataDir, [])).toThrow(/Kurs tidak dapat diubah setelah ada transaksi/);
    expect(masterSnapshot(db)).toEqual(beforeMaster);
    expect(db.prepare('SELECT * FROM transactions ORDER BY id').all()).toEqual(beforeTransactions);
  });

  it('rolls back project and rate updates if an error occurs midway through seeding', () => {
    const dataDir = fixtureDirectory();
    const db = connect();
    loadMasterData(db, dataDir, []);
    const before = masterSnapshot(db);
    writeFileSync(join(dataDir, 'projects.csv'), projectsCsv.replace('17000000', '18000000'));
    writeFileSync(join(dataDir, 'rates.json'), '{"credit_to_idr":200,"usd_to_idr":17000}');
    db.exec(`CREATE TRIGGER fail_usd_update BEFORE UPDATE ON exchange_rates
      WHEN NEW.key = 'usd_to_idr' BEGIN SELECT RAISE(ABORT, 'simulated database failure'); END;`);
    expect(() => loadMasterData(db, dataDir, [])).toThrow(/simulated database failure/);
    expect(masterSnapshot(db)).toEqual(before);
    db.exec('DROP TRIGGER fail_usd_update');
    expect(loadMasterData(db, dataDir, [])).toEqual({ projectCount: 6, rates: { creditsToIdr: '200', usdToIdr: '17000' } });
    expect(listProjects(db).find(project => project.code === 'GBX-01')?.budgetIdr).toBe('18000000');
    expect(masterSnapshot(db).loads).toHaveLength(2);
  });

  it('enforces transaction foreign keys and protects a referenced project from deletion', () => {
    const db = connect();
    loadMasterData(db, fixtureDirectory(), []);
    db.exec(`INSERT INTO raw_records (
      id, source, source_record_id, source_file, payload_json, payload_sha256, content_sha256, status, created_at, updated_at
    ) VALUES (1, 'vendor_a', 'fixture-txn', 'fixture.csv', '{}', 'fixture-hash', 'fixture-content-hash', 'accepted', '2026-09-01', '2026-09-01');`);
    const insert = db.prepare(`INSERT INTO transactions (
      raw_record_id, project_code, vendor, original_amount, original_unit, amount_idr, rate_to_idr,
      occurred_at_utc, occurred_at_wib, date_wib, week_start_wib, created_at
    ) VALUES (?, ?, 'Vendor A', '1', 'credits', '160', '160',
      '2026-09-01T00:00:00Z', '2026-09-01T07:00:00+07:00', '2026-09-01', '2026-08-31', '2026-09-01')`);
    expect(() => insert.run(1, 'UNKNOWN-01')).toThrow(/FOREIGN KEY/);
    expect(() => insert.run(999, 'GBX-01')).toThrow(/FOREIGN KEY/);
    insert.run(1, 'GBX-01');
    expect(() => db.prepare('DELETE FROM projects WHERE code = ?').run('GBX-01')).toThrow(/FOREIGN KEY/);
    expect(db.prepare('SELECT project_code FROM transactions').all()).toEqual([{ project_code: 'GBX-01' }]);
    expect(listProjects(db)).toHaveLength(6);
  });
});
