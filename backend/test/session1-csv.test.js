import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('Session 1: CSV download is safe for Excel', () => {
  it('prefixes formula cells, adds a UTF-8 BOM, and treats format=xls as CSV', async () => {
    const { site, cookie } = await createOwnedSite();
    await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: '=cmd|calc', phone: '966555000111', purpose: '+1', company: '@x', hostName: '-2' });
    const csv = await request(app).get(`/api/sites/${site.slug}/export?format=csv`).set('Cookie', cookie);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/\.csv/);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain(`'=cmd|calc`);
    expect(csv.text).toContain(`'+1`);
    expect(csv.text).toContain(`'-2`);
    expect(csv.text).toContain(`'@x`);

    const xls = await request(app).get(`/api/sites/${site.slug}/export?format=xls`).set('Cookie', cookie);
    expect(xls.status).toBe(200);
    expect(xls.headers['content-type']).toMatch(/text\/csv/);
    expect(xls.headers['content-disposition']).toMatch(/\.csv/);
    expect(xls.text.charCodeAt(0)).toBe(0xfeff);
  });
});
