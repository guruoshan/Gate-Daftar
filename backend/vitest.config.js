import { defineConfig } from 'vitest/config';

const TEST_DB =
  process.env.TEST_DATABASE_URL ||
  'postgres://gate:gate@127.0.0.1:5432/gate_daftar_test';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    setupFiles: ['./test/setup.js'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DB,
    },
  },
});
