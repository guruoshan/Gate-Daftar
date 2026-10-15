import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { PACKS, coercePack, migrateDb } from '../src/packs.js';
import { createOwnedSite, resetAll } from './helpers.js';

beforeEach(() => {
  resetAll();
});

describe('Fix 18: one source of truth for site types', () => {
  it('coerces the drifted demo value to a valid pack', () => {
    expect(coercePack('warehouse-factory')).toBe('warehouse');
    expect(coercePack('manufacturing')).toBe('manufacturing');
    expect(coercePack('nonsense')).toBe(PACKS[0]);
    expect(coercePack(undefined)).toBe(PACKS[0]);
  });

  it('migrates a stored db with a drifted pack', () => {
    const migrated = migrateDb({
      companies: [],
      sites: [{ id: 'site_x', name: 'X', pack: 'warehouse-factory', countryIso: 'SA' }],
      people: [],
      entries: [],
      events: [],
      audit: [],
    });
    expect(migrated.sites[0].pack).toBe('warehouse');
  });

  it('create site always stores a valid pack', async () => {
    const { site } = await createOwnedSite();
    expect(PACKS).toContain(site.pack);
  });

  it('public gate options never contain a drifted pack value', async () => {
    const { site } = await createOwnedSite();
    const res = await request(app).get(`/api/sites/${site.slug}/public`);
    expect(res.status).toBe(200);
  });
});
