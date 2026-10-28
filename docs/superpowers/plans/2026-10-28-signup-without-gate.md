# Sign up without a gate, then forgot-password — implementation plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign up is company and admin only. It does not ask for a gate name and does not create a gate. The owner lands on Your gates, adds the first gate there, then adds people on that gate. Owner can reset a forgotten password with a one-time email link.

**Architecture:** Keep PostgreSQL, Express, Vite/React. New table `password_reset_requests` (not an entry). Reuse `hashToken` / `newMagicToken` / `tokenExpiry` (12 hours, one use). Company walls stay `session.companyId === site.companyId`. Site type (`pack`) moves onto the company so the first gate can inherit it.

**Tech stack:** Node ESM, `pg`, existing PIN/password hash, existing mailer stdout + inbox. Vitest + supertest. AR/EN in `frontend/src/i18n.js`.

**Spec:** `docs/superpowers/specs/2026-10-28-signup-without-gate-design.md`

---

## File map

Create:

- `backend/migrations/007_signup_without_gate.sql` — company pack + password reset table
- `backend/test/signup-without-gate.test.js` — signup, empty home, first gate inherits, walls
- `backend/test/password-reset.test.js` — forgot + reset proofs
- `frontend/src/pages/ResetPassword.jsx` — new password + confirm

Edit:

- `backend/src/db.js` — `truncateAll` includes `password_reset_requests`
- `backend/src/store.js` — `createCompany` no site; company pack; reset token helpers; `addSite` inherits pack
- `backend/src/mailer.js` — `sendPasswordResetEmail`
- `backend/src/index.js` — signup without gateName; forgot/reset routes
- `backend/openapi.json` — signup wording; forgot/reset paths
- `backend/test/helpers.js` — signup has no gate; `createOwnedSite` adds a gate after signup
- `backend/test/fix12-ratelimit.test.js` — `/api/sites` no longer needs a gate name
- `frontend/src/api.js` — forgot, resetGet, resetPost; signup body without gateName
- `frontend/src/App.jsx` — `/reset/:token`
- `frontend/src/pages/Setup.jsx` — drop gate name field
- `frontend/src/pages/CompanyHome.jsx` — empty-state line when there are no gates
- `frontend/src/pages/Login.jsx` — Forgot password
- `frontend/src/i18n.js` — AR+EN keys

Do not edit `.env`. Do not add npm packages. Do not print real emails or PINs. Commit only if the user asks.

Keep test helper `createOwnedSite` working for the rest of the suite: signup, then add a gate, then add a named guard. Do not rewrite every existing test.

---

### Task 1: Migration

**Files:**
- Create: `backend/migrations/007_signup_without_gate.sql`
- Modify: `backend/src/db.js`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pack text NOT NULL DEFAULT 'warehouse';
UPDATE companies c
SET pack = COALESCE(
  (SELECT s.pack FROM sites s WHERE s.company_id = c.id ORDER BY s.created_at ASC LIMIT 1),
  'warehouse'
);

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  magic_token_hash text NOT NULL DEFAULT '',
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_token_hash_key
  ON password_reset_requests (magic_token_hash) WHERE magic_token_hash <> '';
```

Do not put resets in `entries`. They must not appear on the live book.

- [ ] **Step 2: Truncate**

In `truncateAll`, add `password_reset_requests` to the `TRUNCATE` list.

- [ ] **Step 3: Apply against local test DB**

Run: `cd /workspace/backend && npm test -- test/health.test.js`

Expect pass (vitest setup runs migrations). If it fails on SQL, fix the file before Task 2.

---

### Task 2: Store — company without a gate; pack; reset tokens

**Files:**
- Modify: `backend/src/store.js`

- [ ] **Step 1: Company pack on create**

`createCompany` stores `pack: coercePack(pack)` on the company row. Insert columns include `pack`. Do not insert a `sites` row. Do not write `site_created` audit (no site yet). Return `{ company, site: null, user }`.

Still require company name + owner email + password at the route layer. Store still returns `email_taken` when the email exists.

`publicCompany` includes `pack` (and keep `id`, `name`, `countryIso`).

- [ ] **Step 2: addSite inherits pack**

`addSite` sets `pack: coercePack(pack || company.pack || first?.pack)`. Country and timezone stay as today (company / first gate / body). Empty name still errors at the route.

- [ ] **Step 3: Password reset helpers**

Reuse `newMagicToken`, `hashToken`, `tokenExpiry`, `isMagicTokenExpired` (or `isExpired` from `tokens.js`).

`requestPasswordReset(email)`:

- Look up user by email. If missing, return `{ ok: true }` with no token (caller still replies the same).
- Insert a row on `password_reset_requests`. Return `{ ok: true, magicToken, user, company }` only when a user exists (token is for mailer, never put in the HTTP JSON).

`getPasswordResetByToken(raw)` — by hash.

`completePasswordReset(raw, password)`:

- Missing token: `{ error: 'not_found' }`
- Expired and unused: `{ error: 'token_expired' }`
- Already used: `{ error: 'token_expired' }` or `{ error: 'not_found' }` (pick one and use it in tests; prefer `token_expired` for used/expired, `not_found` for unknown)
- Password shorter than 8: `{ error: 'password_short' }`
- Else: hash password onto `users.password_hash`, set `used_at`, return `{ ok: true }`

Never return the raw token from these helpers except `requestPasswordReset` to the mailer path.

- [ ] **Step 4: Seed unchanged**

`seedDemoIfEmpty` still creates the demo company **and** the demo gate. Do not make the demo gate-less.

---

### Task 3: Mailer and routes

**Files:**
- Modify: `backend/src/mailer.js`
- Modify: `backend/src/index.js`
- Modify: `backend/openapi.json`

- [ ] **Step 1: Reset mail**

Same pattern as `sendPersonAddEmail`. Kind `password_reset`. Line: `gate-daftar password-reset mail for ${to}: ${pageUrl}`. Record has `to`, `pageUrl`, `token` (inbox only, for tests), `lang`.

Page URL uses `PUBLIC_ORIGIN` + `/reset/${token}` (same origin helper as approval; do not trust request Host).

- [ ] **Step 2: Sign up route**

`signupOwner`: require `companyName`, `ownerEmail`, password length >= 8. Do **not** require `gateName`. Call `createCompany` with company fields only. Cookie still set. JSON: `{ company, sites: [] }` (no `site`, or `site: null`). Same handler for `POST /owner/signup` and `POST /sites`.

- [ ] **Step 3: Forgot / reset routes**

Use the existing owner rate limiter (or the login limiter) on forgot.

`POST /owner/forgot` body `{ email }`:

- Always 200 `{ ok: true }` with the same message shape. No `token` field.
- If a user exists, send reset mail. Catch `mail_not_configured` the same way as out-pass (503 only in production when SMTP is missing; tests are not production).

`GET /owner/reset/:token`:

- 404 unknown, 410 expired/used, 200 `{ ok: true }` (no email, no user id).

`POST /owner/reset/:token` body `{ password, confirm }`:

- If `password !== confirm`: 400 `{ error: 'password_mismatch' }`
- Else `completePasswordReset`. Map errors to 404/410/400. Success 200 `{ ok: true }`. Do not set a session cookie; they log in next.

- [ ] **Step 4: OpenAPI**

Change `/sites` and `/owner/signup` summaries to “Sign up a company (no gate)”. Add `/owner/forgot`, `/owner/reset/{token}` GET+POST.

---

### Task 4: Tests and helpers

**Files:**
- Modify: `backend/test/helpers.js`
- Modify: `backend/test/fix12-ratelimit.test.js`
- Create: `backend/test/signup-without-gate.test.js`
- Create: `backend/test/password-reset.test.js`

- [ ] **Step 1: Helpers**

`signupCompany`: stop sending `gateName`. Expect `res.body.site` absent and `res.body.sites` empty.

`createOwnedSite`: after signup, `POST /api/companies/${company.id}/sites` with `{ name }`, then `addNamedGuard` on that slug. Keep the same return shape `{ company, site, cookie, email, password }` so existing tests keep working.

- [ ] **Step 2: Rate-limit helper**

`makeSite` in `fix12-ratelimit.test.js` can omit gate name. Still expect 200 (company created).

- [ ] **Step 3: Signup proofs** (`signup-without-gate.test.js`)

Cover spec items 1–4 and 8:

1. Signup with company + owner only: 200, company present, no site, `GET /owner/me` shows `sites: []`.
2. Used email → `email_taken`. Password under 8 → `password_short`.
3. After login, add gate → me lists one site. Snapshot of that slug is 200.
4. Signup with `pack: 'workshop'`, `countryIso: 'AE'`, `timezone: 'Asia/Dubai'`. First `addSite` with only `{ name: 'Yard' }` inherits those (pack workshop, country AE, timezone Dubai).
8. Company A cookie still 403 on Company B snapshot (one line is enough; walls suite still runs).

- [ ] **Step 4: Reset proofs** (`password-reset.test.js`)

Cover spec items 5–7:

5. Known email: 200 `{ ok: true }`, no token in body; `lastMail().token` set; DB/store has only a hash. Unknown email: 200 same body, no new mail (or mail count unchanged).
6. GET+POST reset works once; second POST is 410/404. Expired: freeze time or pass a past expiry in a store-level test.
7. Password under 8 refused. After success, login with old password is 401; login with new password is 200.

Use `example.com` only. Never assert a real inbox address.

- [ ] **Step 5: Run the new files**

`cd /workspace/backend && npm test -- test/signup-without-gate.test.js test/password-reset.test.js`

Expect pass. If a helper change breaks `createOwnedSite`, fix helpers before touching other suites.

---

### Task 5: Frontend

**Files:**
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/pages/Setup.jsx`
- Modify: `frontend/src/pages/CompanyHome.jsx`
- Modify: `frontend/src/pages/Login.jsx`
- Create: `frontend/src/pages/ResetPassword.jsx`
- Modify: `frontend/src/i18n.js`

- [ ] **Step 1: API**

`signup` body: `companyName`, `ownerName`, `ownerEmail`, `password`, `lang`, `pack`, `countryIso`, `timezone`. No `gateName`.

Add `forgot({ email })`, `resetGet(token)`, `resetPost(token, { password, confirm })`.

- [ ] **Step 2: Sign up screen**

Remove the gate name label + input. Keep company name, site type, country, time zone, your name, owner email, password. Still `nav('/home')` on success.

- [ ] **Step 3: Your gates empty state**

When `sites.length === 0`, show `t.homeEmpty` (add a gate first, then people). Keep the Add a gate form. Keep `t.homeHint` if already present.

- [ ] **Step 4: Login + reset page**

Login: link `t.forgotPassword` toggling an email field + submit `api.forgot`. Always show `t.resetSent` (do not say whether the email exists).

`ResetPassword.jsx`: on load `resetGet`. Expired → `t.linkExpired`. Else two password fields + submit. Mismatch → `t.passwordMismatch`. Short → `t.passwordShort`. Success → message + link to `/login`.

`App.jsx`: `<Route path="/reset/:token" element={<ResetPassword t={t} />} />`.

- [ ] **Step 5: i18n AR+EN**

Add both languages: `homeEmpty`, `forgotPassword`, `resetSent`, `resetTitle`, `newPassword`, `confirmPassword`, `passwordMismatch`, `savePassword`. Reuse `passwordShort`, `linkExpired`, `ownerEmail`. No em-dash. No comments unless the file already has them.

- [ ] **Step 6: Frontend build**

`cd /workspace/frontend && npx vite build`

Expect success.

---

### Task 6: Spec status and sanity

- [ ] Spec already `approved`. Do not start a real factory. Do not commit `.env`.
- [ ] Run `cd /workspace/backend && npm test` and `cd /workspace/frontend && npx vite build` once more.
- [ ] Commit only if the user asks.

---

## Self-review

| Spec item | Plan task |
|---|---|
| Sign up company + admin only, no gate | Tasks 2–3, 5 |
| Your gates empty until Add a gate | Tasks 3, 5 |
| First gate inherits pack/country/timezone | Task 2 step 2, Task 4 item 4 |
| Forgot-password same reply | Task 3 step 3, Task 4 item 5 |
| Hashed 12h one-use token | Tasks 1–2 |
| Reset then login with new password | Task 4 item 7 |
| Company walls | Task 4 item 8 |
| AR+EN, no em-dash | Task 5 step 5 |
| No extra deps / no SMTP product | Mailer stdout + inbox |

Placeholder scan: no TBD. Reset is not an entry. Signup does not insert a site.

---

## Execution notes

- Smallest change. No extra npm packages.
- Never print real PIN/email/phone/token from `backend/data/db.json`.
- Stop after two failed checks on the same task.
- Commit only if the user asks.
