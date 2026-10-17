import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

const DEFAULT_URL = 'postgres://gate:gate@127.0.0.1:5432/gate_daftar';

export function databaseUrl() {
  return process.env.DATABASE_URL || DEFAULT_URL;
}

let pool = null;

export function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: databaseUrl(),
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (err) => {
      process.stderr.write(`postgres pool error: ${err.message}\n`);
    });
  }
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function runMigrations() {
  const pool = getPool();
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const applied = new Set(
    (await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
  return files;
}

export async function truncateAll() {
  await query(
    'TRUNCATE companies, sites, users, people, entries, approval_tokens, audit_events, events, sessions, device_sessions RESTART IDENTITY CASCADE',
  );
}

export async function healthCheck() {
  try {
    await query('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Cross-server change feed. In production each server keeps one dedicated
// connection that LISTENs, and publishes its own writes with NOTIFY so the
// other copies pick up the delta.
const CHANNEL = 'gate_delta';
let listenClient = null;
const listeners = new Set();

export async function startListener(onMessage) {
  if (onMessage) listeners.add(onMessage);
  if (listenClient) return listenClient;
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  client.on('notification', (msg) => {
    if (!msg.payload) return;
    let parsed;
    try {
      parsed = JSON.parse(msg.payload);
    } catch {
      return;
    }
    for (const fn of listeners) fn(parsed);
  });
  client.on('error', () => {
    listenClient = null;
  });
  listenClient = client;
  return client;
}

export async function publishDelta(delta) {
  await query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(delta)]);
}

export function stopListener() {
  if (listenClient) {
    listenClient.end().catch(() => {});
    listenClient = null;
  }
  listeners.clear();
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
