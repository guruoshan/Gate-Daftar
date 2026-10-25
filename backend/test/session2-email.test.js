import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { lastMail } from '../src/mailer.js';
import { cookieFrom, createOwnedSite, createOutpass, seedRoster, unlockBooth, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('Session 2: company email approval and roster-only out-pass', () => {
  it('refuses a free-typed out-pass and requires a roster person', async () => {
    const { site, cookie } = await createOwnedSite();
    const res = await request(app)
      .post(`/api/sites/${site.slug}/outpass`)
      .set('Cookie', cookie)
      .send({ name: 'Yousef', reason: 'Lunch', managerName: 'Khalid', managerPhone: '966500111222' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('person_required');
  });

  it('refuses a manager on a public email domain', async () => {
    const { site, cookie } = await createOwnedSite();
    const res = await request(app)
      .post(`/api/sites/${site.slug}/people`)
      .set('Cookie', cookie)
      .send({ name: 'Khalid', role: 'manager', email: ['khalid@gma', 'il.com'].join('') });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('email_domain_not_allowed');
  });

  it('emails the manager and never returns the approval link to the requester', async () => {
    const { site, cookie } = await createOwnedSite();
    const made = await createOutpass(cookie, site.slug);
    expect(made.res.status).toBe(200);
    expect(made.entry.pageUrl).toBeUndefined();
    expect(made.entry.waLink).toBeUndefined();
    expect(made.entry.smsBody).toBeUndefined();
    expect(made.entry.emailed).toBe(true);
    expect(lastMail().to).toBe('khalid@example.com');
    expect(lastMail().pageUrl).toMatch(/\/a\//);
    const approve = await request(app).get(`/api/approve/${made.token}`);
    expect(approve.status).toBe(200);
    expect(approve.body.entry.name).toBe('Yousef Hassan');
  });

  it('lets the public gate create an out-pass only from the roster', async () => {
    const { site, cookie } = await createOwnedSite();
    const roster = await seedRoster(cookie, site.slug);
    const pub = await request(app).get(`/api/sites/${site.slug}/public`);
    expect(pub.body.employees.some((p) => p.id === roster.employee.id)).toBe(true);
    expect(JSON.stringify(pub.body)).not.toMatch(/khalid@example.com/);
    const typed = await request(app).post(`/api/sites/${site.slug}/gate/outpass`).send({
      name: 'Yousef Hassan',
      reason: 'Bank',
      managerName: 'Khalid',
    });
    expect(typed.status).toBe(400);
    const ok = await request(app).post(`/api/sites/${site.slug}/gate/outpass`).send({
      personId: roster.employee.id,
      managerId: roster.manager.id,
      reason: 'Bank',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.entry.pageUrl).toBeUndefined();
  });

  it('resends a new approval email from the booth', async () => {
    const { site, cookie } = await createOwnedSite();
    const made = await createOutpass(cookie, site.slug);
    const first = lastMail().token;
    const resend = await request(app).post(`/api/entries/${made.entry.id}/resend`).set('Cookie', cookie);
    expect(resend.status).toBe(200);
    expect(lastMail().token).toBeTruthy();
    expect(lastMail().token).not.toBe(first);
    const old = await request(app).get(`/api/approve/${first}`);
    expect(old.status).toBe(404);
  });

  it('names the guard on the booth session when a personal PIN is used', async () => {
    const { site, cookie } = await createOwnedSite();
    const added = await request(app)
      .post(`/api/sites/${site.slug}/people`)
      .set('Cookie', cookie)
      .send({ name: 'Guard Ali', role: 'guard', phone: '966500000001', employeeId: 'G-01' });
    expect(added.status).toBe(200);
    expect(added.body.pin).toMatch(/^\d{6}$/);
    const unlock = await request(app)
      .post('/api/guard/unlock')
      .send({ slug: site.slug, pin: added.body.pin, personId: added.body.person.id });
    expect(unlock.status).toBe(200);
    expect(unlock.body.guard.name).toBe('Guard Ali');
    const roster = await seedRoster(cookie, site.slug);
    const requested = await request(app)
      .post(`/api/sites/${site.slug}/outpass`)
      .set('Cookie', cookieFrom(unlock))
      .send({ personId: roster.employee.id, managerId: roster.manager.id, reason: 'Lunch' });
    expect(requested.status).toBe(200);
    const audit = await request(app).get(`/api/sites/${site.slug}/audit`).set('Cookie', cookie);
    const row = audit.body.audit.find((a) => a.action === 'outpass_requested');
    expect(row.actorName).toBe('Guard Ali');
    expect(row.actorRole).toBe('booth');
  });

  it('shared booth PIN still unlocks when no named guard is picked', async () => {
    const { site } = await createOwnedSite();
    const booth = await unlockBooth(site.slug, site.guardPin);
    expect(booth.res.status).toBe(200);
  });
});
