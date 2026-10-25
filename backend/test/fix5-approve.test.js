import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { getDb } from '../src/store.js';
import { createOwnedSite, createOutpass, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

async function makeOutpass(cookie, slug) {
  const made = await createOutpass(cookie, slug);
  const stored = (await getDb()).entries.find((e) => e.id === made.entry.id);
  return { res: made.res, stored, token: made.token };
}

describe('Fix 5: GET never approves; only a button POST does', () => {
  it('GET /api/approve/:token shows the request and does not change status', async () => {
    const { site, cookie } = await createOwnedSite();
    const { stored, token } = await makeOutpass(cookie, site.slug);
    expect(stored.status).toBe('waiting_approval');
    const res = await request(app).get(`/api/approve/${token}?d=approve`);
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('waiting_approval');
    expect(res.body.entry.name).toBe('Yousef Hassan');
    const again = (await getDb()).entries.find((e) => e.id === stored.id);
    expect(again.status).toBe('waiting_approval');
  });

  it('POST from the confirm buttons can approve', async () => {
    const { site, cookie } = await createOwnedSite();
    const { token } = await makeOutpass(cookie, site.slug);
    const res = await request(app).post(`/api/approve/${token}`).send({ decision: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('approved_out');
  });

  it('POST from the confirm buttons can deny', async () => {
    const { site, cookie } = await createOwnedSite();
    const { token } = await makeOutpass(cookie, site.slug);
    const res = await request(app)
      .post(`/api/approve/${token}`)
      .send({ decision: 'deny', denyReason: 'Not today' });
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('denied');
  });

  it('approving twice returns the same result', async () => {
    const { site, cookie } = await createOwnedSite();
    const { token } = await makeOutpass(cookie, site.slug);
    const first = await request(app).post(`/api/approve/${token}`).send({ decision: 'approve' });
    const second = await request(app).post(`/api/approve/${token}`).send({ decision: 'approve' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.entry.status).toBe('approved_out');
  });
});
