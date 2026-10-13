import express from 'express';
import cors from 'cors';
import {
  seedDemoIfEmpty,
  createSite,
  publicSite,
  getSite,
  getSiteBySlug,
  getSiteByGuardPin,
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
} from './store.js';
import { COUNTRIES, countryOf, waNumber } from './countries.js';

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json({ limit: '200kb' }));

seedDemoIfEmpty();

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

function clientMeta(req, extra = {}) {
  return {
    ip: String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim(),
    device: String(req.headers['user-agent'] || '').slice(0, 180),
    actor: extra.actor || { role: extra.role || 'guard', name: extra.name || 'Booth' },
  };
}

function approvalUrls(req, magicToken) {
  const origin = originFrom(req);
  return {
    approveUrl: `${origin}/a/${magicToken}?d=approve`,
    denyUrl: `${origin}/a/${magicToken}?d=deny`,
    pageUrl: `${origin}/a/${magicToken}`,
  };
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
      `Approve`,
      urls.approveUrl,
      '',
      `Deny`,
      urls.denyUrl,
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
    `موافقة`,
    urls.approveUrl,
    '',
    `رفض`,
    urls.denyUrl,
  ]
    .filter((line, i, arr) => line !== '' || arr[i - 1] !== '')
    .join('\n');
}

function withLinks(req, entry, lang) {
  if (!entry) return entry;
  if (entry.kind !== 'outpass' || !entry.magicToken) return entry;
  const urls = approvalUrls(req, entry.magicToken);
  return {
    ...entry,
    ...urls,
    waLink: whatsappLink(entry.managerPhone, outpassMessage(req, entry, lang)),
    smsBody: outpassMessage(req, entry, lang),
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

app.post('/api/guard/unlock', (req, res) => {
  const { pin, slug } = req.body || {};
  let site = null;
  if (slug) site = getSiteBySlug(String(slug).trim());
  if (!site && pin) site = getSiteByGuardPin(String(pin).trim());
  if (!site) return res.status(401).json({ error: 'bad_pin' });
  if (pin && String(pin).trim() !== site.guardPin) return res.status(401).json({ error: 'bad_pin' });
  res.json({ site: { ...publicSite(site), guardPin: site.guardPin } });
});

app.get('/api/sites/:siteId/snapshot', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  const snap = snapshot(site.id);
  const lang = req.query.lang === 'en' ? 'en' : site.lang;
  res.json({
    ...snap,
    country: countryOf(site.countryIso),
    entries: snap.entries.map((e) => withLinks(req, e, lang)),
  });
});

app.get('/api/sites/:siteId/stream', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const lang = req.query.lang === 'en' ? 'en' : site.lang;
  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  send('hello', { ok: true, siteId: site.id });
  const snap = snapshot(site.id);
  send('snapshot', { ...snap, country: countryOf(site.countryIso), entries: snap.entries.map((e) => withLinks(req, e, lang)) });
  const unsub = subscribe(site.id, (msg) => {
    if (msg.type === 'entries') {
      send('entries', msg.payload.map((e) => withLinks(req, e, lang)));
      send('stats', dashboard(site.id));
    } else {
      send(msg.type, msg.payload);
    }
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
  res.json({ people: listPeople(site.id) });
});

app.post('/api/sites/:siteId/people', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  const { name, role, phone, managerPhone, employeeId } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  const result = addPerson(site.id, { name, role, phone, managerPhone, employeeId }, clientMeta(req, { role: 'owner', name: site.ownerName }));
  if (result.error) return fail(res, result);
  res.json(result);
});

app.post('/api/sites/:siteId/visitors', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  const { name, phone, company, purpose, hostName, idNumber, cardNumber, source } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  const result = createVisitor({
    siteId: site.id,
    name,
    phone,
    company,
    purpose,
    hostName,
    idNumber,
    cardNumber,
    source,
  }, clientMeta(req, { role: source === 'qr' ? 'visitor' : 'guard', name: name }));
  if (result.error) return fail(res, result);
  res.json(result);
});

app.post('/api/sites/:siteId/outpass', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  const { name, employeeId, reason, expectedMinutes, managerPhone, managerName, source, personId, phone, company } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'reason_required' });
  if (!managerName || !String(managerName).trim()) return res.status(400).json({ error: 'manager_required' });
  const result = createOutPass({
    siteId: site.id,
    name,
    phone,
    company,
    employeeId,
    reason,
    expectedMinutes,
    managerPhone,
    managerName,
    source,
    personId,
  }, clientMeta(req, { role: source === 'qr' ? 'employee' : 'guard', name }));
  if (result.error) return fail(res, result);
  const lang = req.body?.lang === 'en' ? 'en' : site.lang;
  res.json({ entry: withLinks(req, result.entry, lang) });
});

app.get('/api/sites/:siteId/search', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  res.json({ entries: searchEntries(site.id, req.query.q) });
});

app.get('/api/sites/:siteId/dashboard', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  res.json({
    site: publicSite(site),
    stats: dashboard(site.id),
    audit: listAudit(site.id, 40),
  });
});

app.get('/api/sites/:siteId/audit', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  res.json({ audit: listAudit(site.id, Number(req.query.limit) || 200) });
});

app.get('/api/sites/:siteId/export', (req, res) => {
  const site = siteOr404(req, res);
  if (!site) return;
  const rows = exportRows(site.id, {
    from: req.query.from,
    to: req.query.to,
    status: req.query.status,
    kind: req.query.kind,
  });
  const headers = ['id', 'kind', 'status', 'name', 'phone', 'employeeId', 'company', 'purpose', 'hostName', 'reason', 'managerName', 'managerPhone', 'dayToken', 'source', 'createdAt', 'admittedAt', 'exitedAt', 'outAt', 'inAt', 'dueAt'];
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
  const result = admitVisitor(req.params.id, clientMeta(req));
  if (result.error) return fail(res, result);
  res.json(result);
});

app.post('/api/entries/:id/exit', (req, res) => {
  const result = exitVisitor(req.params.id, clientMeta(req));
  if (result.error) return fail(res, result);
  res.json(result);
});

app.post('/api/entries/:id/out', (req, res) => {
  const result = logOut(req.params.id, clientMeta(req));
  if (result.error) return fail(res, result);
  res.json(result);
});

app.post('/api/entries/:id/in', (req, res) => {
  const result = logIn(req.params.id, clientMeta(req));
  if (result.error) return fail(res, result);
  res.json(result);
});

app.post('/api/entries/:id/unapproved', (req, res) => {
  const result = unapprovedLeave(req.params.id, req.body?.reason || '', clientMeta(req));
  if (result.error) return fail(res, result);
  res.json(result);
});

app.get('/api/approve/:token', (req, res) => {
  const entry = getEntryByToken(req.params.token);
  if (!entry) return res.status(404).json({ error: 'not_found' });
  const site = getSite(entry.siteId);
  res.json({
    entry: {
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
    },
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
    clientMeta(req, { role: 'manager', name: entryPeek?.managerName || 'Manager', hint: 'magic-link' }),
  );
  if (result.error === 'not_found') return res.status(404).json(result);
  if (result.error && result.error !== 'already_decided') return res.status(400).json(result);
  res.json({ entry: result.entry });
});

app.get('/api/entries/:id', (req, res) => {
  const entry = getEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not_found' });
  const site = getSite(entry.siteId);
  res.json({ entry, site: publicSite(site) });
});

app.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`gate-daftar api on ${PORT}\n`);
});
