export const PACKS = [
  { id: 'manufacturing', ar: 'مصنع إنتاج', en: 'Manufacturing plant' },
  { id: 'warehouse', ar: 'مستودع', en: 'Warehouse' },
  { id: 'workshop', ar: 'ورشة', en: 'Workshop' },
  { id: 'logistics', ar: 'ساحة لوجستية', en: 'Logistics yard' },
  { id: 'construction', ar: 'موقع إنشاءات', en: 'Construction site' },
];

export function packLabel(id, lang) {
  const p = PACKS.find((x) => x.id === id) || PACKS[0];
  return lang === 'en' ? p.en : p.ar;
}
