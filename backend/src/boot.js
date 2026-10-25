import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { query } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function pidPath() {
  return path.join(__dirname, '../data/server.pid');
}

export function writePid(pid = process.pid) {
  fs.mkdirSync(path.dirname(pidPath()), { recursive: true });
  fs.writeFileSync(pidPath(), String(pid));
}

export function isServerRunning() {
  try {
    const raw = fs.readFileSync(pidPath(), 'utf8').trim();
    const pid = Number(raw);
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function backupDir() {
  return process.env.GATE_DAFTAR_BACKUP_DIR || path.join(__dirname, '../backups');
}

export async function importLegacyIfEmpty() {
  if (process.env.NODE_ENV === 'test' && !process.env.GATE_DAFTAR_DATA_FILE) {
    return { imported: false };
  }
  const { rows } = await query('SELECT count(*)::int AS n FROM sites');
  if (rows[0].n > 0) return { imported: false };
  const source =
    process.env.GATE_DAFTAR_DATA_FILE || path.join(__dirname, '../data/db.json');
  if (!fs.existsSync(source)) return { imported: false };
  const script = path.join(__dirname, '../scripts/import-db-json.mjs');
  try {
    execFileSync(process.execPath, [script, source], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { imported: true };
  } catch (err) {
    const detail = String(err.stderr || err.message || 'import_failed').slice(0, 200);
    throw new Error(`Existing gate book could not be imported. The server will not start empty. ${detail}`);
  }
}
