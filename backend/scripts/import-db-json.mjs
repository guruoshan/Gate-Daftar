#!/usr/bin/env node
// One time import of the old backend/data/db.json file into PostgreSQL.
//
//   node scripts/import-db-json.mjs [path-to-db.json] [--force]
//
// The audit chain is rebuilt with the canonical hashing used by the app, and
// any raw magic tokens are replaced by their hash. Nothing is printed except a
// summary count, so no personal data lands in the terminal.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashPin } from '../src/pins.js';
import { hashToken } from '../src/tokens.js';
import { coercePack } from '../src/packs.js';
import { auditBase, hashAudit } from '../src/audit.js';
import { query, withTransaction, runMigrations, closePool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const force = args.includes('--force');
const fileArg = args.find((a) => !a.startsWith('--'));
const source =
  fileArg || process.env.GATE_DAFTAR_DATA_FILE || path.join(__dirname, '../data/db.json');

const camelToSnake = (key) => key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

function ts(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function insert(client, table, obj, keys = Object.keys(obj)) {
  const cols = keys.map(camelToSnake);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  await client.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT DO NOTHING`,
    keys.map((k) => obj[k]),
  );
}

async function main() {
  if (!fs.existsSync(source)) {
    console.error(`No file at ${source}`);
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
  const companies = parsed.companies || [];
  const sites = parsed.sites || [];
  const people = parsed.people || [];
  const entries = parsed.entries || [];
  const events = parsed.events || [];
  const audit = parsed.audit || [];

  await runMigrations();
  const existing = await query('SELECT count(*)::int AS n FROM sites');
  if (existing.rows[0].n > 0 && !force) {
    console.error('The database already has sites. Re-run with --force to add anyway.');
    process.exit(2);
  }

  // Legacy rows sometimes lost their companyId. Derive it from the site so the
  // foreign keys hold, and skip rows that cannot be attributed to any site.
  const siteCompany = new Map();
  const fallbackCompany = companies[0]?.id || null;
  for (const s of sites) siteCompany.set(s.id, s.companyId || fallbackCompany);
  const companyOf = (row) => {
    if (row.companyId && companies.some((c) => c.id === row.companyId)) return row.companyId;
    return siteCompany.get(row.siteId) || fallbackCompany;
  };

  await withTransaction(async (client) => {
    for (const c of companies) {
      await insert(client, 'companies', {
        id: c.id,
        name: c.name || 'Company',
        countryIso: c.countryIso || 'SA',
        createdAt: ts(c.createdAt) || new Date().toISOString(),
      });
    }
    for (const s of sites) {
      let companyId = s.companyId;
      if (!companyId) {
        companyId = `co_${s.id}`;
        await insert(client, 'companies', {
          id: companyId,
          name: s.name || 'Company',
          countryIso: s.countryIso || 'SA',
          createdAt: ts(s.createdAt) || new Date().toISOString(),
        });
      }
      await insert(client, 'sites', {
        id: s.id,
        companyId,
        slug: s.slug,
        name: s.name || 'Gate',
        pack: coercePack(s.pack),
        ownerName: s.ownerName || '',
        ownerEmail: s.ownerEmail || '',
        lang: s.lang === 'en' ? 'en' : 'ar',
        countryIso: s.countryIso || 'SA',
        guardPinHash: s.guardPinHash || (s.guardPin ? hashPin(s.guardPin) : ''),
        createdAt: ts(s.createdAt) || new Date().toISOString(),
        updatedAt: ts(s.updatedAt),
      });
      if (s.ownerEmail) {
        await insert(client, 'users', {
          id: `u_${s.id}`,
          companyId,
          email: s.ownerEmail,
          role: 'owner',
          createdAt: ts(s.createdAt) || new Date().toISOString(),
        });
      }
    }
    for (const p of people) {
      const companyId = companyOf(p);
      if (!companyId || !siteCompany.has(p.siteId)) continue;
      await insert(client, 'people', {
        id: p.id,
        siteId: p.siteId,
        companyId,
        name: p.name || '',
        role: p.role === 'manager' ? 'manager' : 'employee',
        phone: p.phone || '',
        managerPhone: p.managerPhone || '',
        employeeId: p.employeeId || '',
        active: p.active !== false,
        createdAt: ts(p.createdAt) || new Date().toISOString(),
      });
    }
    for (const e of entries) {
      const companyId = companyOf(e);
      if (!companyId || !siteCompany.has(e.siteId)) continue;
      const tokenHash = e.magicTokenHash || (e.magicToken ? hashToken(e.magicToken) : '');
      await insert(client, 'entries', {
        id: e.id,
        siteId: e.siteId,
        companyId,
        kind: e.kind,
        status: e.status,
        name: e.name || '',
        phone: e.phone || '',
        company: e.company || '',
        purpose: e.purpose || '',
        hostName: e.hostName || '',
        idNumber: e.idNumber || '',
        cardNumber: e.cardNumber || '',
        employeeId: e.employeeId || '',
        personId: e.personId || '',
        reason: e.reason || '',
        expectedMinutes: Number(e.expectedMinutes) || 0,
        managerName: e.managerName || '',
        managerPhone: e.managerPhone || '',
        source: e.source === 'qr' ? 'qr' : 'guard',
        dayToken: e.dayToken || '',
        magicTokenHash: tokenHash,
        magicTokenExpiresAt: ts(e.magicTokenExpiresAt),
        magicTokenUsedAt: ts(e.magicTokenUsedAt),
        denyReason: e.denyReason || '',
        unapprovedReason: e.unapprovedReason || '',
        createdAt: ts(e.createdAt) || new Date().toISOString(),
        updatedAt: ts(e.updatedAt),
        admittedAt: ts(e.admittedAt),
        exitedAt: ts(e.exitedAt),
        requestedAt: ts(e.requestedAt),
        decidedAt: ts(e.decidedAt),
        outAt: ts(e.outAt),
        inAt: ts(e.inAt),
        dueAt: ts(e.dueAt),
      });
      if (tokenHash && !e.magicTokenUsedAt) {
        await insert(client, 'approval_tokens', {
          id: `tok_${e.id}`,
          entryId: e.id,
          tokenHash,
          expiresAt: ts(e.magicTokenExpiresAt) || new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
          usedAt: null,
          createdAt: ts(e.createdAt) || new Date().toISOString(),
        });
      }
    }
    for (const ev of events) {
      await insert(client, 'events', {
        id: ev.id,
        siteId: ev.siteId,
        kind: ev.kind,
        message: ev.message || '',
        extra: ev.extra ? JSON.stringify(ev.extra) : null,
        createdAt: ts(ev.at || ev.createdAt) || new Date().toISOString(),
      });
    }
    // Rebuild the audit chain with the canonical hash so verifyAudit passes.
    let prev = 'genesis';
    for (const a of audit) {
      const base = auditBase({
        id: a.id,
        at: ts(a.at || a.createdAt) || new Date().toISOString(),
        siteId: a.siteId,
        companyId: a.companyId,
        action: a.action,
        actorRole: a.actorRole,
        actorName: a.actorName,
        actorHint: a.actorHint,
        entryId: a.entryId,
        reason: a.reason,
        ip: a.ip,
        device: a.device,
        prev,
      });
      const hash = hashAudit(base);
      await insert(client, 'audit_events', {
        id: base.id,
        siteId: base.siteId || null,
        companyId: base.companyId || null,
        action: base.action,
        actorRole: base.actorRole,
        actorName: base.actorName,
        actorHint: base.actorHint,
        entryId: base.entryId,
        reason: base.reason,
        ip: base.ip,
        device: base.device,
        prevHash: base.prev,
        hash,
        createdAt: base.at,
      });
      prev = hash;
    }
  });

  const counts = await query(
    `SELECT
       (SELECT count(*)::int FROM companies) AS companies,
       (SELECT count(*)::int FROM sites) AS sites,
       (SELECT count(*)::int FROM people) AS people,
       (SELECT count(*)::int FROM entries) AS entries,
       (SELECT count(*)::int FROM audit_events) AS audit`,
  );
  console.log('Import complete:', counts.rows[0]);
  await closePool();
}

main().catch(async (err) => {
  console.error('Import failed:', err.message);
  await closePool().catch(() => {});
  process.exit(1);
});
