import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../src/db.js';
import { verifyAudit } from '../src/store.js';
import { resetAll } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '../scripts/import-db-json.mjs');

beforeEach(async () => {
  await resetAll();
});

function fixture() {
  const now = new Date().toISOString();
  return {
    companies: [{ id: 'co_old', name: 'Old Co', countryIso: 'SA', createdAt: now }],
    sites: [
      {
        id: 'site_old',
        companyId: 'co_old',
        slug: 'old-gate',
        name: 'Old Gate',
        pack: 'warehouse-factory',
        ownerName: 'Fake Owner',
        ownerEmail: 'fake@example.com',
        lang: 'en',
        countryIso: 'SA',
        guardPin: '123456',
        createdAt: now,
      },
    ],
    // companyId deliberately missing: old files drifted, the importer must
    // derive it from the site instead of failing the foreign key.
    people: [
      { id: 'p_old', siteId: 'site_old', name: 'Fake Person', role: 'employee', phone: '966500000000', employeeId: 'E-1', active: true, createdAt: now },
    ],
    entries: [
      {
        id: 'e_old',
        siteId: 'site_old',
        companyId: 'co_old',
        kind: 'outpass',
        status: 'waiting_approval',
        name: 'Fake Worker',
        reason: 'Errand',
        managerName: 'Fake Boss',
        managerPhone: '966500111222',
        source: 'guard',
        dayToken: 'ABCD',
        magicToken: 'legacy-raw-token-value',
        createdAt: now,
        requestedAt: now,
      },
    ],
    events: [{ id: 'ev_old', siteId: 'site_old', kind: 'visitor_created', message: 'Fake event', extra: { entryId: 'e_old' }, at: now }],
    audit: [
      { id: 'aud_old1', at: now, siteId: 'site_old', companyId: 'co_old', action: 'site_created', actorRole: 'owner', actorName: 'Fake', entryId: '', reason: '', ip: '', device: '', prev: 'genesis', hash: 'cosmetic-old-hash' },
      { id: 'aud_old2', at: now, siteId: 'site_old', companyId: 'co_old', action: 'outpass_requested', actorRole: 'guard', actorName: 'Booth', entryId: 'e_old', reason: 'Errand', ip: '', device: '', prev: 'cosmetic-old-hash', hash: 'cosmetic-old-hash-2' },
    ],
  };
}

describe('Batch 4: one time import from db.json', () => {
  it('moves companies, sites, people, entries, events and audit into PostgreSQL', async () => {
    const file = path.join(os.tmpdir(), `gate-import-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(fixture()));

    execFileSync(process.execPath, [SCRIPT, file, '--force'], {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    });

    const site = await query('SELECT pack, owner_email, guard_pin_hash FROM sites WHERE id = $1', ['site_old']);
    expect(site.rows[0].pack).toBe('warehouse');
    expect(site.rows[0].owner_email).toBe('fake@example.com');
    expect(site.rows[0].guard_pin_hash).toMatch(/^scrypt\$/);

    const entry = await query('SELECT magic_token_hash FROM entries WHERE id = $1', ['e_old']);
    expect(entry.rows[0].magic_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.rows[0].magic_token_hash).not.toContain('legacy-raw-token');

    const tokens = await query('SELECT count(*)::int AS n FROM approval_tokens');
    expect(tokens.rows[0].n).toBe(1);

    const people = await query('SELECT count(*)::int AS n FROM people');
    expect(people.rows[0].n).toBe(1);
    const derived = await query('SELECT company_id FROM people WHERE id = $1', ['p_old']);
    expect(derived.rows[0].company_id).toBe('co_old');

    expect((await verifyAudit()).ok).toBe(true);
  });

  it('refuses to import into a database that already has sites without --force', async () => {
    const file = path.join(os.tmpdir(), `gate-import-guard-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(fixture()));
    execFileSync(process.execPath, [SCRIPT, file, '--force'], {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    });

    let status = 0;
    try {
      execFileSync(process.execPath, [SCRIPT, file], {
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
        stdio: 'pipe',
      });
    } catch (err) {
      status = err.status;
    }
    expect(status).toBe(2);
  });
});
