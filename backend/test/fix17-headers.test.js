import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('Fix 17: security headers, body limits, connection cap', () => {
  it('sets a content security policy and other hardening headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-security-policy']).toBeTruthy();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBeTruthy();
    expect(res.headers['x-frame-options'] || res.headers['content-security-policy']).toMatch(/frame-ancestors|DENY|SAMEORIGIN/i);
  });

  it('rejects an oversized body', async () => {
    const huge = 'x'.repeat(300 * 1024);
    const res = await request(app).post('/api/sites').send({ name: huge });
    expect([400, 413]).toContain(res.status);
  });
});
