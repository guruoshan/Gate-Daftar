#!/usr/bin/env node
import { closePool, runMigrations } from '../src/db.js';
import { retentionReport } from '../src/store.js';

await runMigrations();

const days = Number(process.argv[2] || process.env.RETENTION_DAYS || 90);
const report = await retentionReport(days);
console.log(`Retention report for records older than ${report.days} days (cutoff ${report.cutoff}).`);
console.log('Nothing was deleted.');
for (const row of report.sites) {
  console.log(`${row.slug}: ${row.oldEntries} old entries, ${row.oldAudit} old audit rows`);
}
await closePool();
