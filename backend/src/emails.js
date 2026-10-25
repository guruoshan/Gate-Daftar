const PUBLIC_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);

export function domainOf(email) {
  const clean = String(email || '').trim().toLowerCase();
  const match = clean.match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/);
  return match ? match[1] : '';
}

export function isPublicEmailDomain(domain) {
  return PUBLIC_DOMAINS.has(String(domain || '').toLowerCase());
}

export function parseDomainList(raw) {
  return String(raw || '')
    .split(/[,\s]+/)
    .map((item) => item.toLowerCase().replace(/^@/, '').trim())
    .filter(Boolean);
}

export function joinDomainList(list) {
  return [...new Set(parseDomainList(Array.isArray(list) ? list.join(',') : list))].join(',');
}

export function emailAllowed(company, email) {
  const domain = domainOf(email);
  if (!domain || isPublicEmailDomain(domain)) return false;
  const allowed = parseDomainList(company?.emailDomains);
  return allowed.includes(domain);
}

export function domainsFromOwner(ownerEmail, extra = '') {
  const list = [...parseDomainList(extra)];
  const ownerDomain = domainOf(ownerEmail);
  if (ownerDomain && !isPublicEmailDomain(ownerDomain)) list.unshift(ownerDomain);
  return joinDomainList(list);
}
