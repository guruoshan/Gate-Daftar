export const COUNTRIES = [
  { iso: 'SA', dial: '966', digits: 9, ar: 'السعودية', en: 'Saudi Arabia' },
  { iso: 'AE', dial: '971', digits: 9, ar: 'الإمارات', en: 'United Arab Emirates' },
  { iso: 'OM', dial: '968', digits: 8, ar: 'عُمان', en: 'Oman' },
  { iso: 'KW', dial: '965', digits: 8, ar: 'الكويت', en: 'Kuwait' },
  { iso: 'QA', dial: '974', digits: 8, ar: 'قطر', en: 'Qatar' },
  { iso: 'BH', dial: '973', digits: 8, ar: 'البحرين', en: 'Bahrain' },
  { iso: 'IN', dial: '91', digits: 10, ar: 'الهند', en: 'India' },
  { iso: 'EG', dial: '20', digits: 10, ar: 'مصر', en: 'Egypt' },
  { iso: 'JO', dial: '962', digits: 9, ar: 'الأردن', en: 'Jordan' },
  { iso: 'PK', dial: '92', digits: 10, ar: 'باكستان', en: 'Pakistan' },
  { iso: 'BD', dial: '880', digits: 10, ar: 'بنغلاديش', en: 'Bangladesh' },
];

export function countryOf(iso) {
  return COUNTRIES.find((c) => c.iso === iso) || COUNTRIES[0];
}

export function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function guessIso(value, fallback = 'SA') {
  let d = onlyDigits(value);
  if (d.startsWith('00')) d = d.slice(2);
  const ranked = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of ranked) {
    if (d.startsWith(c.dial)) return c.iso;
  }
  return fallback;
}

export function nationalDigits(value, iso) {
  const c = countryOf(iso);
  let d = onlyDigits(value);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith(c.dial)) d = d.slice(c.dial.length);
  if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, c.digits);
}

export function composePhone(national, iso) {
  const c = countryOf(iso);
  const n = nationalDigits(national, iso);
  if (!n) return '';
  return `${c.dial}${n}`;
}

export function phoneOk(value, iso = 'SA') {
  const active = guessIso(value, iso);
  const c = countryOf(active);
  return nationalDigits(value, active).length === c.digits;
}

export function matchQuery(fields, q) {
  const raw = String(q || '').trim().toLowerCase();
  if (!raw) return true;
  let qd = onlyDigits(raw);
  if (qd.startsWith('00')) qd = qd.slice(2);
  if (qd.startsWith('0')) qd = qd.slice(1);
  const text = fields.map((x) => String(x || '').toLowerCase()).join(' ');
  if (text.includes(raw)) return true;
  if (qd.length >= 3) {
    const nums = fields.map((x) => onlyDigits(x)).join(' ');
    if (nums.includes(qd)) return true;
  }
  return false;
}

export function entryFields(e) {
  return [
    e?.name,
    e?.phone,
    e?.dayToken,
    e?.cardNumber,
    e?.employeeId,
    e?.company,
    e?.hostName,
    e?.idNumber,
    e?.managerName,
    e?.managerPhone,
    e?.reason,
    e?.purpose,
  ];
}
