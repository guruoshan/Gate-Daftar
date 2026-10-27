import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, resetAll, seedRoster } from './helpers.js';
import { lastMail } from '../src/mailer.js';

beforeEach(async () => {
  await resetAll();
});

describe('Person add request', () => {
  it('booth add request emails the manager and does not put the person on the list yet', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const roster = await seedRoster(a.cookie, a.site.slug);
    const res = await request(app)
      .post(`/api/sites/${a.site.slug}/people/request-add`)
      .set('Cookie', a.cookie)
      .send({ name: 'New Worker', employeeId: 'E-200', managerId: roster.manager.id });
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('waiting');
    expect(JSON.stringify(res.body)).not.toMatch(/magicToken|pageUrl/);
    expect(lastMail()?.to).toBe('khalid@example.com');
    expect(lastMail()?.kind).toBe('person_add');
    const people = await request(app).get(`/api/sites/${a.site.slug}/people`).set('Cookie', a.cookie);
    expect(JSON.stringify(people.body)).not.toMatch(/New Worker/);
  });

  it('after Approve the person is on the company list at every gate', async () => {
    const a = await createOwnedSite('Main Gate', { ownerEmail: 'a@example.com' });
    const roster = await seedRoster(a.cookie, a.site.slug);
    const added = await request(app)
      .post(`/api/companies/${a.company.id}/sites`)
      .set('Cookie', a.cookie)
      .send({ name: 'Yard Gate' });
    await request(app)
      .post(`/api/sites/${a.site.slug}/people/request-add`)
      .set('Cookie', a.cookie)
      .send({ name: 'New Worker', employeeId: 'E-200', managerId: roster.manager.id });
    const token = lastMail()?.token;
    const decide = await request(app).post(`/api/approve/${token}`).send({ decision: 'approve' });
    expect(decide.status).toBe(200);
    expect(decide.body.kind).toBe('person_add');
    expect(decide.body.request.status).toBe('approved');
    const first = await request(app).get(`/api/sites/${a.site.slug}/people`).set('Cookie', a.cookie);
    const second = await request(app).get(`/api/sites/${added.body.site.slug}/people`).set('Cookie', a.cookie);
    expect(JSON.stringify(first.body)).toMatch(/New Worker/);
    expect(JSON.stringify(second.body)).toMatch(/New Worker/);
    const person = first.body.people.find((p) => p.name === 'New Worker');
    expect(person.managerId).toBe(roster.manager.id);
  });

  it('Deny leaves them off the list', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const roster = await seedRoster(a.cookie, a.site.slug);
    await request(app)
      .post(`/api/sites/${a.site.slug}/people/request-add`)
      .set('Cookie', a.cookie)
      .send({ name: 'New Worker', managerId: roster.manager.id });
    const token = lastMail()?.token;
    const decide = await request(app).post(`/api/approve/${token}`).send({ decision: 'deny', denyReason: 'no' });
    expect(decide.status).toBe(200);
    expect(decide.body.request.status).toBe('denied');
    const people = await request(app).get(`/api/sites/${a.site.slug}/people`).set('Cookie', a.cookie);
    expect(JSON.stringify(people.body)).not.toMatch(/New Worker/);
  });

  it('public QR can create the same add request', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const roster = await seedRoster(a.cookie, a.site.slug);
    const res = await request(app)
      .post(`/api/sites/${a.site.slug}/gate/request-add`)
      .send({ name: 'Qr Worker', managerId: roster.manager.id });
    expect(res.status).toBe(200);
    const token = lastMail()?.token;
    await request(app).post(`/api/approve/${token}`).send({ decision: 'approve' });
    const people = await request(app).get(`/api/sites/${a.site.slug}/people`).set('Cookie', a.cookie);
    expect(JSON.stringify(people.body)).toMatch(/Qr Worker/);
  });

  it('add-request token of A cannot approve company B', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const b = await createOwnedSite('Gate B', { ownerEmail: 'b@example.com' });
    const rosterA = await seedRoster(a.cookie, a.site.slug);
    const rosterB = await seedRoster(b.cookie, b.site.slug);
    await request(app)
      .post(`/api/sites/${a.site.slug}/people/request-add`)
      .set('Cookie', a.cookie)
      .send({ name: 'Secret A', managerId: rosterA.manager.id });
    const tokenA = lastMail()?.token;
    await request(app)
      .post(`/api/sites/${b.site.slug}/people/request-add`)
      .set('Cookie', b.cookie)
      .send({ name: 'Worker B', managerId: rosterB.manager.id });
    const tokenB = lastMail()?.token;
    const steal = await request(app).get(`/api/approve/${tokenB}`);
    expect(JSON.stringify(steal.body)).not.toMatch(/Secret A/);
    const decide = await request(app).post(`/api/approve/${tokenA}`).send({ decision: 'approve' });
    expect(decide.status).toBe(200);
    const peopleB = await request(app).get(`/api/sites/${b.site.slug}/people`).set('Cookie', b.cookie);
    expect(JSON.stringify(peopleB.body)).not.toMatch(/Secret A/);
  });

  it('empty name and missing manager are refused; existing employee ID is already on list', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const roster = await seedRoster(a.cookie, a.site.slug);
    const empty = await request(app)
      .post(`/api/sites/${a.site.slug}/people/request-add`)
      .set('Cookie', a.cookie)
      .send({ name: '  ', managerId: roster.manager.id });
    expect(empty.status).toBe(400);
    const noMgr = await request(app)
      .post(`/api/sites/${a.site.slug}/people/request-add`)
      .set('Cookie', a.cookie)
      .send({ name: 'Someone' });
    expect(noMgr.status).toBe(400);
    const dup = await request(app)
      .post(`/api/sites/${a.site.slug}/people/request-add`)
      .set('Cookie', a.cookie)
      .send({ name: 'Yousef Hassan', employeeId: 'E-104', managerId: roster.manager.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('already_on_list');
  });
});
