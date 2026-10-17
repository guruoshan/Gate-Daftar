import { beforeEach, describe, expect, it } from 'vitest';
import { seedDemoIfEmpty, getDb } from '../src/store.js';
import { resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('demo seed', () => {
  it('uses only fake example.com emails and no live owner emails', async () => {
    await seedDemoIfEmpty();
    const { sites, people } = await getDb();
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      if (site.ownerEmail) {
        expect(site.ownerEmail).toMatch(/@example\.com$/i);
      }
      expect(String(site.ownerEmail || '')).not.toMatch(/gmail\.com/i);
    }
    for (const person of people) {
      expect(String(person.phone || '')).toMatch(/^9665/);
    }
  });
});
