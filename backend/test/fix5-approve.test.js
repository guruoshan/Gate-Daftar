import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { getDb } from '../src/store.js';
import { createOwnedSite, resetAll } from './helpers.js';

beforeEach(() => {
  resetAll();
});

async function makeOutpass(cookie, slug) {
  const res = await request(app)
    .post(`/api/sites/${slug}/outpass`)
    .set('Cookie', cookie)
    .send({
      name: 'Ahmed Farouk',
      reason: 'Lunch',
      managerName: 'Khalid',
      managerPhone: '966500111222',
      expectedMinutes: 45,
    });
  const stored = getDb().entries.find((e) => e.id === res.body.entry.id);
  return { res, stored };
}

describe('Fix 5: GET never approves; only a button POST does', () => {
  it('GET /api/approve/:token shows the request and does not change status', async () => {
    const { site, cookie } = await createOwnedSite();
    const { stored } = await makeOutpass(cookie, site.slug);
    expect(stored.status).toBe('waiting_approval');
    const res = await request(app).get(`/api/approve/${stored.magicToken}?d=approve`);
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('waiting_approval');
    expect(res.body.entry.name).toBe('Ahmed Farouk');
    const again = getDb().entries.find((e) => e.id === stored.id);
    expect(again.status).toBe('waiting_approval');
  });

  it('POST from the confirm buttons can approve', async () => {
    const { site, cookie } = await createOwnedSite();
    const { stored } = await makeOutpass(cookie, site.slug);
    const res = await request(app).post(`/api/approve/${stored.magicToken}`).send({ decision: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('approved_out');
  });

  it('POST from the confirm buttons can deny', async () => {
    const { site, cookie } = await createOwnedSite();
    const { stored } = await makeOutpass(cookie, site.slug);
    const res = await request(app)
      .post(`/api/approve/${stored.magicToken}`)
      .send({ decision: 'deny', denyReason: 'Not today' });
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('denied');
  });
});
