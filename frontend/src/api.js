async function req(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'request_failed');
    err.body = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  health: () => req('/api/v1/health'),
  createSite: (body) => req('/api/v1/owner/signup', { method: 'POST', body: JSON.stringify(body) }),
  signup: (body) => req('/api/v1/owner/signup', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => req('/api/v1/owner/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => req('/api/v1/owner/logout', { method: 'POST', body: '{}' }),
  me: () => req('/api/v1/owner/me'),
  addGate: (companyId, body) =>
    req(`/api/v1/companies/${companyId}/sites`, { method: 'POST', body: JSON.stringify(body) }),
  site: (id) => req(`/api/v1/sites/${id}`),
  publicSite: (id) => req(`/api/v1/sites/${id}/public`),
  snapshot: (id, lang) => req(`/api/v1/sites/${id}/snapshot?lang=${lang || 'ar'}`),
  unlock: (body) => req('/api/v1/guard/unlock', { method: 'POST', body: JSON.stringify(body) }),
  guards: (id) => req(`/api/v1/sites/${id}/guards`),
  resetPin: (id) => req(`/api/v1/sites/${id}/pin/reset`, { method: 'POST', body: '{}' }),
  forgot: (email) => req('/api/v1/owner/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  resetGet: (token) => req(`/api/v1/owner/reset/${token}`),
  resetPost: (token, body) =>
    req(`/api/v1/owner/reset/${token}`, { method: 'POST', body: JSON.stringify(body) }),
  setTimezone: (id, timezone) =>
    req(`/api/v1/sites/${id}/timezone`, { method: 'POST', body: JSON.stringify({ timezone }) }),

  people: (id) => req(`/api/v1/sites/${id}/people`),
  addPerson: (id, body) => req(`/api/v1/sites/${id}/people`, { method: 'POST', body: JSON.stringify(body) }),
  requestAdd: (id, body) =>
    req(`/api/v1/sites/${id}/people/request-add`, { method: 'POST', body: JSON.stringify(body) }),
  gateRequestAdd: (id, body) =>
    req(`/api/v1/sites/${id}/gate/request-add`, { method: 'POST', body: JSON.stringify(body) }),
  importPeople: (id, csv) =>
    req(`/api/v1/sites/${id}/people/import`, { method: 'POST', body: JSON.stringify({ csv }) }),
  downloadPeopleSample: async (id) => {
    const res = await fetch(`/api/v1/sites/${id}/people/sample.csv`, { credentials: 'include' });
    if (!res.ok) throw new Error('request_failed');
    return res.blob();
  },
  visitor: (id, body) => req(`/api/v1/sites/${id}/visitors`, { method: 'POST', body: JSON.stringify(body) }),
  outpass: (id, body) => req(`/api/v1/sites/${id}/outpass`, { method: 'POST', body: JSON.stringify(body) }),
  gateVisitor: (id, body) => req(`/api/v1/sites/${id}/gate/visitor`, { method: 'POST', body: JSON.stringify(body) }),
  gateOutpass: (id, body) => req(`/api/v1/sites/${id}/gate/outpass`, { method: 'POST', body: JSON.stringify(body) }),
  search: (id, q, cursor = '', limit = 100) => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (cursor) qs.set('cursor', cursor);
    if (limit) qs.set('limit', String(limit));
    return req(`/api/v1/sites/${id}/search?${qs.toString()}`);
  },
  admit: (eid) => req(`/api/v1/entries/${eid}/admit`, { method: 'POST', body: '{}' }),
  exit: (eid) => req(`/api/v1/entries/${eid}/exit`, { method: 'POST', body: '{}' }),
  logOut: (eid) => req(`/api/v1/entries/${eid}/out`, { method: 'POST', body: '{}' }),
  logIn: (eid) => req(`/api/v1/entries/${eid}/in`, { method: 'POST', body: '{}' }),
  unapproved: (eid, reason) =>
    req(`/api/v1/entries/${eid}/unapproved`, { method: 'POST', body: JSON.stringify({ reason }) }),
  resend: (eid, lang) =>
    req(`/api/v1/entries/${eid}/resend`, { method: 'POST', body: JSON.stringify({ lang }) }),
  approveGet: (token) => req(`/api/v1/approve/${token}`),
  approvePost: (token, decision, denyReason) =>
    req(`/api/v1/approve/${token}`, { method: 'POST', body: JSON.stringify({ decision, denyReason }) }),
  dashboard: (id, day) =>
    req(`/api/v1/sites/${id}/dashboard${day ? `?day=${encodeURIComponent(day)}` : ''}`),
  audit: (id, limit = 200) => req(`/api/v1/sites/${id}/audit?limit=${limit}`),
  countries: () => req('/api/v1/countries'),
};

export function exportUrl(siteId, format = 'csv', extra = {}) {
  const q = new URLSearchParams();
  q.set('format', format);
  if (extra.kind) q.set('kind', extra.kind);
  if (extra.status) q.set('status', extra.status);
  if (extra.from) q.set('from', extra.from);
  if (extra.to) q.set('to', extra.to);
  if (extra.day) q.set('day', extra.day);
  return `/api/v1/sites/${siteId}/export?${q.toString()}`;
}

export function streamUrl(siteId, lang) {
  return `/api/v1/sites/${siteId}/stream?lang=${lang || 'ar'}`;
}

export function publicize(value) {
  if (!value || typeof window === 'undefined') return value;
  return String(value).replace(/https?:\/\/(localhost|127\.0\.0\.1):3001/g, window.location.origin);
}
