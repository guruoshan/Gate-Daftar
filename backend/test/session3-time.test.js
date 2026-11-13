import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/db.js';
import { dashboard, searchEntries, snapshot } from '../src/store.js';
import { dayBounds, todayLocalDate } from '../src/time.js';
import { normalizeArabicText, digits } from '../src/text.js';
import { createOwnedSite, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

async function backdate(entryId, iso) {
  await query('UPDATE entries SET created_at = $1, updated_at = $1 WHERE id = $2', [iso, entryId]);
}

describe('Session 3: Gulf time, live snapshot, Arabic search', () => {
  it('treats Riyadh midnight as the day boundary even when the process TZ is UTC', async () => {
    expect(process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone).toBeTruthy();
    const bounds = dayBounds('2026-10-24', 'Asia/Riyadh');
    expect(bounds.start).toBe('2026-10-23T21:00:00.000Z');
    expect(bounds.end).toBe('2026-10-24T21:00:00.000Z');

    const { site, cookie } = await createOwnedSite();
    const before = await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'Before midnight', phone: '966555000111', purpose: 'Drop' });
    const after = await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'After midnight', phone: '966555000222', purpose: 'Drop' });
    await backdate(before.body.entry.id, '2026-10-23T20:30:00.000Z');
    await backdate(after.body.entry.id, '2026-10-23T21:30:00.000Z');

    const oct23 = await dashboard(site.id, '2026-10-23');
    const oct24 = await dashboard(site.id, '2026-10-24');
    expect(oct23.timezone).toBe('Asia/Riyadh');
    expect(oct23.todayVisitors).toBe(1);
    expect(oct24.todayVisitors).toBe(1);

    const csv23 = await request(app)
      .get(`/api/sites/${site.slug}/export?format=csv&day=2026-10-23`)
      .set('Cookie', cookie);
    expect(csv23.text).toMatch(/Before midnight/);
    expect(csv23.text).not.toMatch(/After midnight/);
  });

  it('lets the owner set a timezone and filters dashboard by that local day', async () => {
    const { site, cookie } = await createOwnedSite();
    const bad = await request(app)
      .post(`/api/sites/${site.slug}/timezone`)
      .set('Cookie', cookie)
      .send({ timezone: 'Not/AZone' });
    expect(bad.status).toBe(400);
    const ok = await request(app)
      .post(`/api/sites/${site.slug}/timezone`)
      .set('Cookie', cookie)
      .send({ timezone: 'Asia/Dubai' });
    expect(ok.status).toBe(200);
    expect(ok.body.site.timezone).toBe('Asia/Dubai');
    const dash = await request(app)
      .get(`/api/sites/${site.slug}/dashboard?day=${todayLocalDate('Asia/Dubai')}`)
      .set('Cookie', cookie);
    expect(dash.status).toBe(200);
    expect(dash.body.stats.timezone).toBe('Asia/Dubai');
    expect(dash.body.site.timezone).toBe('Asia/Dubai');
  });

  it('pages search and matches Arabic digits and alef variants', async () => {
    expect(normalizeArabicText('أحمد')).toBe(normalizeArabicText('احمد'));
    expect(digits('٥٥٥٠٠٠١١١')).toBe('555000111');
    const { site, cookie } = await createOwnedSite();
    await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'أحمد علي', phone: '966555000111', purpose: 'Drop' });
    const found = await searchEntries(site.id, 'احمد');
    expect(found.total).toBe(1);
    expect(found.entries[0].name).toBe('أحمد علي');
    const byDigit = await searchEntries(site.id, '٥٥٥٠٠٠١١١');
    expect(byDigit.total).toBe(1);
    const page = await request(app)
      .get(`/api/sites/${site.slug}/search?q=احمد&limit=1`)
      .set('Cookie', cookie);
    expect(page.status).toBe(200);
    expect(page.body.entries).toHaveLength(1);
    expect(page.body.total).toBe(1);
  });

  it('keeps closed yesterday rows out of the live snapshot', async () => {
    const { site, cookie } = await createOwnedSite();
    const made = await request(app)
      .post(`/api/sites/${site.slug}/visitors`)
      .set('Cookie', cookie)
      .send({ name: 'Old visitor', phone: '966555000333', purpose: 'Drop' });
    await request(app).post(`/api/entries/${made.body.entry.id}/admit`).set('Cookie', cookie);
    await request(app).post(`/api/entries/${made.body.entry.id}/exit`).set('Cookie', cookie);
    await backdate(made.body.entry.id, '2020-01-01T08:00:00.000Z');
    const live = await snapshot(site.id);
    expect(live.entries.some((e) => e.id === made.body.entry.id)).toBe(false);
  });
});
