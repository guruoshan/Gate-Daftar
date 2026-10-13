import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { resetAll } from './helpers.js';

beforeEach(() => {
  resetAll();
});

describe('health', () => {
  it('answers that the service is up', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('gate-daftar');
  });
});
