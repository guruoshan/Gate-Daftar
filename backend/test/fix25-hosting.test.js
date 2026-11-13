import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertMailConfigured } from '../src/mailer.js';
import { app, assertStartupConfig, applyHostDefaults, shouldSeedDemo } from '../src/index.js';
import { resetAll } from './helpers.js';

let dir;
const OLD_STATIC = process.env.STATIC_DIR;

beforeEach(async () => {
  await resetAll();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-static-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Gate Daftar</title><div id="root"></div>');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  process.env.STATIC_DIR = dir;
});

afterEach(() => {
  if (OLD_STATIC === undefined) delete process.env.STATIC_DIR;
  else process.env.STATIC_DIR = OLD_STATIC;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Fix 25: one address serves the website and the server (for hosting)', () => {
  it('shows the website on the home page and on gate and approval pages', async () => {
    for (const p of ['/', '/g/gd-abc123', '/a/sometoken', '/admin/gd-abc123']) {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div id="root">');
    }
  });

  it('serves the website files', async () => {
    const res = await request(app).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('console.log');
  });

  it('keeps server answers as data, and unknown server paths are not the website', async () => {
    const ok = await request(app).get('/api/health');
    expect(ok.body.ok).toBe(true);
    const missing = await request(app).get('/api/v1/nothing-here');
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain('<div id="root">');
  });

  it('does not reveal files outside the website folder', async () => {
    fs.writeFileSync(path.join(path.dirname(dir), 'secret-gd.txt'), 'top secret');
    const res = await request(app).get('/..%2fsecret-gd.txt');
    expect(res.text).not.toContain('top secret');
    fs.rmSync(path.join(path.dirname(dir), 'secret-gd.txt'), { force: true });
  });
});

describe('Fix 25: hosted set-up', () => {
  it('a test release without email can start when on-screen codes are switched on', () => {
    const base = { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://x.onrender.com', ALLOWED_ORIGINS: 'https://x.onrender.com', SESSION_SECRET: 'abc' };
    expect(() => assertStartupConfig(base)).toThrow(/SMTP_URL/);
    expect(() => assertStartupConfig({ ...base, ALLOW_DEV_CODES: '1' })).not.toThrow();
  });

  it('takes the website address from the host when it is not set by hand', () => {
    const env = { NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://gate-abc.onrender.com/' };
    applyHostDefaults(env);
    expect(env.PUBLIC_ORIGIN).toBe('https://gate-abc.onrender.com');
    expect(env.ALLOWED_ORIGINS).toBe('https://gate-abc.onrender.com');
    const set = { PUBLIC_ORIGIN: 'https://mine.example', RENDER_EXTERNAL_URL: 'https://other.onrender.com' };
    applyHostDefaults(set);
    expect(set.PUBLIC_ORIGIN).toBe('https://mine.example');
  });

  it('does not create the demo site in a real release unless asked', () => {
    expect(shouldSeedDemo({ NODE_ENV: 'production' })).toBe(false);
    expect(shouldSeedDemo({ NODE_ENV: 'production', SEED_DEMO: '1' })).toBe(true);
    expect(shouldSeedDemo({ NODE_ENV: 'development' })).toBe(true);
  });

  it('sign-in codes can be shown on screen in a hosted test without email', () => {
    expect(() => assertMailConfigured({ NODE_ENV: 'production' })).toThrow();
    expect(() => assertMailConfigured({ NODE_ENV: 'production', ALLOW_DEV_CODES: '1' })).not.toThrow();
  });
});
