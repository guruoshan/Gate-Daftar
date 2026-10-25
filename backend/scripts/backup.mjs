#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { databaseUrl } from '../src/db.js';
import { backupDir } from '../src/boot.js';

const prune = process.argv.includes('--prune');

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function listDumps(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('gate-daftar-') && name.endsWith('.dump'))
    .map((name) => {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      return { name, full, mtime: st.mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime);
}

function main() {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  if (prune) {
    const days = Math.max(1, Number(process.env.RETENTION_DAYS || 90));
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const old = listDumps(dir).filter((f) => f.mtime < cutoff);
    if (old.length === 0) {
      console.log(`No backups older than ${days} days.`);
      return;
    }
    console.log(`Backups older than ${days} days (not deleted):`);
    for (const f of old) console.log(f.name);
    return;
  }
  const dest = path.join(dir, `gate-daftar-${stamp()}.dump`);
  execFileSync(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-acl', `--file=${dest}`, databaseUrl()],
    { stdio: 'inherit' },
  );
  console.log(`Backup written: ${path.basename(dest)}`);
}

main();
