import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, unlockBooth, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

const HEADER = 'Employee Name,Email,Employee ID,WhatsApp,Reporting Manager,Manager Email,Manager WhatsApp';

function upload(slug, cookie, csv) {
  return request(app).post(`/api/sites/${slug}/people/import`).set('Cookie', cookie).send({ csv });
}

async function people(slug, cookie) {
  return (await request(app).get(`/api/sites/${slug}/people`).set('Cookie', cookie)).body.people;
}

describe('Fix 22: staff upload', () => {
  it('creates employees and one shared manager, linked together', async () => {
    const { site, cookie } = await createOwnedSite();
    const csv = [
      HEADER,
      'Sara Ali,sara@acme.com,E-1,966511000001,Omar Khan,omar@acme.com,966500999888',
      'Huda Noor,huda@acme.com,E-2,966511000002,Omar Khan,omar@acme.com,966500999888',
    ].join('\n');
    const res = await upload(site.slug, cookie, csv);
    expect(res.status).toBe(200);
    expect(res.body.created).toEqual({ employees: 2, managers: 1 });
    expect(res.body.errors).toEqual([]);
    const list = await people(site.slug, cookie);
    const manager = list.find((p) => p.role === 'manager');
    expect(manager.name).toBe('Omar Khan');
    const sara = list.find((p) => p.name === 'Sara Ali');
    expect(sara.managerId).toBe(manager.id);
    expect(sara.employeeId).toBe('E-1');
  });

  it('accepts a spreadsheet export: byte order mark, quotes and other column names', async () => {
    const { site, cookie } = await createOwnedSite();
    const csv =
      '﻿"Name","Employee ID","Manager Name","Manager Phone"\r\n' +
      '"Ahmed, Jr","E-7","Omar Khan","966500999888"\r\n';
    const res = await upload(site.slug, cookie, csv);
    expect(res.status).toBe(200);
    expect(res.body.created).toEqual({ employees: 1, managers: 1 });
    const list = await people(site.slug, cookie);
    expect(list.find((p) => p.name === 'Ahmed, Jr')).toBeTruthy();
  });

  it('imports good rows and reports the bad ones by line number', async () => {
    const { site, cookie } = await createOwnedSite();
    const csv = [
      HEADER,
      'Sara Ali,,E-1,,Omar Khan,omar@acme.com,',
      'No Contact,,E-2,,Lost Manager,,',
      ',,E-3,,Omar Khan,omar@acme.com,',
    ].join('\n');
    const res = await upload(site.slug, cookie, csv);
    expect(res.status).toBe(200);
    expect(res.body.created.employees).toBe(1);
    expect(res.body.errors.map((e) => e.line)).toEqual([3, 4]);
  });

  it('uploading the same file twice does not make duplicates', async () => {
    const { site, cookie } = await createOwnedSite();
    const csv = [HEADER, 'Sara Ali,sara@acme.com,E-1,,Omar Khan,omar@acme.com,'].join('\n');
    await upload(site.slug, cookie, csv);
    const again = await upload(site.slug, cookie, csv);
    expect(again.body.created).toEqual({ employees: 0, managers: 0 });
    expect(again.body.skipped).toBe(1);
    expect((await people(site.slug, cookie)).length).toBe(2);
  });

  it('the shared booth login cannot upload staff', async () => {
    const { site, cookie } = await createOwnedSite();
    const pin = (await request(app).post(`/api/sites/${site.slug}/pin/reset`).set('Cookie', cookie)).body.pin;
    const booth = await unlockBooth(site.slug, pin);
    const res = await upload(site.slug, booth.cookie, HEADER);
    expect(res.status).toBe(403);
  });

  it('refuses a file without the employee name column', async () => {
    const { site, cookie } = await createOwnedSite();
    const res = await upload(site.slug, cookie, 'Email,Employee ID\na@b.com,E-1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_columns');
  });

  it('refuses a very large upload', async () => {
    const { site, cookie } = await createOwnedSite();
    const rows = Array.from({ length: 501 }, (_, i) => `P${i},,E-${i},,Omar Khan,omar@acme.com,`);
    const res = await upload(site.slug, cookie, [HEADER, ...rows].join('\n'));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('too_many_rows');
  });
});
