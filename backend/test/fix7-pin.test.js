import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { getDb } from '../src/store.js';
import { createOwnedSite, resetAll } from './helpers.js';

const OLD_ENV = { ...process.env };

beforeEach(async () => {
  await resetAll();
});

afterEach(async () => {
  process.env.PIN_LOCK_BASE_MS = OLD_ENV.PIN_LOCK_BASE_MS;
  process.env.PIN_LOCK_MAX_FAILURES = OLD_ENV.PIN_LOCK_MAX_FAILURES;
  await resetAll();
});

describe('Fix 7: PIN is hashed, per-site, and locks out', () => {
  it('does not store the PIN in plain text', async () => {
    const { site } = await createOwnedSite();
    const stored = (await getDb()).sites.find((s) => s.id === site.id);
    expect(stored.guardPin).toBeUndefined();
    expect(stored.guardPinHash).toMatch(/^scrypt\$/);
    expect(site.guardPin).toMatch(/^\d{6}$/);
  });

  it('issues a six digit PIN to a new gate man', async () => {
    const { site } = await createOwnedSite();
    expect(site.guardPin).toMatch(/^\d{6}$/);
  });

  it('unlock without slug works with the right PIN', async () => {
    const { site } = await createOwnedSite();
    const noSlug = await request(app).post('/api/guard/unlock').send({ pin: site.guardPin });
    expect(noSlug.status).toBe(200);
    expect(noSlug.body.site.slug).toBe(site.slug);
    const wrong = await request(app).post('/api/guard/unlock').send({ slug: site.slug, pin: '000000' });
    expect(wrong.status).toBe(401);
    const right = await request(app).post('/api/guard/unlock').send({ slug: site.slug, pin: site.guardPin });
    expect(right.status).toBe(200);
  });

  it('locks a site and IP after repeated wrong tries', async () => {
    process.env.PIN_LOCK_BASE_MS = '60000';
    process.env.PIN_LOCK_MAX_FAILURES = '5';
    const { site } = await createOwnedSite();
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).post('/api/guard/unlock').send({ slug: site.slug, pin: '111111' });
      expect([401, 429]).toContain(res.status);
    }
    const locked = await request(app).post('/api/guard/unlock').send({ slug: site.slug, pin: site.guardPin });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('locked_out');
  });
});
