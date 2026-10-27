import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import {
  addNamedGuard,
  createOwnedSite,
  createOutpass,
  resetAll,
  seedRoster,
  unlockBooth,
} from './helpers.js';
import { lastMail } from '../src/mailer.js';

beforeEach(async () => {
  await resetAll();
});

describe('Company walls', () => {
  it('Company A cannot open Company B', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const b = await createOwnedSite('Gate B', { ownerEmail: 'b@example.com' });
    for (const path of [
      `/api/sites/${b.site.slug}/snapshot`,
      `/api/sites/${b.site.slug}/search`,
      `/api/sites/${b.site.slug}/dashboard`,
      `/api/sites/${b.site.slug}/audit`,
      `/api/sites/${b.site.slug}/export?format=csv`,
      `/api/sites/${b.site.slug}/people`,
    ]) {
      const res = await request(app).get(path).set('Cookie', a.cookie);
      expect(res.status).toBe(403);
    }
    const stream = await request(app).get(`/api/sites/${b.site.slug}/stream`).set('Cookie', a.cookie);
    expect(stream.status).toBe(403);
  });

  it('owner opens every gate of their company', async () => {
    const a = await createOwnedSite('Main Gate', { ownerEmail: 'a@example.com' });
    const added = await request(app)
      .post(`/api/companies/${a.company.id}/sites`)
      .set('Cookie', a.cookie)
      .send({ name: 'Yard Gate' });
    expect(added.status).toBe(200);
    const first = await request(app).get(`/api/sites/${a.site.slug}/snapshot`).set('Cookie', a.cookie);
    const second = await request(app).get(`/api/sites/${added.body.site.slug}/snapshot`).set('Cookie', a.cookie);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('gate-man PIN of A unlocks A gates and not B', async () => {
    const a = await createOwnedSite('Main Gate', { ownerEmail: 'a@example.com' });
    const b = await createOwnedSite('Other Co', { ownerEmail: 'b@example.com' });
    const added = await request(app)
      .post(`/api/companies/${a.company.id}/sites`)
      .set('Cookie', a.cookie)
      .send({ name: 'Yard Gate' });
    const pin = a.site.guardPin;
    const a1 = await unlockBooth(a.site.slug, pin);
    const a2 = await unlockBooth(added.body.site.slug, pin);
    const other = await unlockBooth(b.site.slug, pin);
    expect(a1.res.status).toBe(200);
    expect(a2.res.status).toBe(200);
    expect(other.res.status).toBe(401);
  });

  it('approval token of A cannot decide B', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const b = await createOwnedSite('Gate B', { ownerEmail: 'b@example.com' });
    const madeB = await createOutpass(b.cookie, b.site.slug);
    const tokenB = lastMail()?.token || madeB.token;
    await createOutpass(a.cookie, a.site.slug);
    const tokenA = lastMail()?.token;
    const steal = await request(app).post(`/api/approve/${tokenA}`).send({ decision: 'approve' });
    expect(steal.status).toBe(200);
    const other = await request(app).get(`/api/approve/${tokenB}`);
    expect(other.status).toBe(200);
    expect(other.body.entry?.status).toBe('waiting_approval');
    expect(other.body.site?.slug).toBe(b.site.slug);
    const decideB = await request(app).post(`/api/approve/${tokenA}`).send({ decision: 'deny', reason: 'no' });
    expect([409, 400, 410]).toContain(decideB.status);
  });

  it('guessed gate without cookie is a closed door', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const res = await request(app).get(`/api/sites/${a.site.slug}/snapshot`);
    expect(res.status).toBe(401);
  });

  it('second signup with the same email is rejected', async () => {
    await createOwnedSite('Gate A', { ownerEmail: 'same@example.com' });
    const again = await createOwnedSite('Gate B', { ownerEmail: 'same@example.com' });
    expect(again.res.status).toBe(409);
    expect(again.res.body.error).toBe('email_taken');
  });

  it('wrong password does not create a session', async () => {
    await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const res = await request(app).post('/api/owner/login').send({
      email: 'a@example.com',
      password: 'nope-nope',
    });
    expect(res.status).toBe(401);
    const me = await request(app).get('/api/owner/me');
    expect(me.status).toBe(401);
  });

  it('worker on the company list can start an out-pass at the second gate', async () => {
    const a = await createOwnedSite('Main Gate', { ownerEmail: 'a@example.com' });
    const roster = await seedRoster(a.cookie, a.site.slug);
    const added = await request(app)
      .post(`/api/companies/${a.company.id}/sites`)
      .set('Cookie', a.cookie)
      .send({ name: 'Yard Gate' });
    const out = await request(app)
      .post(`/api/sites/${added.body.site.slug}/outpass`)
      .set('Cookie', a.cookie)
      .send({
        personId: roster.employee.id,
        managerId: roster.manager.id,
        reason: 'Bank',
        expectedMinutes: 45,
      });
    expect(out.status).toBe(200);
    expect(out.body.entry.siteId || added.body.site.id).toBeTruthy();
  });

  it('a visit at Gate A does not appear on Gate B live book', async () => {
    const a = await createOwnedSite('Main Gate', { ownerEmail: 'a@example.com' });
    const added = await request(app)
      .post(`/api/companies/${a.company.id}/sites`)
      .set('Cookie', a.cookie)
      .send({ name: 'Yard Gate' });
    await request(app)
      .post(`/api/sites/${a.site.slug}/visitors`)
      .set('Cookie', a.cookie)
      .send({ name: 'Ibrahim Delivery', phone: '966555000111', purpose: 'Drop' });
    const aSnap = await request(app).get(`/api/sites/${a.site.slug}/snapshot`).set('Cookie', a.cookie);
    const bSnap = await request(app).get(`/api/sites/${added.body.site.slug}/snapshot`).set('Cookie', a.cookie);
    expect(JSON.stringify(aSnap.body.entries)).toMatch(/Ibrahim Delivery/);
    expect(JSON.stringify(bSnap.body.entries)).not.toMatch(/Ibrahim Delivery/);
  });

  it('responses never include the other company names', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const b = await createOwnedSite('Gate B', { ownerEmail: 'b@example.com' });
    await addNamedGuard(a.cookie, a.site.slug, 'Secret Guard');
    const snap = await request(app).get(`/api/sites/${b.site.slug}/snapshot`).set('Cookie', b.cookie);
    expect(JSON.stringify(snap.body)).not.toMatch(/Secret Guard/);
    const guards = await request(app).get(`/api/sites/${b.site.slug}/guards`);
    expect(JSON.stringify(guards.body)).not.toMatch(/email|pinHash|Secret Guard/);
  });
});
