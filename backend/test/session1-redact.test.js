import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, createOutpass, hasSecretKeys, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

const FORBIDDEN = [
  'guardPin',
  'magicToken',
  'approveUrl',
  'denyUrl',
  'pageUrl',
  'waLink',
  'smsBody',
  'managerPhone',
  'ownerEmail',
  'ownerName',
];

function blobHasForbidden(value) {
  const text = JSON.stringify(value);
  return FORBIDDEN.some((key) => text.includes(`"${key}"`));
}

describe('Session 1: no secrets in snapshot, search, people, entry GET', () => {
  it('snapshot, search, people and entry GET omit the forbidden keys', async () => {
    const { site, cookie } = await createOwnedSite();
    const made = await createOutpass(cookie, site.slug, { reason: 'Bank', expectedMinutes: 60 });
    expect(made.res.status).toBe(200);
    expect(made.entry.pageUrl).toBeUndefined();
    expect(made.entry.approveUrl).toBeUndefined();
    expect(made.entry.denyUrl).toBeUndefined();
    expect(made.entry.emailed).toBe(true);

    const snap = await request(app).get(`/api/sites/${site.slug}/snapshot`).set('Cookie', cookie);
    expect(snap.status).toBe(200);
    expect(hasSecretKeys(snap.body)).toBe(false);
    expect(blobHasForbidden(snap.body)).toBe(false);
    const yousef = snap.body.people.find((p) => p.employeeId === 'E-104');
    expect(yousef).toMatchObject({
      name: 'Yousef Hassan',
      role: 'employee',
      employeeId: 'E-104',
    });
    expect(yousef.phone).toBeUndefined();
    expect(yousef.email).toBeUndefined();

    const people = await request(app).get(`/api/sites/${site.slug}/people`).set('Cookie', cookie);
    expect(people.body.people.every((p) => p.phone === undefined)).toBe(true);
    expect(people.body.people.every((p) => p.managerPhone === undefined)).toBe(true);

    const search = await request(app).get(`/api/sites/${site.slug}/search?q=Yousef`).set('Cookie', cookie);
    expect(blobHasForbidden(search.body)).toBe(false);

    const entry = await request(app).get(`/api/entries/${made.entry.id}`).set('Cookie', cookie);
    expect(blobHasForbidden(entry.body)).toBe(false);
    expect(entry.body.entry.pageUrl).toBeUndefined();
  });
});
