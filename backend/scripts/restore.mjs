#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { databaseUrl } from '../src/db.js';
import { backupDir, isServerRunning } from '../src/boot.js';

function latestDump() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return '';
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('gate-daftar-') && name.endsWith('.dump'))
    .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? path.join(dir, files[0].name) : '';
}

function main() {
  if (isServerRunning()) {
    console.error('The server is running. Stop it before restoring a backup.');
    process.exit(3);
  }
  const fileArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const file = fileArg ? path.resolve(fileArg) : latestDump();
  if (!file || !fs.existsSync(file)) {
    console.error('No backup file found.');
    process.exit(1);
  }
  execFileSync(
    'pg_restore',
    ['--clean', '--if-exists', '--no-owner', '--no-acl', `--dbname=${databaseUrl()}`, file],
    { stdio: 'inherit' },
  );
  console.log(`Restore complete: ${path.basename(file)}`);
}

main();
