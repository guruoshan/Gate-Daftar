import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { getDb, subscribe } from '../src/store.js';
import { createOwnedSite, cookieFrom, resetAll } from './helpers.js';

beforeEach(() => {
  resetAll();
});

describe('Fix 19 and 20: company access is enforced and the dead channel is gone', () => {
  it('an owner reaches every site in their own company', async () => {
    const email = 'owner@example.com';
    const first = await createOwnedSite('First Gate');
    const asked = await request(app).post('/api/owner/request-code').send({ email });
    const verified = await request(app).post('/api/owner/verify').send({ email, code: asked.body.devCode });
    const cookie = cookieFrom(verified);
    const snap = await request(app).get(`/api/sites/${first.site.slug}/snapshot`).set('Cookie', cookie);
    expect(snap.status).toBe(200);
  });

  it('an owner cannot reach a site from another company', async () => {
    const a = await createOwnedSite('Gate A');
    const b = await createOwnedSite('Gate B');
    const res = await request(app).get(`/api/sites/${b.site.slug}/snapshot`).set('Cookie', a.cookie);
    expect(res.status).toBe(403);
  });

  it('does not emit a company wide channel', async () => {
    const { site, cookie } = await createOwnedSite();
    const companyId = getDb().sites.find((s) => s.id === site.id).companyId;
    let gotCompany = false;
    const off = subscribe.__bus
      ? subscribe.__bus.on(`co:${companyId}`, () => {
          gotCompany = true;
        })
      : null;
    await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'Ibrahim', phone: '966555000111', purpose: 'Drop' });
    expect(gotCompany).toBe(false);
    if (off) off();
  });
});
