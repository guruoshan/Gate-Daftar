import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, unlockBooth, resetAll } from './helpers.js';

beforeEach(() => {
  resetAll();
});

describe('Fix 8: the PIN is never returned in payloads', () => {
  it('create returns the PIN once and later reads do not', async () => {
    const { site, cookie } = await createOwnedSite();
    expect(site.guardPin).toMatch(/^\d{6}$/);
    const siteRead = await request(app).get(`/api/sites/${site.slug}`).set('Cookie', cookie);
    expect(JSON.stringify(siteRead.body)).not.toMatch(/guardPin/);
    const snap = await request(app).get(`/api/sites/${site.slug}/snapshot`).set('Cookie', cookie);
    expect(JSON.stringify(snap.body)).not.toMatch(/guardPin/);
  });

  it('owner can reset the PIN and sees the new one once', async () => {
    const { site, cookie } = await createOwnedSite();
    const oldPin = site.guardPin;
    const reset = await request(app).post(`/api/sites/${site.slug}/pin/reset`).set('Cookie', cookie);
    expect(reset.status).toBe(200);
    expect(reset.body.pin).toMatch(/^\d{6}$/);
    expect(reset.body.pin).not.toBe(oldPin);
    const oldTry = await request(app).post('/api/guard/unlock').send({ slug: site.slug, pin: oldPin });
    expect(oldTry.status).toBe(401);
    const newTry = await unlockBooth(site.slug, reset.body.pin);
    expect(newTry.res.status).toBe(200);
  });

  it('booth cannot reset the PIN', async () => {
    const { site } = await createOwnedSite();
    const booth = await unlockBooth(site.slug, site.guardPin);
    const reset = await request(app).post(`/api/sites/${site.slug}/pin/reset`).set('Cookie', booth.cookie);
    expect(reset.status).toBe(403);
  });
});
