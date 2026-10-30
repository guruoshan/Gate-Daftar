import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  initStore,
  seedDemoIfEmpty,
  createCompany,
  addSite,
  publicSite,
  publicCompany,
  publicGateView,
  getSite,
  getSiteBySlug,
  getCompany,
  getUserByEmail,
  listSitesByCompany,
  addPerson,
  snapshot,
  createVisitor,
  createOutPass,
  decideOutPass,
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
  redactSite,
  redactPerson,
  redactAudit,
  resetGuardPin,
  findSiteByPin,
  verifySitePin,
  requestPasswordReset,
  getPasswordResetByToken,
  completePasswordReset,
  rotateOutPassToken,
  updateSiteTimezone,
  createPersonAdd,
  getPersonAddByToken,
  decidePersonAdd,
  publicPersonAdd,
  importPeopleCsv,
} from './store.js';
import { buildXlsx } from './xlsx.js';
import { healthCheck } from './db.js';
import { COUNTRIES, countryOf, waNumber } from './countries.js';
import { SITE_TIMEZONES } from './time.js';
import { writePid } from './boot.js';
import {
  createSession,
  setOwnerCookie,
  clearOwnerCookie,
  setBoothCookie,
  requireSiteAccess,
  requireCompanyAccess,
  readSessions,
  deleteSession,
} from './sessions.js';
import { verifyPassword, isLocked, recordFailure, clearFailures, pinKey } from './pins.js';
import { rateLimit, acquireStream } from './rateLimit.js';
import { sendApprovalEmail, sendPersonAddEmail, sendPasswordResetEmail } from './mailer.js';
import { isExpired } from './tokens.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
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

function originAllowed(origin) {
  if (!origin) return true;
  if (allowedOrigins().includes(origin)) return true;
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const host = new URL(origin).hostname;
    return host === 'monkeycode-ai.live' || host.endsWith('.monkeycode-ai.live');
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

export function originFrom(req) {
  if (process.env.PUBLIC_ORIGIN) return process.env.PUBLIC_ORIGIN.replace(/\/+$/, '');
  const proto = req?.protocol || 'http';
  const host = req?.headers?.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
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
    if (!env.SMTP_URL) {
      throw new Error('SMTP_URL must be set in production. Manager approval is sent by company email.');
    }
  }
}

export const api = express.Router();

const gateLimit = rateLimit({ name: 'gate', windowMs: 60 * 1000, max: 30, envMax: 'RATE_LIMIT_GATE_MAX' });
const createLimit = rateLimit({ name: 'create', windowMs: 60 * 60 * 1000, max: 20, envMax: 'RATE_LIMIT_CREATE_MAX' });
const unlockLimit = rateLimit({ name: 'unlock', windowMs: 15 * 60 * 1000, max: 30, envMax: 'RATE_LIMIT_UNLOCK_MAX' });
const approveLimit = rateLimit({ name: 'approve', windowMs: 60 * 1000, max: 60 });
const exportLimit = rateLimit({ name: 'export', windowMs: 60 * 60 * 1000, max: 40 });
const ownerLimit = rateLimit({ name: 'owner', windowMs: 15 * 60 * 1000, max: 20 });
const importLimit = rateLimit({ name: 'people-import', windowMs: 60 * 60 * 1000, max: 10 });

function clientMeta(req, session, extra = {}) {
  return {
    ip: String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim(),
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

function mailPersonAdd(req, request, manager, magicToken, lang) {
  const urls = approvalUrls(req, magicToken);
  sendPersonAddEmail({
    to: manager.email,
    pageUrl: urls.pageUrl,
    token: magicToken,
    request,
    siteName: '',
    lang,
  });
  return publicPersonAdd(request);
}

const PEOPLE_SAMPLE_CSV =
  '\uFEFFRole,Name,Employee ID,Work email,Phone,Manager name\nmanager,Khalid Al-Harbi,M-01,khalid@example.com,,\nemployee,Yousef Hassan,E-104,,,Khalid Al-Harbi\n';

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
    result.error === 'not_found'
      ? 404
      : result.error === 'invalid_state' ||
          result.error === 'email_taken' ||
          result.error === 'already_on_list' ||
          result.error === 'employee_id_taken'
        ? 409
        : 400;
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
  const entry = redactEntry(result.entry);
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

async function signupOwner(req, res) {
  const body = req.body || {};
  const companyName = String(body.companyName || body.name || '').trim();
  const ownerEmail = String(body.ownerEmail || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!companyName) return res.status(400).json({ error: 'name_required' });
  if (!ownerEmail) return res.status(400).json({ error: 'email_required' });
  if (password.length < 8) return res.status(400).json({ error: 'password_short' });
  const result = await createCompany({
    companyName,
    name: companyName,
    ownerName: body.ownerName,
    ownerEmail,
    password,
    lang: body.lang,
    pack: body.pack,
    countryIso: body.countryIso,
    timezone: body.timezone,
  });
  if (result.error) return fail(res, result);
  const { company } = result;
  const session = await createSession({
    role: 'owner',
    siteId: '',
    companyId: company.id,
    name: body.ownerName || 'Owner',
  });
  setOwnerCookie(res, session);
  return res.json({
    company: publicCompany(company),
    sites: [],
  });
}

api.post('/sites', createLimit, signupOwner);
api.post('/owner/signup', createLimit, signupOwner);

api.post('/owner/login', ownerLimit, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(401).json({ error: 'bad_login' });
  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'bad_login' });
  }
  const company = await getCompany(user.companyId);
  const sites = await listSitesByCompany(user.companyId);
  const session = await createSession({
    role: 'owner',
    siteId: sites[0]?.id || '',
    companyId: user.companyId,
    name: sites[0]?.ownerName || 'Owner',
  });
  setOwnerCookie(res, session);
  res.json({ company: publicCompany(company), sites: sites.map(publicSite) });
});

api.post('/owner/logout', async (req, res) => {
  const { owner } = await readSessions(req);
  if (owner) await deleteSession(owner.id);
  clearOwnerCookie(res);
  res.json({ ok: true });
});

api.get('/owner/me', async (req, res) => {
  const { owner } = await readSessions(req);
  if (!owner) return res.status(401).json({ error: 'auth_required' });
  const company = await getCompany(owner.companyId);
  const sites = await listSitesByCompany(owner.companyId);
  res.json({ company: publicCompany(company), sites: sites.map(publicSite) });
});

api.post('/owner/forgot', ownerLimit, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const result = await requestPasswordReset(email);
  if (result.magicToken && result.user) {
    const origin = originFrom(req);
    sendPasswordResetEmail({
      to: result.user.email,
      pageUrl: `${origin}/reset/${result.magicToken}`,
      token: result.magicToken,
      lang: 'en',
    });
  }
  res.json({ ok: true });
});

api.get('/owner/reset/:token', async (req, res) => {
  const row = await getPasswordResetByToken(req.params.token);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.usedAt || isExpired(row.expiresAt)) return res.status(410).json({ error: 'token_expired' });
  res.json({ ok: true });
});

api.post('/owner/reset/:token', ownerLimit, async (req, res) => {
  const password = String(req.body?.password || '');
  const confirm = String(req.body?.confirm || '');
  if (password !== confirm) return res.status(400).json({ error: 'password_mismatch' });
  const result = await completePasswordReset(req.params.token, password);
  if (result.error === 'not_found') return res.status(404).json({ error: result.error });
  if (result.error === 'token_expired') return res.status(410).json({ error: result.error });
  if (result.error) return fail(res, result);
  res.json({ ok: true });
});

api.post('/companies/:companyId/sites', createLimit, async (req, res) => {
  const companyId = String(req.params.companyId || '');
  const session = await requireCompanyAccess(req, res, companyId, ['owner']);
  if (!session) return;
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  const result = await addSite(
    companyId,
    {
      name,
      pack: req.body?.pack,
      lang: req.body?.lang,
      countryIso: req.body?.countryIso,
      timezone: req.body?.timezone,
    },
    clientMeta(req, session),
  );
  if (result.error) return fail(res, result);
  res.json({ site: publicSite(result.site), pin: result.pin });
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
  const { pin, slug } = req.body || {};
  const cleanSlug = String(slug || '').trim();
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  let site = null;
  if (cleanSlug) {
    site = await getSiteBySlug(cleanSlug);
    if (!site) return res.status(401).json({ error: 'bad_pin' });
  }
  const key = pinKey(site?.id || 'pin', ip);
  const lock = isLocked(key);
  if (lock.locked) {
    res.set('Retry-After', String(Math.ceil(lock.retryAfterMs / 1000)));
    return res.status(429).json({ error: 'locked_out', retryAfterMs: lock.retryAfterMs });
  }
  if (!site) site = await findSiteByPin(pin);
  else if (!(await verifySitePin(site, pin))) site = null;
  if (!site) {
    recordFailure(key);
    return res.status(401).json({ error: 'bad_pin' });
  }
  const siteKey = pinKey(site.id, ip);
  const siteLock = isLocked(siteKey);
  if (siteLock.locked) {
    res.set('Retry-After', String(Math.ceil(siteLock.retryAfterMs / 1000)));
    return res.status(429).json({ error: 'locked_out', retryAfterMs: siteLock.retryAfterMs });
  }
  clearFailures(key);
  clearFailures(siteKey);
  const actorName = site.name;
  const session = await createSession({
    role: 'booth',
    siteId: site.id,
    companyId: site.companyId,
    name: actorName,
  });
  setBoothCookie(res, session);
  res.json({ site: publicSite(site), guard: { name: actorName } });
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

api.get('/sites/:siteId/people/sample.csv', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  if (!(await requireSiteAccess(req, res, site, ['owner']))) return;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="gate-daftar-people-sample.csv"');
  res.send(PEOPLE_SAMPLE_CSV);
});

api.post('/sites/:siteId/people/import', importLimit, async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  const session = await requireSiteAccess(req, res, site, ['owner']);
  if (!session) return;
  const csv = String(req.body?.csv || '');
  if (!csv.trim()) return res.status(400).json({ error: 'csv_required' });
  const result = await importPeopleCsv(site.id, csv, clientMeta(req, session));
  if (result.error) return fail(res, result);
  res.json({ added: result.added, updated: result.updated, skipped: result.skipped });
});

api.post('/sites/:siteId/people/request-add', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  const session = await requireSiteAccess(req, res, site, ['booth', 'owner']);
  if (!session) return;
  const { name, employeeId, managerId } = req.body || {};
  const result = await createPersonAdd(
    { siteId: site.id, name, employeeId, managerId, source: 'guard' },
    clientMeta(req, session),
  );
  if (result.error) return fail(res, result);
  const lang = req.body?.lang === 'en' ? 'en' : site.lang;
  try {
    mailPersonAdd(req, result.request, result.manager, result.magicToken, lang);
  } catch {
    return res.status(503).json({ error: 'mail_not_configured', request: publicPersonAdd(result.request) });
  }
  res.json({ request: publicPersonAdd(result.request) });
});

api.post('/sites/:siteId/gate/request-add', gateLimit, async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  const { name, employeeId, managerId } = req.body || {};
  const result = await createPersonAdd(
    { siteId: site.id, name, employeeId, managerId, source: 'qr' },
    clientMeta(req, null, { role: 'employee', name: 'gate' }),
  );
  if (result.error) return fail(res, result);
  const lang = req.body?.lang === 'en' ? 'en' : site.lang;
  try {
    mailPersonAdd(req, result.request, result.manager, result.magicToken, lang);
  } catch {
    return res.status(503).json({ error: 'mail_not_configured', request: publicPersonAdd(result.request) });
  }
  res.status(200).json({ request: publicPersonAdd(result.request) });
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
    mailApproval(req, result.entry, result.magicToken, lang);
  } catch {
    return res.status(503).json({ error: 'mail_not_configured', entry: waitingView(result.entry) });
  }
  res.json({ entry: waitingView(result.entry) });
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
    mailApproval(req, result.entry, result.magicToken, lang);
  } catch {
    return res.status(503).json({ error: 'mail_not_configured', entry: publicCreated(result.entry) });
  }
  res.status(201).json({ entry: publicCreated(result.entry) });
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
    entries: found.entries.map(redactEntry),
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
  if (entry) {
    if (isMagicTokenExpired(entry)) return res.status(410).json({ error: 'token_expired' });
    const site = await getSite(entry.siteId);
    return res.json({
      entry: approveView(entry),
      site: publicSite(site),
    });
  }
  const request = await getPersonAddByToken(req.params.token);
  if (!request) return res.status(404).json({ error: 'not_found' });
  if (isMagicTokenExpired(request) && request.status === 'waiting') {
    return res.status(410).json({ error: 'token_expired' });
  }
  const site = await getSite(request.siteId);
  res.json({
    kind: 'person_add',
    request: publicPersonAdd(request),
    site: publicSite(site),
  });
});

api.post('/approve/:token', approveLimit, async (req, res) => {
  const decision = req.body?.decision === 'deny' ? 'deny' : 'approve';
  const entryPeek = await getEntryByToken(req.params.token);
  if (entryPeek) {
    const result = await decideOutPass(
      req.params.token,
      decision,
      req.body?.denyReason || '',
      clientMeta(req, null, { role: 'manager', name: entryPeek?.managerName || 'Manager' }),
    );
    if (result.error === 'not_found') return res.status(404).json({ error: result.error });
    if (result.error === 'token_expired') return res.status(410).json({ error: result.error });
    if (result.error) return fail(res, result);
    return res.json({ entry: approveView(result.entry) });
  }
  const addPeek = await getPersonAddByToken(req.params.token);
  const result = await decidePersonAdd(
    req.params.token,
    decision,
    req.body?.denyReason || '',
    clientMeta(req, null, { role: 'manager', name: addPeek ? 'Manager' : 'Manager' }),
  );
  if (result.error === 'not_found') return res.status(404).json({ error: result.error });
  if (result.error === 'token_expired') return res.status(410).json({ error: result.error });
  if (result.error) return fail(res, result);
  const site = await getSite(result.request.siteId);
  res.json({
    kind: 'person_add',
    request: publicPersonAdd(result.request),
    site: publicSite(site),
  });
});

api.get('/entries/:id', async (req, res) => {
  const found = await requireEntrySession(req, res, req.params.id, ['booth', 'owner']);
  if (!found) return;
  res.json({
    entry: redactEntry(found.entry),
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

export async function start() {
  assertStartupConfig();
  await initStore({ seed: true });
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
