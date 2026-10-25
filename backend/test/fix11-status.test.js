import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { getDb } from '../src/store.js';
import { createOwnedSite, createOutpass, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

async function visitor(slug, cookie) {
  const res = await request(app)
    .post(`/api/sites/${slug}/visitors`)
    .set('Cookie', cookie)
    .send({ name: 'Ibrahim', phone: '966555000111', purpose: 'Drop' });
  return res.body.entry;
}

async function outpass(slug, cookie) {
  const made = await createOutpass(cookie, slug);
  const entry = (await getDb()).entries.find((e) => e.id === made.entry.id);
  return { ...entry, magicToken: made.token };
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
    expect(early.status).toBe(409);
    expect(early.body.error).toBe('invalid_state');
    await request(app).post(`/api/entries/${v.id}/admit`).set('Cookie', cookie);
    const again = await request(app).post(`/api/entries/${v.id}/admit`).set('Cookie', cookie);
    expect(again.status).toBe(200);
    expect(again.body.entry.status).toBe('inside');
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
    expect(early.status).toBe(409);
    expect(early.body.error).toBe('invalid_state');
  });

  it('unapproved leave is outpass only', async () => {
    const { site, cookie } = await createOwnedSite();
    const v = await visitor(site.slug, cookie);
    const bad = await request(app)
      .post(`/api/entries/${v.id}/unapproved`)
      .set('Cookie', cookie)
      .send({ reason: 'ran off' });
    expect(bad.status).toBe(409);
    expect(bad.body.error).toBe('invalid_state');
  });

  it('repeating the same action returns the existing entry', async () => {
    const { site, cookie } = await createOwnedSite();
    const v = await visitor(site.slug, cookie);
    const first = await request(app).post(`/api/entries/${v.id}/admit`).set('Cookie', cookie);
    const second = await request(app).post(`/api/entries/${v.id}/admit`).set('Cookie', cookie);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.entry.status).toBe('inside');
  });

  it('unapproved needs a reason of at least 3 characters and cannot run from out', async () => {
    const { site, cookie } = await createOwnedSite();
    const o = await outpass(site.slug, cookie);
    const short = await request(app)
      .post(`/api/entries/${o.id}/unapproved`)
      .set('Cookie', cookie)
      .send({ reason: 'no' });
    expect(short.status).toBe(400);
    expect(short.body.error).toBe('reason_required');
    await request(app).post(`/api/approve/${o.magicToken}`).send({ decision: 'approve' });
    await request(app).post(`/api/entries/${o.id}/out`).set('Cookie', cookie);
    const fromOut = await request(app)
      .post(`/api/entries/${o.id}/unapproved`)
      .set('Cookie', cookie)
      .send({ reason: 'ran off' });
    expect(fromOut.status).toBe(409);
    expect(fromOut.body.error).toBe('invalid_state');
  });
});
