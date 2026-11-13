import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, createOutpass, unlockBooth, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('Fix 3: export is owner-only and has no magic tokens', () => {
  it('rejects export when there is no session', async () => {
    const { site } = await createOwnedSite();
    const res = await request(app).get(`/api/sites/${site.slug}/export?format=csv`);
    expect(res.status).toBe(401);
  });

  it('rejects export from a booth session', async () => {
    const { site } = await createOwnedSite();
    const { cookie } = await unlockBooth(site.slug, site.guardPin);
    const res = await request(app).get(`/api/sites/${site.slug}/export?format=csv`).set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('lets the owner export their own site without magic tokens', async () => {
    const { site, cookie } = await createOwnedSite();
    await createOutpass(cookie, site.slug);
    const res = await request(app).get(`/api/sites/${site.slug}/export?format=csv`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(String(res.text)).toMatch(/Yousef Hassan/);
    expect(String(res.text)).not.toMatch(/magicToken/i);
    expect(String(res.headers['content-disposition'] || '')).toMatch(/\.csv/);
  });

  it('does not let an owner export another site', async () => {
    const a = await createOwnedSite('Gate A');
    const b = await createOwnedSite('Gate B');
    const res = await request(app).get(`/api/sites/${b.site.slug}/export?format=csv`).set('Cookie', a.cookie);
    expect(res.status).toBe(403);
  });
});
