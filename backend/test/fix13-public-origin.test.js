import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import request from 'supertest';
import { app, assertStartupConfig, originFrom } from '../src/index.js';
import { createOwnedSite, resetAll } from './helpers.js';

const OLD = { ...process.env };

beforeEach(async () => {
  await resetAll();
});

afterEach(() => {
  process.env.PUBLIC_ORIGIN = OLD.PUBLIC_ORIGIN;
  process.env.NODE_ENV = OLD.NODE_ENV;
  process.env.ALLOWED_ORIGINS = OLD.ALLOWED_ORIGINS;
});

describe('Fix 13: magic links always come from PUBLIC_ORIGIN', () => {
  it('uses PUBLIC_ORIGIN, not the request headers', async () => {
    process.env.PUBLIC_ORIGIN = 'https://gate.example.com';
    // Let the spoofed origin through the CORS allowlist so the request reaches
    // the handler; the link must still be built from PUBLIC_ORIGIN.
    process.env.ALLOWED_ORIGINS = 'https://evil.example';
    const { site, cookie } = await createOwnedSite();
    const res = await request(app)
      .post(`/api/sites/${site.slug}/outpass`)
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .send({
        name: 'Ahmed',
        reason: 'Lunch',
        managerName: 'Khalid',
        managerPhone: '966500111222',
        expectedMinutes: 45,
      });
    expect(res.status).toBe(200);
    expect(res.body.entry.pageUrl).toMatch(/^https:\/\/gate\.example\.com\/a\//);
    expect(res.body.entry.pageUrl).not.toMatch(/evil\.example/);
  });

  it('falls back to localhost only outside production', async () => {
    delete process.env.PUBLIC_ORIGIN;
    process.env.NODE_ENV = 'test';
    const fake = { headers: { host: 'localhost:3001' }, protocol: 'http', socket: {} };
    expect(originFrom(fake)).toBe('http://localhost:3001');
  });

  it('refuses to start in production without PUBLIC_ORIGIN', () => {
    delete process.env.PUBLIC_ORIGIN;
    process.env.NODE_ENV = 'production';
    expect(() => assertStartupConfig()).toThrow(/PUBLIC_ORIGIN/);
  });

  it('starts fine in production with PUBLIC_ORIGIN', () => {
    process.env.PUBLIC_ORIGIN = 'https://gate.example.com';
    process.env.NODE_ENV = 'production';
    expect(() => assertStartupConfig()).not.toThrow();
  });
});
