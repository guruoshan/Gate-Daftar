export const COUNTRIES = [
  { iso: 'SA', dial: '966', digits: 9, ar: 'السعودية', en: 'Saudi Arabia', flag: 'SA' },
  { iso: 'AE', dial: '971', digits: 9, ar: 'الإمارات', en: 'United Arab Emirates', flag: 'AE' },
  { iso: 'OM', dial: '968', digits: 8, ar: 'عُمان', en: 'Oman', flag: 'OM' },
  { iso: 'KW', dial: '965', digits: 8, ar: 'الكويت', en: 'Kuwait', flag: 'KW' },
  { iso: 'QA', dial: '974', digits: 8, ar: 'قطر', en: 'Qatar', flag: 'QA' },
  { iso: 'BH', dial: '973', digits: 8, ar: 'البحرين', en: 'Bahrain', flag: 'BH' },
  { iso: 'IN', dial: '91', digits: 10, ar: 'الهند', en: 'India', flag: 'IN' },
  { iso: 'EG', dial: '20', digits: 10, ar: 'مصر', en: 'Egypt', flag: 'EG' },
  { iso: 'JO', dial: '962', digits: 9, ar: 'الأردن', en: 'Jordan', flag: 'JO' },
  { iso: 'PK', dial: '92', digits: 10, ar: 'باكستان', en: 'Pakistan', flag: 'PK' },
  { iso: 'BD', dial: '880', digits: 10, ar: 'بنغلاديش', en: 'Bangladesh', flag: 'BD' },
];

export function countryOf(iso) {
  return COUNTRIES.find((c) => c.iso === iso) || COUNTRIES[0];
}

export function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function guessIso(raw, fallback = 'SA') {
  let d = digits(raw);
  if (d.startsWith('00')) d = d.slice(2);
  const ranked = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of ranked) {
    if (d.startsWith(c.dial) && d.length === c.dial.length + c.digits) return c.iso;
  }
  for (const c of ranked) {
    if (d.startsWith(c.dial)) return c.iso;
  }
  return fallback;
}

export function normalizePhone(raw, iso = 'SA') {
  let d = digits(raw);
  if (!d) return { error: 'phone_required', country: countryOf(iso) };
  if (d.startsWith('00')) d = d.slice(2);
  const c = countryOf(guessIso(d, iso));
  if (d.startsWith(c.dial)) d = d.slice(c.dial.length);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length !== c.digits) {
    return { error: 'phone_invalid', expected: c.digits, country: c };
  }
  return { e164: `${c.dial}${d}`, national: d, iso: c.iso, dial: c.dial, country: c };
}

export function displayPhone(e164, iso) {
  const c = countryOf(iso);
  const d = digits(e164);
  if (!d) return '';
  const national = d.startsWith(c.dial) ? d.slice(c.dial.length) : d;
  return `+${c.dial} ${national}`;
}

export function waNumber(e164) {
  return digits(e164);
}
