# Company walls — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each company signs up with work email + password, lands on a company home of their gates, and cannot see another company. People are company-wide. Visits stay on the gate used. Gate man unlocks with PIN only.

**Architecture:** Keep PostgreSQL, Express, Vite/React. Add `password_hash` on `users`. Change the lock from `session.siteId === site.id` to `session.companyId === site.companyId`. List people by `company_id`. Replace email-code owner login with password. Split public signup (`POST /sites`) into signup + authenticated add-gate.

**Tech stack:** Node ESM, `pg`, existing `hashPin`/`verifyPin` in `backend/src/pins.js` (reuse for passwords — no new deps), Vitest + supertest, React pages, AR/EN in `frontend/src/i18n.js`.

**Spec:** `docs/superpowers/specs/2026-10-25-company-walls-design.md`

---

## File map

Create:

- `backend/migrations/005_company_walls.sql` — password hash, unique email, people by company
- `backend/test/company-walls.test.js` — the ten proof checks from the spec
- `frontend/src/pages/CompanyHome.jsx` — gate list after login

Edit:

- `backend/src/pins.js` — optional `hashPassword`/`verifyPassword` aliases (or reuse pin helpers as-is)
- `backend/src/store.js` — signup, add-gate, list company sites/people, company-wide out-pass/guard lookup
- `backend/src/sessions.js` — company lock; drop auth-code helpers
- `backend/src/index.js` — signup/login/logout/me/add-gate; retire request-code/verify; PIN unlock company-wide
- `backend/src/mailer.js` — drop `sendLoginCode` if unused
- `backend/test/helpers.js` — signup helper with password; two-company helper
- `backend/test/sessions.test.js` — password login instead of email code
- `backend/openapi.json` — new owner routes; drop code routes
- `frontend/src/api.js` — signup, login, logout, me, addGate
- `frontend/src/App.jsx` — `/home` route
- `frontend/src/pages/Landing.jsx` — signup + login links
- `frontend/src/pages/Login.jsx` — email + password
- `frontend/src/pages/Setup.jsx` — create-site form becomes signup; logged-in add-gate; no shared site PIN reset as unlock
- `frontend/src/pages/Booth.jsx` — PIN only (no shared site PIN path in UI copy)
- `frontend/src/i18n.js` — AR+EN for signup, password, company home, logout, errors

Do not edit `.env`. Do not print real passwords or PINs in tests beyond one-time create/reset responses.

---

### Task 1: Migration

**Files:**
- Create: `backend/migrations/005_company_walls.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text NOT NULL DEFAULT '';
DROP INDEX IF EXISTS users_email_company_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
CREATE INDEX IF NOT EXISTS people_company_idx ON people (company_id, created_at DESC);
```

Keep `people.site_id` (who added them / first gate). Do not drop `sites.guard_pin_hash` yet (unlock will stop using it; column can stay unused).

- [ ] **Step 2: Apply against local test DB**

Run: `cd /workspace/backend && node --input-type=module -e 'import { runMigrations, closePool } from "./src/db.js"; console.log(await runMigrations()); await closePool();'`

Expect `005_company_walls.sql` in the printed list. If test DB is empty, `TEST_DATABASE_URL` / vitest setup already runs migrations in tests — still keep the file.

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/005_company_walls.sql
git commit -m "feat(db): password hash and unique owner email for company walls"
```

Only commit if the user asked. Otherwise stop after the file exists.

---

### Task 2: Password helpers and company lock

**Files:**
- Modify: `backend/src/pins.js`
- Modify: `backend/src/sessions.js`

- [ ] **Step 1: Reuse hash/verify for passwords**

In `pins.js`, export aliases (no new algorithm):

```js
export const hashPassword = hashPin;
export const verifyPassword = verifyPin;
```

Keep PIN length 6. Password check is “string in, hash compare” — minimum length is enforced in the signup route, not here.

- [ ] **Step 2: Change `requireSiteAccess`**

In `backend/src/sessions.js` `requireSiteAccess`, replace:

```js
const match = present.find((s) => s.siteId === site.id && roles.includes(s.role));
```

with:

```js
const match = present.find((s) => s.companyId === site.companyId && roles.includes(s.role));
```

Keep 401 `auth_required` and 403 `forbidden`.

- [ ] **Step 3: Add `requireCompanyAccess`**

Same file:

```js
export async function requireCompanyAccess(req, res, companyId, roles = ['owner']) {
  const { owner, booth } = await readSessions(req);
  const present = [owner, booth].filter(Boolean);
  if (present.length === 0) {
    res.status(401).json({ error: 'auth_required' });
    return null;
  }
  const match = present.find((s) => s.companyId === companyId && roles.includes(s.role));
  if (!match) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return match;
}
```

- [ ] **Step 4: Drop in-memory auth codes**

Remove `authCodes`, `createAuthCode`, `consumeAuthCode` from `sessions.js`. Clear `authCodes` line from `resetSessions`.

- [ ] **Step 5: Run existing session tests (expect some to fail until Task 5)**

Do not rewrite tests yet. Confirm `requireSiteAccess` still 401s without cookie.

---

### Task 3: Store — signup, add gate, company people

**Files:**
- Modify: `backend/src/store.js`

- [ ] **Step 1: `getUserByEmail(email)`**

Query `users` by `lower(email)`. Return camelized row or null.

- [ ] **Step 2: Change `createSite` into company signup**

Keep the function name used by tests for now, but:

- Require `ownerEmail` and `password` (caller hashes or this function hashes).
- If `getUserByEmail` hits, return `{ error: 'email_taken' }`.
- Insert company, first site, user with `passwordHash`.
- First site `name` is the gate name (spec: company name + first gate name). Accept both `companyName` and `name` (gate). If only `name` is sent (old tests), use it for both company and first gate so existing `createOwnedSite` keeps working until helpers are updated.
- Do not require returning a shared site PIN for unlock. Returning `pin: ''` or omitting `guardPin` is fine. Tests that assert `guardPin` must be updated in Task 5.

Preferred signature:

```js
export async function createCompany({
  companyName, gateName, ownerName, ownerEmail, password, lang, pack, countryIso, emailDomains, timezone,
})
```

Have `createSite` call `createCompany` with `companyName = name`, `gateName = name` for one release so old callers compile.

- [ ] **Step 3: `addSite(companyId, { name, pack, lang, countryIso, timezone }, meta)`**

Insert another row in `sites` with the same `companyId`, owner email/name copied from the company owner user or first site. No new company. No new user. Return `{ site }`.

- [ ] **Step 4: `listSitesByCompany(companyId)`**

`SELECT * FROM sites WHERE company_id = $1 ORDER BY created_at ASC`.

- [ ] **Step 5: People by company**

Change `listPeople` to take `companyId` (or add `listPeopleByCompany` and switch callers):

```sql
SELECT * FROM people WHERE company_id = $1 AND active IS NOT FALSE ORDER BY created_at ASC
```

Update `listPeoplePublic`, `listGateRoster`, `listGuards`, `emitPeople`, `snapshot` so a gate’s roster is the company roster.

- [ ] **Step 6: Out-pass and guard lookup use company, not site**

In `createOutPass`, replace `person.siteId !== input.siteId` with `person.companyId !== site.companyId` (same for manager). Worker/manager must belong to that company.

In `findGuardByPin`, load guards with `company_id = site.companyId`.

In `resetGuardPersonPin`, allow reset if `person.companyId === site.companyId` (not `person.siteId === siteId`).

- [ ] **Step 7: Seed demo owner password**

In `seedDemoIfEmpty`, after inserting the demo site, insert owner user:

- email `fahad@example.com`
- `passwordHash` from `hashPassword` of a generated password (or `DEMO_OWNER_PASSWORD` if set — do not read Agent LLM keys)
- Print once: `gate-daftar demo owner password:` the same way as the booth PIN line
- Also add the owner user row (today seed never inserts `users` — fix that)

Do not print after seed. Tests must not assert the live printed secret; they sign up a fresh company.

---

### Task 4: HTTP routes

**Files:**
- Modify: `backend/src/index.js`
- Modify: `backend/src/mailer.js` (remove `sendLoginCode` if nothing else uses it)
- Modify: `backend/openapi.json`

- [ ] **Step 1: Signup**

Change `POST /sites` (keep path so OpenAPI alias stays; also accept `POST /owner/signup` as the named route, both calling the same handler):

Body: `companyName`, `gateName` (or `name`), `ownerName`, `ownerEmail`, `password`, `lang`, `pack`, `countryIso`, `timezone`.

Rules:

- Password length `< 8` → 400 `password_short`
- Missing company/gate/email → 400
- `email_taken` → 409
- Hash password, `createCompany`, `createSession` with `companyId` and `siteId` of first gate, `setOwnerCookie`, return `{ company: { id, name }, site: publicSite(site), sites: [publicSite(site)] }`
- Do not put password or hash in the JSON
- Do not put `guardPin` on the site object (PIN is per gate man, shown once on add-person)

- [ ] **Step 2: Login / logout / me**

`POST /owner/login` `{ email, password }`:

- Unknown email or bad password → 401 `{ error: 'bad_login' }` (same body either way)
- Success → owner cookie, `{ company, sites }`

`POST /owner/logout`: clear owner cookie (`Max-Age=0`). Do not clear booth cookie.

`GET /owner/me`: 401 if no owner session; else `{ company, sites }` via `listSitesByCompany`.

- [ ] **Step 3: Add gate**

`POST /companies/:companyId/sites` owner-only via `requireCompanyAccess`:

- Body `{ name, pack, lang, countryIso, timezone }`
- `addSite`, return `{ site: publicSite(site) }`

- [ ] **Step 4: Retire email code**

Delete `POST /owner/request-code` and `POST /owner/verify`. Remove `createAuthCode` / `sendLoginCode` imports.

- [ ] **Step 5: Unlock**

In `POST /guard/unlock`:

- Stop accepting shared `site.guardPinHash` as success
- Resolve guard with `findGuardByPin(site.id, pin)` which now searches the company
- If no named guard matches → 401 `bad_pin`
- Session `companyId: site.companyId`, `siteId: site.id` (URL gate), `personId` of the guard
- PIN lock key stays `pinKey(site.id, ip)` (per booth computer)

- [ ] **Step 6: Guards list**

`GET /sites/:siteId/guards` may stay public for the PIN pad names (ids + names only, already redacted). Roster is company-wide so Gate B shows the same gate-man names.

- [ ] **Step 7: OpenAPI**

Replace `/owner/request-code` and `/owner/verify` with `/owner/signup`, `/owner/login`, `/owner/logout`, `/owner/me`, `/companies/{companyId}/sites`. Keep `/sites` POST as signup alias.

---

### Task 5: Tests

**Files:**
- Create: `backend/test/company-walls.test.js`
- Modify: `backend/test/helpers.js`
- Modify: `backend/test/sessions.test.js`
- Modify: any test that posts `/api/sites` without password or expects email codes / `guardPin` on create

- [ ] **Step 1: Helper**

```js
export async function signupCompany(overrides = {}) {
  const res = await request(app).post('/api/owner/signup').send({
    companyName: 'Test Co',
    gateName: 'Main Gate',
    ownerName: 'Test Owner',
    ownerEmail: overrides.email || 'owner@example.com',
    password: overrides.password || 'password1',
    lang: 'en',
    pack: 'warehouse',
    countryIso: 'SA',
    ...overrides,
  });
  return { res, company: res.body.company, site: res.body.site, cookie: cookieFrom(res) };
}
```

Keep `createOwnedSite` as a wrapper around `signupCompany` so old tests compile.

Add `signupSecondCompany()` with a different email.

- [ ] **Step 2: Rewrite `sessions.test.js`**

Drop request-code / verify tests. Cover:

- Login with password sets cookie and `/owner/me` lists sites
- Wrong password → 401 `bad_login`, no cookie
- Unknown email → 401 `bad_login`, body looks the same (no `devCode`)
- Logout then snapshot → 401

- [ ] **Step 3: `company-walls.test.js` (spec section 10)**

Two companies, two gates on A.

1. A’s cookie on B’s snapshot/stream/search/dashboard/audit/export/people → 403
2. A’s cookie on A gate 1 and A gate 2 snapshot → 200
3. Guard PIN of A unlocks A1 and A2, not B
4. Approval token of A cannot decide B’s pass (`decideOutPass` / POST approve → not found or forbidden, never B’s names)
5. No cookie + guessed slug snapshot → 401
6. Second signup same email → 409 `email_taken`
7. Wrong password → 401, `/owner/me` without cookie → 401
8. Worker added on A1 can `POST` out-pass on A2
9. Visitor created on A1 is absent from A2 live snapshot `entries`, present on A1
10. B’s snapshot body stringified contains none of A’s person names

Also: `/sites/:id/guards` does not include emails or PIN hashes.

- [ ] **Step 4: Run tests**

Run: `cd /workspace/backend && npm test`

Expect all passing, including previous 102 plus new file. If a test fails twice on the same assertion, stop and report.

Fix `fix19-company.test.js` / `seed.test.js` / `fix8-pin-secret.test.js` if they assumed shared site PIN on create or email codes.

---

### Task 6: Frontend

**Files:**
- Create: `frontend/src/pages/CompanyHome.jsx`
- Modify: `frontend/src/api.js`, `App.jsx`, `Landing.jsx`, `Login.jsx`, `Setup.jsx`, `Booth.jsx`, `i18n.js`

- [ ] **Step 1: API client**

Replace `requestCode` / `verifyCode` with:

```js
signup: (body) => req('/api/v1/owner/signup', { method: 'POST', body: JSON.stringify(body) }),
login: (body) => req('/api/v1/owner/login', { method: 'POST', body: JSON.stringify(body) }),
logout: () => req('/api/v1/owner/logout', { method: 'POST', body: '{}' }),
me: () => req('/api/v1/owner/me'),
addGate: (companyId, body) =>
  req(`/api/v1/companies/${companyId}/sites`, { method: 'POST', body: JSON.stringify(body) }),
```

Keep `createSite` pointing at signup for one release or delete and switch Setup.

- [ ] **Step 2: Login page**

Email + password fields. Submit `api.login`. On success `nav('/home')`. Errors: `t.badLogin`. No code field. No `devCode`.

- [ ] **Step 3: Signup**

Landing “create site” goes to `/setup` which posts signup (company name, first gate name, owner name, email, password). On success `nav('/home')`. Duplicate email: `t.emailTaken`. Short password: `t.passwordShort`.

Logged-in `/setup/:siteId` stays the people/PIN/QR screen for one gate.

- [ ] **Step 4: Company home**

Route `/home`. Load `api.me()`. List gates with links to `/booth/:slug`, `/setup/:slug`, `/reports/:slug`. Form to add a gate (`api.addGate`). Log out button → `api.logout()` → `/login`.

If `me` is 401, `nav('/login')`.

- [ ] **Step 5: i18n**

Add AR+EN keys: `password`, `signUp`, `logOut`, `companyHome`, `addGate`, `gateName`, `companyName`, `badLogin`, `emailTaken`, `passwordShort`. No em-dash placeholders. No comments in the file unless already present.

- [ ] **Step 6: Booth copy**

Remove “shared site PIN” hints (`sharedPin`) from booth/setup if unlock no longer uses it. Gate man PIN shown once on add remains.

- [ ] **Step 7: Frontend build**

Run: `cd /workspace/frontend && npx vite build`

Expect success.

---

### Task 7: Spec status and sanity

- [ ] Mark spec status `approved` in `docs/superpowers/specs/2026-10-25-company-walls-design.md`
- [ ] Run backend tests and frontend build once more
- [ ] Do not start a real factory. Do not commit `.env`

---

## Self-review

| Spec item | Plan task |
|---|---|
| Email + password signup/login | Tasks 3–4, 6 |
| Company home then a gate | Task 6 CompanyHome |
| People company-wide | Task 3 listPeople / createOutPass |
| Visits stay on a gate | Task 5 check 9 (entries still `site_id`) |
| Gate man PIN, no email | Task 4 unlock |
| Closed door other company | Task 2 lock + Task 5 checks 1, 4, 5, 10 |
| No forgot-password / offline | Out of scope, not scheduled |
| Demo owner password printed once | Task 3 seed |
| Email code removed | Task 4 step 4, Task 5 sessions.test |

Placeholder scan: no TBD. Password min length 8 is explicit. Shared site PIN retired for unlock; column left in place.

---

## Execution notes

- Smallest change. No extra npm packages.
- Never print real PIN/email/phone/token from `backend/data/db.json`.
- Stop after two failed checks on the same task.
- Commit only if the user asks.
