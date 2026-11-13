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

export function isValidTimeZone(tz) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: String(tz || '') });
    return true;
  } catch {
    return false;
  }
}

function partsInZone(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return map;
}

export function localDateString(value, timeZone) {
  const p = partsInZone(new Date(value), timeZone || 'Asia/Riyadh');
  return `${p.year}-${p.month}-${p.day}`;
}

export function formatInZone(value, timeZone, locale = 'en-GB') {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString(locale, {
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

export function dayBounds(localDate, timeZone) {
  const match = String(localDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return dayBounds(localDateString(new Date(), timeZone), timeZone);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const zone = timeZone || 'Asia/Riyadh';
  let guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let i = 0; i < 8; i += 1) {
    const p = partsInZone(new Date(guess), zone);
    const localAsUtc = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    const want = Date.UTC(year, month - 1, day, 0, 0, 0);
    const diff = localAsUtc - want;
    if (diff === 0) break;
    guess -= diff;
  }
  return {
    start: new Date(guess).toISOString(),
    end: new Date(guess + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function todayLocalDate(timeZone) {
  return localDateString(new Date(), timeZone || 'Asia/Riyadh');
}
