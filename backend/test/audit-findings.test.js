// Release-readiness audit: each test states the behaviour a safe release SHOULD have.
// A FAILING test here means the problem is confirmed in the current code (red step of TDD).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { app, assertStartupConfig } from '../src/index.js';
import { sendApprovalEmail } from '../src/mailer.js';
import { resetAll, createOwnedSite, unlockBooth, cookieFrom } from './helpers.js';

const FREE = ['gm', 'ail.com'].join('');
const here = path.dirname(fileURLToPath(import.meta.url));

beforeEach(async () => {
  await resetAll();
});

describe('AUDIT: email delivery', () => {
  it('actually opens a connection to the mail server when SMTP_URL is set', async () => {
    let connections = 0;
    const server = net.createServer((sock) => {
      connections += 1;
      sock.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const old = process.env.SMTP_URL;
    process.env.SMTP_URL = `smtp://127.0.0.1:${port}`;
    try {
      sendApprovalEmail({
        to: 'manager@company.com',
        pageUrl: 'https://x/a/tok',
        token: 'tok',
        entry: { id: 'e_1' },
        siteName: 'x',
        lang: 'en',
      });
      await new Promise((r) => setTimeout(r, 800));
    } finally {
      if (old === undefined) delete process.env.SMTP_URL;
      else process.env.SMTP_URL = old;
      server.close();
    }
    expect(connections).toBeGreaterThan(0);
  });
});

describe('AUDIT: brute-force protection', () => {
  it('locks the booth PIN even when the attacker changes the X-Forwarded-For header', async () => {
    const { site } = await createOwnedSite();
    const statuses = [];
    for (let i = 0; i < 40; i += 1) {
      const res = await request(app)
        .post('/api/guard/unlock')
        .set('X-Forwarded-For', `10.9.8.${i}`)
        .send({ slug: site.slug, pin: '000000' });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });

  it('burns the owner login code after a few wrong guesses (even with spoofed IPs)', async () => {
    await createOwnedSite();
    const req = await request(app).post('/api/owner/request-code').send({ email: 'owner@example.com' });
    const realCode = req.body.devCode;
    for (let i = 0; i < 30; i += 1) {
      await request(app)
        .post('/api/owner/verify')
        .set('X-Forwarded-For', `10.7.7.${i}`)
        .send({ email: 'owner@example.com', code: String(100000 + i) });
    }
    const final = await request(app).post('/api/owner/verify').send({ email: 'owner@example.com', code: realCode });
    expect(final.status).not.toBe(200);
  });
});

describe('AUDIT: who can do what', () => {
  it('a shared booth login cannot create new guard logins or managers', async () => {
    const { site } = await createOwnedSite();
    const pin = (await request(app).post(`/api/sites/${site.slug}/pin/reset`).set('Cookie', '')).status; // unauth control
    expect(pin).toBe(401);
    const owner = await createOwnedSite('Second');
    const reset = await request(app).post(`/api/sites/${owner.site.slug}/pin/reset`).set('Cookie', owner.cookie);
    const booth = await unlockBooth(owner.site.slug, reset.body.pin);
    const res = await request(app)
      .post(`/api/sites/${owner.site.slug}/people`)
      .set('Cookie', booth.cookie)
      .send({ name: 'Fake Guard', role: 'guard' });
    expect(res.status).toBe(403);
  });

  it('public gate page does not reveal employee ID numbers to strangers', async () => {
    const { site, cookie } = await createOwnedSite();
    await request(app)
      .post(`/api/sites/${site.slug}/people`)
      .set('Cookie', cookie)
      .send({ name: 'Yousef Hassan', role: 'employee', employeeId: 'E-104' });
    const res = await request(app).get(`/api/sites/${site.slug}/public`);
    expect(JSON.stringify(res.body)).not.toContain('E-104');
  });
});

describe('AUDIT: owner set-up and login', () => {
  it('an owner with a Gmail address can still add a manager', async () => {
    const res = await request(app).post('/api/sites').send({
      name: 'Gmail Shop',
      ownerName: 'Owner',
      ownerEmail: 'shopowner@' + FREE,
      lang: 'en',
    });
    const add = await request(app)
      .post(`/api/sites/${res.body.site.slug}/people`)
      .set('Cookie', cookieFrom(res))
      .send({ name: 'Boss', role: 'manager', email: 'boss@' + FREE });
    expect(add.status).toBe(200);
  });

  it('an owner who runs two gates can sign in to the second one', async () => {
    await request(app).post('/api/sites').send({ name: 'Gate One', ownerEmail: 'two@acme.com' });
    const second = await request(app).post('/api/sites').send({ name: 'Gate Two', ownerEmail: 'two@acme.com' });
    const code = (await request(app).post('/api/owner/request-code').send({ email: 'two@acme.com' })).body.devCode;
    const login = await request(app).post('/api/owner/verify').send({ email: 'two@acme.com', code, slug: second.body.site.slug });
    const snap = await request(app)
      .get(`/api/sites/${second.body.site.slug}/snapshot`)
      .set('Cookie', cookieFrom(login));
    expect(snap.status).toBe(200);
  });
});

describe('AUDIT: deployment config', () => {
  it('the docker-compose settings are enough for the server to start', () => {
    const yml = fs.readFileSync(path.join(here, '../../docker-compose.yml'), 'utf8');
    const block = yml.split(/\n {2}api:\n/)[1].split(/\n {2}web:\n/)[0];
    const env = Object.fromEntries(
      [...block.matchAll(/^ {6}([A-Z_]+):\s*(.*)$/gm)].map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]),
    );
    expect(() => assertStartupConfig(env)).not.toThrow();
  });
});

describe('AUDIT: stability', () => {
  const procs = [];
  afterAll(() => procs.forEach((p) => p.kill()));

  it('one strange public request cannot take the whole server down', async () => {
    const port = 4555;
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: path.join(here, '..'),
      env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
      stdio: 'ignore',
    });
    procs.push(child);
    let up = false;
    for (let i = 0; i < 40 && !up; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      up = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.ok).catch(() => false);
    }
    expect(up).toBe(true);
    await fetch(`http://127.0.0.1:${port}/api/sites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bad\u0000name' }),
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    const alive = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.ok).catch(() => false);
    expect(alive).toBe(true);
  }, 30000);
});
