import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, createOutpass, unlockBooth, hasSecretKeys, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('Fix 1: snapshot is private; public gate is minimal', () => {
  it('rejects snapshot when there is no booth or owner session', async () => {
    const { site } = await createOwnedSite();
    const res = await request(app).get(`/api/sites/${site.slug}/snapshot`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('auth_required');
  });

  it('lets the owner read snapshot without PIN or magic tokens', async () => {
    const { site, cookie } = await createOwnedSite();
    await createOutpass(cookie, site.slug, { reason: 'Bank', expectedMinutes: 60 });
    const res = await request(app).get(`/api/sites/${site.slug}/snapshot`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.site?.name).toBe('Test Gate');
    expect(res.body.site?.guardPin).toBeUndefined();
    expect(hasSecretKeys(res.body)).toBe(false);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  it('lets the unlocked booth read snapshot', async () => {
    const { site } = await createOwnedSite();
    const pin = site.guardPin;
    expect(pin).toBeTruthy();
    const { cookie } = await unlockBooth(site.slug, pin);
    const res = await request(app).get(`/api/sites/${site.slug}/snapshot`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.site?.guardPin).toBeUndefined();
  });

  it('public gate payload has only name, language, country and form options', async () => {
    const { site } = await createOwnedSite();
    const res = await request(app).get(`/api/sites/${site.slug}/public`);
    expect(res.status).toBe(200);
    expect(res.body.site.name).toBe('Test Gate');
    expect(res.body.site.lang).toBe('en');
    expect(res.body.site.countryIso).toBe('SA');
    expect(res.body.country).toBeTruthy();
    expect(res.body.options?.durations).toEqual([45, 60, 90, 180]);
    expect(res.body.employees).toEqual([]);
    expect(res.body.managers).toEqual([]);
    expect(res.body.people).toBeUndefined();
    expect(res.body.entries).toBeUndefined();
    expect(res.body.site.guardPin).toBeUndefined();
    expect(hasSecretKeys(res.body)).toBe(false);
    const blob = JSON.stringify(res.body);
    expect(blob).not.toMatch(/9665/);
  });
});
