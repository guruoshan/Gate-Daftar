import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, unlockBooth, hasSecretKeys, resetAll } from './helpers.js';

beforeEach(() => {
  resetAll();
});

describe('Fix 6: entry GET needs a session and hides secrets', () => {
  it('rejects entry GET when there is no session', async () => {
    const { site, cookie } = await createOwnedSite();
    const made = await request(app)
      .post(`/api/sites/${site.slug}/outpass`)
      .set('Cookie', cookie)
      .send({
        name: 'Yousef',
        reason: 'Bank',
        managerName: 'Khalid',
        managerPhone: '966500111222',
        expectedMinutes: 60,
      });
    const res = await request(app).get(`/api/entries/${made.body.entry.id}`);
    expect(res.status).toBe(401);
  });

  it('returns a safe view to booth and owner of that site', async () => {
    const { site, cookie } = await createOwnedSite();
    const made = await request(app)
      .post(`/api/sites/${site.slug}/outpass`)
      .set('Cookie', cookie)
      .send({
        name: 'Yousef',
        reason: 'Bank',
        managerName: 'Khalid',
        managerPhone: '966500111222',
        expectedMinutes: 60,
      });
    const ownerView = await request(app).get(`/api/entries/${made.body.entry.id}`).set('Cookie', cookie);
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.entry.magicToken).toBeUndefined();
    expect(hasSecretKeys(ownerView.body)).toBe(false);
    expect(ownerView.body.entry.managerPhone).toBe('966500111222');
    const booth = await unlockBooth(site.slug, site.guardPin);
    const boothView = await request(app).get(`/api/entries/${made.body.entry.id}`).set('Cookie', booth.cookie);
    expect(boothView.status).toBe(200);
    expect(boothView.body.entry.managerPhone).toBe('966500111222');
    expect(boothView.body.entry.magicToken).toBeUndefined();
  });

  it('does not let another site read the entry', async () => {
    const a = await createOwnedSite('A');
    const b = await createOwnedSite('B');
    const made = await request(app)
      .post(`/api/sites/${a.site.slug}/outpass`)
      .set('Cookie', a.cookie)
      .send({
        name: 'Yousef',
        reason: 'Bank',
        managerName: 'Khalid',
        managerPhone: '966500111222',
        expectedMinutes: 60,
      });
    const res = await request(app).get(`/api/entries/${made.body.entry.id}`).set('Cookie', b.cookie);
    expect(res.status).toBe(403);
  });
});
