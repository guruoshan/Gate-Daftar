import crypto from 'crypto';
import { EventEmitter } from 'events';
import { id, shortCode, now } from './ids.js';
import { countryOf, normalizePhone, digits } from './countries.js';
import { normalizeArabicText } from './text.js';
import { timezoneForCountry, isValidTimeZone, dayBounds, todayLocalDate } from './time.js';
import { hashPin, hashPassword, generatePin, verifyPin } from './pins.js';
import { PACKS, coercePack } from './packs.js';
import { newMagicToken, hashToken, tokenExpiry, isExpired } from './tokens.js';
import { auditBase, hashAudit } from './audit.js';
import { domainsFromOwner, emailAllowed } from './emails.js';
import {
  query,
  withTransaction,
  runMigrations,
  truncateAll,
  publishDelta,
  startListener,
} from './db.js';
import { importLegacyIfEmpty } from './boot.js';
import { parseCsv } from './csv.js';

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

const HIDDEN_KEYS = [
  'guardPin',
  'guardPinHash',
  'magicToken',
  'magicTokenHash',
  'magicTokenExpiresAt',
  'magicTokenUsedAt',
  'approveUrl',
  'denyUrl',
  'pageUrl',
  'waLink',
  'smsBody',
  'managerPhone',
  'managerEmail',
  'ownerEmail',
  'ownerName',
  'pinHash',
  'email',
  'passwordHash',
];

function withoutHidden(value) {
  if (!value) return value;
  const out = { ...value };
  for (const key of HIDDEN_KEYS) delete out[key];
  return out;
}

export function redactEntry(entry) {
  return withoutHidden(entry);
}

export function redactSite(site) {
  return withoutHidden(site);
}

export function redactPerson(person, extra = {}) {
  if (!person) return person;
  const out = {
    id: person.id,
    name: person.name,
    role: person.role,
    employeeId: person.employeeId || '',
    managerId: person.managerId || '',
  };
  if (extra.includeEmail && person.email) out.email = person.email;
  return out;
}

export function redactAudit(row) {
  return withoutHidden(row);
}

export function safeEntry(entry) {
  return redactEntry(entry);
}

export function publicGateView(site, roster = { employees: [], managers: [] }) {
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
    employees: roster.employees || [],
    managers: roster.managers || [],
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
    timezone: site.timezone || timezoneForCountry(site.countryIso),
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
  s.timezone = s.timezone || timezoneForCountry(s.countryIso);
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
    const siteKey = siteId || '';
    const prevRow = await client.query(
      'SELECT hash, site_seq FROM audit_events WHERE COALESCE(site_id, \'\') = $1 ORDER BY site_seq DESC NULLS LAST, seq DESC LIMIT 1',
      [siteKey],
    );
    const prev = prevRow.rows[0]?.hash || 'genesis';
    const siteSeq = Number(prevRow.rows[0]?.site_seq || 0) + 1;
    const row = {
      id: id('aud_'),
      at: now(),
      siteId: siteKey,
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
         (id, site_id, company_id, action, actor_role, actor_name, actor_hint, entry_id, reason, ip, device, prev_hash, hash, created_at, site_seq, legacy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false)`,
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
        siteSeq,
      ],
    );
    return row;
  });
}

export async function verifyAudit() {
  const rows = (await query(
    'SELECT * FROM audit_events ORDER BY COALESCE(site_id, \'\'), site_seq ASC NULLS FIRST, seq ASC',
  )).rows.map(mapAudit);
  const lastBySite = new Map();
  let checked = 0;
  for (const row of rows) {
    const siteKey = row.siteId || '';
    const prev = lastBySite.get(siteKey) || 'genesis';
    const base = auditBase(row);
    if (row.legacy) {
      lastBySite.set(siteKey, row.hash);
      continue;
    }
    if (base.prev !== prev) return { ok: false, at: row.id, reason: 'prev_mismatch' };
    if (hashAudit(base) !== row.hash) return { ok: false, at: row.id, reason: 'hash_mismatch' };
    lastBySite.set(siteKey, row.hash);
    checked += 1;
  }
  return { ok: true, count: checked };
}

async function note(siteId, kind, message, extra, actor, ip, device) {
  await query(
    'INSERT INTO events (id, site_id, kind, message, extra, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [id('ev_'), siteId, kind, message, extra ? JSON.stringify(extra) : null, now()],
  );
  await query(
    `DELETE FROM events WHERE site_id = $1 AND id IN (
       SELECT id FROM events WHERE site_id = $1 ORDER BY created_at DESC OFFSET 500
     )`,
    [siteId],
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
    entry: redactEntry(entry),
  });
}

async function emitPeople(siteId) {
  const site = await getSite(siteId);
  const people = (await listPeople(siteId)).map(redactPerson);
  const sites = site?.companyId ? await listSitesByCompany(site.companyId) : [{ id: siteId }];
  for (const s of sites) {
    emitSite(s.id, 'delta', {
      entity: 'people',
      op: 'replace',
      people,
    });
  }
}

let listenerReady = false;

async function attachListener() {
  await startListener((msg) => {
    if (!msg || msg.serverId === SERVER_ID) return;
    bus.emit(`site:${msg.siteId}`, { type: msg.type, payload: msg.payload, at: now() });
  });
  listenerReady = true;
}

export async function initStore({ seed = false } = {}) {
  await runMigrations();
  if (!listenerReady) await attachListener();
  if (seed) {
    await importLegacyIfEmpty();
    await seedDemoIfEmpty();
  }
}

export async function restartListener() {
  listenerReady = false;
  await attachListener();
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

export async function getCompany(companyId) {
  if (!companyId) return null;
  const { rows } = await query('SELECT * FROM companies WHERE id = $1', [companyId]);
  return rows[0] ? camelize(rows[0]) : null;
}

export async function getUserByEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return null;
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = $1 LIMIT 1', [clean]);
  return rows[0] ? camelize(rows[0]) : null;
}

export function publicCompany(company) {
  if (!company) return null;
  return {
    id: company.id,
    name: company.name,
    countryIso: company.countryIso || 'SA',
    pack: coercePack(company.pack),
  };
}

export async function listSitesByCompany(companyId) {
  if (!companyId) return [];
  const { rows } = await query('SELECT * FROM sites WHERE company_id = $1 ORDER BY created_at ASC', [companyId]);
  return rows.map(mapSite);
}

export async function listPeople(siteId) {
  const site = await getSite(siteId);
  if (!site?.companyId) return [];
  const { rows } = await query(
    'SELECT * FROM people WHERE company_id = $1 AND active IS NOT FALSE ORDER BY created_at ASC',
    [site.companyId],
  );
  return rows.map(camelize);
}

export async function getPerson(personId) {
  if (!personId) return null;
  const { rows } = await query('SELECT * FROM people WHERE id = $1', [personId]);
  return rows[0] ? camelize(rows[0]) : null;
}

export async function listPeoplePublic(siteId) {
  return (await listPeople(siteId)).map((p) => redactPerson(p));
}

export async function listGateRoster(siteId) {
  const people = await listPeople(siteId);
  return {
    employees: people.filter((p) => p.role !== 'manager' && p.role !== 'guard').map((p) => redactPerson(p)),
    managers: people.filter((p) => p.role === 'manager').map((p) => redactPerson(p)),
  };
}

export async function listGuards(siteId) {
  return (await listPeople(siteId))
    .filter((p) => p.role === 'guard')
    .map((p) => ({ id: p.id, name: p.name, employeeId: p.employeeId || '' }));
}

const OPEN_STATUSES = ['waiting_admit', 'waiting_approval', 'approved_out', 'inside', 'out'];

export async function listEntries(siteId) {
  const { rows } = await query(
    'SELECT * FROM entries WHERE site_id = $1 ORDER BY created_at DESC',
    [siteId],
  );
  return rows.map(mapEntry);
}

export async function listLiveEntries(siteId, timezone) {
  const site = timezone ? { timezone } : await getSite(siteId);
  const tz = site?.timezone || timezoneForCountry(site?.countryIso);
  const today = todayLocalDate(tz);
  const { start, end } = dayBounds(today, tz);
  const { rows } = await query(
    `SELECT * FROM entries
      WHERE site_id = $1
        AND (status = ANY($2) OR created_at >= $3::timestamptz)
      ORDER BY created_at DESC`,
    [siteId, OPEN_STATUSES, start],
  );
  return rows.map(mapEntry).filter((e) => {
    if (OPEN_STATUSES.includes(e.status)) return true;
    return e.createdAt >= start && e.createdAt < end;
  });
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
  'email',
  'managerPhone',
  'managerId',
  'employeeId',
  'pinHash',
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
  'vehicle',
  'employeeId',
  'personId',
  'reason',
  'expectedMinutes',
  'managerName',
  'managerPhone',
  'managerEmail',
  'managerId',
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

export async function createCompany({
  companyName,
  name,
  ownerName,
  ownerEmail,
  password,
  lang = 'ar',
  pack,
  countryIso = 'SA',
  emailDomains,
  timezone,
}) {
  const email = String(ownerEmail || '').trim().toLowerCase();
  if (email && (await getUserByEmail(email))) return { error: 'email_taken' };
  const company = {
    id: id('co_'),
    name: String(companyName || name || 'Company').trim(),
    countryIso: countryOf(countryIso).iso,
    emailDomains: domainsFromOwner(email, emailDomains),
    pack: coercePack(pack),
    lang: lang === 'en' ? 'en' : 'ar',
    timezone: isValidTimeZone(timezone) ? timezone : timezoneForCountry(countryOf(countryIso).iso),
    createdAt: now(),
  };
  const user = email
    ? {
        id: id('u_'),
        companyId: company.id,
        email,
        role: 'owner',
        passwordHash: password ? hashPassword(password) : '',
        createdAt: now(),
      }
    : null;
  await withTransaction(async (client) => {
    await insertRow(
      'companies',
      ['id', 'name', 'countryIso', 'emailDomains', 'pack', 'lang', 'timezone', 'createdAt'],
      company,
      client,
    );
    if (user) {
      await insertRow(
        'users',
        ['id', 'companyId', 'email', 'role', 'passwordHash', 'createdAt'],
        user,
        client,
      );
    }
  });
  return { company, site: null, user };
}

export async function createSite(input) {
  return createCompany(input);
}

async function uniqueGatePin() {
  for (let i = 0; i < 20; i += 1) {
    const pin = generatePin();
    const hash = hashPin(pin);
    const { rows } = await query('SELECT id, guard_pin_hash FROM sites WHERE guard_pin_hash <> \'\'');
    const clash = rows.some((row) => verifyPin(pin, row.guard_pin_hash));
    if (!clash) return { pin, hash };
  }
  const pin = generatePin();
  return { pin, hash: hashPin(pin) };
}

export async function addSite(companyId, { name, pack, lang, countryIso, timezone }, meta = {}) {
  const company = await getCompany(companyId);
  if (!company) return { error: 'not_found' };
  const sites = await listSitesByCompany(companyId);
  const first = sites[0];
  const { pin, hash } = await uniqueGatePin();
  const site = {
    id: id('site_'),
    companyId,
    slug: `gd-${shortCode(6).toLowerCase()}`,
    name: String(name || '').trim() || company.name,
    pack: coercePack(pack || first?.pack || company.pack),
    ownerName: first?.ownerName || meta.actor?.name || '',
    ownerEmail: first?.ownerEmail || '',
    lang: lang === 'en' || first?.lang === 'en' || company.lang === 'en' ? 'en' : 'ar',
    countryIso: countryOf(countryIso || first?.countryIso || company.countryIso).iso,
    timezone: isValidTimeZone(timezone)
      ? timezone
      : first?.timezone || (isValidTimeZone(company.timezone) ? company.timezone : timezoneForCountry(company.countryIso)),
    guardPinHash: hash,
    createdAt: now(),
  };
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
      'timezone',
      'guardPinHash',
      'createdAt',
    ],
    site,
  );
  await writeAudit({
    siteId: site.id,
    action: 'site_created',
    actor: meta.actor || { role: 'owner', name: site.ownerName || 'owner' },
  });
  return { site, pin };
}

export async function updateSiteTimezone(siteId, timezone, meta = {}) {
  const site = await getSite(siteId);
  if (!site) return { error: 'not_found' };
  if (!isValidTimeZone(timezone)) return { error: 'timezone_invalid' };
  await query('UPDATE sites SET timezone = $1, updated_at = $2 WHERE id = $3', [timezone, now(), siteId]);
  await writeAudit({ siteId, action: 'timezone_changed', actor: meta.actor, ip: meta.ip, device: meta.device, reason: timezone });
  return { site: await getSite(siteId) };
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

export async function addPerson(siteId, { name, role, phone, email, managerPhone, managerId, employeeId, pin }, meta = {}) {
  const site = await getSite(siteId);
  const company = await getCompany(site?.companyId);
  const p = phone ? phoneForSite(site, phone) : { e164: '' };
  const m = managerPhone ? phoneForSite(site, managerPhone) : { e164: '' };
  if (phone && p.error) return { error: p.error, expected: p.expected };
  if (managerPhone && m.error) return { error: m.error, expected: m.expected };
  const kind = role === 'manager' ? 'manager' : role === 'guard' ? 'guard' : 'employee';
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (kind === 'manager') {
    if (!cleanEmail) return { error: 'email_required' };
    if (!emailAllowed(company, cleanEmail)) return { error: 'email_domain_not_allowed' };
  } else if (cleanEmail && !emailAllowed(company, cleanEmail)) {
    return { error: 'email_domain_not_allowed' };
  }
  let pinHash = '';
  let shownPin = '';
  if (kind === 'guard') {
    shownPin = pin ? String(pin) : generatePin();
    pinHash = hashPin(shownPin);
  }
  const empId = String(employeeId || '').trim();
  if (empId && site?.companyId) {
    const { rows } = await query(
      'SELECT id FROM people WHERE company_id = $1 AND employee_id = $2 AND active IS NOT FALSE LIMIT 1',
      [site.companyId, empId],
    );
    if (rows[0]) return { error: 'employee_id_taken' };
  }
  const person = {
    id: id('p_'),
    siteId,
    companyId: site?.companyId || '',
    name: String(name || '').trim(),
    role: kind,
    phone: p.e164 || '',
    email: cleanEmail,
    managerPhone: m.e164 || '',
    managerId: String(managerId || '').trim(),
    employeeId: empId,
    pinHash,
    active: true,
    createdAt: now(),
  };
  await insertRow('people', personKeys, person);
  await note(siteId, 'person_added', `${person.name} added`, { personId: person.id }, meta.actor, meta.ip, meta.device);
  await emitPeople(siteId);
  return { person, pin: shownPin };
}

function namesEqual(a, b) {
  return normalizeArabicText(a) === normalizeArabicText(b);
}

const personAddKeys = [
  'id',
  'siteId',
  'companyId',
  'name',
  'employeeId',
  'managerId',
  'status',
  'source',
  'magicTokenHash',
  'magicTokenExpiresAt',
  'magicTokenUsedAt',
  'denyReason',
  'actorName',
  'createdAt',
  'decidedAt',
];

function mapPersonAdd(row) {
  return row ? camelize(row) : null;
}

export function publicPersonAdd(request) {
  if (!request) return null;
  return {
    id: request.id,
    name: request.name,
    employeeId: request.employeeId || '',
    status: request.status,
    denyReason: request.denyReason || '',
    decidedAt: request.decidedAt || null,
    requestedAt: request.createdAt,
  };
}

export async function createPersonAdd({ siteId, name, employeeId, managerId, source }, meta = {}) {
  const site = await getSite(siteId);
  if (!site) return { error: 'not_found' };
  const company = await getCompany(site.companyId);
  const cleanName = String(name || '').trim();
  if (!cleanName) return { error: 'name_required' };
  const people = await listPeople(siteId);
  const managers = people.filter((p) => p.role === 'manager');
  if (!managers.length) return { error: 'manager_required' };
  const manager = managers.find((p) => p.id === String(managerId || ''));
  if (!manager || !manager.email || !emailAllowed(company, manager.email)) {
    return { error: 'manager_required' };
  }
  const empId = String(employeeId || '').trim();
  if (empId) {
    if (people.some((p) => p.employeeId === empId)) return { error: 'already_on_list' };
  } else {
    const hits = people.filter((p) => p.role === 'employee' && namesEqual(p.name, cleanName));
    if (hits.length === 1) return { error: 'already_on_list' };
  }
  const magicToken = newMagicToken();
  const expires = tokenExpiry();
  const request = {
    id: id('pa_'),
    siteId: site.id,
    companyId: site.companyId,
    name: cleanName,
    employeeId: empId,
    managerId: manager.id,
    status: 'waiting',
    source: source === 'qr' ? 'qr' : 'guard',
    magicTokenHash: hashToken(magicToken),
    magicTokenExpiresAt: expires,
    magicTokenUsedAt: null,
    denyReason: '',
    actorName: meta.actor?.name || '',
    createdAt: now(),
    decidedAt: null,
  };
  await insertRow('person_add_requests', personAddKeys, request);
  await note(
    site.id,
    'person_add_requested',
    `${request.name} add requested`,
    {},
    meta.actor,
    meta.ip,
    meta.device,
  );
  return { request, magicToken, manager };
}

export async function getPersonAddByToken(magicToken) {
  const want = hashToken(magicToken);
  if (!want) return null;
  const { rows } = await query('SELECT * FROM person_add_requests WHERE magic_token_hash = $1 LIMIT 1', [want]);
  return mapPersonAdd(rows[0]);
}

export async function decidePersonAdd(magicToken, decision, denyReason = '', meta = {}) {
  const request = await getPersonAddByToken(magicToken);
  if (!request) return { error: 'not_found' };
  if (isMagicTokenExpired(request) && request.status === 'waiting') return { error: 'token_expired' };
  const ok = decision === 'approve';
  if (request.status !== 'waiting') {
    if (ok && request.status === 'approved') return { request };
    if (!ok && request.status === 'denied') return { request };
    return { error: 'invalid_state', request };
  }
  const usedAt = now();
  const decidedAt = now();
  if (!ok) {
    await query(
      'UPDATE person_add_requests SET status=$1, magic_token_used_at=$2, decided_at=$3, deny_reason=$4 WHERE id=$5',
      ['denied', usedAt, decidedAt, String(denyReason || '').trim(), request.id],
    );
    Object.assign(request, { status: 'denied', magicTokenUsedAt: usedAt, decidedAt, denyReason: String(denyReason || '').trim() });
    await writeAudit({
      siteId: request.siteId,
      action: 'person_add_denied',
      actor: meta.actor,
      ip: meta.ip,
      device: meta.device,
      reason: request.name,
    });
    return { request };
  }
  const added = await addPerson(
    request.siteId,
    {
      name: request.name,
      role: 'employee',
      employeeId: request.employeeId,
      managerId: request.managerId,
    },
    meta,
  );
  if (added.error && added.error !== 'employee_id_taken') return added;
  await query(
    'UPDATE person_add_requests SET status=$1, magic_token_used_at=$2, decided_at=$3, deny_reason=$4 WHERE id=$5',
    ['approved', usedAt, decidedAt, '', request.id],
  );
  Object.assign(request, { status: 'approved', magicTokenUsedAt: usedAt, decidedAt, denyReason: '' });
  await writeAudit({
    siteId: request.siteId,
    action: 'person_add_approved',
    actor: meta.actor,
    ip: meta.ip,
    device: meta.device,
    reason: request.name,
  });
  if (!added.error) await emitPeople(request.siteId);
  return { request, person: added.person || null };
}

function csvHeaderKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ');
}

function csvRole(raw) {
  const v = normalizeArabicText(raw);
  if (v === 'manager' || v === 'مدير') return 'manager';
  if (v === 'employee' || v === 'موظف') return 'employee';
  return '';
}

function matchCompanyPerson(people, empId, name) {
  if (empId) {
    const hits = people.filter((p) => p.employeeId === empId);
    if (hits.length > 1) return { error: 'employee_id_taken' };
    if (hits.length === 1) return { person: hits[0] };
    return { person: null };
  }
  const hits = people.filter((p) => namesEqual(p.name, name));
  if (hits.length > 1) return { error: 'name_ambiguous' };
  if (hits.length === 1) return { person: hits[0] };
  return { person: null };
}

async function applyPersonRow(site, company, people, row, meta) {
  const skip = (reason) => ({ skipped: true, reason, name: row.name });
  if (!row.role) return skip('role_invalid');
  if (!row.name) return skip('name_required');
  if (row.role === 'manager') {
    if (!row.email) return skip('email_required');
    if (!emailAllowed(company, row.email)) return skip('email_domain_not_allowed');
  } else if (row.email && !emailAllowed(company, row.email)) {
    return skip('email_domain_not_allowed');
  }
  let phone = '';
  if (row.phone) {
    const parsed = phoneForSite(site, row.phone);
    if (parsed.error) return skip('phone_invalid');
    phone = parsed.e164 || '';
  }
  let managerId = '';
  if (row.role === 'employee') {
    const managerName = row.managerName;
    if (!managerName) return skip('manager_not_found');
    const hits = people.filter((p) => p.role === 'manager' && namesEqual(p.name, managerName));
    if (!hits.length) return skip('manager_not_found');
    if (hits.length > 1) return skip('manager_name_ambiguous');
    managerId = hits[0].id;
  }
  const found = matchCompanyPerson(people, row.employeeId, row.name);
  if (found.error) return skip(found.error);
  if (found.person) {
    if (found.person.role === 'guard') return skip('guard_skip');
    await query('UPDATE people SET name = $1, email = $2, phone = $3, manager_id = $4 WHERE id = $5', [
      row.name,
      row.email || found.person.email || '',
      phone || found.person.phone || '',
      row.role === 'employee' ? managerId : found.person.managerId || '',
      found.person.id,
    ]);
    return { updated: true, name: row.name };
  }
  const added = await addPerson(
    site.id,
    {
      name: row.name,
      role: row.role,
      email: row.email,
      phone,
      employeeId: row.employeeId,
      managerId,
    },
    meta,
  );
  if (added.error === 'employee_id_taken') return skip('employee_id_taken');
  if (added.error === 'email_required') return skip('email_required');
  if (added.error === 'email_domain_not_allowed') return skip('email_domain_not_allowed');
  if (added.error) return skip(added.error);
  return { added: true, name: row.name };
}

export async function importPeopleCsv(siteId, text, meta = {}) {
  const site = await getSite(siteId);
  if (!site) return { error: 'not_found' };
  const company = await getCompany(site.companyId);
  const parsed = parseCsv(text);
  if (!parsed.headers.length) return { error: 'csv_invalid' };
  const keys = parsed.headers.map(csvHeaderKey);
  const col = (aliases) => {
    const i = keys.findIndex((h) => aliases.includes(h));
    return i;
  };
  const idx = {
    role: col(['role']),
    name: col(['name']),
    employeeId: col(['employee id', 'employeeid']),
    email: col(['work email', 'email']),
    phone: col(['phone']),
    managerName: col(['manager name', 'managername']),
  };
  if (idx.role < 0 || idx.name < 0) return { error: 'csv_invalid' };
  const records = parsed.rows.map((cells, i) => ({
    line: i + 2,
    role: csvRole(idx.role >= 0 ? cells[idx.role] : ''),
    name: String(idx.name >= 0 ? cells[idx.name] || '' : '').trim(),
    employeeId: String(idx.employeeId >= 0 ? cells[idx.employeeId] || '' : '').trim(),
    email: String(idx.email >= 0 ? cells[idx.email] || '' : '').trim().toLowerCase(),
    phone: String(idx.phone >= 0 ? cells[idx.phone] || '' : '').trim(),
    managerName: String(idx.managerName >= 0 ? cells[idx.managerName] || '' : '').trim(),
  }));
  const managers = records.filter((r) => r.role === 'manager');
  const employees = records.filter((r) => r.role !== 'manager');
  const ordered = [...managers, ...employees];
  const added = [];
  const updated = [];
  const skipped = [];
  const seenIds = new Set();
  for (const row of ordered) {
    if (row.employeeId) {
      if (seenIds.has(row.employeeId)) {
        skipped.push({ line: row.line, name: row.name, reason: 'employee_id_taken' });
        continue;
      }
      seenIds.add(row.employeeId);
    }
    const people = await listPeople(siteId);
    const result = await applyPersonRow(site, company, people, row, meta);
    if (result.skipped) skipped.push({ line: row.line, name: result.name, reason: result.reason });
    else if (result.added) added.push(row.name);
    else if (result.updated) updated.push(row.name);
  }
  await emitPeople(siteId);
  await writeAudit({
    siteId,
    action: 'people_csv_imported',
    actor: meta.actor,
    ip: meta.ip,
    device: meta.device,
    reason: `added=${added.length} updated=${updated.length} skipped=${skipped.length}`,
  });
  return { added: added.length, updated: updated.length, skipped };
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
    vehicle: String(input.vehicle || '').trim(),
    employeeId: '',
    personId: '',
    reason: '',
    expectedMinutes: 0,
    managerName: '',
    managerPhone: '',
    managerEmail: '',
    managerId: '',
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
  if (entry.vehicle.length > 32) return { error: 'vehicle_long' };
  await insertRow('entries', entryKeys, entry);
  await note(input.siteId, 'visitor_created', `${entry.name} is waiting at the gate`, { entryId: entry.id, source: entry.source }, meta.actor, meta.ip, meta.device);
  emitEntry(entry);
  return { entry };
}

export async function createOutPass(input, meta = {}) {
  const site = await getSite(input.siteId);
  const company = await getCompany(site?.companyId);
  const person = await getPerson(input.personId);
  if (!person || person.companyId !== site?.companyId || person.role === 'manager' || person.role === 'guard') {
    return { error: 'person_required' };
  }
  let manager = null;
  if (input.managerId) manager = await getPerson(input.managerId);
  if (!manager && person.managerId) manager = await getPerson(person.managerId);
  if (!manager || manager.companyId !== site?.companyId || manager.role !== 'manager' || !manager.email) {
    return { error: 'manager_required' };
  }
  if (!emailAllowed(company, manager.email)) return { error: 'email_domain_not_allowed' };
  const empPhone = person.phone ? { e164: person.phone } : input.phone ? phoneForSite(site, input.phone) : { e164: '' };
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
    name: person.name,
    phone: empPhone.e164 || '',
    company: String(input.company || '').trim(),
    purpose: '',
    hostName: '',
    idNumber: '',
    cardNumber: '',
    vehicle: '',
    employeeId: person.employeeId || String(input.employeeId || '').trim(),
    personId: person.id,
    reason: String(input.reason || '').trim(),
    expectedMinutes: minutes,
    managerName: manager.name,
    managerPhone: manager.phone || '',
    managerEmail: manager.email,
    managerId: manager.id,
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

export async function rotateOutPassToken(entryId) {
  const entry = await getEntry(entryId);
  if (!entry || entry.kind !== 'outpass') return { error: 'not_found' };
  if (entry.status !== 'waiting_approval') return { error: 'invalid_state', entry };
  const magicToken = newMagicToken();
  const expires = tokenExpiry();
  const tokenHash = hashToken(magicToken);
  await withTransaction(async (client) => {
    await client.query(
      'UPDATE entries SET magic_token_hash=$1, magic_token_expires_at=$2, magic_token_used_at=NULL, updated_at=$3 WHERE id=$4',
      [tokenHash, expires, now(), entry.id],
    );
    await client.query('UPDATE approval_tokens SET used_at=$1 WHERE entry_id=$2 AND used_at IS NULL', [now(), entry.id]);
    await insertRow(
      'approval_tokens',
      ['id', 'entryId', 'tokenHash', 'expiresAt', 'usedAt', 'createdAt'],
      {
        id: id('tok_'),
        entryId: entry.id,
        tokenHash,
        expiresAt: expires,
        usedAt: null,
        createdAt: now(),
      },
      client,
    );
  });
  Object.assign(entry, { magicTokenHash: tokenHash, magicTokenExpiresAt: expires, magicTokenUsedAt: null });
  return { entry, magicToken };
}

export async function findGuardByPin(siteId, pin) {
  const people = await listPeople(siteId);
  const guards = people.filter((p) => p.role === 'guard' && p.pinHash);
  for (const guard of guards) {
    if (verifyPin(String(pin || ''), guard.pinHash)) return guard;
  }
  return null;
}

export async function findSiteByPin(pin) {
  const clean = String(pin || '');
  if (!clean) return null;
  const { rows } = await query('SELECT * FROM sites WHERE guard_pin_hash <> \'\' ORDER BY created_at ASC');
  for (const row of rows) {
    const site = mapSite(row);
    if (verifyPin(clean, site.guardPinHash)) return site;
  }
  return null;
}

export async function verifySitePin(site, pin) {
  if (!site?.guardPinHash) return false;
  return verifyPin(String(pin || ''), site.guardPinHash);
}

function mapPasswordReset(row) {
  return row ? camelize(row) : null;
}

export async function requestPasswordReset(email) {
  const user = await getUserByEmail(email);
  if (!user) return { ok: true };
  const magicToken = newMagicToken();
  const row = {
    id: id('pr_'),
    userId: user.id,
    companyId: user.companyId,
    magicTokenHash: hashToken(magicToken),
    expiresAt: tokenExpiry(),
    usedAt: null,
    createdAt: now(),
  };
  await insertRow(
    'password_reset_requests',
    ['id', 'userId', 'companyId', 'magicTokenHash', 'expiresAt', 'usedAt', 'createdAt'],
    row,
  );
  return { ok: true, magicToken, user };
}

export async function getPasswordResetByToken(raw) {
  const want = hashToken(raw);
  if (!want) return null;
  const { rows } = await query(
    'SELECT * FROM password_reset_requests WHERE magic_token_hash = $1 LIMIT 1',
    [want],
  );
  return mapPasswordReset(rows[0]);
}

export async function completePasswordReset(raw, password) {
  const row = await getPasswordResetByToken(raw);
  if (!row) return { error: 'not_found' };
  if (row.usedAt || isExpired(row.expiresAt)) return { error: 'token_expired' };
  if (String(password || '').length < 8) return { error: 'password_short' };
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), row.userId]);
  await query('UPDATE password_reset_requests SET used_at = $1 WHERE id = $2', [now(), row.id]);
  return { ok: true };
}

export async function resetGuardPersonPin(siteId, personId, meta = {}) {
  const site = await getSite(siteId);
  const person = await getPerson(personId);
  if (!person || !site || person.companyId !== site.companyId || person.role !== 'guard') return { error: 'not_found' };
  const pin = generatePin();
  await query('UPDATE people SET pin_hash = $1 WHERE id = $2', [hashPin(pin), person.id]);
  await writeAudit({ siteId, action: 'guard_pin_reset', actor: meta.actor, ip: meta.ip, device: meta.device, entryId: person.id });
  return { pin, person: { id: person.id, name: person.name } };
}

export async function decideOutPass(magicToken, decision, denyReason = '', meta = {}) {
  const entry = await getEntryByToken(magicToken);
  if (!entry) return { error: 'not_found' };
  if (entry.kind !== 'outpass') return { error: 'not_outpass' };
  if (isMagicTokenExpired(entry)) return { error: 'token_expired' };
  const ok = decision === 'approve';
  const want = ok ? 'approved_out' : 'denied';
  if (entry.status !== 'waiting_approval') {
    if (ok && ['approved_out', 'out', 'returned'].includes(entry.status)) return { entry };
    if (!ok && entry.status === 'denied') return { entry };
    return { error: 'invalid_state', entry };
  }
  const patch = {
    status: want,
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
    unapproved_leave: { returned: 'inAt' },
  },
};

const UNAPPROVED_FROM = ['waiting_approval', 'approved_out'];

function isAllowedTransition(kind, from, to) {
  return Boolean(TRANSITIONS[kind]?.[from]?.[to]);
}

async function touch(entry, status, field, kind, message, meta) {
  if (!entry) return { error: 'not_found' };
  if (entry.status === status) return { entry };
  if (!isAllowedTransition(entry.kind, entry.status, status)) {
    return { error: 'invalid_state', entry };
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
  const why = String(reason || '').trim();
  if (why.length < 3) return { error: 'reason_required', entry };
  if (entry.status === 'unapproved_leave') return { entry };
  if (entry.kind !== 'outpass' || !UNAPPROVED_FROM.includes(entry.status)) {
    return { error: 'invalid_state', entry };
  }
  const patch = {
    status: 'unapproved_leave',
    unapprovedReason: why,
    outAt: entry.outAt || now(),
    updatedAt: now(),
  };
  await updateEntry(entry.id, patch);
  Object.assign(entry, patch);
  await note(entry.siteId, 'unapproved_leave', `${entry.name} left without approval`, { entryId: entry.id, reason: patch.unapprovedReason }, meta.actor, meta.ip, meta.device);
  emitEntry(entry);
  return { entry };
}

export async function searchEntries(siteId, q, { cursor = '', limit = 100 } = {}) {
  const needle = normalizeArabicText(q);
  const entries = await listEntries(siteId);
  let qd = digits(q);
  if (qd.startsWith('00')) qd = qd.slice(2);
  if (qd.startsWith('0')) qd = qd.slice(1);
  const matched = needle
    ? entries.filter((e) => {
        const text = normalizeArabicText(
          [e.name, e.company, e.hostName, e.reason, e.purpose, e.managerName].join(' '),
        );
        if (text.includes(needle)) return true;
        const ids = [e.phone, e.employeeId, e.cardNumber, e.idNumber, e.dayToken].map(digits).join(' ');
        if (qd && ids.includes(qd)) return true;
        return false;
      })
    : entries;
  const start = cursor ? matched.findIndex((e) => e.id === cursor) + 1 : 0;
  const sliceStart = start < 0 ? 0 : start;
  const page = matched.slice(sliceStart, sliceStart + Math.min(100, Math.max(1, Number(limit) || 100)));
  const next = matched[sliceStart + page.length] ? matched[sliceStart + page.length - 1].id : '';
  return { entries: page, nextCursor: next || '', total: matched.length };
}

export async function dashboard(siteId, day) {
  const site = await getSite(siteId);
  const tz = site?.timezone || timezoneForCountry(site?.countryIso);
  const localDay = day || todayLocalDate(tz);
  const { start, end } = dayBounds(localDay, tz);
  const entries = await listEntries(siteId);
  const today = entries.filter((e) => e.createdAt >= start && e.createdAt < end);
  const inside = entries.filter((e) => e.status === 'inside').length;
  const waiting = entries.filter((e) => e.status === 'waiting_admit' || e.status === 'waiting_approval').length;
  const overdue = entries.filter((e) => e.kind === 'outpass' && e.status === 'out' && e.dueAt && e.dueAt < now()).length;
  const stillOut = entries.filter((e) => e.status === 'out').length;
  const returned = entries.filter((e) => e.status === 'returned' && e.outAt && e.inAt);
  const avgMin = returned.length
    ? Math.round(returned.reduce((s, e) => s + (new Date(e.inAt) - new Date(e.outAt)) / 60000, 0) / returned.length)
    : 0;
  return {
    day: localDay,
    timezone: tz,
    todayTotal: today.length,
    todayVisitors: today.filter((e) => e.kind === 'visitor').length,
    todayOutpass: today.filter((e) => e.kind === 'outpass').length,
    inside,
    waiting,
    overdue,
    stillOut,
    avgMinutes: avgMin,
    exceptions: overdue + entries.filter((e) => e.status === 'unapproved_leave' && e.createdAt >= start && e.createdAt < end).length,
  };
}

export async function exportRows(siteId, { from, to, status, kind, day } = {}) {
  const site = await getSite(siteId);
  const tz = site?.timezone || timezoneForCountry(site?.countryIso);
  let fromIso = from;
  let toIso = to;
  if (day) {
    const bounds = dayBounds(day, tz);
    fromIso = bounds.start;
    toIso = bounds.end;
  }
  return (await listEntries(siteId))
    .filter((e) => {
      if (fromIso && e.createdAt < fromIso) return false;
      if (toIso && e.createdAt >= toIso && day) return false;
      if (toIso && !day && e.createdAt > toIso) return false;
      if (status && e.status !== status) return false;
      if (kind && e.kind !== kind) return false;
      return true;
    })
    .map((e) => {
      const row = { ...e };
      delete row.magicToken;
      delete row.magicTokenHash;
      delete row.magicTokenExpiresAt;
      delete row.magicTokenUsedAt;
      return row;
    });
}

export async function snapshot(siteId) {
  const site = await getSite(siteId);
  if (!site) return null;
  const [people, entries, events, stats] = await Promise.all([
    listPeoplePublic(siteId),
    listLiveEntries(siteId, site.timezone),
    query(
      'SELECT * FROM events WHERE site_id = $1 ORDER BY created_at DESC LIMIT 80',
      [siteId],
    ).then((r) => r.rows.map(camelize)),
    dashboard(siteId),
  ]);
  return {
    site: redactSite(publicSite(site)),
    people,
    entries: entries.map(redactEntry),
    events,
    stats,
  };
}

export async function retentionReport(days) {
  const n = Math.max(1, Number(days) || 90);
  const cutoff = new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await query(
    `SELECT s.id, s.slug,
            (SELECT count(*)::int FROM entries e WHERE e.site_id = s.id AND e.created_at < $1) AS old_entries,
            (SELECT count(*)::int FROM audit_events a WHERE a.site_id = s.id AND a.created_at < $1) AS old_audit
       FROM sites s
       ORDER BY s.created_at ASC`,
    [cutoff],
  );
  return { days: n, cutoff, sites: rows.map((r) => ({ siteId: r.id, slug: r.slug, oldEntries: r.old_entries, oldAudit: r.old_audit })) };
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
    emailDomains: 'example.com',
    pack: 'warehouse',
    lang: 'ar',
    timezone: 'Asia/Riyadh',
    createdAt: now(),
  };
  const demoGatePin = generatePin();
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
    timezone: 'Asia/Riyadh',
    guardPinHash: hashPin(demoGatePin),
    createdAt: now(),
  };
  const demoOwnerPassword = process.env.DEMO_OWNER_PASSWORD || generatePin() + generatePin();
  await withTransaction(async (client) => {
    await insertRow(
      'companies',
      ['id', 'name', 'countryIso', 'emailDomains', 'pack', 'lang', 'timezone', 'createdAt'],
      company,
      client,
    );
    await insertRow(
      'sites',
      ['id', 'companyId', 'slug', 'name', 'pack', 'ownerName', 'ownerEmail', 'lang', 'countryIso', 'timezone', 'guardPinHash', 'createdAt'],
      site,
      client,
    );
    await insertRow(
      'users',
      ['id', 'companyId', 'email', 'role', 'passwordHash', 'createdAt'],
      {
        id: id('u_'),
        companyId: company.id,
        email: site.ownerEmail,
        role: 'owner',
        passwordHash: hashPassword(demoOwnerPassword),
        createdAt: now(),
      },
      client,
    );
  });
  process.stdout.write(`gate-daftar demo owner password: ${demoOwnerPassword}\n`);
  process.stdout.write(`gate-daftar demo booth PIN: ${demoGatePin}\n`);
  const khalid = await addPerson(site.id, { name: 'Khalid Al-Harbi', role: 'manager', phone: '966500111222', email: 'khalid@example.com', employeeId: 'M-01' }, { actor: { role: 'owner', name: 'Fahad' } });
  const noura = await addPerson(site.id, { name: 'Noura Al-Otaibi', role: 'manager', phone: '966500333444', email: 'noura@example.com', employeeId: 'M-02' }, { actor: { role: 'owner', name: 'Fahad' } });
  const yousef = await addPerson(site.id, { name: 'Yousef Hassan', role: 'employee', phone: '966511222333', managerId: khalid.person.id, employeeId: 'E-104' }, { actor: { role: 'owner', name: 'Fahad' } });
  const ahmed = await addPerson(site.id, { name: 'Ahmed Farouk', role: 'employee', phone: '966511444555', managerId: khalid.person.id, employeeId: 'E-118' }, { actor: { role: 'owner', name: 'Fahad' } });
  await addPerson(site.id, { name: 'Sami Al-Dosari', role: 'employee', phone: '966511666777', managerId: noura.person.id, employeeId: 'E-221' }, { actor: { role: 'owner', name: 'Fahad' } });

  await createVisitor({ siteId: site.id, name: 'Ibrahim Delivery', phone: '966555000111', company: 'Aramex', purpose: 'Parcel drop', hostName: 'Receiving', source: 'qr' }, { actor: { role: 'visitor', name: 'Ibrahim Delivery' } });
  await createVisitor({ siteId: site.id, name: 'Contractor Majed', phone: '966555222333', company: 'AC Fix Co', purpose: 'HVAC repair', hostName: 'Maintenance', source: 'guard' }, { actor: { role: 'guard', name: 'Booth' } });
  const admitted = await createVisitor({ siteId: site.id, name: 'Layla Supplier', phone: '966555888999', company: 'Gulf Parts', purpose: 'Parts delivery', hostName: 'Store', source: 'guard' }, { actor: { role: 'guard', name: 'Booth' } });
  if (admitted.entry) await admitVisitor(admitted.entry.id, { actor: { role: 'guard', name: 'Booth' } });
  await createOutPass({ siteId: site.id, personId: yousef.person.id, managerId: khalid.person.id, reason: 'Bank errand', expectedMinutes: 90, source: 'qr' }, { actor: { role: 'employee', name: 'Yousef Hassan' } });
  const approved = await createOutPass({ siteId: site.id, personId: ahmed.person.id, managerId: khalid.person.id, reason: 'Lunch', expectedMinutes: 45, source: 'guard' }, { actor: { role: 'guard', name: 'Booth' } });
  if (approved.entry) await decideOutPass(approved.magicToken, 'approve', '', { actor: { role: 'manager', name: 'Khalid Al-Harbi', hint: 'seed' } });
  return getSite(site.id);
}

export { digits, countryOf };
export { PACKS, coercePack } from './packs.js';
