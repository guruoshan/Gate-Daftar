import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, resetAll } from './helpers.js';
import { buildXlsx } from '../src/xlsx.js';

beforeEach(() => {
  resetAll();
});

describe('Fix 15: real xlsx export and safe cells', () => {
  it('sends a real xlsx file (zip signature and type)', async () => {
    const { site, cookie } = await createOwnedSite();
    await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'Ibrahim', phone: '966555000111', purpose: 'Drop' });
    const res = await request(app)
      .get(`/api/sites/${site.slug}/export?format=xlsx`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml\.sheet/);
    expect(res.headers['content-disposition']).toMatch(/\.xlsx/);
    expect(res.body.slice(0, 2).toString('latin1')).toBe('PK');
  });

  it('neutralizes formula injection characters', () => {
    const buffer = buildXlsx(
      [{ a: '=cmd|calc', b: '+1', c: '-2', d: '@x', e: 'normal' }],
      ['a', 'b', 'c', 'd', 'e'],
    );
    const text = buffer.toString('latin1');
    expect(text).toContain(`'=cmd|calc`);
    expect(text).toContain(`'+1`);
    expect(text).toContain(`'-2`);
    expect(text).toContain(`'@x`);
    expect(text).not.toContain('>@x<');
    expect(text).toContain('normal');
  });
});
