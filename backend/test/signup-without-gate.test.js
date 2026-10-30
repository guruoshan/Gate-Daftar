import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { resetAll, signupCompany, createOwnedSite } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('Sign up without a gate', () => {
  it('creates a company and login with zero gates', async () => {
    const signed = await signupCompany({
      companyName: 'Noor Co',
      ownerEmail: 'owner@example.com',
      pack: 'warehouse',
      countryIso: 'SA',
      timezone: 'Asia/Riyadh',
    });
    expect(signed.res.status).toBe(200);
    expect(signed.company.name).toBe('Noor Co');
    expect(signed.company.pack).toBe('warehouse');
    expect(signed.res.body.sites).toEqual([]);
    expect(signed.res.body.site).toBeUndefined();
  });

  it('refuses a used email and a short password', async () => {
    await signupCompany({ ownerEmail: 'taken@example.com' });
    const again = await request(app).post('/api/owner/signup').send({
      companyName: 'Other',
      ownerEmail: 'taken@example.com',
      password: 'password1',
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('email_taken');
    const short = await request(app).post('/api/owner/signup').send({
      companyName: 'Short Co',
      ownerEmail: 'short@example.com',
      password: 'short',
    });
    expect(short.status).toBe(400);
    expect(short.body.error).toBe('password_short');
  });

  it('lists no gates until Add a gate', async () => {
    const signed = await signupCompany({ ownerEmail: 'empty@example.com' });
    const me = await request(app).get('/api/owner/me').set('Cookie', signed.cookie);
    expect(me.status).toBe(200);
    expect(me.body.sites).toEqual([]);
    const added = await request(app)
      .post(`/api/companies/${signed.company.id}/sites`)
      .set('Cookie', signed.cookie)
      .send({ name: 'Main Gate' });
    expect(added.status).toBe(200);
    const after = await request(app).get('/api/owner/me').set('Cookie', signed.cookie);
    expect(after.body.sites).toHaveLength(1);
    expect(after.body.sites[0].name).toBe('Main Gate');
  });

  it('first gate inherits pack, country, and timezone', async () => {
    const signed = await signupCompany({
      companyName: 'Inherit Co',
      ownerEmail: 'inherit@example.com',
      pack: 'workshop',
      countryIso: 'AE',
      timezone: 'Asia/Dubai',
    });
    const added = await request(app)
      .post(`/api/companies/${signed.company.id}/sites`)
      .set('Cookie', signed.cookie)
      .send({ name: 'Dock' });
    expect(added.status).toBe(200);
    expect(added.body.site.pack).toBe('workshop');
    expect(added.body.site.countryIso).toBe('AE');
    expect(added.body.site.timezone).toBe('Asia/Dubai');
  });

  it('A cannot open B', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const b = await createOwnedSite('Gate B', { ownerEmail: 'b@example.com' });
    const snap = await request(app).get(`/api/sites/${b.site.slug}/snapshot`).set('Cookie', a.cookie);
    expect([401, 403]).toContain(snap.status);
    expect(JSON.stringify(snap.body)).not.toMatch(/Gate B/);
  });
});
