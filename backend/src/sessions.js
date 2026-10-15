import crypto from 'crypto';

const sessions = new Map();
const authCodes = new Map();
const COOKIE_OWNER = 'gd_owner';
const COOKIE_BOOTH = 'gd_booth';
const MAX_AGE_SECONDS = 60 * 60 * 12;
const MAX_AGE_MS = MAX_AGE_SECONDS * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;

export function createSession({ role, siteId, companyId, name }) {
  const id = crypto.randomBytes(24).toString('base64url');
  const session = {
    id,
    role,
    siteId: siteId || '',
    companyId: companyId || '',
    name: name || '',
    createdAt: Date.now(),
    expiresAt: Date.now() + MAX_AGE_MS,
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expiresAt && Date.now() > session.expiresAt) {
    sessions.delete(id);
    return null;
  }
  return session;
}

export function resetSessions() {
  sessions.clear();
  authCodes.clear();
}

export function createAuthCode(email, code) {
  const key = String(email || '').trim().toLowerCase();
  authCodes.set(key, { code: code || crypto.randomInt(100000, 999999).toString(), expiresAt: Date.now() + CODE_TTL_MS });
  return authCodes.get(key);
}

export function consumeAuthCode(email, code) {
  const key = String(email || '').trim().toLowerCase();
  const rec = authCodes.get(key);
  if (!rec) return false;
  if (Date.now() > rec.expiresAt) {
    authCodes.delete(key);
    return false;
  }
  const ok = String(rec.code) === String(code);
  if (ok) authCodes.delete(key);
  return ok;
}

export function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function cookieLine(name, value) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

function appendCookie(res, line) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', line);
    return;
  }
  const list = Array.isArray(prev) ? prev : [prev];
  res.setHeader('Set-Cookie', [...list, line]);
}

export function setOwnerCookie(res, session) {
  appendCookie(res, cookieLine(COOKIE_OWNER, session.id));
}

export function setBoothCookie(res, session) {
  appendCookie(res, cookieLine(COOKIE_BOOTH, session.id));
}

export function readSessions(req) {
  const cookies = parseCookies(req);
  const ownerRaw = getSession(cookies[COOKIE_OWNER]);
  const boothRaw = getSession(cookies[COOKIE_BOOTH]);
  return {
    owner: ownerRaw && ownerRaw.role === 'owner' ? ownerRaw : null,
    booth: boothRaw && boothRaw.role === 'booth' ? boothRaw : null,
  };
}

export function requireSiteAccess(req, res, site, roles = ['booth', 'owner']) {
  if (!site) return null;
  const { owner, booth } = readSessions(req);
  const present = [owner, booth].filter(Boolean);
  if (present.length === 0) {
    res.status(401).json({ error: 'auth_required' });
    return null;
  }
  const match = present.find((s) => s.siteId === site.id && roles.includes(s.role));
  if (!match) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return match;
}
