import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { getDb, verifyAudit } from '../src/store.js';
import { query } from '../src/db.js';
import { createOwnedSite, unlockBooth, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('Fix 10: audit has real identity and a real hash chain', () => {
  it('chains rows with full length hashes', async () => {
    const { site, cookie } = await createOwnedSite();
    await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'Ibrahim', phone: '966555000111', purpose: 'Drop' });
    const audit = (await getDb()).audit.filter((a) => a.siteId === site.id);
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit[0].prev).toBe('genesis');
    expect(audit[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit[1].prev).toBe(audit[0].hash);
    expect((await verifyAudit()).ok).toBe(true);
  });

  it('detects a tampered row', async () => {
    const { site, cookie } = await createOwnedSite();
    await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'Ibrahim', phone: '966555000111', purpose: 'Drop' });
    const rows = (await getDb()).audit.filter((a) => a.siteId === site.id);
    await query('UPDATE audit_events SET reason = $1 WHERE id = $2', ['tampered', rows[0].id]);
    const result = await verifyAudit();
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('records the booth session as the actor, not a browser supplied name', async () => {
    const { site } = await createOwnedSite();
    const requested = await request(app)
      .post(`/api/sites/${site.slug}/outpass`)
      .set('Cookie', (await unlockBooth(site.slug, site.guardPin)).cookie)
      .send({
        name: 'Ahmed',
        reason: 'Lunch',
        managerName: 'Khalid',
        managerPhone: '966500111222',
        expectedMinutes: 45,
      });
    expect(requested.status).toBe(200);
    const entryAudit = (await getDb())
      .audit.filter((a) => a.action === 'outpass_requested')
      .pop();
    expect(entryAudit.actorRole).toBe('booth');
    expect(entryAudit.actorName).toBe('Booth');
  });
});
