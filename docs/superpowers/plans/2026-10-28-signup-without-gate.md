# Sign up without a gate, Admin/Gate home, per-gate PIN, forgot-password — implementation plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign up is company and admin only. Public home is two doors: Admin (email + password) and Gate (that door’s PIN). Adding a gate shows a 6-digit PIN once. Owner can reset a forgotten password with a one-time email link.

**Architecture:** Keep PostgreSQL, Express, Vite/React. New table `password_reset_requests` (not an entry). Reuse `hashToken` / `newMagicToken` / `tokenExpiry` (12 hours, one use). Company walls stay `session.companyId === site.companyId`. Site type (`pack`) on the company. Gate PIN is `sites.guard_pin_hash` again (one PIN per gate). Named-guard unlock is removed.

**Tech stack:** Node ESM, `pg`, existing PIN/password hash, existing mailer stdout + inbox. Vitest + supertest. AR/EN in `frontend/src/i18n.js`.

**Spec:** `docs/superpowers/specs/2026-10-28-signup-without-gate-design.md`

---

## File map

Create:

- `backend/migrations/007_signup_without_gate.sql` — company pack + password reset table
- `backend/test/signup-without-gate.test.js` — signup, empty home, first gate inherits, walls
- `backend/test/gate-pin.test.js` — add-gate PIN once, unlock by PIN, second gate, reset
- `backend/test/password-reset.test.js` — forgot + reset proofs
- `frontend/src/pages/ResetPassword.jsx` — new password + confirm
- `frontend/src/pages/GateUnlock.jsx` — home Gate tab PIN pad (no slug, no guard dropdown)

Edit:

- `backend/src/db.js` — `truncateAll` includes `password_reset_requests`
- `backend/src/store.js` — `createCompany` no site; company pack; `addSite` issues PIN; `findSiteByPin`; reset helpers; seed uses gate PIN
- `backend/src/mailer.js` — `sendPasswordResetEmail`
- `backend/src/index.js` — signup without gateName; addSite returns PIN once; unlock by PIN; forgot/reset routes
- `backend/openapi.json` — wording + new paths
- `backend/test/helpers.js` — signup has no gate; `createOwnedSite` adds a gate and keeps `site.guardPin`
- `backend/test/fix7-pin.test.js` — unlock without slug; PIN is on the site hash
- `backend/test/fix8-pin-secret.test.js` — PIN comes from add-gate, not named guard
- `backend/test/fix12-ratelimit.test.js` — `/api/sites` no gate name
- `backend/test/session2-email.test.js` — drop personal-PIN-by-personId case or point it at the gate PIN
- `frontend/src/api.js` — signup without gateName; addGate; forgot; reset; unlock `{ pin }`
- `frontend/src/App.jsx` — `/reset/:token`; `/gate` unlock
- `frontend/src/pages/Landing.jsx` — Admin / Gate
- `frontend/src/pages/Setup.jsx` — drop gate name on signup; drop Guard role (or leave unused)
- `frontend/src/pages/CompanyHome.jsx` — empty state; show PIN once after add; reset PIN
- `frontend/src/pages/Login.jsx` — Forgot password
- `frontend/src/pages/Booth.jsx` — PIN pad without guard dropdown; unlock `{ pin }` (slug still in URL when opened from admin)
- `frontend/src/i18n.js` — AR+EN keys

Do not edit `.env`. Do not add npm packages. Do not print real emails or PINs. Commit only if the user asks.

Keep `createOwnedSite` working for the rest of the suite: signup, then add a gate (PIN on `site.guardPin`), no named guard required for unlock. Do not rewrite every existing test unless it asserts named-guard unlock.

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

Do not put resets in `entries`.

- [ ] **Step 2: Truncate**

In `truncateAll`, add `password_reset_requests`.

- [ ] **Step 3: Apply against local test DB**

Run: `cd /workspace/backend && npm test -- test/health.test.js`

Expect pass. If it fails on SQL, fix the file before Task 2.

---

### Task 2: Store — company without a gate; pack; per-gate PIN; reset tokens

**Files:**
- Modify: `backend/src/store.js`

- [ ] **Step 1: Company pack on create**

`createCompany` stores `pack: coercePack(pack)` on the company. Insert columns include `pack`. Do not insert a `sites` row. Do not write `site_created` audit. Return `{ company, site: null, user }`.

`publicCompany` includes `pack` (keep `id`, `name`, `countryIso`).

- [ ] **Step 2: addSite issues a PIN**

`addSite` inherits `pack` / country / timezone from the company (and first gate if any). Generate a 6-digit PIN with `generatePin()`. Hash with `hashPin`. Store on `guard_pin_hash`. If a hash collision with another site (vanishingly rare), generate again. Return `{ site, pin }`. Audit `site_created`.

`resetGuardPin` already writes `sites.guard_pin_hash`. Keep it as the owner reset. Do not reset a named person’s `pin_hash` for unlock.

- [ ] **Step 3: findSiteByPin**

New helper: load sites that have `guard_pin_hash <> ''`, `verifyPin` against each, return the matching site or null. Used by unlock when slug is omitted. If slug is present, verify that site’s hash only (faster, same lock key as today).

- [ ] **Step 4: Password reset helpers**

Reuse `newMagicToken`, `hashToken`, `tokenExpiry`, `isExpired`.

`requestPasswordReset(email)`: missing user → `{ ok: true }` no token. Else insert row, return `{ ok: true, magicToken, user }` (token for mailer only).

`getPasswordResetByToken(raw)` — by hash.

`completePasswordReset(raw, password)`:

- unknown: `{ error: 'not_found' }`
- expired or already used: `{ error: 'token_expired' }`
- password shorter than 8: `{ error: 'password_short' }`
- else hash onto `users.password_hash`, set `used_at`, `{ ok: true }`

- [ ] **Step 5: Seed**

`seedDemoIfEmpty` still creates the demo company **and** demo gate. Set `guard_pin_hash` on that gate. Print `gate-daftar demo booth PIN:` once from that gate PIN. Still add demo people (managers/employees). Guard Ali as a **person** is optional; unlock must not need them.

---

### Task 3: Mailer and routes

**Files:**
- Modify: `backend/src/mailer.js`
- Modify: `backend/src/index.js`
- Modify: `backend/openapi.json`

- [ ] **Step 1: Reset mail**

Same pattern as `sendPersonAddEmail`. Kind `password_reset`. Line: `gate-daftar password-reset mail for ${to}: ${pageUrl}`. Page URL = `PUBLIC_ORIGIN` + `/reset/${token}`.

- [ ] **Step 2: Sign up**

`signupOwner`: require `companyName`, `ownerEmail`, password >= 8. Do **not** require `gateName`. JSON: `{ company, sites: [] }`. Same handler for `POST /owner/signup` and `POST /sites`. Cookie set.

- [ ] **Step 3: Add gate returns PIN once**

`POST /companies/:companyId/sites` already owner-only. Return `{ site: publicSite(site), pin }`. `publicSite` must not include `guardPin` or hash.

- [ ] **Step 4: Unlock**

`POST /guard/unlock` body `{ pin, slug? }`:

- If `slug` present: today’s lock key (site + IP); verify that site’s `guard_pin_hash`.
- If `slug` absent: require `pin`; `findSiteByPin`; lock key by IP (and site id once found). No match → `bad_pin`.
- On match: booth session as today (`siteId`, `companyId`, name can be the site name). No `personId` required.
- `GET /sites/:id/guards` may stay for now but the Gate tab and booth pad must not require picking a guard.

`POST /sites/:id/pin/reset` stays owner-only and uses `resetGuardPin` (site hash). Stop picking `guards[0]` / `resetGuardPersonPin` for this route.

- [ ] **Step 5: Forgot / reset routes**

`POST /owner/forgot` `{ email }`: always 200 `{ ok: true }`. No `token` field. Send mail only if user exists.

`GET /owner/reset/:token`: 404 unknown, 410 expired/used, 200 `{ ok: true }`.

`POST /owner/reset/:token` `{ password, confirm }`: mismatch → 400 `password_mismatch`. Else `completePasswordReset`. Success 200 `{ ok: true }`. Do not set a session cookie.

- [ ] **Step 6: OpenAPI**

Signup summaries: “Sign up a company (no gate)”. Add-gate: “returns PIN once”. Unlock: “PIN; slug optional”. Add `/owner/forgot`, `/owner/reset/{token}`.

---

### Task 4: Tests and helpers

**Files:**
- Modify: `backend/test/helpers.js`
- Modify: `backend/test/fix7-pin.test.js`
- Modify: `backend/test/fix8-pin-secret.test.js`
- Modify: `backend/test/fix12-ratelimit.test.js`
- Modify: `backend/test/session2-email.test.js` (personal PIN test)
- Create: `backend/test/signup-without-gate.test.js`
- Create: `backend/test/gate-pin.test.js`
- Create: `backend/test/password-reset.test.js`

- [ ] **Step 1: Helpers**

`signupCompany`: stop sending `gateName`. Expect no site.

`createOwnedSite`: after signup, `POST /api/companies/${id}/sites` with `{ name }`, set `site.guardPin` from `body.pin`. Do **not** require `addNamedGuard` for unlock. Keep return shape `{ company, site, cookie, email, password }`.

`unlockBooth(slug, pin)` may still send slug (booth URL). Also allow `{ pin }` only in the new tests.

- [ ] **Step 2: Existing PIN tests**

`fix7-pin.test.js`: “does not store PIN in plain text” → assert `sites.guard_pin_hash` (via `getDb` or a store read), not `people.pinHash`. Unlock without slug with the right PIN is 200. Wrong PIN 401. Lockout still works with slug + IP.

`fix8-pin-secret.test.js`: create/add-gate returns PIN once; later site/snapshot JSON has no `guardPin`. Reset uses site PIN. Booth cannot reset.

`fix12`: `makeSite` omits gate name.

`session2-email.test.js` “names the guard on the booth session when a personal PIN is used”: change to unlock with the **gate** PIN; actor name may be the site name. Do not add a second person with `G-02`.

Company-walls “gate-man PIN of A unlocks A gates and not B”: Gate 1 PIN must **not** unlock Gate 2 of the same company. Add a second PIN via add-gate. Update that test.

- [ ] **Step 3: Signup proofs** (`signup-without-gate.test.js`)

Spec 1–4 and 11: signup zero gates; used email / short password; empty me.sites until add-gate; first gate inherits pack/country/timezone; A cannot open B.

- [ ] **Step 4: Gate PIN proofs** (`gate-pin.test.js`)

Spec 5–7: add-gate returns `/^\d{6}$/`; later GET site/snapshot omit PIN; that PIN unlocks that slug (and `{ pin }` only); second gate of same company has a different PIN; first PIN does not unlock second; reset: old fails, new works.

- [ ] **Step 5: Reset proofs** (`password-reset.test.js`)

Spec 8–10: known email 200 no token in JSON, `lastMail().token` set; unknown email 200 same body, mail count unchanged; works once; expired refused; short password refused; old login 401, new login 200. `example.com` only.

- [ ] **Step 6: Run new files**

`cd /workspace/backend && npm test -- test/signup-without-gate.test.js test/gate-pin.test.js test/password-reset.test.js`

Expect pass. Fix helpers if `createOwnedSite` breaks.

---

### Task 5: Frontend

**Files:**
- Modify: `frontend/src/api.js`, `App.jsx`, `Landing.jsx`, `Setup.jsx`, `CompanyHome.jsx`, `Login.jsx`, `Booth.jsx`, `i18n.js`
- Create: `frontend/src/pages/ResetPassword.jsx`, `frontend/src/pages/GateUnlock.jsx`

- [ ] **Step 1: API**

Signup body without `gateName`. `addGate` already exists; expect `d.pin`. `unlock({ pin, slug? })`. `forgot`, `resetGet`, `resetPost`.

- [ ] **Step 2: Landing**

Two buttons: `t.adminDoor` → `/login`. `t.gateDoor` → `/gate`. Demo booth as a small muted link, not a third equal button.

- [ ] **Step 3: Sign up**

Remove gate name field. Keep company, site type, country, time zone, name, email, password. Success → `/home`.

- [ ] **Step 4: Your gates**

`sites.length === 0`: `t.homeEmpty`. Add a gate: on success, show `d.pin` once (`token-xl` + `t.newPinOnce`). Keep a `shownPin` in component state. Reset PIN button per gate (owner `api.resetPin(slug)`), show the new PIN once. Links: People, Reports. Open booth may stay for admin preview.

- [ ] **Step 5: Login + reset**

Login: Forgot password → email → always `t.resetSent`.

`ResetPassword.jsx`: GET token; expired → `t.linkExpired`; else two passwords; mismatch / short; success → link to `/login`.

`App.jsx`: `/reset/:token`, `/gate`.

- [ ] **Step 6: Gate tab and booth pad**

`GateUnlock.jsx`: title `t.pinUnlock`, number pad, submit `api.unlock({ pin })`, on 200 `nav(/booth/${site.slug})`. No guard dropdown.

`Booth.jsx` locked pad: drop guard dropdown. Unlock `{ slug: siteId, pin }` when opened from `/booth/:siteId` (admin Open booth). After unlock, same live book.

People add form: stop offering role Guard (employee / manager only). CSV already skips guards.

- [ ] **Step 7: i18n AR+EN**

`adminDoor`, `gateDoor`, `homeEmpty`, `forgotPassword`, `resetSent`, `resetTitle`, `newPassword`, `confirmPassword`, `passwordMismatch`, `savePassword`, `resetGatePin`. Reuse `passwordShort`, `linkExpired`, `guardPin`, `newPinOnce`. No em-dash.

- [ ] **Step 8: Frontend build**

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
| Home Admin / Gate | Task 5 |
| Sign up company + admin only | Tasks 2–3, 5 |
| Add a gate shows PIN once | Tasks 2–5 |
| PIN unlocks that gate only | Tasks 3–4 |
| Named-guard unlock removed | Tasks 3–5 |
| Forgot-password | Tasks 2–5 |
| Company walls | Task 4 |
| AR+EN, no em-dash | Task 5 |
| One company QR / cross-gate find | Out of scope |

Placeholder scan: no TBD. Reset is not an entry. Signup does not insert a site. PIN is on `sites.guard_pin_hash`.

---

## Execution notes

- Smallest change. No extra npm packages.
- Never print real PIN/email/phone/token from `backend/data/db.json`.
- Stop after two failed checks on the same task.
- Commit only if the user asks.
