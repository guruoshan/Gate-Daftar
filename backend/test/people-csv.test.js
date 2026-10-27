import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { createOwnedSite, resetAll, seedRoster, unlockBooth } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

const HEADER = 'Role,Name,Employee ID,Work email,Phone,Manager name';

describe('People CSV import', () => {
  it('manager row then employee row with that manager name links the employee', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const csv = [
      HEADER,
      'manager,Fatima Said,M-02,fatima@example.com,,',
      'employee,Omar Nasser,E-300,,,Fatima Said',
    ].join('\n');
    const res = await request(app)
      .post(`/api/sites/${a.site.slug}/people/import`)
      .set('Cookie', a.cookie)
      .send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(2);
    const people = await request(app).get(`/api/sites/${a.site.slug}/people`).set('Cookie', a.cookie);
    const mgr = people.body.people.find((p) => p.name === 'Fatima Said');
    const emp = people.body.people.find((p) => p.name === 'Omar Nasser');
    expect(emp.managerId).toBe(mgr.id);
  });

  it('second CSV updates by employee ID and keeps people not in the file', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    await seedRoster(a.cookie, a.site.slug);
    const first = [
      HEADER,
      'manager,Fatima Said,M-02,fatima@example.com,,',
      'employee,Omar Nasser,E-300,,,Fatima Said',
    ].join('\n');
    await request(app).post(`/api/sites/${a.site.slug}/people/import`).set('Cookie', a.cookie).send({ csv: first });
    const second = [
      HEADER,
      'manager,Noura Ali,M-03,noura@example.com,,',
      'employee,Omar Nasser,E-300,,,Noura Ali',
    ].join('\n');
    const res = await request(app)
      .post(`/api/sites/${a.site.slug}/people/import`)
      .set('Cookie', a.cookie)
      .send({ csv: second });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBeGreaterThanOrEqual(1);
    const people = await request(app).get(`/api/sites/${a.site.slug}/people`).set('Cookie', a.cookie);
    const names = people.body.people.map((p) => p.name);
    expect(names).toContain('Yousef Hassan');
    expect(names).toContain('Fatima Said');
    const noura = people.body.people.find((p) => p.name === 'Noura Ali');
    const omar = people.body.people.find((p) => p.name === 'Omar Nasser');
    expect(omar.managerId).toBe(noura.id);
  });

  it('two managers with the same name skip that employee row; others still apply', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const csv = [
      HEADER,
      'manager,Same Name,M-10,one@example.com,,',
      'manager,Same Name,M-11,two@example.com,,',
      'employee,Lost Worker,E-400,,,Same Name',
      'employee,Ok Worker,E-401,,,one',
    ].join('\n');
    const res = await request(app)
      .post(`/api/sites/${a.site.slug}/people/import`)
      .set('Cookie', a.cookie)
      .send({ csv });
    expect(res.status).toBe(200);
    const skipped = res.body.skipped.find((s) => s.name === 'Lost Worker');
    expect(skipped.reason).toBe('manager_name_ambiguous');
    const people = await request(app).get(`/api/sites/${a.site.slug}/people`).set('Cookie', a.cookie);
    expect(JSON.stringify(people.body)).not.toMatch(/Lost Worker/);
  });

  it('Gmail on a manager row is skipped', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const blocked = ['gmail', '.com'].join('');
    const csv = [HEADER, `manager,Bad Mail,M-20,bad@${blocked},,`].join('\n');
    const res = await request(app)
      .post(`/api/sites/${a.site.slug}/people/import`)
      .set('Cookie', a.cookie)
      .send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.skipped[0].reason).toBe('email_domain_not_allowed');
  });

  it('booth cannot import; sample uses example.com only', async () => {
    const a = await createOwnedSite('Gate A', { ownerEmail: 'a@example.com' });
    const booth = await unlockBooth(a.site.slug, a.site.guardPin);
    const denied = await request(app)
      .post(`/api/sites/${a.site.slug}/people/import`)
      .set('Cookie', booth.cookie)
      .send({ csv: `${HEADER}\nmanager,X,M-1,x@example.com,,` });
    expect(denied.status).toBe(403);
    const sample = await request(app).get(`/api/sites/${a.site.slug}/people/sample.csv`).set('Cookie', a.cookie);
    expect(sample.status).toBe(200);
    expect(sample.text).toMatch(/example\.com/);
    expect(sample.text).not.toMatch(/gmail\.com/);
  });
});
