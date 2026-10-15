import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, cookieFrom, resetAll } from './helpers.js';

beforeEach(() => {
  resetAll();
});

describe('Sessions: owner login by one-time code', () => {
  it('sends a code to a known owner email and lets them sign in', async () => {
    const { site } = await createOwnedSite();
    const email = 'owner@example.com';
    const asked = await request(app).post('/api/owner/request-code').send({ email });
    expect(asked.status).toBe(200);
    expect(asked.body.ok).toBe(true);
    expect(asked.body.devCode).toMatch(/^\d{6}$/);
    const verified = await request(app).post('/api/owner/verify').send({ email, code: asked.body.devCode });
    expect(verified.status).toBe(200);
    const cookie = cookieFrom(verified);
    const snap = await request(app).get(`/api/sites/${site.slug}/snapshot`).set('Cookie', cookie);
    expect(snap.status).toBe(200);
  });

  it('does not reveal whether an email is known', async () => {
    const res = await request(app).post('/api/owner/request-code').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.devCode).toBeUndefined();
  });

  it('rejects a wrong code', async () => {
    await createOwnedSite();
    const res = await request(app).post('/api/owner/verify').send({ email: 'owner@example.com', code: '000000' });
    expect(res.status).toBe(401);
  });
});
