import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/db.js';
import { lastMail, resetMail } from '../src/mailer.js';
import { cookieFrom, createOwnedSite, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
  resetMail();
});

describe('Forgot password', () => {
  it('known email is 200 without token in JSON and mails a link', async () => {
    const { email } = await createOwnedSite('Main Gate', { ownerEmail: 'known@example.com' });
    const before = lastMail();
    const res = await request(app).post('/api/owner/forgot').send({ email });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.body.token).toBeUndefined();
    expect(lastMail()).not.toBe(before);
    expect(lastMail().kind).toBe('password_reset');
    expect(lastMail().token).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(lastMail().token);
  });

  it('unknown email is 200 with the same body and no extra mail', async () => {
    const res = await request(app).post('/api/owner/forgot').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(lastMail()).toBeNull();
  });

  it('reset works once then refuses reuse; expired is refused', async () => {
    const { email } = await createOwnedSite('Main Gate', { ownerEmail: 'once@example.com' });
    await request(app).post('/api/owner/forgot').send({ email });
    const token = lastMail().token;
    const ok = await request(app)
      .post(`/api/owner/reset/${token}`)
      .send({ password: 'password2', confirm: 'password2' });
    expect(ok.status).toBe(200);
    const again = await request(app)
      .post(`/api/owner/reset/${token}`)
      .send({ password: 'password3', confirm: 'password3' });
    expect(again.status).toBe(410);
    await request(app).post('/api/owner/forgot').send({ email });
    const second = lastMail().token;
    await query('UPDATE password_reset_requests SET expires_at = $1 WHERE magic_token_hash IS NOT NULL', [
      new Date(Date.now() - 1000).toISOString(),
    ]);
    const expired = await request(app)
      .post(`/api/owner/reset/${second}`)
      .send({ password: 'password4', confirm: 'password4' });
    expect(expired.status).toBe(410);
  });

  it('short password is refused; old login fails and new login works', async () => {
    const { email, password } = await createOwnedSite('Main Gate', { ownerEmail: 'login@example.com' });
    await request(app).post('/api/owner/forgot').send({ email });
    const token = lastMail().token;
    const short = await request(app)
      .post(`/api/owner/reset/${token}`)
      .send({ password: 'short', confirm: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error).toBe('password_short');
    const mismatch = await request(app)
      .post(`/api/owner/reset/${token}`)
      .send({ password: 'password2', confirm: 'password3' });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toBe('password_mismatch');
    const ok = await request(app)
      .post(`/api/owner/reset/${token}`)
      .send({ password: 'password2', confirm: 'password2' });
    expect(ok.status).toBe(200);
    const oldLogin = await request(app).post('/api/owner/login').send({ email, password });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/owner/login').send({ email, password: 'password2' });
    expect(newLogin.status).toBe(200);
    expect(cookieFrom(newLogin)).toBeTruthy();
  });
});
