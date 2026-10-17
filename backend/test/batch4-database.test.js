import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import { app } from '../src/index.js';
import { initStore, subscribe } from '../src/store.js';
import { query, publishDelta } from '../src/db.js';
import { createSession } from '../src/sessions.js';
import { createOwnedSite, resetAll } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

beforeEach(async () => {
  await resetAll();
});

describe('Batch 4: PostgreSQL is the store of record', () => {
  it('removes the synchronous file write from the store', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/store.js'), 'utf8');
    expect(source).not.toMatch(/writeFileSync/);
    expect(source).not.toMatch(/db\.json/);
    expect(source).not.toMatch(/GATE_DAFTAR_DATA_FILE/);
  });

  it('persists a site in the database, not in memory', async () => {
    const { site } = await createOwnedSite('Persisted Gate');
    const { rows } = await query('SELECT id, slug, company_id FROM sites WHERE id = $1', [site.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe(site.slug);
    expect(rows[0].company_id).toBeTruthy();
  });

  it('stores sessions in the database so any server copy can read them', async () => {
    const { site } = await createOwnedSite();
    const session = await createSession({
      role: 'owner',
      siteId: site.id,
      companyId: site.companyId,
      name: 'Owner',
    });
    const found = await query('SELECT role, site_id FROM sessions WHERE id = $1', [session.id]);
    expect(found.rows[0].role).toBe('owner');
    expect(found.rows[0].site_id).toBe(site.id);

    const booth = await createSession({
      role: 'booth',
      siteId: site.id,
      companyId: site.companyId,
      name: 'Booth',
    });
    const device = await query('SELECT role FROM device_sessions WHERE id = $1', [booth.id]);
    expect(device.rows[0].role).toBe('booth');
  });

  it('reports the database in the health endpoint', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.database.ok).toBe(true);
  });

  it('sends a delta to other server copies through LISTEN/NOTIFY', async () => {
    await initStore();
    const siteId = 'site_cross';
    const received = new Promise((resolve) => {
      const off = subscribe(siteId, (msg) => {
        off();
        resolve(msg);
      });
    });
    await publishDelta({
      serverId: 'some-other-server',
      siteId,
      type: 'delta',
      payload: { entity: 'entry', op: 'upsert', entry: { id: 'e_1' } },
    });
    const msg = await Promise.race([
      received,
      new Promise((_, reject) => setTimeout(() => reject(new Error('no delta in 3s')), 3000)),
    ]);
    expect(msg.type).toBe('delta');
    expect(msg.payload.entry.id).toBe('e_1');
  });

  it('delivers each foreign delta exactly once', async () => {
    await initStore();
    const siteId = 'site_self';
    let hits = 0;
    const off = subscribe(siteId, () => {
      hits += 1;
    });
    await publishDelta({
      serverId: 'unknown-server',
      siteId,
      type: 'delta',
      payload: { entity: 'entry', op: 'upsert', entry: { id: 'e_2' } },
    });
    await new Promise((r) => setTimeout(r, 300));
    off();
    expect(hits).toBe(1);
  });
});
