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
  createSite: (body) => req('/api/v1/sites', { method: 'POST', body: JSON.stringify(body) }),
  site: (id) => req(`/api/v1/sites/${id}`),
  publicSite: (id) => req(`/api/v1/sites/${id}/public`),
  snapshot: (id, lang) => req(`/api/v1/sites/${id}/snapshot?lang=${lang || 'ar'}`),
  unlock: (body) => req('/api/v1/guard/unlock', { method: 'POST', body: JSON.stringify(body) }),
  resetPin: (id) => req(`/api/v1/sites/${id}/pin/reset`, { method: 'POST', body: '{}' }),
  requestCode: (body) => req('/api/v1/owner/request-code', { method: 'POST', body: JSON.stringify(body) }),
  verifyCode: (body) => req('/api/v1/owner/verify', { method: 'POST', body: JSON.stringify(body) }),
  people: (id) => req(`/api/v1/sites/${id}/people`),
  addPerson: (id, body) => req(`/api/v1/sites/${id}/people`, { method: 'POST', body: JSON.stringify(body) }),
  visitor: (id, body) => req(`/api/v1/sites/${id}/visitors`, { method: 'POST', body: JSON.stringify(body) }),
  outpass: (id, body) => req(`/api/v1/sites/${id}/outpass`, { method: 'POST', body: JSON.stringify(body) }),
  gateVisitor: (id, body) => req(`/api/v1/sites/${id}/gate/visitor`, { method: 'POST', body: JSON.stringify(body) }),
  gateOutpass: (id, body) => req(`/api/v1/sites/${id}/gate/outpass`, { method: 'POST', body: JSON.stringify(body) }),
  search: (id, q) => req(`/api/v1/sites/${id}/search?q=${encodeURIComponent(q || '')}`),
  admit: (eid) => req(`/api/v1/entries/${eid}/admit`, { method: 'POST', body: '{}' }),
  exit: (eid) => req(`/api/v1/entries/${eid}/exit`, { method: 'POST', body: '{}' }),
  logOut: (eid) => req(`/api/v1/entries/${eid}/out`, { method: 'POST', body: '{}' }),
  logIn: (eid) => req(`/api/v1/entries/${eid}/in`, { method: 'POST', body: '{}' }),
  unapproved: (eid, reason) =>
    req(`/api/v1/entries/${eid}/unapproved`, { method: 'POST', body: JSON.stringify({ reason }) }),
  approveGet: (token) => req(`/api/v1/approve/${token}`),
  approvePost: (token, decision, denyReason) =>
    req(`/api/v1/approve/${token}`, { method: 'POST', body: JSON.stringify({ decision, denyReason }) }),
  dashboard: (id) => req(`/api/v1/sites/${id}/dashboard`),
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
  return `/api/v1/sites/${siteId}/export?${q.toString()}`;
}

export function streamUrl(siteId, lang) {
  return `/api/v1/sites/${siteId}/stream?lang=${lang || 'ar'}`;
}

export function publicize(value) {
  if (!value || typeof window === 'undefined') return value;
  return String(value).replace(/https?:\/\/(localhost|127\.0\.0\.1):3001/g, window.location.origin);
}

export function outpassShareText(entry) {
  if (!entry) return '';
  return publicize(entry.smsBody || entry.pageUrl || '');
}

export async function shareOutpass(entry) {
  const text = outpassShareText(entry);
  const url = publicize(entry?.pageUrl || '');
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Gate Daftar', text, url: url || undefined });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'abort';
    }
  }
  if (text) await navigator.clipboard.writeText(text);
  return 'copied';
}
