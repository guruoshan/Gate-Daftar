import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { id, token, shortCode, now } from './ids.js';
import { countryOf, normalizePhone, digits } from './countries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const bus = new EventEmitter();
bus.setMaxListeners(400);

const PACKS = ['manufacturing', 'warehouse', 'workshop', 'logistics', 'construction'];

function emptyDb() {
  return { companies: [], sites: [], people: [], entries: [], events: [], audit: [] };
}

function migrate(parsed) {
  const dbx = {
    companies: parsed.companies || [],
    sites: parsed.sites || [],
    people: parsed.people || [],
    entries: parsed.entries || [],
    events: parsed.events || [],
    audit: parsed.audit || [],
  };
  dbx.sites.forEach((s) => {
    if (!s.countryIso) s.countryIso = 'SA';
    if (!s.companyId) {
      const company = {
        id: id('co_'),
        name: s.name || 'Company',
        countryIso: s.countryIso,
        createdAt: s.createdAt || now(),
      };
      dbx.companies.push(company);
      s.companyId = company.id;
    }
  });
  return dbx;
}

function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) return emptyDb();
    return migrate(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch {
    return emptyDb();
  }
}

function persist() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

let db = load();

function emitSite(siteId, type, payload) {
  const msg = { type, payload, at: now() };
  bus.emit(`site:${siteId}`, msg);
  const site = getSite(siteId);
  if (site?.companyId) bus.emit(`co:${site.companyId}`, { ...msg, siteId });
}

function lastAuditHash() {
  const last = db.audit[db.audit.length - 1];
  return last?.hash || 'genesis';
}

function writeAudit({ siteId, action, actor, entryId, reason, ip, device }) {
  const site = getSite(siteId);
  const row = {
    id: id('aud_'),
    at: now(),
    siteId: siteId || '',
    companyId: site?.companyId || '',
    action,
    actorRole: actor?.role || 'system',
    actorName: actor?.name || '',
    actorHint: actor?.hint || '',
    entryId: entryId || '',
    reason: reason || '',
    ip: ip || '',
    device: device || '',
    prev: lastAuditHash(),
  };
  row.hash = crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0, 16);
  db.audit.push(row);
  return row;
}

function note(siteId, kind, message, extra, actor, ip, device) {
  db.events.push({ id: id('ev_'), siteId, kind, message, extra, at: now() });
  writeAudit({
    siteId,
    action: kind,
    actor,
    entryId: extra?.entryId,
    reason: extra?.reason || message,
    ip,
    device,
  });
}

export function subscribe(siteId, fn) {
  const ch = `site:${siteId}`;
  bus.on(ch, fn);
  return () => bus.off(ch, fn);
}

export function getSite(siteId) {
  return db.sites.find((s) => s.id === siteId) || null;
}

export function getSiteBySlug(slug) {
  return db.sites.find((s) => s.slug === slug) || null;
}

export function getSiteByGuardPin(pin) {
  return db.sites.find((s) => s.guardPin === pin) || null;
}

export function publicSite(site) {
  if (!site) return null;
  return {
    id: site.id,
    slug: site.slug,
    name: site.name,
    pack: site.pack,
    lang: site.lang,
    countryIso: site.countryIso || 'SA',
    companyId: site.companyId,
    createdAt: site.createdAt,
  };
}

export function listPeople(siteId) {
  return db.people.filter((p) => p.siteId === siteId && p.active !== false);
}

export function listEntries(siteId) {
  return db.entries
    .filter((e) => e.siteId === siteId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getEntry(entryId) {
  return db.entries.find((e) => e.id === entryId) || null;
}

export function getEntryByToken(magicToken) {
  return db.entries.find((e) => e.magicToken === magicToken) || null;
}

export function getEntryByDayToken(siteId, dayToken) {
  const t = String(dayToken || '').trim().toUpperCase();
  return db.entries.find((e) => e.siteId === siteId && e.dayToken === t) || null;
}

function uniqueDayToken(siteId) {
  for (let i = 0; i < 20; i += 1) {
    const code = shortCode(4);
    if (!getEntryByDayToken(siteId, code)) return code;
  }
  return shortCode(5);
}

function phoneForSite(site, raw) {
  return normalizePhone(raw, site?.countryIso || 'SA');
}

export function createSite({ name, ownerName, ownerEmail, lang = 'ar', pack, countryIso = 'SA' }) {
  const company = {
    id: id('co_'),
    name: String(name || 'Company').trim(),
    countryIso: countryOf(countryIso).iso,
    createdAt: now(),
  };
  db.companies.push(company);
  const site = {
    id: id('site_'),
    companyId: company.id,
    slug: `gd-${shortCode(6).toLowerCase()}`,
    name: company.name,
    pack: PACKS.includes(pack) ? pack : 'manufacturing',
    ownerName: ownerName || '',
    ownerEmail: ownerEmail || '',
    lang: lang === 'en' ? 'en' : 'ar',
    countryIso: company.countryIso,
    guardPin: String(1000 + Math.floor(Math.random() * 9000)),
    createdAt: now(),
  };
  db.sites.push(site);
  writeAudit({ siteId: site.id, action: 'site_created', actor: { role: 'owner', name: ownerName || 'owner' } });
  persist();
  return site;
}

export function addPerson(siteId, { name, role, phone, managerPhone, employeeId }, meta = {}) {
  const site = getSite(siteId);
  const p = phoneForSite(site, phone);
  const m = managerPhone ? phoneForSite(site, managerPhone) : { e164: '' };
  if (phone && p.error) return { error: p.error, expected: p.expected };
  if (managerPhone && m.error) return { error: m.error, expected: m.expected };
  const person = {
    id: id('p_'),
    siteId,
    companyId: site?.companyId || '',
    name: String(name || '').trim(),
    role: role === 'manager' ? 'manager' : 'employee',
    phone: p.e164 || '',
    managerPhone: m.e164 || '',
    employeeId: String(employeeId || '').trim(),
    active: true,
    createdAt: now(),
  };
  db.people.push(person);
  note(siteId, 'person_added', `${person.name} added`, { personId: person.id }, meta.actor, meta.ip, meta.device);
  persist();
  emitSite(siteId, 'people', listPeople(siteId));
  return { person };
}

export function createVisitor(input, meta = {}) {
  const site = getSite(input.siteId);
  const p = phoneForSite(site, input.phone);
  if (p.error) return { error: p.error, expected: p.expected };
  const entry = {
    id: id('e_'),
    siteId: input.siteId,
    companyId: site?.companyId || '',
    kind: 'visitor',
    status: 'waiting_admit',
    name: String(input.name || '').trim(),
    phone: p.e164,
    company: String(input.company || '').trim(),
    purpose: String(input.purpose || '').trim(),
    hostName: String(input.hostName || '').trim(),
    idNumber: String(input.idNumber || '').trim(),
    cardNumber: String(input.cardNumber || '').trim(),
    employeeId: '',
    personId: '',
    reason: '',
    expectedMinutes: 0,
    managerName: '',
    managerPhone: '',
    source: input.source === 'qr' ? 'qr' : 'guard',
    dayToken: uniqueDayToken(input.siteId),
    magicToken: '',
    denyReason: '',
    unapprovedReason: '',
    createdAt: now(),
    updatedAt: now(),
    admittedAt: null,
    exitedAt: null,
    requestedAt: now(),
    decidedAt: null,
    outAt: null,
    inAt: null,
    dueAt: null,
  };
  db.entries.push(entry);
  note(input.siteId, 'visitor_created', `${entry.name} is waiting at the gate`, { entryId: entry.id, source: entry.source }, meta.actor, meta.ip, meta.device);
  persist();
  emitSite(input.siteId, 'entries', listEntries(input.siteId));
  return { entry };
}

export function createOutPass(input, meta = {}) {
  const site = getSite(input.siteId);
  const m = phoneForSite(site, input.managerPhone);
  if (m.error) return { error: m.error, expected: m.expected };
  const empPhone = input.phone ? phoneForSite(site, input.phone) : { e164: '' };
  if (input.phone && empPhone.error) return { error: empPhone.error, expected: empPhone.expected };
  const minutes = Math.max(15, Number(input.expectedMinutes) || 60);
  const entry = {
    id: id('e_'),
    siteId: input.siteId,
    companyId: site?.companyId || '',
    kind: 'outpass',
    status: 'waiting_approval',
    name: String(input.name || '').trim(),
    phone: empPhone.e164 || '',
    company: String(input.company || '').trim(),
    purpose: '',
    hostName: '',
    idNumber: '',
    cardNumber: '',
    employeeId: String(input.employeeId || '').trim(),
    personId: input.personId || '',
    reason: String(input.reason || '').trim(),
    expectedMinutes: minutes,
    managerName: String(input.managerName || '').trim(),
    managerPhone: m.e164,
    source: input.source === 'qr' ? 'qr' : 'guard',
    dayToken: uniqueDayToken(input.siteId),
    magicToken: token(18),
    denyReason: '',
    unapprovedReason: '',
    createdAt: now(),
    updatedAt: now(),
    admittedAt: null,
    exitedAt: null,
    requestedAt: now(),
    decidedAt: null,
    outAt: null,
    inAt: null,
    dueAt: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
  };
  db.entries.push(entry);
  note(input.siteId, 'outpass_requested', `${entry.name} asked to go out`, { entryId: entry.id, source: entry.source }, meta.actor, meta.ip, meta.device);
  persist();
  emitSite(input.siteId, 'entries', listEntries(input.siteId));
  return { entry };
}

export function decideOutPass(magicToken, decision, denyReason = '', meta = {}) {
  const entry = getEntryByToken(magicToken);
  if (!entry) return { error: 'not_found' };
  if (entry.kind !== 'outpass') return { error: 'not_outpass' };
  if (entry.status !== 'waiting_approval') return { error: 'already_decided', entry };
  const ok = decision === 'approve';
  entry.status = ok ? 'approved_out' : 'denied';
  entry.decidedAt = now();
  entry.updatedAt = now();
  entry.denyReason = ok ? '' : String(denyReason || '').trim();
  note(
    entry.siteId,
    ok ? 'outpass_approved' : 'outpass_denied',
    ok ? `${entry.name} was approved to leave` : `${entry.name} was denied`,
    { entryId: entry.id, reason: entry.denyReason },
    meta.actor || { role: 'manager', name: entry.managerName, hint: 'magic-link' },
    meta.ip,
    meta.device,
  );
  persist();
  emitSite(entry.siteId, 'entries', listEntries(entry.siteId));
  return { entry };
}

function touch(entry, status, field, kind, message, meta) {
  if (!entry) return { error: 'not_found' };
  entry.status = status;
  entry[field] = now();
  entry.updatedAt = now();
  note(entry.siteId, kind, message, { entryId: entry.id }, meta.actor, meta.ip, meta.device);
  persist();
  emitSite(entry.siteId, 'entries', listEntries(entry.siteId));
  return { entry };
}

export function admitVisitor(entryId, meta = {}) {
  const entry = getEntry(entryId);
  if (!entry || entry.kind !== 'visitor') return { error: 'not_found' };
  if (entry.status !== 'waiting_admit') return { error: 'bad_status', entry };
  return touch(entry, 'inside', 'admittedAt', 'visitor_in', `${entry.name} was welcomed in`, meta);
}

export function exitVisitor(entryId, meta = {}) {
  const entry = getEntry(entryId);
  if (!entry || entry.kind !== 'visitor') return { error: 'not_found' };
  if (entry.status !== 'inside') return { error: 'bad_status', entry };
  return touch(entry, 'exited', 'exitedAt', 'visitor_out', `${entry.name} left the site`, meta);
}

export function logOut(entryId, meta = {}) {
  const entry = getEntry(entryId);
  if (!entry || entry.kind !== 'outpass') return { error: 'not_found' };
  if (entry.status !== 'approved_out') return { error: 'bad_status', entry };
  return touch(entry, 'out', 'outAt', 'employee_out', `${entry.name} walked out the gate`, meta);
}

export function logIn(entryId, meta = {}) {
  const entry = getEntry(entryId);
  if (!entry || entry.kind !== 'outpass') return { error: 'not_found' };
  if (entry.status !== 'out') return { error: 'bad_status', entry };
  return touch(entry, 'returned', 'inAt', 'employee_in', `${entry.name} came back`, meta);
}

export function unapprovedLeave(entryId, reason, meta = {}) {
  const entry = getEntry(entryId);
  if (!entry) return { error: 'not_found' };
  entry.status = 'unapproved_leave';
  entry.unapprovedReason = String(reason || '').trim();
  entry.outAt = entry.outAt || now();
  entry.updatedAt = now();
  note(entry.siteId, 'unapproved_leave', `${entry.name} left without approval`, { entryId: entry.id, reason: entry.unapprovedReason }, meta.actor, meta.ip, meta.device);
  persist();
  emitSite(entry.siteId, 'entries', listEntries(entry.siteId));
  return { entry };
}

export function searchEntries(siteId, q) {
  const query = String(q || '').trim().toLowerCase();
  if (!query) return listEntries(siteId);
  let qd = digits(query);
  if (qd.startsWith('00')) qd = qd.slice(2);
  if (qd.startsWith('0')) qd = qd.slice(1);
  return listEntries(siteId).filter((e) => {
    const text = [e.name, e.phone, e.dayToken, e.cardNumber, e.employeeId, e.company, e.hostName, e.managerName, e.managerPhone, e.idNumber, e.reason, e.purpose]
      .join(' ')
      .toLowerCase();
    if (text.includes(query)) return true;
    if (qd.length >= 3) {
      const nums = [e.phone, e.managerPhone, e.employeeId, e.cardNumber, e.idNumber, e.dayToken].map(digits).join(' ');
      if (nums.includes(qd)) return true;
    }
    return false;
  });
}

export function listAudit(siteId, limit = 200) {
  return db.audit.filter((a) => a.siteId === siteId).slice(-limit).reverse();
}

export function dashboard(siteId) {
  const entries = listEntries(siteId);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const todayIso = start.toISOString();
  const today = entries.filter((e) => e.createdAt >= todayIso);
  const inside = entries.filter((e) => e.status === 'inside').length;
  const waiting = entries.filter((e) => e.status === 'waiting_admit' || e.status === 'waiting_approval').length;
  const overdue = entries.filter((e) => e.kind === 'outpass' && e.status === 'out' && e.dueAt && e.dueAt < now()).length;
  const stillOut = entries.filter((e) => e.status === 'out').length;
  const returned = entries.filter((e) => e.status === 'returned' && e.outAt && e.inAt);
  const avgMin = returned.length
    ? Math.round(returned.reduce((s, e) => s + (new Date(e.inAt) - new Date(e.outAt)) / 60000, 0) / returned.length)
    : 0;
  return {
    todayTotal: today.length,
    todayVisitors: today.filter((e) => e.kind === 'visitor').length,
    todayOutpass: today.filter((e) => e.kind === 'outpass').length,
    inside,
    waiting,
    overdue,
    stillOut,
    avgMinutes: avgMin,
    exceptions: overdue + entries.filter((e) => e.status === 'unapproved_leave' && e.createdAt >= todayIso).length,
  };
}

export function exportRows(siteId, { from, to, status, kind } = {}) {
  return listEntries(siteId).filter((e) => {
    if (from && e.createdAt < from) return false;
    if (to && e.createdAt > to) return false;
    if (status && e.status !== status) return false;
    if (kind && e.kind !== kind) return false;
    return true;
  });
}

export function seedDemoIfEmpty() {
  if (db.sites.length > 0) {
    db = migrate(db);
    persist();
    return getSiteBySlug('demo') || db.sites[0];
  }
  const company = {
    id: 'co_demo',
    name: 'Al-Noor Warehouse',
    countryIso: 'SA',
    createdAt: now(),
  };
  db.companies.push(company);
  const site = {
    id: 'site_demo',
    companyId: company.id,
    slug: 'demo',
    name: 'Al-Noor Warehouse',
    pack: 'warehouse',
    ownerName: 'Fahad Al-Qahtani',
    ownerEmail: 'fahad@example.com',
    lang: 'ar',
    countryIso: 'SA',
    guardPin: '1234',
    createdAt: now(),
  };
  db.sites.push(site);
  [
    { name: 'Khalid Al-Harbi', role: 'manager', phone: '966500111222', managerPhone: '', employeeId: 'M-01' },
    { name: 'Noura Al-Otaibi', role: 'manager', phone: '966500333444', managerPhone: '', employeeId: 'M-02' },
    { name: 'Yousef Hassan', role: 'employee', phone: '966511222333', managerPhone: '966500111222', employeeId: 'E-104' },
    { name: 'Ahmed Farouk', role: 'employee', phone: '966511444555', managerPhone: '966500111222', employeeId: 'E-118' },
    { name: 'Sami Al-Dosari', role: 'employee', phone: '966511666777', managerPhone: '966500333444', employeeId: 'E-221' },
  ].forEach((p) => addPerson(site.id, p, { actor: { role: 'owner', name: 'Fahad' } }));

  createVisitor({ siteId: site.id, name: 'Ibrahim Delivery', phone: '966555000111', company: 'Aramex', purpose: 'Parcel drop', hostName: 'Receiving', source: 'qr' }, { actor: { role: 'visitor', name: 'Ibrahim Delivery' } });
  createVisitor({ siteId: site.id, name: 'Contractor Majed', phone: '966555222333', company: 'AC Fix Co', purpose: 'HVAC repair', hostName: 'Maintenance', source: 'guard' }, { actor: { role: 'guard', name: 'Booth' } });
  const admitted = createVisitor({ siteId: site.id, name: 'Layla Supplier', phone: '966555888999', company: 'Gulf Parts', purpose: 'Parts delivery', hostName: 'Store', source: 'guard' }, { actor: { role: 'guard', name: 'Booth' } });
  if (admitted.entry) admitVisitor(admitted.entry.id, { actor: { role: 'guard', name: 'Booth' } });
  createOutPass({ siteId: site.id, name: 'Yousef Hassan', employeeId: 'E-104', reason: 'Bank errand', expectedMinutes: 90, managerPhone: '966500111222', managerName: 'Khalid Al-Harbi', source: 'qr' }, { actor: { role: 'employee', name: 'Yousef Hassan' } });
  const approved = createOutPass({ siteId: site.id, name: 'Ahmed Farouk', employeeId: 'E-118', reason: 'Lunch', expectedMinutes: 45, managerPhone: '966500111222', managerName: 'Khalid Al-Harbi', source: 'guard' }, { actor: { role: 'guard', name: 'Booth' } });
  if (approved.entry) decideOutPass(approved.entry.magicToken, 'approve', '', { actor: { role: 'manager', name: 'Khalid Al-Harbi', hint: 'seed' } });
  persist();
  return site;
}

export function snapshot(siteId) {
  const site = getSite(siteId);
  if (!site) return null;
  return {
    site: { ...publicSite(site), guardPin: site.guardPin },
    people: listPeople(siteId),
    entries: listEntries(siteId),
    events: db.events.filter((e) => e.siteId === siteId).slice(-80).reverse(),
    stats: dashboard(siteId),
  };
}

export { digits, countryOf };
