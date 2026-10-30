import request from 'supertest';
import { app } from '../src/index.js';
import { resetSessions } from '../src/sessions.js';
import { resetStore } from '../src/store.js';
import { resetRateLimits } from '../src/rateLimit.js';
import { resetPinState } from '../src/pins.js';
import { lastMail, resetMail } from '../src/mailer.js';

export async function resetAll() {
  ownerSeq = 0;
  await resetStore();
  await resetSessions();
  resetRateLimits();
  resetPinState();
  resetMail();
}

export function cookieFrom(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return '';
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((c) => String(c).split(';')[0]).join('; ');
}

let ownerSeq = 0;

export async function signupCompany(overrides = {}) {
  ownerSeq += 1;
  const email = overrides.ownerEmail || overrides.email || `owner${ownerSeq}@example.com`;
  const res = await request(app).post('/api/owner/signup').send({
    companyName: overrides.companyName || overrides.name || 'Test Co',
    ownerName: overrides.ownerName || 'Test Owner',
    ownerEmail: email,
    password: overrides.password || 'password1',
    lang: overrides.lang || 'en',
    pack: overrides.pack || 'warehouse',
    countryIso: overrides.countryIso || 'SA',
    timezone: overrides.timezone,
  });
  return {
    res,
    company: res.body.company,
    site: null,
    cookie: cookieFrom(res),
    email,
    password: overrides.password || 'password1',
  };
}

export async function addNamedGuard(cookie, slug, name = 'Guard Ali') {
  const res = await request(app)
    .post(`/api/sites/${slug}/people`)
    .set('Cookie', cookie)
    .send({ name, role: 'guard', employeeId: 'G-01' });
  return { res, person: res.body.person, pin: res.body.pin };
}

export async function createOwnedSite(name = 'Test Gate', extra = {}) {
  const signed = await signupCompany({
    companyName: extra.companyName || name,
    ownerEmail: extra.ownerEmail || extra.email,
    password: extra.password,
    ...extra,
  });
  let site = null;
  let guardPin = '';
  if (signed.cookie && signed.company?.id) {
    const added = await request(app)
      .post(`/api/companies/${signed.company.id}/sites`)
      .set('Cookie', signed.cookie)
      .send({ name });
    site = added.body.site ? { ...added.body.site, guardPin: added.body.pin || '' } : null;
    guardPin = added.body.pin || '';
  }
  return {
    res: signed.res,
    company: signed.company,
    site: site ? { ...site, guardPin } : site,
    cookie: signed.cookie,
    email: signed.email,
    password: signed.password,
  };
}

export async function unlockBooth(slug, pin) {
  const res = await request(app).post('/api/guard/unlock').send({ slug, pin });
  return { res, site: res.body.site, cookie: cookieFrom(res) };
}

export function hasSecretKeys(value) {
  const text = JSON.stringify(value);
  return /magicToken|guardPin|approveUrl|denyUrl|waLink|smsBody|ownerEmail|ownerName|managerEmail/.test(text);
}

export async function seedRoster(cookie, slug) {
  const manager = await request(app)
    .post(`/api/sites/${slug}/people`)
    .set('Cookie', cookie)
    .send({
      name: 'Khalid Al-Harbi',
      role: 'manager',
      email: 'khalid@example.com',
      phone: '966500111222',
      employeeId: 'M-01',
    });
  const employee = await request(app)
    .post(`/api/sites/${slug}/people`)
    .set('Cookie', cookie)
    .send({
      name: 'Yousef Hassan',
      role: 'employee',
      phone: '966511222333',
      employeeId: 'E-104',
      managerId: manager.body.person.id,
    });
  return { manager: manager.body.person, employee: employee.body.person };
}

export async function createOutpass(cookie, slug, extra = {}) {
  const roster = extra.roster || (await seedRoster(cookie, slug));
  const res = await request(app)
    .post(`/api/sites/${slug}/outpass`)
    .set('Cookie', cookie)
    .send({
      personId: extra.personId || roster.employee.id,
      managerId: extra.managerId || roster.manager.id,
      reason: extra.reason || 'Lunch',
      expectedMinutes: extra.expectedMinutes || 45,
    });
  return {
    res,
    roster,
    entry: res.body.entry,
    token: lastMail()?.token || '',
  };
}
