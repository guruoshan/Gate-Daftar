import { beforeAll, afterAll } from 'vitest';
import { runMigrations, closePool } from '../src/db.js';

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await closePool();
});
