import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('optional visitor vehicle', () => {
  it('stores vehicle on booth create and snapshot', async () => {
    const { site, cookie } = await createOwnedSite();
    const created = await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'Layla', phone: '966555888999', vehicle: 'ABC 1234' });
    expect(created.status).toBe(200);
    expect(created.body.entry.vehicle).toBe('ABC 1234');

    const snap = await request(app).get(`/api/sites/${site.slug}/snapshot`).set('Cookie', cookie);
    expect(snap.status).toBe(200);
    const row = snap.body.entries.find((e) => e.id === created.body.entry.id);
    expect(row?.vehicle).toBe('ABC 1234');
  });

  it('stores vehicle on public gate create', async () => {
    const { site, cookie } = await createOwnedSite();
    const created = await request(app)
      .post(`/api/sites/${site.slug}/gate/visitor`)
      .send({ name: 'Majed', phone: '966555888999', vehicle: 'XYZ 99' });
    expect(created.status).toBe(201);
    expect(created.body.entry.vehicle).toBeUndefined();

    const snap = await request(app).get(`/api/sites/${site.slug}/snapshot`).set('Cookie', cookie);
    const row = snap.body.entries.find((e) => e.id === created.body.entry.id);
    expect(row?.vehicle).toBe('XYZ 99');
  });

  it('accepts empty or omitted vehicle', async () => {
    const { site, cookie } = await createOwnedSite();
    const empty = await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'Nora', phone: '966555888999', vehicle: '' });
    expect(empty.status).toBe(200);
    expect(empty.body.entry.vehicle).toBe('');

    const omitted = await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'Omar', phone: '966555000111' });
    expect(omitted.status).toBe(200);
    expect(omitted.body.entry.vehicle).toBe('');
  });

  it('rejects vehicle longer than 32 characters', async () => {
    const { site, cookie } = await createOwnedSite();
    const res = await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'Sara', phone: '966555888999', vehicle: 'x'.repeat(33) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('vehicle_long');
  });

  it('includes vehicle in CSV export after hostName', async () => {
    const { site, cookie } = await createOwnedSite();
    await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'Layla', phone: '966555888999', hostName: 'Khalid', vehicle: 'ABC 1234' });
    const csv = await request(app).get(`/api/sites/${site.slug}/export?format=csv`).set('Cookie', cookie);
    expect(csv.status).toBe(200);
    const header = csv.text.split('\n')[0];
    expect(header).toContain('hostName,vehicle,');
    expect(csv.text).toContain('ABC 1234');
  });

  it('does not match search on vehicle', async () => {
    const { site, cookie } = await createOwnedSite();
    await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'Layla', phone: '966555888999', vehicle: 'PLATEONLY' });
    const res = await request(app)
      .get(`/api/sites/${site.slug}/search?q=PLATEONLY`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
  });
});
