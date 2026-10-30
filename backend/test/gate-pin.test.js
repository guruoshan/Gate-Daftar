import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { getDb } from '../src/store.js';
import { createOwnedSite, resetAll, unlockBooth } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('Per-gate PIN', () => {
  it('add-gate returns a six-digit PIN once and later reads omit it', async () => {
    const { company, cookie } = await createOwnedSite('Main Gate', { ownerEmail: 'pin@example.com' });
    const added = await request(app)
      .post(`/api/companies/${company.id}/sites`)
      .set('Cookie', cookie)
      .send({ name: 'Yard' });
    expect(added.status).toBe(200);
    expect(added.body.pin).toMatch(/^\d{6}$/);
    const stored = (await getDb()).sites.find((s) => s.slug === added.body.site.slug);
    expect(stored.guardPinHash).toMatch(/^scrypt\$/);
    const siteRead = await request(app).get(`/api/sites/${added.body.site.slug}`).set('Cookie', cookie);
    expect(JSON.stringify(siteRead.body)).not.toMatch(/guardPin/);
    const snap = await request(app).get(`/api/sites/${added.body.site.slug}/snapshot`).set('Cookie', cookie);
    expect(JSON.stringify(snap.body)).not.toMatch(/guardPin/);
  });

  it('that PIN unlocks that gate only', async () => {
    const a = await createOwnedSite('Main Gate', { ownerEmail: 'a@example.com' });
    const added = await request(app)
      .post(`/api/companies/${a.company.id}/sites`)
      .set('Cookie', a.cookie)
      .send({ name: 'Yard Gate' });
    const withSlug = await unlockBooth(a.site.slug, a.site.guardPin);
    expect(withSlug.res.status).toBe(200);
    const pinOnly = await request(app).post('/api/guard/unlock').send({ pin: a.site.guardPin });
    expect(pinOnly.status).toBe(200);
    expect(pinOnly.body.site.slug).toBe(a.site.slug);
    const second = await unlockBooth(added.body.site.slug, a.site.guardPin);
    expect(second.res.status).toBe(401);
    const yard = await unlockBooth(added.body.site.slug, added.body.pin);
    expect(yard.res.status).toBe(200);
    expect(added.body.pin).not.toBe(a.site.guardPin);
  });

  it('reset gate PIN: old fails, new works', async () => {
    const { site, cookie } = await createOwnedSite('Main Gate', { ownerEmail: 'reset@example.com' });
    const oldPin = site.guardPin;
    const reset = await request(app).post(`/api/sites/${site.slug}/pin/reset`).set('Cookie', cookie);
    expect(reset.status).toBe(200);
    expect(reset.body.pin).toMatch(/^\d{6}$/);
    expect(reset.body.pin).not.toBe(oldPin);
    const oldTry = await unlockBooth(site.slug, oldPin);
    expect(oldTry.res.status).toBe(401);
    const newTry = await unlockBooth(site.slug, reset.body.pin);
    expect(newTry.res.status).toBe(200);
  });
});
