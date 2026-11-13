import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  initStore,
  seedDemoIfEmpty,
  createSite,
  publicSite,
  publicGateView,
  getSite,
  getSiteBySlug,
  getSiteByOwnerEmail,
  addPerson,
  snapshot,
  createVisitor,
  createOutPass,
  decideOutPass,
  decideFinal,
  importStaff,
  admitVisitor,
  exitVisitor,
  logOut,
  logIn,
  unapprovedLeave,
  searchEntries,
  getEntry,
  getEntryByToken,
  isMagicTokenExpired,
  subscribe,
  dashboard,
  exportRows,
  listAudit,
  listPeoplePublic,
  listGateRoster,
  listGuards,
  redactEntry,
  staffEntry,
  redactSite,
  redactPerson,
  redactAudit,
  resetGuardPin,
  resetGuardPersonPin,
  findGuardByPin,
  rotateOutPassToken,
  updateSiteTimezone,
} from './store.js';
import { buildXlsx } from './xlsx.js';
import { parseCsv } from './csv.js';
import { healthCheck } from './db.js';
import { COUNTRIES, countryOf, waNumber } from './countries.js';
import { SITE_TIMEZONES } from './time.js';
import { writePid } from './boot.js';
import {
  createSession,
  setOwnerCookie,
  setBoothCookie,
  requireSiteAccess,
  readSessions,
  createAuthCode,
  consumeAuthCode,
} from './sessions.js';
import { verifyPin, isLocked, recordFailure, clearFailures, pinKey } from './pins.js';
import { rateLimit, acquireStream } from './rateLimit.js';
import { sendLoginCode, sendApprovalEmail } from './mailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();

// Only believe the X-Forwarded-For label when the server really sits behind
// your own proxy. Set TRUST_PROXY=1 (one proxy in front) in that case.
const trustProxy = process.env.TRUST_PROXY;
app.set('trust proxy', trustProxy ? (Number.isNaN(Number(trustProxy)) ? trustProxy : Number(trustProxy)) : false);
const PORT = Number(process.env.PORT || 3001);

// Tells browsers to load a page's files over https. Right for a real https release, but on a
// plain http address (your own laptop on Wi-Fi) it makes the page fail with an SSL error.
export function upgradeInsecure(env = process.env) {
  if (env.NODE_ENV !== 'production') return false;
  const origin = String(env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || '');
  return origin === '' || origin.startsWith('https:');
}

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'upgrade-insecure-requests': upgradeInsecure() ? [] : null,
        'default-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-site' },
  }),
);

function allowedOrigins() {
  const fallback = 'http://localhost:5173,http://127.0.0.1:5173';
  const list = (process.env.ALLOWED_ORIGINS || fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.filter((item) => item !== '*');
}

// While testing (not in production), a phone on the same Wi-Fi opens the site by the PC's
// address, such as 192.168.0.222. Only private network addresses count, never real websites.
function isHomeNetworkHost(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function originAllowed(origin) {
  if (!origin) return true;
  if (allowedOrigins().includes(origin)) return true;
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const host = new URL(origin).hostname;
    return host === 'monkeycode-ai.live' || host.endsWith('.monkeycode-ai.live') || isHomeNetworkHost(host);
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  if (!originAllowed(req.headers.origin)) {
    return res.status(403).json({ error: 'origin_not_allowed' });
  }
  return next();
});
app.use(cors({ origin: (origin, cb) => cb(null, originAllowed(origin)), credentials: true }));
app.use(express.json({ limit: '200kb' }));

// PostgreSQL cannot store a null character in text. Refuse it up front with a
// normal error instead of letting the database reject it.
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object' && JSON.stringify(req.body).includes('\\u0000')) {
    return res.status(400).json({ error: 'invalid_characters' });
  }
  return next();
});

export function originFrom(req) {
  if (process.env.PUBLIC_ORIGIN) return process.env.PUBLIC_ORIGIN.replace(/\/+$/, '');
  const proto = req?.protocol || 'http';
  const host = req?.headers?.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

// On hosts such as Render the public address is provided by the host itself.
export function applyHostDefaults(env = process.env) {
  const given = String(env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  if (given) {
    if (!env.PUBLIC_ORIGIN) env.PUBLIC_ORIGIN = given;
    if (!env.ALLOWED_ORIGINS) env.ALLOWED_ORIGINS = given;
  }
  return env;
}

export function shouldSeedDemo(env = process.env) {
  return env.NODE_ENV !== 'production' || env.SEED_DEMO === '1';
}

export function assertStartupConfig(env = process.env) {
  if (env.NODE_ENV === 'production') {
    if (!env.PUBLIC_ORIGIN) {
      throw new Error('PUBLIC_ORIGIN must be set in production. This is the public web address people use in the browser.');
    }
    if (!env.ALLOWED_ORIGINS) {
      throw new Error('ALLOWED_ORIGINS must be set in production. List the websites that may call this server, separated by commas.');
    }
    if (!env.SESSION_SECRET) {
      throw new Error('SESSION_SECRET must be set in production. Use a long random phrase to protect login cookies.');
    }
    // Test releases may skip email when ALLOW_DEV_CODES=1 (sign-in codes then show on screen,
    // so never use that with real company data).
    if (!env.SMTP_URL && env.ALLOW_DEV_CODES !== '1') {
      throw new Error('SMTP_URL must be set in production. Sign-in codes are sent by email.');
    }
  }
}

export const api = express.Router();

// Express 4 does not catch errors thrown inside async handlers, and Node shuts
// the whole server down on them. Send every such error to the error handler.
for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const original = api[method].bind(api);
  api[method] = (path, ...handlers) =>
    original(
      path,
      ...handlers.map((handler) => (req, res, next) =>
        Promise.resolve(handler(req, res, next)).catch(next),
      ),
    );
}

const gateLimit = rateLimit({ name: 'gate', windowMs: 60 * 1000, max: 30, envMax: 'RATE_LIMIT_GATE_MAX' });
const createLimit = rateLimit({ name: 'create', windowMs: 60 * 60 * 1000, max: 20, envMax: 'RATE_LIMIT_CREATE_MAX' });
const unlockLimit = rateLimit({ name: 'unlock', windowMs: 15 * 60 * 1000, max: 30, envMax: 'RATE_LIMIT_UNLOCK_MAX' });
const approveLimit = rateLimit({ name: 'approve', windowMs: 60 * 1000, max: 60 });
const exportLimit = rateLimit({ name: 'export', windowMs: 60 * 60 * 1000, max: 40 });
const ownerLimit = rateLimit({ name: 'owner', windowMs: 15 * 60 * 1000, max: 20 });

function clientMeta(req, session, extra = {}) {
  return {
    ip: String(req.ip || req.socket?.remoteAddress || ''),
    device: String(req.headers['user-agent'] || '').slice(0, 180),
    actor: {
      role: session?.role || extra.role || 'system',
      name: session?.name || extra.name || '',
    },
  };
}

function approvalUrls(req, magicToken) {
  const origin = originFrom(req);
  const pageUrl = `${origin}/a/${magicToken}`;
  return { pageUrl };
}

function whatsappLink(phone, text) {
  const n = waNumber(phone);
  if (!n) return '';
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

function outpassMessage(req, entry, lang = 'ar', magicToken = '') {
  const urls = approvalUrls(req, magicToken);
  if (lang === 'en') {
    return [
      `Out-pass for ${entry.name}`,
      entry.employeeId ? `ID ${entry.employeeId}` : '',
      `Reason: ${entry.reason}`,
      `Duration: ${entry.expectedMinutes} min`,
      `Gate token: ${entry.dayToken}`,
      '',
      `Open this page, then tap Approve or Deny`,
      urls.pageUrl,
    ]
      .filter((line, i, arr) => line !== '' || arr[i - 1] !== '')
      .join('\n');
  }
  return [
    `طلب إذن خروج لـ ${entry.name}`,
    entry.employeeId ? `الرقم الوظيفي ${entry.employeeId}` : '',
    `السبب: ${entry.reason}`,
    `المدة: ${entry.expectedMinutes} دقيقة`,
    `رمز البوابة: ${entry.dayToken}`,
    '',
    `افتح الصفحة ثم اضغط موافقة أو رفض`,
    urls.pageUrl,
  ]
    .filter((line, i, arr) => line !== '' || arr[i - 1] !== '')
    .join('\n');
}

function shareableOutpass(req, entry, lang, magicToken = '') {
  if (!entry) return entry;
  const urls = approvalUrls(req, magicToken);
  const text = outpassMessage(req, entry, lang, magicToken);
  return {
    ...redactEntry(entry),
    pageUrl: urls.pageUrl,
    smsBody: text,
  };
}

function mailApproval(req, entry, magicToken, lang) {
  const shared = shareableOutpass(req, entry, lang, magicToken);
  sendApprovalEmail({
    to: entry.managerEmail,
    pageUrl: shared.pageUrl,
    token: magicToken,
    entry,
    siteName: '',
    lang,
  });
  return shared;
}

// The employee (or guard) taps this to send the manager the one-time approval link on WhatsApp.
function whatsappShare(req, entry, magicToken, lang) {
  const url = whatsappLink(entry.managerPhone, outpassMessage(req, entry, lang, magicToken));
  return url ? { whatsappUrl: url } : null;
}

function waitingView(entry) {
  return {
    ...redactEntry(entry),
    emailed: true,
  };
}

function publicCreated(entry) {
  if (!entry) return entry;
  return {
    id: entry.id,
    kind: entry.kind,
    status: entry.status,
    name: entry.name,
    dayToken: entry.dayToken,
    expectedMinutes: entry.expectedMinutes,
    managerName: entry.managerName,
  };
}

async function siteOr404(req, res) {
  const site = (await getSite(req.params.siteId)) || (await getSiteBySlug(req.params.siteId));
  if (!site) {
    res.status(404).json({ error: 'site_not_found' });
    return null;
  }
  return site;
}

function fail(res, result) {
  const code =
    result.error === 'not_found' ? 404 : result.error === 'invalid_state' ? 409 : 400;
  const body = { error: result.error };
  if (result.entry) body.entry = redactEntry(result.entry);
  if (result.entry?.status) body.status = result.entry.status;
  if (result.expected) body.expected = result.expected;
  return res.status(code).json(body);
}

async function requireAuthed(req, res) {
  const { owner, booth } = await readSessions(req);
  if (!owner && !booth) {
    res.status(401).json({ error: 'auth_required' });
    return null;
  }
  return { owner, booth };
}

async function requireEntrySession(req, res, entryId, roles = ['booth', 'owner']) {
  if (!(await requireAuthed(req, res))) return null;
  const entry = await getEntry(entryId);
  if (!entry) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  const site = await getSite(entry.siteId);
  const session = await requireSiteAccess(req, res, site, roles);
  if (!session) return null;
  return { entry, site, session };
}

function jsonEntry(res, result, extra = {}) {
  if (result.error) return fail(res, result);
  const entry = staffEntry(result.entry);
  return res.json({ entry, ...extra });
}

api.get('/health', async (_req, res) => {
  const db = await healthCheck();
  const ok = db.ok;
  res.status(ok ? 200 : 503).json({ ok, name: 'gate-daftar', database: db });
});

api.get('/countries', (_req, res) => {
  res.json({ countries: COUNTRIES, timezones: SITE_TIMEZONES });
});

api.post('/sites', createLimit, async (req, res) => {
  const { name, ownerName, ownerEmail, lang, pack, countryIso, timezone } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name_required' });
  }
  const { site, pin } = await createSite({ name, ownerName, ownerEmail, lang, pack, countryIso, timezone });
  const session = await createSession({
    role: 'owner',
    siteId: site.id,
    companyId: site.companyId,
    name: site.ownerName || 'Owner',
  });
  setOwnerCookie(res, session);
  res.json({
    site: {
      ...publicSite(site),
      guardPin: pin,
      ownerName: site.ownerName,
    },
  });
});

api.get('/sites/:siteId', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  res.json({ site: publicSite(site), country: countryOf(site.countryIso) });
});

api.get('/sites/:siteId/public', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  res.json(publicGateView(site, await listGateRoster(site.id)));
});

api.get('/sites/:siteId/guards', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  res.json({ guards: await listGuards(site.id) });
});

api.post('/guard/unlock', unlockLimit, async (req, res) => {
  const { pin, slug, personId } = req.body || {};
  const cleanSlug = String(slug || '').trim();
  if (!cleanSlug) return res.status(400).json({ error: 'slug_required' });
  const site = await getSiteBySlug(cleanSlug);
  const ip = String(req.ip || req.socket?.remoteAddress || '');
  if (!site) return res.status(401).json({ error: 'bad_pin' });
  const key = pinKey(site.id, ip);
  const lock = isLocked(key);
  if (lock.locked) {
    res.set('Retry-After', String(Math.ceil(lock.retryAfterMs / 1000)));
    return res.status(429).json({ error: 'locked_out', retryAfterMs: lock.retryAfterMs });
  }
  let actorName = 'Booth';
  let actorPersonId = '';
  const named = personId ? await findGuardByPin(site.id, pin) : null;
  const namedMatch = named && (!personId || named.id === personId);
  const sharedOk = verifyPin(String(pin || ''), site.guardPinHash);
  if (namedMatch) {
    actorName = named.name;
    actorPersonId = named.id;
  } else if (!sharedOk) {
    recordFailure(key);
    return res.status(401).json({ error: 'bad_pin' });
  }
  clearFailures(key);
  const session = await createSession({
    role: 'booth',
    siteId: site.id,
    companyId: site.companyId,
    name: actorName,
    personId: actorPersonId,
  });
  setBoothCookie(res, session);
  res.json({ site: publicSite(site), guard: actorPersonId ? { id: actorPersonId, name: actorName } : null });
});

api.post('/sites/:siteId/timezone', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  const session = await requireSiteAccess(req, res, site, ['owner']);
  if (!session) return;
  const result = await updateSiteTimezone(site.id, req.body?.timezone, clientMeta(req, session));
  if (result.error) return fail(res, result);
  res.json({ site: redactSite(publicSite(result.site)) });
});

api.post('/sites/:siteId/pin/reset', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  const session = await requireSiteAccess(req, res, site, ['owner']);
  if (!session) return;
  const result = await resetGuardPin(site.id, clientMeta(req, session));
  if (result.error) return fail(res, result);
  res.json({ pin: result.pin });
});

api.post('/owner/request-code', ownerLimit, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email_required' });
  const site = await getSiteByOwnerEmail(email);
  if (site) {
    const rec = createAuthCode(email);
    try {
      sendLoginCode(email, rec.code);
    } catch {
      return res.status(503).json({ error: 'mail_not_configured' });
    }
    if (process.env.NODE_ENV === 'test' || process.env.ALLOW_DEV_CODES === '1') {
      return res.json({ ok: true, devCode: rec.code });
    }
  }
  res.json({ ok: true });
});

api.post('/owner/verify', ownerLimit, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  if (!email || !code) return res.status(400).json({ error: 'email_and_code_required' });
  if (!consumeAuthCode(email, code)) return res.status(401).json({ error: 'bad_code' });
  // An owner with several gates can say which one to open by sending its slug.
  const wanted = String(req.body?.slug || '').trim();
  const picked = wanted ? await getSiteBySlug(wanted) : null;
  const pickedOk = picked && String(picked.ownerEmail || '').trim().toLowerCase() === email ? picked : null;
  const site = pickedOk || (await getSiteByOwnerEmail(email));
  if (!site) return res.status(401).json({ error: 'bad_code' });
  const session = await createSession({
    role: 'owner',
    siteId: site.id,
    companyId: site.companyId,
    name: site.ownerName || 'Owner',
  });
  setOwnerCookie(res, session);
  res.json({ ok: true, site: publicSite(site) });
});

api.get('/sites/:siteId/snapshot', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  if (!(await requireSiteAccess(req, res, site, ['booth', 'owner']))) return;
  const snap = await snapshot(site.id);
  res.json({
    ...snap,
    country: countryOf(site.countryIso),
  });
});

api.get('/sites/:siteId/stream', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  if (!(await requireSiteAccess(req, res, site, ['booth', 'owner']))) return;
  const slot = acquireStream(site.id, req);
  if (!slot.ok) return res.status(429).json({ error: 'too_many_streams' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  send('hello', { ok: true, siteId: site.id });
  const unsub = subscribe(site.id, (msg) => {
    if (msg.type === 'delta') send('delta', msg.payload);
    else if (msg.type === 'entries' || msg.type === 'people') return;
    else send('delta', { entity: msg.type, payload: msg.payload });
  });
  const ping = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);
  req.on('close', () => {
    clearInterval(ping);
    unsub();
    slot.release();
  });
});

api.get('/sites/:siteId/people', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  if (!(await requireSiteAccess(req, res, site, ['booth', 'owner']))) return;
  res.json({ people: await listPeoplePublic(site.id) });
});

api.post('/sites/:siteId/people', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  const session = await requireSiteAccess(req, res, site, ['booth', 'owner']);
  if (!session) return;
  const { name, role, phone, email, managerPhone, managerId, employeeId } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  // The shared booth login may register employees, but only the owner can create
  // managers (who approve out-passes) and guards (who get their own PIN).
  if (session.role !== 'owner' && (role === 'manager' || role === 'guard')) {
    return res.status(403).json({ error: 'owner_only' });
  }
  const result = await addPerson(
    site.id,
    { name, role, phone, email, managerPhone, managerId, employeeId },
    clientMeta(req, session),
  );
  if (result.error) return fail(res, result);
  const body = { person: redactPerson(result.person, { includeEmail: result.person.role === 'manager' }) };
  if (result.pin) body.pin = result.pin;
  res.json(body);
});

api.post('/sites/:siteId/people/import', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  const session = await requireSiteAccess(req, res, site, ['owner']);
  if (!session) return;
  const csv = req.body?.csv;
  if (typeof csv !== 'string' || !csv.trim()) return res.status(400).json({ error: 'empty_file' });
  const result = await importStaff(site.id, parseCsv(csv), clientMeta(req, session));
  if (result.error) return fail(res, result);
  res.json(result);
});

api.post('/sites/:siteId/visitors', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  const session = await requireSiteAccess(req, res, site, ['booth', 'owner']);
  if (!session) return;
  const { name, phone, company, purpose, hostName, idNumber, cardNumber } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  const result = await createVisitor(
    {
      siteId: site.id,
      name,
      phone,
      company,
      purpose,
      hostName,
      idNumber,
      cardNumber,
      source: 'guard',
    },
    clientMeta(req, session),
  );
  if (result.error) return fail(res, result);
  res.status(200).json({ entry: redactEntry(result.entry) });
});

api.post('/sites/:siteId/outpass', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  const session = await requireSiteAccess(req, res, site, ['booth', 'owner']);
  if (!session) return;
  const { reason, expectedMinutes, personId, managerId, phone, company } = req.body || {};
  if (!personId) return res.status(400).json({ error: 'person_required' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'reason_required' });
  const result = await createOutPass(
    {
      siteId: site.id,
      phone,
      company,
      reason,
      expectedMinutes,
      source: 'guard',
      personId,
      managerId,
    },
    clientMeta(req, session),
  );
  if (result.error) return fail(res, result);
  const lang = req.body?.lang === 'en' ? 'en' : site.lang;
  try {
    if (result.entry.managerEmail) mailApproval(req, result.entry, result.magicToken, lang);
  } catch {
    return res.status(503).json({ error: 'mail_not_configured', entry: waitingView(result.entry) });
  }
  res.json({ entry: waitingView(result.entry), share: whatsappShare(req, result.entry, result.magicToken, lang) });
});

api.post('/sites/:siteId/gate/visitor', gateLimit, async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  const { name, phone, company, purpose, hostName, idNumber, cardNumber } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  const result = await createVisitor(
    {
      siteId: site.id,
      name,
      phone,
      company,
      purpose,
      hostName,
      idNumber,
      cardNumber,
      source: 'qr',
    },
    clientMeta(req, null, { role: 'visitor', name }),
  );
  if (result.error) return fail(res, result);
  res.status(201).json({ entry: publicCreated(result.entry) });
});

api.post('/sites/:siteId/gate/outpass', gateLimit, async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  const { reason, expectedMinutes, personId, managerId, phone, company } = req.body || {};
  if (!personId) return res.status(400).json({ error: 'person_required' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'reason_required' });
  const result = await createOutPass(
    {
      siteId: site.id,
      phone,
      company,
      reason,
      expectedMinutes,
      source: 'qr',
      personId,
      managerId,
    },
    clientMeta(req, null, { role: 'employee', name: '' }),
  );
  if (result.error) return fail(res, result);
  const lang = req.body?.lang === 'en' ? 'en' : site.lang;
  try {
    if (result.entry.managerEmail) mailApproval(req, result.entry, result.magicToken, lang);
  } catch {
    return res.status(503).json({ error: 'mail_not_configured', entry: publicCreated(result.entry) });
  }
  res.status(201).json({ entry: publicCreated(result.entry), share: whatsappShare(req, result.entry, result.magicToken, lang) });
});

api.post('/entries/:id/resend', async (req, res) => {
  const found = await requireEntrySession(req, res, req.params.id, ['booth', 'owner']);
  if (!found) return;
  const rotated = await rotateOutPassToken(found.entry.id);
  if (rotated.error) return fail(res, rotated);
  const lang = req.body?.lang === 'en' ? 'en' : found.site.lang;
  try {
    mailApproval(req, rotated.entry, rotated.magicToken, lang);
  } catch {
    return res.status(503).json({ error: 'mail_not_configured' });
  }
  res.json({ entry: waitingView(rotated.entry) });
});

api.get('/sites/:siteId/search', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  if (!(await requireSiteAccess(req, res, site, ['booth', 'owner']))) return;
  const found = await searchEntries(site.id, req.query.q, {
    cursor: req.query.cursor,
    limit: Number(req.query.limit) || 100,
  });
  res.json({
    entries: found.entries.map(staffEntry),
    nextCursor: found.nextCursor,
    total: found.total,
  });
});

api.get('/sites/:siteId/dashboard', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  if (!(await requireSiteAccess(req, res, site, ['owner']))) return;
  res.json({
    site: redactSite(publicSite(site)),
    stats: await dashboard(site.id, req.query.day),
    audit: (await listAudit(site.id, 40)).map(redactAudit),
  });
});

api.get('/sites/:siteId/audit', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  if (!(await requireSiteAccess(req, res, site, ['owner']))) return;
  res.json({ audit: (await listAudit(site.id, Number(req.query.limit) || 200)).map(redactAudit) });
});

api.get('/sites/:siteId/export', exportLimit, async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  if (!(await requireSiteAccess(req, res, site, ['owner']))) return;
  const rows = await exportRows(site.id, {
    from: req.query.from,
    to: req.query.to,
    status: req.query.status,
    kind: req.query.kind,
    day: req.query.day,
  });
  const headers = [
    'id',
    'kind',
    'status',
    'name',
    'phone',
    'employeeId',
    'company',
    'purpose',
    'hostName',
    'reason',
    'managerName',
    'managerPhone',
    'dayToken',
    'source',
    'createdAt',
    'admittedAt',
    'exitedAt',
    'outAt',
    'inAt',
    'dueAt',
  ];
  const csvCell = (v) => {
    let text = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const body = [headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n');
  const fmt = String(req.query.format || 'json').toLowerCase();
  if (fmt === 'csv' || fmt === 'xls') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gate-daftar-${site.slug}.csv"`);
    return res.send(`\uFEFF${body}`);
  }
  if (fmt === 'xlsx' || fmt === 'excel') {
    const workbook = buildXlsx(rows, headers);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="gate-daftar-${site.slug}.xlsx"`);
    return res.send(workbook);
  }
  res.json({ rows });
});

api.post('/entries/:id/admit', async (req, res) => {
  const found = await requireEntrySession(req, res, req.params.id);
  if (!found) return;
  jsonEntry(res, await admitVisitor(found.entry.id, clientMeta(req, found.session)));
});

api.post('/entries/:id/exit', async (req, res) => {
  const found = await requireEntrySession(req, res, req.params.id);
  if (!found) return;
  jsonEntry(res, await exitVisitor(found.entry.id, clientMeta(req, found.session)));
});

api.post('/entries/:id/out', async (req, res) => {
  const found = await requireEntrySession(req, res, req.params.id);
  if (!found) return;
  jsonEntry(res, await logOut(found.entry.id, clientMeta(req, found.session)));
});

api.post('/entries/:id/in', async (req, res) => {
  const found = await requireEntrySession(req, res, req.params.id);
  if (!found) return;
  jsonEntry(res, await logIn(found.entry.id, clientMeta(req, found.session)));
});

api.post('/entries/:id/unapproved', async (req, res) => {
  const found = await requireEntrySession(req, res, req.params.id);
  if (!found) return;
  jsonEntry(res, await unapprovedLeave(found.entry.id, req.body?.reason || '', clientMeta(req, found.session)));
});

function approveView(entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    status: entry.status,
    name: entry.name,
    employeeId: entry.employeeId,
    reason: entry.reason,
    expectedMinutes: entry.expectedMinutes,
    managerName: entry.managerName,
    dayToken: entry.dayToken,
    denyReason: entry.denyReason,
    decidedAt: entry.decidedAt,
    requestedAt: entry.requestedAt,
  };
}

api.get('/approve/:token', async (req, res) => {
  const entry = await getEntryByToken(req.params.token);
  if (!entry) return res.status(404).json({ error: 'not_found' });
  if (isMagicTokenExpired(entry)) return res.status(410).json({ error: 'token_expired' });
  const site = await getSite(entry.siteId);
  res.json({
    entry: approveView(entry),
    site: publicSite(site),
  });
});

api.post('/approve/:token', approveLimit, async (req, res) => {
  const decision = req.body?.decision === 'deny' ? 'deny' : 'approve';
  const entryPeek = await getEntryByToken(req.params.token);
  const result = await decideOutPass(
    req.params.token,
    decision,
    req.body?.denyReason || '',
    clientMeta(req, null, { role: 'manager', name: entryPeek?.managerName || 'Manager' }),
  );
  if (result.error === 'not_found') return res.status(404).json({ error: result.error });
  if (result.error === 'token_expired') return res.status(410).json({ error: result.error });
  if (result.error) return fail(res, result);
  res.json({ entry: approveView(result.entry) });
});

api.post('/entries/:id/final', async (req, res) => {
  const found = await requireEntrySession(req, res, req.params.id, ['owner']);
  if (!found) return;
  const decision = req.body?.decision === 'deny' ? 'deny' : 'approve';
  const result = await decideFinal(
    found.entry.id,
    decision,
    req.body?.reason || '',
    { name: found.session.name },
    clientMeta(req, found.session),
  );
  return jsonEntry(res, result);
});

api.get('/entries/:id', async (req, res) => {
  const found = await requireEntrySession(req, res, req.params.id, ['booth', 'owner']);
  if (!found) return;
  res.json({
    entry: staffEntry(found.entry),
    site: redactSite(publicSite(found.site)),
  });
});

app.use('/api', api);
app.use('/api/v1', api);

function readOpenApi() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../openapi.json'), 'utf8'));
  } catch {
    return null;
  }
}

app.get('/api/v1/openapi.json', (_req, res) => res.json(readOpenApi()));
app.get('/api/openapi.json', (_req, res) => res.json(readOpenApi()));

// When the website has been built (frontend/dist), this same server shows it, so the whole
// app lives at one address. That keeps sign-in cookies and live updates simple.
const staticCache = new Map();
function frontendFiles() {
  const dir = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '../../frontend/dist'));
  if (!fs.existsSync(path.join(dir, 'index.html'))) return null;
  if (!staticCache.has(dir)) {
    staticCache.set(
      dir,
      express.static(dir, {
        index: false,
        setHeaders: (res, file) => {
          if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
  }
  return { dir, files: staticCache.get(dir) };
}

app.use((req, res, next) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/') || req.path === '/api') return next();
  const site = frontendFiles();
  if (!site) return next();
  return site.files(req, res, () => {
    if (path.extname(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(path.join(site.dir, 'index.html'));
  });
});

// Last line of defence: any error becomes a plain error answer, never a crash.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err?.status || err?.statusCode) || 500;
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: 'bad_request' });
  }
  process.stderr.write(`request failed: ${req.method} ${req.path}: ${err?.message || err}\n`);
  return res.status(500).json({ error: 'server_error' });
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`unhandled rejection (server kept running): ${reason?.message || reason}\n`);
});

export async function start() {
  applyHostDefaults();
  assertStartupConfig();
  await initStore({ seed: shouldSeedDemo() });
  writePid();
  const server = app.listen(PORT, '0.0.0.0', () => {
    process.stdout.write(`gate-daftar api on ${PORT}\n`);
  });
  server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 30000);
  server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 20000);
  return server;
}

const launchedDirectly =
  Boolean(process.argv[1]) &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (launchedDirectly) {
  start();
}

export { seedDemoIfEmpty };
