export const PACKS = ['manufacturing', 'warehouse', 'workshop', 'logistics', 'construction'];

const ALIASES = {
  'warehouse-factory': 'warehouse',
  factory: 'manufacturing',
  plant: 'manufacturing',
  yard: 'logistics',
  site: 'construction',
};

export function coercePack(value) {
  const key = String(value || '').trim().toLowerCase();
  if (PACKS.includes(key)) return key;
  if (ALIASES[key]) return ALIASES[key];
  return PACKS[0];
}

export function migrateDb(parsed) {
  const dbx = parsed || {};
  (dbx.sites || []).forEach((s) => {
    s.pack = coercePack(s.pack);
  });
  return dbx;
}
