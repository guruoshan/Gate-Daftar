import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { resetAll } from './helpers.js';

const OLD_ENV = process.env.NODE_ENV;

beforeEach(async () => {
  await resetAll();
  delete process.env.ALLOWED_ORIGINS;
});

afterEach(() => {
  process.env.NODE_ENV = OLD_ENV;
});

// A phone on the same Wi-Fi opens the site as http://192.168.x.x:5173. That must work
// when testing on your own PC, but never in a real (production) release.
describe('Fix 24: testing from a phone on the same Wi-Fi', () => {
  it.each(['http://192.168.0.222:5173', 'http://10.0.0.5:5173', 'http://172.20.1.9:5173'])(
    'allows %s while testing',
    async (origin) => {
      const res = await request(app).post('/api/sites').set('Origin', origin).send({ name: 'Phone Test' });
      expect(res.status).not.toBe(403);
    },
  );

  it('still refuses an ordinary website address while testing', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://evil.example');
    expect(res.status).toBe(403);
  });

  it('refuses a public-looking address that only starts with 192.168', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://192.168.0.222.evil.example');
    expect(res.status).toBe(403);
  });

  it('does not allow a local address in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app).get('/api/health').set('Origin', 'http://192.168.0.222:5173');
    expect(res.status).toBe(403);
  });
});
