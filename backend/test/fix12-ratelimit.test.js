import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { resetAll } from './helpers.js';

const keys = ['RATE_LIMIT_CREATE_MAX', 'RATE_LIMIT_GATE_MAX', 'RATE_LIMIT_UNLOCK_MAX'];
const OLD = {};
keys.forEach((k) => {
  OLD[k] = process.env[k];
});

beforeEach(() => {
  resetAll();
});

afterEach(() => {
  keys.forEach((k) => {
    if (OLD[k] === undefined) delete process.env[k];
    else process.env[k] = OLD[k];
  });
});

async function makeSite() {
  return request(app).post('/api/sites').send({
    name: 'Gate',
    ownerName: 'Owner',
    ownerEmail: 'owner@example.com',
    lang: 'en',
    pack: 'warehouse',
    countryIso: 'SA',
  });
}

describe('Fix 12: rate limits protect expensive and auth routes', () => {
  it('limits site creation', async () => {
    process.env.RATE_LIMIT_CREATE_MAX = '2';
    const first = await makeSite();
    const second = await makeSite();
    const third = await makeSite();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.error).toBe('rate_limited');
  });

  it('limits public gate submissions', async () => {
    process.env.RATE_LIMIT_GATE_MAX = '2';
    const created = await makeSite();
    const slug = created.body.site.slug;
    const send = () =>
      request(app).post(`/api/sites/${slug}/gate/visitor`).send({
        name: 'Ibrahim',
        phone: '966555000111',
        purpose: 'Drop',
      });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    const blocked = await send();
    expect(blocked.status).toBe(429);
  });

  it('limits unlock attempts', async () => {
    process.env.RATE_LIMIT_UNLOCK_MAX = '2';
    const created = await makeSite();
    const slug = created.body.site.slug;
    const tryUnlock = () => request(app).post('/api/guard/unlock').send({ slug, pin: '999999' });
    await tryUnlock();
    await tryUnlock();
    const blocked = await tryUnlock();
    expect(blocked.status).toBe(429);
  });
});
