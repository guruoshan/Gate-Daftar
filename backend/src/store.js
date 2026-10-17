import crypto from 'crypto';
import { EventEmitter } from 'events';
import { id, shortCode, now } from './ids.js';
import { countryOf, normalizePhone, digits } from './countries.js';
import { hashPin, generatePin } from './pins.js';
import { PACKS, coercePack } from './packs.js';
import { newMagicToken, hashToken, tokenExpiry } from './tokens.js';
import { auditBase, hashAudit } from './audit.js';
import {
  query,
  withTransaction,
  runMigrations,
  truncateAll,
  publishDelta,
  startListener,
} from './db.js';

const bus = new EventEmitter();
bus.setMaxListeners(400);
const SERVER_ID = crypto.randomBytes(8).toString('hex');

// The audit chain lives on top of a serialised writer, so every row sees the
// row before it no matter how many requests are in flight.
const AUDIT_LOCK = 812734;

const camelToSnake = (key) => key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const snakeToCamel = (key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function iso(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function camelize(row) {
  const out = {};
  for (const key of Object.keys(row)) out[snakeToCamel(key)] = iso(row[key]);
  return out;
}

export function safeEntry(entry, { managerPhone = false } = {}) {
  if (!entry) return null;
  const out = { ...entry };
  delete out.magicToken;
  delete out.magicTokenHash;
  delete out.magicTokenExpiresAt;
  delete out.magicTokenUsedAt;
  if (!managerPhone) delete out.managerPhone;
  return out;
}

export function publicGateView(site) {
  if (!site) return null;
  return {
    site: {
      id: site.id,
      slug: site.slug,
      name: site.name,
      lang: site.lang,
      countryIso: site.countryIso || 'SA',
    },
    country: countryOf(site.countryIso),
    options: { durations: [45, 60, 90, 180] },
  };
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

export function isMagicTokenExpired(entry) {
  if (!entry?.magicTokenExpiresAt) return false;
  return new Date(entry.magicTokenExpiresAt).getTime() < Date.now();
}

function mapSite(row) {
  if (!row) return null;
  const s = camelize(row);
  if (!s.countryIso) s.countryIso = 'SA';
  s.pack = coercePack(s.pack);
  return s;
}

function mapEntry(row) {
  if (!row) return null;
  const e = camelize(row);
  if (!e.magicTokenExpiresAt) e.magicTokenExpiresAt = '';
  if (!e.magicTokenUsedAt) e.magicTokenUsedAt = '';
  if (!e.magicTokenHash) e.magicTokenHash = '';
  return e;
}

function mapAudit(row) {
  if (!row) return null;
  const a = camelize(row);
  a.at = a.createdAt;
  a.prev = a.prevHash || 'genesis';
  delete a.prevHash;
  return a;
}

// --- audit chain ---------------------------------------------------------

async function writeAudit({ siteId, action, actor, entryId, reason, ip, device }) {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_LOCK]);
    const site = siteId
      ? (await client.query('SELECT company_id FROM sites WHERE id = $1', [siteId])).rows[0]
      : null;
    const prevRow = await client.query(
      'SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1',
    );
    const prev = prevRow.rows[0]?.hash || 'genesis';
    const row = {
      id: id('aud_'),
      at: now(),
      siteId: siteId || '',
      companyId: site?.company_id || '',
      action,
      actorRole: actor?.role || 'system',
      actorName: actor?.name || '',
      actorHint: actor?.hint || '',
      entryId: entryId || '',
      reason: reason || '',
      ip: ip || '',
      device: device || '',
      prev,
    };
    row.hash = hashAudit(auditBase(row));
    await client.query(
      `INSERT INTO audit_events
         (id, site_id, company_id, action, actor_role, actor_name, actor_hint, entry_id, reason, ip, device, prev_hash, hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        row.id,
        row.siteId,
        row.companyId,
        row.action,
        row.actorRole,
        row.actorName,
        row.actorHint,
        row.entryId,
        row.reason,
        row.ip,
        row.device,
        row.prev,
        row.hash,
        row.at,
      ],
    );
    return row;
  });
}

export async function verifyAudit() {
  const rows = (await query('SELECT * FROM audit_events ORDER BY seq ASC')).rows.map(mapAudit);
  let prev = 'genesis';
  for (const row of rows) {
    const base = auditBase(row);
    if (base.prev !== prev) return { ok: false, at: row.id, reason: 'prev_mismatch' };
    if (hashAudit(base) !== row.hash) return { ok: false, at: row.id, reason: 'hash_mismatch' };
    prev = row.hash;
  }
  return { ok: true, count: rows.length };
}

async function note(siteId, kind, message, extra, actor, ip, device) {
  await query(
    'INSERT INTO events (id, site_id, kind, message, extra, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [id('ev_'), siteId, kind, message, extra ? JSON.stringify(extra) : null, now()],
  );
  await writeAudit({
    siteId,
    action: kind,
    actor,
    entryId: extra?.entryId,
    reason: extra?.reason || message,
    ip,
    device,
  });
}

// --- change feed ---------------------------------------------------------

function emitSite(siteId, type, payload) {
  bus.emit(`site:${siteId}`, { type, payload, at: now() });
  publishDelta({ serverId: SERVER_ID, siteId, type, payload }).catch(() => {});
}

function emitEntry(entry) {
  if (!entry) return;
  emitSite(entry.siteId, 'delta', {
    entity: 'entry',
    op: 'upsert',
    entry: safeEntry(entry, { managerPhone: false }),
  });
}

async function emitPeople(siteId) {
  emitSite(siteId, 'delta', {
    entity: 'people',
    op: 'replace',
    people: await listPeople(siteId),
  });
}

let listenerReady = false;

export async function initStore({ seed = false } = {}) {
  await runMigrations();
  if (!listenerReady) {
    await startListener((msg) => {
      if (!msg || msg.serverId === SERVER_ID) return;
      bus.emit(`site:${msg.siteId}`, { type: msg.type, payload: msg.payload, at: now() });
    });
    listenerReady = true;
  }
  if (seed) await seedDemoIfEmpty();
}

export function subscribe(siteId, fn) {
  const ch = `site:${siteId}`;
  bus.on(ch, fn);
  return () => bus.off(ch, fn);
}
subscribe.__bus = bus;

export async function resetStore() {
  await truncateAll();
}

// --- reads ---------------------------------------------------------------

export async function getSite(siteId) {
  const { rows } = await query('SELECT * FROM sites WHERE id = $1', [siteId]);
  return mapSite(rows[0]);
}

export async function getSiteBySlug(slug) {
  const { rows } = await query('SELECT * FROM sites WHERE slug = $1', [slug]);
  return mapSite(rows[0]);
}

export async function getSiteByOwnerEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return null;
  const { rows } = await query(
    'SELECT * FROM sites WHERE lower(owner_email) = $1 ORDER BY created_at ASC LIMIT 1',
    [clean],
  );
  return mapSite(rows[0]);
}

export async function listPeople(siteId) {
  const { rows } = await query(
    'SELECT * FROM people WHERE site_id = $1 AND active IS NOT FALSE ORDER BY created_at ASC',
    [siteId],
  );
  return rows.map(camelize);
}

export async function listEntries(siteId) {
  const { rows } = await query(
    'SELECT * FROM entries WHERE site_id = $1 ORDER BY created_at DESC',
    [siteId],
  );
  return rows.map(mapEntry);
}

export async function getEntry(entryId) {
  const { rows } = await query('SELECT * FROM entries WHERE id = $1', [entryId]);
  return mapEntry(rows[0]);
}

export async function getEntryByToken(magicToken) {
  const want = hashToken(magicToken);
  if (!want) return null;
  const { rows } = await query('SELECT * FROM entries WHERE magic_token_hash = $1 LIMIT 1', [want]);
  return mapEntry(rows[0]);
}

export async function getEntryByDayToken(siteId, dayToken) {
  const t = String(dayToken || '').trim().toUpperCase();
  const { rows } = await query(
    'SELECT * FROM entries WHERE site_id = $1 AND day_token = $2 LIMIT 1',
    [siteId, t],
  );
  return mapEntry(rows[0]);
}

export async function listAudit(siteId, limit = 200) {
  const { rows } = await query(
    'SELECT * FROM audit_events WHERE site_id = $1 ORDER BY seq DESC LIMIT $2',
    [siteId, limit],
  );
  return rows.map(mapAudit);
}

export async function getDb() {
  const [companies, sites, people, entries, events, audit] = await Promise.all([
    query('SELECT * FROM companies ORDER BY created_at ASC').then((r) => r.rows.map(camelize)),
    query('SELECT * FROM sites ORDER BY created_at ASC').then((r) => r.rows.map(mapSite)),
    query('SELECT * FROM people ORDER BY created_at ASC').then((r) => r.rows.map(camelize)),
    query('SELECT * FROM entries ORDER BY created_at ASC').then((r) => r.rows.map(mapEntry)),
    query('SELECT * FROM events ORDER BY created_at ASC').then((r) => r.rows.map(camelize)),
    query('SELECT * FROM audit_events ORDER BY seq ASC').then((r) => r.rows.map(mapAudit)),
  ]);
  return { companies, sites, people, entries, events, audit };
}

// --- writes --------------------------------------------------------------

const personKeys = [
  'id',
  'siteId',
  'companyId',
  'name',
  'role',
  'phone',
  'managerPhone',
  'employeeId',
  'active',
  'createdAt',
];

async function insertRow(table, keys, obj, client = null) {
  const cols = keys.map(camelToSnake);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const values = keys.map((k) => obj[k]);
  const run = client ? client.query.bind(client) : query;
  await run(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
    values,
  );
  return obj;
}

const entryKeys = [
  'id',
  'siteId',
  'companyId',
  'kind',
  'status',
  'name',
  'phone',
  'company',
  'purpose',
  'hostName',
  'idNumber',
  'cardNumber',
  'employeeId',
  'personId',
  'reason',
  'expectedMinutes',
  'managerName',
  'managerPhone',
  'source',
  'dayToken',
  'magicTokenHash',
  'magicTokenExpiresAt',
  'magicTokenUsedAt',
  'denyReason',
  'unapprovedReason',
  'createdAt',
  'updatedAt',
  'admittedAt',
  'exitedAt',
  'requestedAt',
  'decidedAt',
  'outAt',
  'inAt',
  'dueAt',
];

async function updateEntry(entryId, patch) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${camelToSnake(k)} = $${i + 1}`);
  await query(`UPDATE entries SET ${sets.join(', ')} WHERE id = $${keys.length + 1}`, [
    ...keys.map((k) => patch[k]),
    entryId,
  ]);
}

function phoneForSite(site, raw) {
  return normalizePhone(raw, site?.countryIso || 'SA');
}

async function uniqueDayToken(siteId) {
  for (let i = 0; i < 20; i += 1) {
    const code = shortCode(4);
    if (!(await getEntryByDayToken(siteId, code))) return code;
  }
  return shortCode(5);
}

export async function createSite({ name, ownerName, ownerEmail, lang = 'ar', pack, countryIso = 'SA' }) {
  const company = {
    id: id('co_'),
    name: String(name || 'Company').trim(),
    countryIso: countryOf(countryIso).iso,
    createdAt: now(),
  };
  const pin = generatePin();
  const site = {
    id: id('site_'),
    companyId: company.id,
    slug: `gd-${shortCode(6).toLowerCase()}`,
    name: company.name,
    pack: coercePack(pack),
    ownerName: ownerName || '',
    ownerEmail: ownerEmail || '',
    lang: lang === 'en' ? 'en' : 'ar',
    countryIso: company.countryIso,
    guardPinHash: hashPin(pin),
    createdAt: now(),
  };
  await withTransaction(async (client) => {
    await insertRow(
      'companies',
      ['id', 'name', 'countryIso', 'createdAt'],
      company,
      client,
    );
    await insertRow(
      'sites',
      [
        'id',
        'companyId',
        'slug',
        'name',
        'pack',
        'ownerName',
        'ownerEmail',
        'lang',
        'countryIso',
        'guardPinHash',
        'createdAt',
      ],
      site,
      client,
    );
    if (site.ownerEmail) {
      await insertRow(
        'users',
        ['id', 'companyId', 'email', 'role', 'createdAt'],
        { id: id('u_'), companyId: company.id, email: site.ownerEmail, role: 'owner', createdAt: now() },
        client,
      );
    }
  });
  await writeAudit({
    siteId: site.id,
    action: 'site_created',
    actor: { role: 'owner', name: ownerName || 'owner' },
  });
  return { site, pin };
}

export async function resetGuardPin(siteId, meta = {}) {
  const site = await getSite(siteId);
  if (!site) return { error: 'not_found' };
  const pin = generatePin();
  await query('UPDATE sites SET guard_pin_hash = $1, updated_at = $2 WHERE id = $3', [
    hashPin(pin),
    now(),
    siteId,
  ]);
  await writeAudit({ siteId, action: 'pin_reset', actor: meta.actor, ip: meta.ip, device: meta.device });
  return { pin };
}

export async function addPerson(siteId, { name, role, phone, managerPhone, employeeId }, meta = {}) {
  const site = await getSite(siteId);
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
  await insertRow('people', personKeys, person);
  await note(siteId, 'person_added', `${person.name} added`, { personId: person.id }, meta.actor, meta.ip, meta.device);
  await emitPeople(siteId);
  return { person };
}

export async function createVisitor(input, meta = {}) {
  const site = await getSite(input.siteId);
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
    dayToken: await uniqueDayToken(input.siteId),
    magicTokenHash: '',
    magicTokenExpiresAt: null,
    magicTokenUsedAt: null,
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
  await insertRow('entries', entryKeys, entry);
  await note(input.siteId, 'visitor_created', `${entry.name} is waiting at the gate`, { entryId: entry.id, source: entry.source }, meta.actor, meta.ip, meta.device);
  emitEntry(entry);
  return { entry };
}

export async function createOutPass(input, meta = {}) {
  const site = await getSite(input.siteId);
  const m = phoneForSite(site, input.managerPhone);
  if (m.error) return { error: m.error, expected: m.expected };
  const empPhone = input.phone ? phoneForSite(site, input.phone) : { e164: '' };
  if (input.phone && empPhone.error) return { error: empPhone.error, expected: empPhone.expected };
  const minutes = Math.max(15, Number(input.expectedMinutes) || 60);
  const magicToken = newMagicToken();
  const expires = tokenExpiry();
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
    dayToken: await uniqueDayToken(input.siteId),
    magicTokenHash: hashToken(magicToken),
    magicTokenExpiresAt: expires,
    magicTokenUsedAt: null,
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
  await withTransaction(async (client) => {
    await insertRow('entries', entryKeys, entry, client);
    await insertRow(
      'approval_tokens',
      ['id', 'entryId', 'tokenHash', 'expiresAt', 'usedAt', 'createdAt'],
      {
        id: id('tok_'),
        entryId: entry.id,
        tokenHash: entry.magicTokenHash,
        expiresAt: expires,
        usedAt: null,
        createdAt: now(),
      },
      client,
    );
  });
  await note(input.siteId, 'outpass_requested', `${entry.name} asked to go out`, { entryId: entry.id, source: entry.source }, meta.actor, meta.ip, meta.device);
  emitEntry(entry);
  return { entry, magicToken };
}

export async function decideOutPass(magicToken, decision, denyReason = '', meta = {}) {
  const entry = await getEntryByToken(magicToken);
  if (!entry) return { error: 'not_found' };
  if (entry.kind !== 'outpass') return { error: 'not_outpass' };
  if (isMagicTokenExpired(entry)) return { error: 'token_expired' };
  if (entry.status !== 'waiting_approval') return { error: 'already_decided', entry };
  const ok = decision === 'approve';
  const patch = {
    status: ok ? 'approved_out' : 'denied',
    magicTokenUsedAt: now(),
    decidedAt: now(),
    updatedAt: now(),
    denyReason: ok ? '' : String(denyReason || '').trim(),
  };
  await withTransaction(async (client) => {
    await client.query(
      'UPDATE entries SET status=$1, magic_token_used_at=$2, decided_at=$3, updated_at=$4, deny_reason=$5 WHERE id=$6',
      [patch.status, patch.magicTokenUsedAt, patch.decidedAt, patch.updatedAt, patch.denyReason, entry.id],
    );
    await client.query('UPDATE approval_tokens SET used_at=$1 WHERE entry_id=$2 AND used_at IS NULL', [
      patch.magicTokenUsedAt,
      entry.id,
    ]);
  });
  Object.assign(entry, patch);
  await note(
    entry.siteId,
    ok ? 'outpass_approved' : 'outpass_denied',
    ok ? `${entry.name} was approved to leave` : `${entry.name} was denied`,
    { entryId: entry.id, reason: patch.denyReason },
    meta.actor || { role: 'manager', name: entry.managerName, hint: 'magic-link' },
    meta.ip,
    meta.device,
  );
  emitEntry(entry);
  return { entry };
}

const TRANSITIONS = {
  visitor: {
    waiting_admit: { inside: 'admittedAt' },
    inside: { exited: 'exitedAt' },
  },
  outpass: {
    waiting_approval: { approved_out: 'decidedAt', denied: 'decidedAt' },
    approved_out: { out: 'outAt' },
    out: { returned: 'inAt' },
  },
};

const UNAPPROVED_FROM = ['waiting_approval', 'approved_out', 'out'];

function isAllowedTransition(kind, from, to) {
  return Boolean(TRANSITIONS[kind]?.[from]?.[to]);
}

async function touch(entry, status, field, kind, message, meta) {
  if (!entry) return { error: 'not_found' };
  if (!isAllowedTransition(entry.kind, entry.status, status)) {
    return { error: 'bad_transition', entry };
  }
  const patch = { status, [field]: now(), updatedAt: now() };
  await updateEntry(entry.id, patch);
  Object.assign(entry, patch);
  await note(entry.siteId, kind, message, { entryId: entry.id }, meta.actor, meta.ip, meta.device);
  emitEntry(entry);
  return { entry };
}

export async function admitVisitor(entryId, meta = {}) {
  const entry = await getEntry(entryId);
  if (!entry || entry.kind !== 'visitor') return { error: 'not_found' };
  return touch(entry, 'inside', 'admittedAt', 'visitor_in', `${entry.name} was welcomed in`, meta);
}

export async function exitVisitor(entryId, meta = {}) {
  const entry = await getEntry(entryId);
  if (!entry || entry.kind !== 'visitor') return { error: 'not_found' };
  return touch(entry, 'exited', 'exitedAt', 'visitor_out', `${entry.name} left the site`, meta);
}

export async function logOut(entryId, meta = {}) {
  const entry = await getEntry(entryId);
  if (!entry || entry.kind !== 'outpass') return { error: 'not_found' };
  return touch(entry, 'out', 'outAt', 'employee_out', `${entry.name} walked out the gate`, meta);
}

export async function logIn(entryId, meta = {}) {
  const entry = await getEntry(entryId);
  if (!entry || entry.kind !== 'outpass') return { error: 'not_found' };
  return touch(entry, 'returned', 'inAt', 'employee_in', `${entry.name} came back`, meta);
}

export async function unapprovedLeave(entryId, reason, meta = {}) {
  const entry = await getEntry(entryId);
  if (!entry) return { error: 'not_found' };
  if (entry.kind !== 'outpass' || !UNAPPROVED_FROM.includes(entry.status)) {
    return { error: 'bad_transition', entry };
  }
  const patch = {
    status: 'unapproved_leave',
    unapprovedReason: String(reason || '').trim(),
    outAt: entry.outAt || now(),
    updatedAt: now(),
  };
  await updateEntry(entry.id, patch);
  Object.assign(entry, patch);
  await note(entry.siteId, 'unapproved_leave', `${entry.name} left without approval`, { entryId: entry.id, reason: patch.unapprovedReason }, meta.actor, meta.ip, meta.device);
  emitEntry(entry);
  return { entry };
}

export async function searchEntries(siteId, q) {
  const query_text = String(q || '').trim().toLowerCase();
  const entries = await listEntries(siteId);
  if (!query_text) return entries;
  let qd = digits(query_text);
  if (qd.startsWith('00')) qd = qd.slice(2);
  if (qd.startsWith('0')) qd = qd.slice(1);
  return entries.filter((e) => {
    const text = [e.name, e.phone, e.dayToken, e.cardNumber, e.employeeId, e.company, e.hostName, e.managerName, e.managerPhone, e.idNumber, e.reason, e.purpose]
      .join(' ')
      .toLowerCase();
    if (text.includes(query_text)) return true;
    if (qd.length >= 3) {
      const nums = [e.phone, e.managerPhone, e.employeeId, e.cardNumber, e.idNumber, e.dayToken].map(digits).join(' ');
      if (nums.includes(qd)) return true;
    }
    return false;
  });
}

export async function dashboard(siteId) {
  const entries = await listEntries(siteId);
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

export async function exportRows(siteId, { from, to, status, kind } = {}) {
  return (await listEntries(siteId))
    .filter((e) => {
      if (from && e.createdAt < from) return false;
      if (to && e.createdAt > to) return false;
      if (status && e.status !== status) return false;
      if (kind && e.kind !== kind) return false;
      return true;
    })
    .map((e) => safeEntry(e, { managerPhone: true }));
}

export async function snapshot(siteId) {
  const site = await getSite(siteId);
  if (!site) return null;
  const [people, entries, events, stats] = await Promise.all([
    listPeople(siteId),
    listEntries(siteId),
    query(
      'SELECT * FROM events WHERE site_id = $1 ORDER BY created_at DESC LIMIT 80',
      [siteId],
    ).then((r) => r.rows.map(camelize)),
    dashboard(siteId),
  ]);
  return {
    site: publicSite(site),
    people,
    entries: entries.map((e) => safeEntry(e, { managerPhone: true })),
    events,
    stats,
  };
}

export async function seedDemoIfEmpty() {
  const existing = await query('SELECT id, slug FROM sites ORDER BY created_at ASC LIMIT 1');
  if (existing.rows.length > 0) {
    return getSiteBySlug('demo') || getSite(existing.rows[0].id);
  }
  const company = {
    id: 'co_demo',
    name: 'Al-Noor Warehouse',
    countryIso: 'SA',
    createdAt: now(),
  };
  const demoPin = process.env.DEMO_PIN || generatePin();
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
    guardPinHash: hashPin(demoPin),
    createdAt: now(),
  };
  await withTransaction(async (client) => {
    await insertRow('companies', ['id', 'name', 'countryIso', 'createdAt'], company, client);
    await insertRow(
      'sites',
      ['id', 'companyId', 'slug', 'name', 'pack', 'ownerName', 'ownerEmail', 'lang', 'countryIso', 'guardPinHash', 'createdAt'],
      site,
      client,
    );
  });
  process.stdout.write(`gate-daftar demo booth PIN: ${demoPin}\n`);
  for (const p of [
    { name: 'Khalid Al-Harbi', role: 'manager', phone: '966500111222', managerPhone: '', employeeId: 'M-01' },
    { name: 'Noura Al-Otaibi', role: 'manager', phone: '966500333444', managerPhone: '', employeeId: 'M-02' },
    { name: 'Yousef Hassan', role: 'employee', phone: '966511222333', managerPhone: '966500111222', employeeId: 'E-104' },
    { name: 'Ahmed Farouk', role: 'employee', phone: '966511444555', managerPhone: '966500111222', employeeId: 'E-118' },
    { name: 'Sami Al-Dosari', role: 'employee', phone: '966511666777', managerPhone: '966500333444', employeeId: 'E-221' },
  ]) {
    await addPerson(site.id, p, { actor: { role: 'owner', name: 'Fahad' } });
  }

  await createVisitor({ siteId: site.id, name: 'Ibrahim Delivery', phone: '966555000111', company: 'Aramex', purpose: 'Parcel drop', hostName: 'Receiving', source: 'qr' }, { actor: { role: 'visitor', name: 'Ibrahim Delivery' } });
  await createVisitor({ siteId: site.id, name: 'Contractor Majed', phone: '966555222333', company: 'AC Fix Co', purpose: 'HVAC repair', hostName: 'Maintenance', source: 'guard' }, { actor: { role: 'guard', name: 'Booth' } });
  const admitted = await createVisitor({ siteId: site.id, name: 'Layla Supplier', phone: '966555888999', company: 'Gulf Parts', purpose: 'Parts delivery', hostName: 'Store', source: 'guard' }, { actor: { role: 'guard', name: 'Booth' } });
  if (admitted.entry) await admitVisitor(admitted.entry.id, { actor: { role: 'guard', name: 'Booth' } });
  await createOutPass({ siteId: site.id, name: 'Yousef Hassan', employeeId: 'E-104', reason: 'Bank errand', expectedMinutes: 90, managerPhone: '966500111222', managerName: 'Khalid Al-Harbi', source: 'qr' }, { actor: { role: 'employee', name: 'Yousef Hassan' } });
  const approved = await createOutPass({ siteId: site.id, name: 'Ahmed Farouk', employeeId: 'E-118', reason: 'Lunch', expectedMinutes: 45, managerPhone: '966500111222', managerName: 'Khalid Al-Harbi', source: 'guard' }, { actor: { role: 'guard', name: 'Booth' } });
  if (approved.entry) await decideOutPass(approved.magicToken, 'approve', '', { actor: { role: 'manager', name: 'Khalid Al-Harbi', hint: 'seed' } });
  return getSite(site.id);
}

export { digits, countryOf };
export { PACKS, coercePack } from './packs.js';
