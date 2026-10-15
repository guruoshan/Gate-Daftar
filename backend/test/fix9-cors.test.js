import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { resetAll } from './helpers.js';

const OLD = process.env.ALLOWED_ORIGINS;

beforeEach(() => {
  resetAll();
});

afterEach(() => {
  process.env.ALLOWED_ORIGINS = OLD;
});

describe('Fix 9: CORS uses an allowlist', () => {
  it('allows a listed origin', async () => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('refuses an unlisted origin', async () => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('origin_not_allowed');
  });

  it('allows requests with no origin header (same origin or tools)', async () => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});
