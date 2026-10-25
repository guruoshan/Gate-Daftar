#!/usr/bin/env node
import { closePool, runMigrations } from '../src/db.js';
import { verifyAudit } from '../src/store.js';

await runMigrations();
const result = await verifyAudit();
if (result.ok) {
  console.log(`Audit chain ok. Checked ${result.count} rows.`);
} else {
  console.error(`Audit chain failed at ${result.at}: ${result.reason}`);
}
await closePool();
process.exit(result.ok ? 0 : 1);
