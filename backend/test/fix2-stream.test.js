import { beforeEach, describe, expect, it } from 'vitest';
import http from 'http';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, hasSecretKeys, resetAll } from './helpers.js';

beforeEach(() => {
  resetAll();
});

function readSse(server, path, cookie, ms = 400) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        headers: cookie ? { Cookie: cookie } : {},
      },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c.toString();
        });
        setTimeout(() => {
          req.destroy();
          resolve({ status: res.statusCode, body });
        }, ms);
      },
    );
    req.on('error', (err) => {
      if (err.code === 'ECONNRESET') return;
      reject(err);
    });
    req.end();
  });
}

describe('Fix 2: live stream needs a session and sends small safe updates', () => {
  it('rejects the live stream when there is no session', async () => {
    const { site } = await createOwnedSite();
    const res = await request(app).get(`/api/sites/${site.slug}/stream`);
    expect(res.status).toBe(401);
  });

  it('sends a small update without PIN, magic token or manager phone', async () => {
    const { site, cookie } = await createOwnedSite();
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const pending = readSse(server, `/api/sites/${site.slug}/stream`, cookie, 500);
      await new Promise((r) => setTimeout(r, 80));
      await request(app)
        .post(`/api/sites/${site.slug}/visitors`)
        .set('Cookie', cookie)
        .send({ name: 'Ibrahim', phone: '966555000111', company: 'Aramex', purpose: 'Drop', source: 'guard' });
      const { status, body } = await pending;
      expect(status).toBe(200);
      expect(body).toMatch(/event: hello/);
      expect(body).not.toMatch(/event: snapshot/);
      expect(hasSecretKeys(body)).toBe(false);
      expect(body).not.toMatch(/managerPhone/);
      expect(body).toMatch(/event: delta/);
      expect(body).toMatch(/Ibrahim/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
