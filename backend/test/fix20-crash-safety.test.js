import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { resetAll, createOwnedSite } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('Fix 20: bad text cannot crash the server', () => {
  it('answers 400 when a text box contains a null character', async () => {
    const res = await request(app).post('/api/sites').send({ name: 'bad\u0000name' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_characters');
  });

  it('refuses a null character on the public gate form too', async () => {
    const { site } = await createOwnedSite();
    const res = await request(app)
      .post(`/api/sites/${site.slug}/gate/visitor`)
      .send({ name: 'Ali\u0000', phone: '' });
    expect(res.status).toBe(400);
  });

  it('keeps working after a rejected request', async () => {
    await request(app).post('/api/sites').send({ name: 'bad\u0000name' });
    const ok = await request(app).get('/api/health');
    expect(ok.status).toBe(200);
  });
});
