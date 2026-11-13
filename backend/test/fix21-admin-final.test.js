import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, createOutpass, unlockBooth, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

async function managerApproved() {
  const { site, cookie } = await createOwnedSite();
  const made = await createOutpass(cookie, site.slug);
  const decision = await request(app).post(`/api/approve/${made.token}`).send({ decision: 'approve' });
  const booth = await unlockBooth(site.slug, site.guardPin);
  return { site, cookie, made, decision, booth };
}

describe('Fix 21: manager approval moves the pass to the admin', () => {
  it('manager approval makes the pass wait for the admin, not leave', async () => {
    const { decision } = await managerApproved();
    expect(decision.status).toBe(200);
    expect(decision.body.entry.status).toBe('waiting_admin');
  });

  it('the guard cannot let the employee out while the admin has not approved', async () => {
    const { made, booth } = await managerApproved();
    const out = await request(app).post(`/api/entries/${made.entry.id}/out`).set('Cookie', booth.cookie);
    expect(out.status).toBe(409);
  });

  it('Admin approval lets the employee leave and records who approved and when', async () => {
    const { site, cookie, made, booth } = await managerApproved();
        const res = await request(app)
      .post(`/api/entries/${made.entry.id}/final`)
      .set('Cookie', cookie)
      .send({ decision: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('approved_out');
    expect(res.body.entry.adminName).toBe('Test Owner');
    expect(res.body.entry.adminDecidedAt).toBeTruthy();
    const out = await request(app).post(`/api/entries/${made.entry.id}/out`).set('Cookie', booth.cookie);
    expect(out.status).toBe(200);
    expect(out.body.entry.status).toBe('out');
    expect(site.slug).toBeTruthy();
  });

  it('Admin can deny, and the pass cannot leave', async () => {
    const { cookie, made, booth } = await managerApproved();
    const res = await request(app)
      .post(`/api/entries/${made.entry.id}/final`)
      .set('Cookie', cookie)
      .send({ decision: 'deny', reason: 'Not today' });
    expect(res.body.entry.status).toBe('denied');
    expect(res.body.entry.denyReason).toBe('Not today');
    const out = await request(app).post(`/api/entries/${made.entry.id}/out`).set('Cookie', booth.cookie);
    expect(out.status).toBe(409);
  });

  it('Admin cannot approve before the manager has decided', async () => {
    const { site, cookie } = await createOwnedSite();
      const made = await createOutpass(cookie, site.slug);
    const res = await request(app)
      .post(`/api/entries/${made.entry.id}/final`)
      .set('Cookie', cookie)
      .send({ decision: 'approve' });
    expect(res.status).toBe(409);
  });

  it('the guard login cannot give the final decision', async () => {
    const { made, booth } = await managerApproved();
    const res = await request(app)
      .post(`/api/entries/${made.entry.id}/final`)
      .set('Cookie', booth.cookie)
      .send({ decision: 'approve' });
    expect(res.status).toBe(403);
  });
});

describe('Fix 21: manager link works once', () => {
  it('the link stops working after the manager acts', async () => {
    const { made } = await managerApproved();
    const again = await request(app).get(`/api/approve/${made.token}`);
    expect(again.status).toBe(410);
    const flip = await request(app).post(`/api/approve/${made.token}`).send({ decision: 'deny' });
    expect([409, 410]).toContain(flip.status);
  });
});

describe('Fix 21: manager reached by WhatsApp only', () => {
  it('a manager with only a WhatsApp number can be added and gets a share link', async () => {
    const { site, cookie } = await createOwnedSite();
    const manager = await request(app)
      .post(`/api/sites/${site.slug}/people`)
      .set('Cookie', cookie)
      .send({ name: 'Omar Manager', role: 'manager', phone: '966500999888' });
    expect(manager.status).toBe(200);
    const employee = await request(app)
      .post(`/api/sites/${site.slug}/people`)
      .set('Cookie', cookie)
      .send({ name: 'Sara Staff', role: 'employee', employeeId: 'E-9', managerId: manager.body.person.id });
    const res = await request(app)
      .post(`/api/sites/${site.slug}/gate/outpass`)
      .send({ personId: employee.body.person.id, reason: 'Bank', expectedMinutes: 60 });
    expect(res.status).toBe(201);
    expect(res.body.share.whatsappUrl).toMatch(/^https:\/\/wa\.me\/966500999888\?text=/);
    expect(decodeURIComponent(res.body.share.whatsappUrl)).toMatch(/\/a\//);
  });

  it('a manager with neither email nor WhatsApp is refused', async () => {
    const { site, cookie } = await createOwnedSite();
    const res = await request(app)
      .post(`/api/sites/${site.slug}/people`)
      .set('Cookie', cookie)
      .send({ name: 'No Contact', role: 'manager' });
    expect(res.status).toBe(400);
  });

  it('a manager may use any email address, not only the company one', async () => {
    const { site, cookie } = await createOwnedSite();
    const res = await request(app)
      .post(`/api/sites/${site.slug}/people`)
      .set('Cookie', cookie)
      .send({ name: 'Free Mail', role: 'manager', email: 'manager@' + ['gm', 'ail.com'].join('') });
    expect(res.status).toBe(200);
  });
});
