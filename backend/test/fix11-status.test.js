import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { getDb } from '../src/store.js';
import { createOwnedSite, resetAll } from './helpers.js';

beforeEach(() => {
  resetAll();
});

async function visitor(slug, cookie) {
  const res = await request(app)
    .post(`/api/sites/${slug}/visitors`)
    .set('Cookie', cookie)
    .send({ name: 'Ibrahim', phone: '966555000111', purpose: 'Drop' });
  return res.body.entry;
}

async function outpass(slug, cookie) {
  const res = await request(app)
    .post(`/api/sites/${slug}/outpass`)
    .set('Cookie', cookie)
    .send({
      name: 'Ahmed',
      reason: 'Lunch',
      managerName: 'Khalid',
      managerPhone: '966500111222',
      expectedMinutes: 45,
    });
  const entry = getDb().entries.find((e) => e.id === res.body.entry.id);
  return { ...entry, magicToken: res.body.entry.pageUrl.split('/').pop() };
}

describe('Fix 11: only allowed status changes are accepted', () => {
  it('visitor: waiting_admit -> inside -> exited', async () => {
    const { site, cookie } = await createOwnedSite();
    const v = await visitor(site.slug, cookie);
    const admit = await request(app).post(`/api/entries/${v.id}/admit`).set('Cookie', cookie);
    expect(admit.status).toBe(200);
    const exit = await request(app).post(`/api/entries/${v.id}/exit`).set('Cookie', cookie);
    expect(exit.status).toBe(200);
    expect(exit.body.entry.status).toBe('exited');
  });

  it('visitor: cannot exit before admission and cannot admit twice', async () => {
    const { site, cookie } = await createOwnedSite();
    const v = await visitor(site.slug, cookie);
    const early = await request(app).post(`/api/entries/${v.id}/exit`).set('Cookie', cookie);
    expect(early.status).toBe(400);
    expect(early.body.error).toBe('bad_transition');
    await request(app).post(`/api/entries/${v.id}/admit`).set('Cookie', cookie);
    const again = await request(app).post(`/api/entries/${v.id}/admit`).set('Cookie', cookie);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('bad_transition');
  });

  it('outpass: waiting_approval -> approved_out -> out -> returned', async () => {
    const { site, cookie } = await createOwnedSite();
    const o = await outpass(site.slug, cookie);
    const decide = await request(app).post(`/api/approve/${o.magicToken}`).send({ decision: 'approve' });
    expect(decide.status).toBe(200);
    const out = await request(app).post(`/api/entries/${o.id}/out`).set('Cookie', cookie);
    expect(out.status).toBe(200);
    const back = await request(app).post(`/api/entries/${o.id}/in`).set('Cookie', cookie);
    expect(back.status).toBe(200);
    expect(back.body.entry.status).toBe('returned');
  });

  it('outpass: cannot log out before approval', async () => {
    const { site, cookie } = await createOwnedSite();
    const o = await outpass(site.slug, cookie);
    const early = await request(app).post(`/api/entries/${o.id}/out`).set('Cookie', cookie);
    expect(early.status).toBe(400);
    expect(early.body.error).toBe('bad_transition');
  });

  it('unapproved leave is outpass only', async () => {
    const { site, cookie } = await createOwnedSite();
    const v = await visitor(site.slug, cookie);
    const bad = await request(app)
      .post(`/api/entries/${v.id}/unapproved`)
      .set('Cookie', cookie)
      .send({ reason: 'ran off' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('bad_transition');
  });
});
