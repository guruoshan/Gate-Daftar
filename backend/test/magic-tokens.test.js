import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { getDb } from '../src/store.js';
import { query } from '../src/db.js';
import { createOwnedSite, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

async function makeOutpass(cookie, slug) {
  const res = await request(app)
    .post(`/api/sites/${slug}/outpass`)
    .set('Cookie', cookie)
    .send({
      name: 'Ahmed',
      reason: 'Lunch',
      managerName: 'Khalid',
      managerPhone: '966500111222',
      expectedMinutes: 45,
    });
  const stored = (await getDb()).entries.find((e) => e.id === res.body.entry.id);
  return { raw: res.body.entry.pageUrl.split('/').pop(), stored };
}

describe('Magic tokens: hashed, expiring, single use, bound to the pass', () => {
  it('stores only a hash, never the raw token', async () => {
    const { site, cookie } = await createOwnedSite();
    const { raw, stored } = await makeOutpass(cookie, site.slug);
    expect(raw).toBeTruthy();
    expect(stored.magicToken).toBeUndefined();
    expect(stored.magicTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.magicTokenHash).not.toBe(raw);
  });

  it('works once and then refuses reuse', async () => {
    const { site, cookie } = await createOwnedSite();
    const { raw } = await makeOutpass(cookie, site.slug);
    const first = await request(app).post(`/api/approve/${raw}`).send({ decision: 'approve' });
    expect(first.status).toBe(200);
    const again = await request(app).post(`/api/approve/${raw}`).send({ decision: 'approve' });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('already_decided');
  });

  it('refuses a wrong token', async () => {
    const { site, cookie } = await createOwnedSite();
    await makeOutpass(cookie, site.slug);
    const res = await request(app).get('/api/approve/not-a-real-token');
    expect(res.status).toBe(404);
  });

  it('refuses an expired token', async () => {
    const { site, cookie } = await createOwnedSite();
    const { raw, stored } = await makeOutpass(cookie, site.slug);
    await query('UPDATE entries SET magic_token_expires_at = $1 WHERE id = $2', [
      new Date(Date.now() - 1000).toISOString(),
      stored.id,
    ]);
    const res = await request(app).get(`/api/approve/${raw}`);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('token_expired');
  });

  it('sets a twelve hour expiry', async () => {
    const { site, cookie } = await createOwnedSite();
    const { stored } = await makeOutpass(cookie, site.slug);
    const ttl = new Date(stored.magicTokenExpiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(11 * 60 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(12 * 60 * 60 * 1000 + 5000);
  });
});
