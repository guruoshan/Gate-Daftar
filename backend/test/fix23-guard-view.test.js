import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, createOutpass, unlockBooth, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('Fix 23: the guard and admin can see who approved and how to reach the manager', () => {
  it('the guard screen data shows manager name, manager phone, approval time and the admin decision', async () => {
    const { site, cookie } = await createOwnedSite();
    const made = await createOutpass(cookie, site.slug);
    const booth = await unlockBooth(site.slug, site.guardPin);

    let snap = await request(app).get(`/api/sites/${site.slug}/snapshot`).set('Cookie', booth.cookie);
    let row = snap.body.entries.find((e) => e.id === made.entry.id);
    expect(row.managerName).toBe('Khalid Al-Harbi');
    expect(row.managerPhone).toBe('966500111222');
    expect(row.status).toBe('waiting_approval');
    expect(row.decidedAt).toBeFalsy();

    await request(app).post(`/api/approve/${made.token}`).send({ decision: 'approve' });
    snap = await request(app).get(`/api/sites/${site.slug}/snapshot`).set('Cookie', booth.cookie);
    row = snap.body.entries.find((e) => e.id === made.entry.id);
    expect(row.status).toBe('waiting_admin');
    expect(row.decidedAt).toBeTruthy();

    await request(app).post(`/api/entries/${made.entry.id}/final`).set('Cookie', cookie).send({ decision: 'approve' });
    snap = await request(app).get(`/api/sites/${site.slug}/snapshot`).set('Cookie', booth.cookie);
    row = snap.body.entries.find((e) => e.id === made.entry.id);
    expect(row.status).toBe('approved_out');
    expect(row.adminDecidedAt).toBeTruthy();
    expect(row.adminName).toBe('Test Owner');
  });

  it('never exposes the manager email, the link, or the phone on the public pages', async () => {
    const { site, cookie } = await createOwnedSite();
    const made = await createOutpass(cookie, site.slug);
    const snap = await request(app).get(`/api/sites/${site.slug}/snapshot`).set('Cookie', cookie);
    const row = snap.body.entries.find((e) => e.id === made.entry.id);
    expect(row.managerEmail).toBeUndefined();
    expect(row.magicTokenHash).toBeUndefined();
    const pub = await request(app).get(`/api/sites/${site.slug}/public`);
    expect(JSON.stringify(pub.body)).not.toContain('966500111222');
    const link = await request(app).get(`/api/approve/${made.token}`);
    expect(JSON.stringify(link.body)).not.toContain('966500111222');
  });
});
