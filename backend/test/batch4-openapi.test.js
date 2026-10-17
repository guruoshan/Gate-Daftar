import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { api } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function toSpecPath(p) {
  return p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function expressRoutes(router) {
  const out = new Set();
  const stack = router.stack || [];
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      out.add(`${method.toUpperCase()} ${toSpecPath(layer.route.path)}`);
    }
  }
  return out;
}

function specRoutes(spec) {
  const out = new Set();
  for (const [routePath, methods] of Object.entries(spec.paths)) {
    for (const method of Object.keys(methods)) {
      out.add(`${method.toUpperCase()} ${routePath}`);
    }
  }
  return out;
}

describe('Batch 4: the OpenAPI file matches the real routes', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '../openapi.json'), 'utf8'));

  it('documents every real route and nothing extra', () => {
    const real = [...expressRoutes(api)].sort();
    const documented = [...specRoutes(spec)].sort();
    expect(real.filter((r) => !documented.includes(r))).toEqual([]);
    expect(documented.filter((d) => !real.includes(d))).toEqual([]);
  });

  it('ships the spec over /api/v1', async () => {
    const request = (await import('supertest')).default;
    const { app } = await import('../src/index.js');
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(0);
  });
});
