import crypto from 'crypto';
import { query } from './db.js';

const authCodes = new Map();
const COOKIE_OWNER = 'gd_owner';
const COOKIE_BOOTH = 'gd_booth';
const MAX_AGE_SECONDS = 60 * 60 * 12;
const CODE_TTL_MS = 10 * 60 * 1000;

function tableFor(role) {
  return role === 'booth' ? 'device_sessions' : 'sessions';
}

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production') return '';
  return 'dev-session-secret';
}

export function signValue(id) {
  const secret = sessionSecret();
  if (!secret || !id) return '';
  const sig = crypto.createHmac('sha256', secret).update(String(id)).digest('base64url');
  return `${id}.${sig}`;
}

export function unsignValue(raw) {
  const text = String(raw || '');
  const idx = text.lastIndexOf('.');
  if (idx < 1) return null;
  const id = text.slice(0, idx);
  const sig = text.slice(idx + 1);
  const expected = signValue(id).slice(id.length + 1);
  if (!expected || sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return id;
}

export async function createSession({ role, siteId, companyId, name, personId }) {
  const session = {
    id: crypto.randomBytes(24).toString('base64url'),
    role,
    siteId: siteId || '',
    companyId: companyId || '',
    name: name || '',
    personId: personId || '',
  };
  const expiresAt = new Date(Date.now() + MAX_AGE_SECONDS * 1000).toISOString();
  await query(
    `INSERT INTO ${tableFor(role)} (id, role, site_id, company_id, name, person_id, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [session.id, role, siteId || null, companyId || null, session.name, session.personId || '', expiresAt],
  );
  return session;
}

export async function getSession(id) {
  if (!id) return null;
  const { rows } = await query(
    `SELECT id, role, site_id, company_id, name, person_id, expires_at,
            'sessions' AS source FROM sessions WHERE id = $1
     UNION ALL
     SELECT id, role, site_id, company_id, name, person_id, expires_at,
            'device_sessions' AS source FROM device_sessions WHERE id = $1
     LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await query(`DELETE FROM ${row.source} WHERE id = $1`, [id]);
    return null;
  }
  return {
    id: row.id,
    role: row.role,
    siteId: row.site_id || '',
    companyId: row.company_id || '',
    name: row.name || '',
    personId: row.person_id || '',
  };
}

export async function resetSessions() {
  await query('TRUNCATE sessions, device_sessions');
  authCodes.clear();
}

export function createAuthCode(email, code) {
  const key = String(email || '').trim().toLowerCase();
  authCodes.set(key, {
    code: code || crypto.randomInt(100000, 999999).toString(),
    expiresAt: Date.now() + CODE_TTL_MS,
  });
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
  appendCookie(res, cookieLine(COOKIE_OWNER, signValue(session.id)));
}

export function setBoothCookie(res, session) {
  appendCookie(res, cookieLine(COOKIE_BOOTH, signValue(session.id)));
}

export async function readSessions(req) {
  const cookies = parseCookies(req);
  const ownerRaw = await getSession(unsignValue(cookies[COOKIE_OWNER]));
  const boothRaw = await getSession(unsignValue(cookies[COOKIE_BOOTH]));
  return {
    owner: ownerRaw && ownerRaw.role === 'owner' ? ownerRaw : null,
    booth: boothRaw && boothRaw.role === 'booth' ? boothRaw : null,
  };
}

export async function requireSiteAccess(req, res, site, roles = ['booth', 'owner']) {
  if (!site) return null;
  const { owner, booth } = await readSessions(req);
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
