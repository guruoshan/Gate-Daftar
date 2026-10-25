import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool, stopListener } from '../src/db.js';
import { initStore, restartListener, retentionReport, verifyAudit } from '../src/store.js';
import { isServerRunning, pidPath, writePid } from '../src/boot.js';
import { createOwnedSite, resetAll } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMPORT = path.join(__dirname, '../scripts/import-db-json.mjs');
const BACKUP = path.join(__dirname, '../scripts/backup.mjs');
const RESTORE = path.join(__dirname, '../scripts/restore.mjs');
const VERIFY = path.join(__dirname, '../scripts/verify-audit.mjs');
const RETENTION = path.join(__dirname, '../scripts/retention-report.mjs');

beforeEach(async () => {
  await resetAll();
});

function fixture(file) {
  const now = new Date().toISOString();
  const data = {
    companies: [{ id: 'co_s3', name: 'Session Three Co', countryIso: 'SA', createdAt: now }],
    sites: [
      {
        id: 'site_s3',
        companyId: 'co_s3',
        slug: 'session3-gate',
        name: 'Session Three Gate',
        pack: 'warehouse',
        ownerName: 'Fake Owner',
        ownerEmail: 'fake@example.com',
        lang: 'en',
        countryIso: 'SA',
        guardPin: '654321',
        createdAt: now,
      },
    ],
    people: [],
    entries: [],
    events: [],
    audit: [
      {
        id: 'aud_s3',
        at: now,
        siteId: 'site_s3',
        companyId: 'co_s3',
        action: 'site_created',
        actorRole: 'owner',
        actorName: 'Fake',
        entryId: '',
        reason: '',
        ip: '',
        device: '',
        prev: 'genesis',
        hash: 'old',
      },
    ],
  };
  fs.writeFileSync(file, JSON.stringify(data));
}

function run(script, args = [], extraEnv = {}) {
  return execFileSync(process.execPath, [script, ...args], {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, ...extraEnv },
    encoding: 'utf8',
  });
}

describe('Session 3: import, backup, restore, audit, retention', () => {
  it('imports a synthetic file into an empty database and verifies the audit chain', async () => {
    const file = path.join(os.tmpdir(), `gate-s3-${Date.now()}.json`);
    fixture(file);
    run(IMPORT, [file]);
    const site = await query('SELECT slug, timezone FROM sites WHERE id = $1', ['site_s3']);
    expect(site.rows[0].slug).toBe('session3-gate');
    expect(site.rows[0].timezone).toBe('Asia/Riyadh');
    expect((await verifyAudit()).ok).toBe(true);
  });

  it('imports on first start when the database is empty', async () => {
    const file = path.join(os.tmpdir(), `gate-s3-boot-${Date.now()}.json`);
    fixture(file);
    process.env.GATE_DAFTAR_DATA_FILE = file;
    try {
      await initStore({ seed: true });
    } finally {
      delete process.env.GATE_DAFTAR_DATA_FILE;
    }
    const site = await query('SELECT slug FROM sites WHERE id = $1', ['site_s3']);
    expect(site.rows[0].slug).toBe('session3-gate');
  });

  it('writes a backup, refuses restore while running, then restores after stop', async () => {
    const { site } = await createOwnedSite('Backup Gate');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-bak-'));
    run(BACKUP, [], { GATE_DAFTAR_BACKUP_DIR: dir });
    const dumps = fs.readdirSync(dir).filter((n) => n.endsWith('.dump'));
    expect(dumps.length).toBe(1);
    const dumpFile = path.join(dir, dumps[0]);
    const listed = execFileSync('pg_restore', ['--list', dumpFile], { encoding: 'utf8' });
    expect(listed).toMatch(/TABLE DATA.*sites/i);

    writePid(process.pid);
    expect(isServerRunning()).toBe(true);
    let restoreStatus = 0;
    try {
      execFileSync(process.execPath, [RESTORE, dumpFile], {
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, GATE_DAFTAR_BACKUP_DIR: dir },
        encoding: 'utf8',
      });
    } catch (err) {
      restoreStatus = err.status;
    }
    expect(restoreStatus).toBe(3);
    fs.writeFileSync(pidPath(), '');
    expect(isServerRunning()).toBe(false);

    await resetAll();
    const gone = await query('SELECT id FROM sites WHERE id = $1', [site.id]);
    expect(gone.rows).toHaveLength(0);
    stopListener();
    await closePool();
    run(RESTORE, [dumpFile], { GATE_DAFTAR_BACKUP_DIR: dir });
    await restartListener();
    const found = await query('SELECT slug FROM sites WHERE id = $1', [site.id]);
    expect(found.rows[0].slug).toBe(site.slug);
  });

  it('lists old backups on prune without deleting them', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-prune-'));
    const old = path.join(dir, 'gate-daftar-20000101-000000.dump');
    fs.writeFileSync(old, 'not-a-real-dump');
    const longAgo = new Date('2000-01-01T00:00:00Z');
    fs.utimesSync(old, longAgo, longAgo);
    const out = run(BACKUP, ['--prune'], { GATE_DAFTAR_BACKUP_DIR: dir, RETENTION_DAYS: '90' });
    expect(out).toMatch(/gate-daftar-20000101-000000\.dump/);
    expect(fs.existsSync(old)).toBe(true);
  });

  it('verify-audit exits 0 on a healthy chain and 1 after tamper', async () => {
    await createOwnedSite();
    const ok = run(VERIFY);
    expect(ok).toMatch(/Audit chain ok/);
    await query("UPDATE audit_events SET reason = 'tampered' WHERE action = 'site_created'");
    let status = 0;
    try {
      run(VERIFY);
    } catch (err) {
      status = err.status;
    }
    expect(status).toBe(1);
  });

  it('retention-report counts old rows and deletes nothing', async () => {
    const { site } = await createOwnedSite();
    await query(
      `INSERT INTO entries (id, site_id, company_id, kind, status, name, created_at)
       VALUES ($1,$2,$3,'visitor','exited','Old', '2001-01-01T00:00:00Z')`,
      ['e_old_ret', site.id, site.companyId],
    );
    const report = await retentionReport(90);
    const row = report.sites.find((s) => s.siteId === site.id);
    expect(row.oldEntries).toBeGreaterThanOrEqual(1);
    const still = await query('SELECT id FROM entries WHERE id = $1', ['e_old_ret']);
    expect(still.rows).toHaveLength(1);
    const printed = run(RETENTION, ['90']);
    expect(printed).toMatch(/Nothing was deleted/);
  });
});
