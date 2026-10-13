import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  seedDemoIfEmpty,
  createSite,
  publicSite,
  publicGateView,
  getSite,
  getSiteBySlug,
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
  subscribe,
  dashboard,
  exportRows,
  listAudit,
  safeEntry,
} from './store.js';
import { COUNTRIES, countryOf, waNumber } from './countries.js';
import {
  createSession,
  setOwnerCookie,
  setBoothCookie,
  requireSiteAccess,
  readSessions,
} from './sessions.js';

export const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '200kb' }));

function originFrom(req) {
  if (process.env.PUBLIC_ORIGIN) return process.env.PUBLIC_ORIGIN.replace(/\/$/, '');
  const origin = req.headers.origin;
  if (origin && /^https?:\/\//i.test(origin)) return origin;
  const referer = req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* ignore */
    }
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

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

function outpassMessage(req, entry, lang = 'ar') {
  const urls = approvalUrls(req, entry.magicToken);
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

function shareableOutpass(req, entry, lang) {
  if (!entry) return entry;
  const urls = approvalUrls(req, entry.magicToken);
  return {
    ...safeEntry(entry, { managerPhone: true }),
    ...urls,
    waLink: whatsappLink(entry.managerPhone, outpassMessage(req, entry, lang)),
    smsBody: outpassMessage(req, entry, lang),
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

function siteOr404(req, res) {
  const site = getSite(req.params.siteId) || getSiteBySlug(req.params.siteId);
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

function requireAuthed(req, res) {
  const { owner, booth } = readSessions(req);
  if (!owner && !booth) {
    res.status(401).json({ error: 'auth_required' });
    return null;
  }
  return { owner, booth };
}

function requireEntrySession(req, res, entryId, roles = ['booth', 'owner']) {
  if (!requireAuthed(req, res)) return null;
  const entry = getEntry(entryId);
  if (!entry) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  const site = getSite(entry.siteId);
  const session = requireSiteAccess(req, res, site, roles);
  if (!session) return null;
  return { entry, site, session };
}

function jsonEntry(res, result, extra = {}) {
  if (result.error) return fail(res, result);
  const entry = safeEntry(result.entry, { managerPhone: true });
  return res.json({ entry, ...extra });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'gate-daftar' });
});

app.get('/api/countries', (_req, res) => {
  res.json({ countries: COUNTRIES });
});

app.post('/api/sites', (req, res) => {
  const { name, ownerName, ownerEmail, lang, pack, countryIso } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name_required' });
  }
  const site = createSite({ name, ownerName, ownerEmail, lang, pack, countryIso });
  const session = createSession({
    role: 'owner',
    siteId: site.id,
    companyId: site.companyId,
    name: site.ownerName || 'Owner',
  });
  setOwnerCookie(res, session);
  res.json({
    site: {
      ...publicSite(site),
      guardPin: site.guardPin,
      ownerName: site.ownerName,
    },
  });
});

app.get('/api/sites/:siteId', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  res.json({ site: publicSite(site), country: countryOf(site.countryIso) });
});

app.get('/api/sites/:siteId/public', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  res.json(publicGateView(site));
});

app.post('/api/guard/unlock', (req, res) => {
  const { pin, slug } = req.body || {};
  const site = getSiteBySlug(String(slug || '').trim());
  if (!site) return res.status(401).json({ error: 'bad_pin' });
  if (!pin || String(pin).trim() !== site.guardPin) return res.status(401).json({ error: 'bad_pin' });
  const session = createSession({
    role: 'booth',
    siteId: site.id,
    companyId: site.companyId,
    name: 'Booth',
  });
  setBoothCookie(res, session);
  res.json({ site: publicSite(site) });
});

app.get('/api/sites/:siteId/snapshot', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  if (!requireSiteAccess(req, res, site, ['booth', 'owner'])) return;
  const snap = snapshot(site.id);
  res.json({
    ...snap,
    country: countryOf(site.countryIso),
  });
});

app.get('/api/sites/:siteId/stream', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  if (!requireSiteAccess(req, res, site, ['booth', 'owner'])) return;
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
  });
});

app.get('/api/sites/:siteId/people', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  if (!requireSiteAccess(req, res, site, ['booth', 'owner'])) return;
  res.json({ people: listPeople(site.id) });
});

app.post('/api/sites/:siteId/people', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  const session = requireSiteAccess(req, res, site, ['booth', 'owner']);
  if (!session) return;
  const { name, role, phone, managerPhone, employeeId } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  const result = addPerson(site.id, { name, role, phone, managerPhone, employeeId }, clientMeta(req, session));
  if (result.error) return fail(res, result);
  res.json(result);
});

app.post('/api/sites/:siteId/visitors', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  const session = requireSiteAccess(req, res, site, ['booth', 'owner']);
  if (!session) return;
  const { name, phone, company, purpose, hostName, idNumber, cardNumber } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  const result = createVisitor(
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

app.post('/api/sites/:siteId/outpass', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  const session = requireSiteAccess(req, res, site, ['booth', 'owner']);
  if (!session) return;
  const { name, employeeId, reason, expectedMinutes, managerPhone, managerName, personId, phone, company } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'reason_required' });
  if (!managerName || !String(managerName).trim()) return res.status(400).json({ error: 'manager_required' });
  const result = createOutPass(
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
  res.json({ entry: shareableOutpass(req, result.entry, lang) });
});

app.post('/api/sites/:siteId/gate/visitor', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  const { name, phone, company, purpose, hostName, idNumber, cardNumber } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  const result = createVisitor(
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

app.post('/api/sites/:siteId/gate/outpass', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  const { name, employeeId, reason, expectedMinutes, managerPhone, managerName, phone, company } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'reason_required' });
  if (!managerName || !String(managerName).trim()) return res.status(400).json({ error: 'manager_required' });
  const result = createOutPass(
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
  const shared = shareableOutpass(req, result.entry, lang);
  res.status(201).json({
    entry: {
      ...publicCreated(result.entry),
      pageUrl: shared.pageUrl,
      waLink: shared.waLink,
      smsBody: shared.smsBody,
    },
  });
});

app.get('/api/sites/:siteId/search', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  if (!requireSiteAccess(req, res, site, ['booth', 'owner'])) return;
  res.json({
    entries: searchEntries(site.id, req.query.q).map((e) => safeEntry(e, { managerPhone: true })),
  });
});

app.get('/api/sites/:siteId/dashboard', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  if (!requireSiteAccess(req, res, site, ['owner'])) return;
  res.json({
    site: publicSite(site),
    stats: dashboard(site.id),
    audit: listAudit(site.id, 40),
  });
});

app.get('/api/sites/:siteId/audit', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  if (!requireSiteAccess(req, res, site, ['owner'])) return;
  res.json({ audit: listAudit(site.id, Number(req.query.limit) || 200) });
});

app.get('/api/sites/:siteId/export', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  if (!requireSiteAccess(req, res, site, ['owner'])) return;
  const rows = exportRows(site.id, {
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
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gate-daftar-${site.slug}.xls"`);
    return res.send(`\uFEFF${body}`);
  }
  res.json({ rows });
});

app.post('/api/entries/:id/admit', (req, res) => {
  const found = requireEntrySession(req, res, req.params.id);
  if (!found) return;
  jsonEntry(res, admitVisitor(found.entry.id, clientMeta(req, found.session)));
});

app.post('/api/entries/:id/exit', (req, res) => {
  const found = requireEntrySession(req, res, req.params.id);
  if (!found) return;
  jsonEntry(res, exitVisitor(found.entry.id, clientMeta(req, found.session)));
});

app.post('/api/entries/:id/out', (req, res) => {
  const found = requireEntrySession(req, res, req.params.id);
  if (!found) return;
  jsonEntry(res, logOut(found.entry.id, clientMeta(req, found.session)));
});

app.post('/api/entries/:id/in', (req, res) => {
  const found = requireEntrySession(req, res, req.params.id);
  if (!found) return;
  jsonEntry(res, logIn(found.entry.id, clientMeta(req, found.session)));
});

app.post('/api/entries/:id/unapproved', (req, res) => {
  const found = requireEntrySession(req, res, req.params.id);
  if (!found) return;
  jsonEntry(res, unapprovedLeave(found.entry.id, req.body?.reason || '', clientMeta(req, found.session)));
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

app.get('/api/approve/:token', (req, res) => {
  const entry = getEntryByToken(req.params.token);
  if (!entry) return res.status(404).json({ error: 'not_found' });
  const site = getSite(entry.siteId);
  res.json({
    entry: approveView(entry),
    site: publicSite(site),
  });
});

app.post('/api/approve/:token', (req, res) => {
  const decision = req.body?.decision === 'deny' ? 'deny' : 'approve';
  const entryPeek = getEntryByToken(req.params.token);
  const result = decideOutPass(
    req.params.token,
    decision,
    req.body?.denyReason || '',
    clientMeta(req, null, { role: 'manager', name: entryPeek?.managerName || 'Manager' }),
  );
  if (result.error === 'not_found') return res.status(404).json(result);
  if (result.error && result.error !== 'already_decided') return res.status(400).json(result);
  res.json({ entry: approveView(result.entry) });
});

app.get('/api/entries/:id', (req, res) => {
  const found = requireEntrySession(req, res, req.params.id, ['booth', 'owner']);
  if (!found) return;
  res.json({
    entry: safeEntry(found.entry, { managerPhone: true }),
    site: publicSite(found.site),
  });
});

export function start() {
  seedDemoIfEmpty();
  return app.listen(PORT, '0.0.0.0', () => {
    process.stdout.write(`gate-daftar api on ${PORT}\n`);
  });
}

const launchedDirectly =
  Boolean(process.argv[1]) &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (launchedDirectly) {
  start();
}
