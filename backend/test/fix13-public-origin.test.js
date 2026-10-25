import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import request from 'supertest';
import { app, assertStartupConfig, originFrom } from '../src/index.js';
import { createOwnedSite, createOutpass, resetAll } from './helpers.js';
import { lastMail } from '../src/mailer.js';

const OLD = { ...process.env };

beforeEach(async () => {
  await resetAll();
});

afterEach(() => {
    process.env.PUBLIC_ORIGIN = OLD.PUBLIC_ORIGIN;
    process.env.NODE_ENV = OLD.NODE_ENV;
    process.env.ALLOWED_ORIGINS = OLD.ALLOWED_ORIGINS;
    process.env.SESSION_SECRET = OLD.SESSION_SECRET;
    process.env.SMTP_URL = OLD.SMTP_URL;
  });

describe('Fix 13: magic links always come from PUBLIC_ORIGIN', () => {
  it('uses PUBLIC_ORIGIN, not the request headers', async () => {
    process.env.PUBLIC_ORIGIN = 'https://gate.example.com';
    // Let the spoofed origin through the CORS allowlist so the request reaches
    // the handler; the link must still be built from PUBLIC_ORIGIN.
    process.env.ALLOWED_ORIGINS = 'https://evil.example';
    const { site, cookie } = await createOwnedSite();
    const made = await createOutpass(cookie, site.slug);
    expect(made.res.status).toBe(200);
    expect(lastMail().pageUrl).toMatch(/^https:\/\/gate\.example\.com\/a\//);
    expect(lastMail().pageUrl).not.toMatch(/evil\.example/);
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

  it('refuses to start in production without ALLOWED_ORIGINS', () => {
    process.env.PUBLIC_ORIGIN = 'https://gate.example.com';
    delete process.env.ALLOWED_ORIGINS;
    process.env.NODE_ENV = 'production';
    expect(() => assertStartupConfig()).toThrow(/ALLOWED_ORIGINS/);
  });

  it('refuses to start in production without SESSION_SECRET', () => {
    process.env.PUBLIC_ORIGIN = 'https://gate.example.com';
    process.env.ALLOWED_ORIGINS = 'https://gate.example.com';
    process.env.SMTP_URL = 'smtp://mail.example.com';
    delete process.env.SESSION_SECRET;
    process.env.NODE_ENV = 'production';
    expect(() => assertStartupConfig()).toThrow(/SESSION_SECRET/);
  });

  it('starts fine in production with PUBLIC_ORIGIN, ALLOWED_ORIGINS, SESSION_SECRET and SMTP_URL', () => {
    process.env.PUBLIC_ORIGIN = 'https://gate.example.com';
    process.env.ALLOWED_ORIGINS = 'https://gate.example.com';
    process.env.SESSION_SECRET = 'long-random-session-secret';
    process.env.SMTP_URL = 'smtp://mail.example.com';
    process.env.NODE_ENV = 'production';
    expect(() => assertStartupConfig()).not.toThrow();
  });
});
