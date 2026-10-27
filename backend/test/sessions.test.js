import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, cookieFrom, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('Sessions: owner login by password', () => {
  it('logs in with email and password and lists sites', async () => {
    const { site, password, email } = await createOwnedSite();
    const logged = await request(app).post('/api/owner/login').send({
      email,
      password,
    });
    expect(logged.status).toBe(200);
    const cookie = cookieFrom(logged);
    const me = await request(app).get('/api/owner/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.sites.some((s) => s.slug === site.slug)).toBe(true);
    const snap = await request(app).get(`/api/sites/${site.slug}/snapshot`).set('Cookie', cookie);
    expect(snap.status).toBe(200);
  });

  it('rejects a wrong password without a session', async () => {
    const { email } = await createOwnedSite();
    const res = await request(app).post('/api/owner/login').send({
      email,
      password: 'wrongpass',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('bad_login');
    expect(cookieFrom(res)).toBe('');
  });

  it('uses the same error for an unknown email', async () => {
    const res = await request(app).post('/api/owner/login').send({
      email: 'nobody@example.com',
      password: 'password1',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('bad_login');
    expect(res.body.devCode).toBeUndefined();
  });

  it('logout then snapshot is closed', async () => {
    const { site, cookie } = await createOwnedSite();
    const out = await request(app).post('/api/owner/logout').set('Cookie', cookie);
    expect(out.status).toBe(200);
    const snap = await request(app).get(`/api/sites/${site.slug}/snapshot`).set('Cookie', cookie);
    expect(snap.status).toBe(401);
  });
});
