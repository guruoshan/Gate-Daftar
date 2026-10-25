const TZ_BY_COUNTRY = {
  SA: 'Asia/Riyadh',
  AE: 'Asia/Dubai',
  OM: 'Asia/Muscat',
  KW: 'Asia/Kuwait',
  QA: 'Asia/Qatar',
  BH: 'Asia/Bahrain',
  IN: 'Asia/Kolkata',
  EG: 'Africa/Cairo',
  JO: 'Asia/Amman',
  PK: 'Asia/Karachi',
  BD: 'Asia/Dhaka',
};

export const SITE_TIMEZONES = [...new Set(Object.values(TZ_BY_COUNTRY))];

export function timezoneForCountry(iso) {
  return TZ_BY_COUNTRY[String(iso || 'SA').toUpperCase()] || 'Asia/Riyadh';
}

export function todayLocalDate(timeZone) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = {};
  for (const part of p) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

export function formatInZone(value, timeZone, lang = 'ar') {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString(lang === 'en' ? 'en-GB' : 'ar-SA', {
      timeZone: timeZone || 'Asia/Riyadh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return String(value);
  }
}

export function formatTimeInZone(value, timeZone, lang = 'ar') {
  if (!value) return '';
  try {
    return new Date(value).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'ar-SA', {
      timeZone: timeZone || 'Asia/Riyadh',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return String(value).slice(11, 16);
  }
}
