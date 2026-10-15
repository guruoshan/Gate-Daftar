import request from 'supertest';
import { app } from '../src/index.js';
import { resetSessions } from '../src/sessions.js';
import { resetStore } from '../src/store.js';
import { resetRateLimits } from '../src/rateLimit.js';
import { resetPinState } from '../src/pins.js';

export function resetAll() {
  resetStore();
  resetSessions();
  resetRateLimits();
  resetPinState();
}

export function cookieFrom(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return '';
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((c) => String(c).split(';')[0]).join('; ');
}

export async function createOwnedSite(name = 'Test Gate') {
  const res = await request(app).post('/api/sites').send({
    name,
    ownerName: 'Test Owner',
    ownerEmail: 'owner@example.com',
    lang: 'en',
    pack: 'warehouse',
    countryIso: 'SA',
  });
  return {
    res,
    site: res.body.site,
    cookie: cookieFrom(res),
  };
}

export async function unlockBooth(slug, pin) {
  const res = await request(app).post('/api/guard/unlock').send({ slug, pin });
  return { res, site: res.body.site, cookie: cookieFrom(res) };
}

export function hasSecretKeys(value) {
  const text = JSON.stringify(value);
  return /magicToken|guardPin/.test(text);
}
