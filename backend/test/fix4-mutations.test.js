import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { getDb } from '../src/store.js';
import { createOwnedSite, seedRoster, unlockBooth, hasSecretKeys, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('Fix 4: mutations need a session; public gate is write-only', () => {
  it('rejects admit, exit, out, in, unapproved, add person without a session', async () => {
    const { site, cookie } = await createOwnedSite();
    const visitor = await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'Layla', phone: '966555888999', purpose: 'Parts', source: 'guard' });
    const id = visitor.body.entry.id;
    const paths = [
      ['post', `/api/entries/${id}/admit`],
      ['post', `/api/entries/${id}/exit`],
      ['post', `/api/entries/${id}/out`],
      ['post', `/api/entries/${id}/in`],
      ['post', `/api/entries/${id}/unapproved`],
      ['post', `/api/sites/${site.slug}/people`],
    ];
    for (const [method, path] of paths) {
      const res = await request(app)[method](path).send({ name: 'X', reason: 'none' });
      expect(res.status, path).toBe(401);
    }
  });

  it('booth can admit a visitor for its own site only', async () => {
    const a = await createOwnedSite('Site A');
    const b = await createOwnedSite('Site B');
    const visitor = await request(app)
      .post(`/api/sites/${a.site.slug}/visitors`)
      .set('Cookie', a.cookie)
      .send({ name: 'Majed', phone: '966555222333', purpose: 'Repair', source: 'guard' });
    const id = visitor.body.entry.id;
    const boothB = await unlockBooth(b.site.slug, b.site.guardPin);
    const stolen = await request(app).post(`/api/entries/${id}/admit`).set('Cookie', boothB.cookie);
    expect(stolen.status).toBe(403);
    const boothA = await unlockBooth(a.site.slug, a.site.guardPin);
    const ok = await request(app).post(`/api/entries/${id}/admit`).set('Cookie', boothA.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.entry.status).toBe('inside');
  });

  it('public gate writes a visitor and returns only that token, not other people', async () => {
    const { site, cookie } = await createOwnedSite();
    await request(app)
      .post(`/api/sites/${site.slug}/people`)
      .set('Cookie', cookie)
      .send({ name: 'Secret Worker', role: 'employee', phone: '966511222333' });
    const res = await request(app).post(`/api/sites/${site.slug}/gate/visitor`).send({
      name: 'Ibrahim Delivery',
      phone: '966555000111',
      company: 'Aramex',
      purpose: 'Parcel',
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.name).toBe('Ibrahim Delivery');
    expect(res.body.entry.dayToken).toBeTruthy();
    expect(res.body.entry.kind).toBe('visitor');
    expect(res.body.people).toBeUndefined();
    expect(hasSecretKeys(res.body)).toBe(false);
    const blob = JSON.stringify(res.body);
    expect(blob).not.toMatch(/Secret Worker/);
    expect(blob).not.toMatch(/966511222333/);
  });

  it('public gate writes an out-pass request and does not list the roster', async () => {
    const { site, cookie } = await createOwnedSite();
    const roster = await seedRoster(cookie, site.slug);
    const res = await request(app).post(`/api/sites/${site.slug}/gate/outpass`).send({
      personId: roster.employee.id,
      managerId: roster.manager.id,
      reason: 'Bank errand',
      expectedMinutes: 90,
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.dayToken).toBeTruthy();
    expect(res.body.entry.status).toBe('waiting_approval');
    expect(res.body.entry.magicToken).toBeUndefined();
    expect(res.body.entry.pageUrl).toBeUndefined();
    expect(res.body.people).toBeUndefined();
    expect((await getDb()).entries.some((e) => e.kind === 'outpass')).toBe(true);
  });

  it('legacy public POST /visitors and /outpass without a session are rejected', async () => {
    const { site } = await createOwnedSite();
    const v = await request(app).post(`/api/sites/${site.slug}/visitors`).send({ name: 'X', phone: '966555000111' });
    expect(v.status).toBe(401);
    const o = await request(app)
      .post(`/api/sites/${site.slug}/outpass`)
      .send({ name: 'Y', reason: 'Lunch', managerName: 'K', managerPhone: '966500111222' });
    expect(o.status).toBe(401);
  });
});
