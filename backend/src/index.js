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
  listPeople,
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
  safeEntry,
  resetGuardPin,
} from './store.js';
import { buildXlsx } from './xlsx.js';
import { healthCheck } from './db.js';
import { COUNTRIES, countryOf, waNumber } from './countries.js';
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
import { sendLoginCode } from './mailer.js';

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
  const list = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list;
}

function originAllowed(origin) {
  if (!origin) return true;
  return allowedOrigins().includes(origin);
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
  if (env.NODE_ENV === 'production' && !env.PUBLIC_ORIGIN) {
    throw new Error('PUBLIC_ORIGIN must be set in production');
  }
}

export const api = express.Router();

const gateLimit = rateLimit({ name: 'gate', windowMs: 60 * 1000, max: 30, envMax: 'RATE_LIMIT_GATE_MAX' });
const createLimit = rateLimit({ name: 'create', windowMs: 60 * 60 * 1000, max: 20, envMax: 'RATE_LIMIT_CREATE_MAX' });
const unlockLimit = rateLimit({ name: 'unlock', windowMs: 15 * 60 * 1000, max: 30, envMax: 'RATE_LIMIT_UNLOCK_MAX' });
const approveLimit = rateLimit({ name: 'approve', windowMs: 60 * 1000, max: 60 });
const exportLimit = rateLimit({ name: 'export', windowMs: 60 * 60 * 1000, max: 40 });
const ownerLimit = rateLimit({ name: 'owner', windowMs: 15 * 60 * 1000, max: 20 });

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
  return { approveUrl: pageUrl, denyUrl: pageUrl, pageUrl };
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
  return {
    ...safeEntry(entry, { managerPhone: true }),
    ...urls,
    waLink: whatsappLink(entry.managerPhone, outpassMessage(req, entry, lang, magicToken)),
    smsBody: outpassMessage(req, entry, lang, magicToken),
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
  const code = result.error === 'not_found' ? 404 : 400;
  return res.status(code).json(result);
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
  const entry = safeEntry(result.entry, { managerPhone: true });
  return res.json({ entry, ...extra });
}

api.get('/health', async (_req, res) => {
  const db = await healthCheck();
  const ok = db.ok;
  res.status(ok ? 200 : 503).json({ ok, name: 'gate-daftar', database: db });
});

api.get('/countries', (_req, res) => {
  res.json({ countries: COUNTRIES });
});

api.post('/sites', createLimit, async (req, res) => {
  const { name, ownerName, ownerEmail, lang, pack, countryIso } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name_required' });
  }
  const { site, pin } = await createSite({ name, ownerName, ownerEmail, lang, pack, countryIso });
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
  res.json(publicGateView(site));
});

api.post('/guard/unlock', unlockLimit, async (req, res) => {
  const { pin, slug } = req.body || {};
  const cleanSlug = String(slug || '').trim();
  if (!cleanSlug) return res.status(400).json({ error: 'slug_required' });
  const site = await getSiteBySlug(cleanSlug);
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (!site) return res.status(401).json({ error: 'bad_pin' });
  const key = pinKey(site.id, ip);
  const lock = isLocked(key);
  if (lock.locked) {
    res.set('Retry-After', String(Math.ceil(lock.retryAfterMs / 1000)));
    return res.status(429).json({ error: 'locked_out', retryAfterMs: lock.retryAfterMs });
  }
  if (!verifyPin(String(pin || ''), site.guardPinHash)) {
    recordFailure(key);
    return res.status(401).json({ error: 'bad_pin' });
  }
  clearFailures(key);
  const session = await createSession({
    role: 'booth',
    siteId: site.id,
    companyId: site.companyId,
    name: 'Booth',
  });
  setBoothCookie(res, session);
  res.json({ site: publicSite(site) });
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
    if (process.env.NODE_ENV !== 'production') {
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
  const site = await getSiteByOwnerEmail(email);
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
  res.json({ people: await listPeople(site.id) });
});

api.post('/sites/:siteId/people', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  const session = await requireSiteAccess(req, res, site, ['booth', 'owner']);
  if (!session) return;
  const { name, role, phone, managerPhone, employeeId } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  const result = await addPerson(site.id, { name, role, phone, managerPhone, employeeId }, clientMeta(req, session));
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
  res.status(200).json({ entry: safeEntry(result.entry, { managerPhone: true }) });
});

api.post('/sites/:siteId/outpass', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  const session = await requireSiteAccess(req, res, site, ['booth', 'owner']);
  if (!session) return;
  const { name, employeeId, reason, expectedMinutes, managerPhone, managerName, personId, phone, company } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'reason_required' });
  if (!managerName || !String(managerName).trim()) return res.status(400).json({ error: 'manager_required' });
  const result = await createOutPass(
    {
      siteId: site.id,
      name,
      phone,
      company,
      employeeId,
      reason,
      expectedMinutes,
      managerPhone,
      managerName,
      source: 'guard',
      personId,
    },
    clientMeta(req, session),
  );
  if (result.error) return fail(res, result);
  const lang = req.body?.lang === 'en' ? 'en' : site.lang;
  res.json({ entry: shareableOutpass(req, result.entry, lang, result.magicToken) });
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
  const { name, employeeId, reason, expectedMinutes, managerPhone, managerName, phone, company } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'reason_required' });
  if (!managerName || !String(managerName).trim()) return res.status(400).json({ error: 'manager_required' });
  const result = await createOutPass(
    {
      siteId: site.id,
      name,
      phone,
      company,
      employeeId,
      reason,
      expectedMinutes,
      managerPhone,
      managerName,
      source: 'qr',
    },
    clientMeta(req, null, { role: 'employee', name }),
  );
  if (result.error) return fail(res, result);
  const lang = req.body?.lang === 'en' ? 'en' : site.lang;
  const shared = shareableOutpass(req, result.entry, lang, result.magicToken);
  res.status(201).json({
    entry: {
      ...publicCreated(result.entry),
      pageUrl: shared.pageUrl,
      waLink: shared.waLink,
      smsBody: shared.smsBody,
    },
  });
});

api.get('/sites/:siteId/search', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  if (!(await requireSiteAccess(req, res, site, ['booth', 'owner']))) return;
  res.json({
    entries: (await searchEntries(site.id, req.query.q)).map((e) => safeEntry(e, { managerPhone: true })),
  });
});

api.get('/sites/:siteId/dashboard', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  if (!(await requireSiteAccess(req, res, site, ['owner']))) return;
  res.json({
    site: publicSite(site),
    stats: await dashboard(site.id),
    audit: await listAudit(site.id, 40),
  });
});

api.get('/sites/:siteId/audit', async (req, res) => {
  const site = await siteOr404(req, res);
  if (!site) return;
  if (!(await requireSiteAccess(req, res, site, ['owner']))) return;
  res.json({ audit: await listAudit(site.id, Number(req.query.limit) || 200) });
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
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
  const fmt = String(req.query.format || 'json').toLowerCase();
  if (fmt === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gate-daftar-${site.slug}.csv"`);
    return res.send(`\uFEFF${body}`);
  }
  if (fmt === 'xls' || fmt === 'xlsx' || fmt === 'excel') {
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
  if (result.error === 'not_found') return res.status(404).json(result);
  if (result.error === 'token_expired') return res.status(410).json(result);
  if (result.error) return res.status(400).json(result);
  res.json({ entry: approveView(result.entry) });
});

api.get('/entries/:id', async (req, res) => {
  const found = await requireEntrySession(req, res, req.params.id, ['booth', 'owner']);
  if (!found) return;
  res.json({
    entry: safeEntry(found.entry, { managerPhone: true }),
    site: publicSite(found.site),
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
