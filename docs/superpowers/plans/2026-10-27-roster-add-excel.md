# Add person from gate and Excel roster — implementation plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate man and worker QR can request adding a person who is not on the list. Manager email Approves the add first. Only then can an out-pass start. Owner can upload a CSV any time on the people page: add and update, keep others, link employees by manager name.

**Architecture:** Keep PostgreSQL, Express, Vite/React. New table `person_add_requests` (not an out-pass, not a live-book entry). Reuse `/a/:token` and hashed one-time tokens. CSV parse in-process with no extra npm packages. Company walls stay `session.companyId === site.companyId`.

**Tech stack:** Node ESM, `pg`, existing `hashToken` / `newMagicToken` / `tokenExpiry` / `normalizeArabicText` / `emailAllowed` / `addPerson`. Vitest + supertest. AR/EN in `frontend/src/i18n.js`.

**Spec:** `docs/superpowers/specs/2026-10-27-roster-add-excel-design.md`

---

## File map

Create:

- `backend/migrations/006_person_add.sql` — pending add requests
- `backend/src/csv.js` — parse CSV text (quoted fields, no extra deps)
- `backend/test/person-add.test.js` — booth/QR add-request proofs
- `backend/test/people-csv.test.js` — owner CSV proofs

Edit:

- `backend/src/store.js` — create/decide/lookup person add; import CSV; duplicate employee ID check
- `backend/src/mailer.js` — send add-request mail (same stdout + inbox as approval)
- `backend/src/index.js` — routes; `/approve/:token` looks up add-request if not an out-pass
- `backend/openapi.json` — new routes
- `backend/test/helpers.js` — only if needed for CSV / second company
- `frontend/src/api.js` — requestAdd, importPeople, peopleSampleUrl
- `frontend/src/pages/Booth.jsx` — not-on-list fields
- `frontend/src/pages/Gate.jsx` — same
- `frontend/src/pages/Setup.jsx` — sample download + CSV upload
- `frontend/src/pages/Approve.jsx` — add-request copy
- `frontend/src/i18n.js` — AR+EN keys

Do not edit `.env`. Do not add npm packages. Do not print real emails or PINs. Commit only if the user asks.

---

### Task 1: Migration

**Files:**
- Create: `backend/migrations/006_person_add.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS person_add_requests (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  employee_id text NOT NULL DEFAULT '',
  manager_id text NOT NULL,
  status text NOT NULL DEFAULT 'waiting',
  source text NOT NULL DEFAULT 'guard',
  magic_token_hash text NOT NULL DEFAULT '',
  magic_token_expires_at timestamptz,
  magic_token_used_at timestamptz,
  deny_reason text NOT NULL DEFAULT '',
  actor_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS person_add_company_idx ON person_add_requests (company_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS person_add_token_hash_key ON person_add_requests (magic_token_hash) WHERE magic_token_hash <> '';
```

Do not put add-requests in `entries`. They must not appear on the live book.

- [ ] **Step 2: Apply against local test DB**

Run: `cd /workspace/backend && npm test -- test/health.test.js`

Expect pass (vitest setup runs migrations). If it fails on SQL, fix the file before Task 2.

---

### Task 2: Store — add request, decide, CSV import

**Files:**
- Create: `backend/src/csv.js`
- Modify: `backend/src/store.js`
- Modify: `backend/src/mailer.js`

- [ ] **Step 1: CSV parser**

`csv.js` exports `parseCsv(text)` → `{ headers: string[], rows: string[][] }`. Handle quoted fields and `""`. Strip UTF-8 BOM. No extra deps.

- [ ] **Step 2: Name match helper**

In `store.js` (or a tiny helper next to it):

```js
function namesEqual(a, b) {
  return normalizeArabicText(a) === normalizeArabicText(b);
}
```

- [ ] **Step 3: Duplicate employee ID**

In `addPerson`, if `employeeId` is non-empty and another active person on the same `companyId` already has that ID, return `{ error: 'employee_id_taken' }`.

- [ ] **Step 4: `createPersonAdd({ siteId, name, employeeId, managerId, source }, meta)`**

- Load site + company.
- Name required (trim). Else `{ error: 'name_required' }`.
- Manager must be `role === 'manager'`, same `companyId`, with work email allowed. Else `{ error: 'manager_required' }`.
- If company has no managers: `{ error: 'manager_required' }`.
- If `employeeId` matches an existing person on this company: `{ error: 'already_on_list' }`.
- If name-only (no employee ID) matches exactly one employee on this company: `{ error: 'already_on_list' }`.
- Insert row `status: 'waiting'`, hashed token, 12-hour expiry (reuse `newMagicToken` / `hashToken` / `tokenExpiry`).
- Audit `person_add_requested`.
- Return `{ request, magicToken }` (raw token only here). Never store the raw token.

`source` is `guard` (booth) or `qr`.

- [ ] **Step 5: `getPersonAddByToken(token)` / `decidePersonAdd(token, decision, denyReason, meta)`**

- Lookup by `hashToken`. Missing → `{ error: 'not_found' }`. Expired waiting row → `{ error: 'token_expired' }`.
- Approve: call existing `addPerson` with name, employeeId, managerId, role employee. Then set request `approved`, spend token, `decided_at`. If `addPerson` returns `employee_id_taken`, set request `approved` anyway and do not create a second person (spec: already-on-list).
- Deny: set `denied`, spend token. No person row.
- Repeat approve on already approved → return the request (same as out-pass idempotent). Repeat deny on denied → return the request.
- Audit `person_add_approved` / `person_add_denied`.
- Do not create an out-pass.

- [ ] **Step 6: `importPeopleCsv(siteId, text, meta)`**

Owner-only at the route layer. Store function:

1. `parseCsv`. Missing header → `{ error: 'csv_invalid' }`.
2. Map headers case-insensitive: `role`, `name`, `employee id` / `employee_id` / `employeeid`, `work email` / `email`, `phone`, `manager name` / `manager_name`.
3. Split rows into managers then employees. Role accepts `employee` / `manager` and the Arabic UI words `موظف` / `مدير`.
4. For each manager row: validate name; work email required + `emailAllowed`; phone via `phoneForSite`. Skip with reason on failure. Match existing by employee ID else unique name. Guard match → skip. Ambiguous name (two people, no ID) → skip. Update or `addPerson` role manager.
5. Reload people. For each employee row: find managers whose names equal `manager name` (file-created plus existing). 0 matches → skip `manager_not_found`. 2+ → skip `manager_name_ambiguous`. Then match/update/add employee with that `managerId`.
6. Return `{ added, updated, skipped: [{ line, name, reason }] }`. Reasons are stable codes: `role_invalid`, `name_required`, `email_required`, `email_domain_not_allowed`, `phone_invalid`, `manager_not_found`, `manager_name_ambiguous`, `name_ambiguous`, `employee_id_taken`, `guard_skip`.
7. Do not retire anyone missing from the file.
8. Audit one row `people_csv_imported` with counts in `reason` (e.g. `added=2 updated=1 skipped=1`). Do not write emails/phones into audit.

Process in one request; skip bad rows; do not abort the whole file on a skip.

- [ ] **Step 7: Mail helper**

In `mailer.js`, add `sendPersonAddEmail` same shape as `sendApprovalEmail` (`kind: 'person_add'`). Stdout line: `gate-daftar add-person mail for <to>: <pageUrl>`. Tests use `lastMail()`.

---

### Task 3: HTTP routes

**Files:**
- Modify: `backend/src/index.js`
- Modify: `backend/openapi.json`

- [ ] **Step 1: Sample CSV**

`GET /sites/:siteId/people/sample.csv` — owner only (`requireSiteAccess` owner). Body is a small UTF-8 CSV with BOM, fake `example.com` rows (one manager, one employee). Content-Type `text/csv`. Filename `gate-daftar-people-sample.csv`.

- [ ] **Step 2: Upload**

`POST /sites/:siteId/people/import` — owner only. Body JSON `{ csv: "<text>" }` (keep JSON like the rest of the API; no multipart). Empty → 400 `csv_required`. `csv_invalid` → 400. Success 200 with `{ added, updated, skipped }`. Rate-limit with `createLimit` or a dedicated 10/hour limiter.

- [ ] **Step 3: Booth add request**

`POST /sites/:siteId/people/request-add` — booth or owner (`requireSiteAccess` booth+owner). Body `{ name, employeeId, managerId }`. Call `createPersonAdd` source `guard`. Mail manager with `/a/<token>` via `PUBLIC_ORIGIN` (same `approvalUrls` as out-pass). Never return the token or pageUrl to the client. Response `{ request: { id, name, employeeId, status: 'waiting' } }`. Mail fail → 503 `mail_not_configured` (same as out-pass). `already_on_list` → 409.

- [ ] **Step 4: Public QR add request**

`POST /sites/:siteId/gate/request-add` — public, `gateLimit`. Same body. Source `qr`. Actor name `gate`. Same mail rules. Same redacted response.

- [ ] **Step 5: Approve lookup**

Change `GET /approve/:token` and `POST /approve/:token`:

1. `getEntryByToken` — if found, existing out-pass behaviour.
2. Else `getPersonAddByToken` — GET returns `{ kind: 'person_add', request: { id, name, employeeId, status, denyReason, decidedAt, requestedAt }, site: publicSite(site) }`. No manager email, no token. POST calls `decidePersonAdd`. Map waiting/approved/denied. 404 / 410 same codes as out-pass.

Keep out-pass `entry` shape unchanged so existing tests pass.

- [ ] **Step 6: OpenAPI**

Add `/sites/{siteId}/people/request-add`, `/sites/{siteId}/gate/request-add`, `/sites/{siteId}/people/import`, `/sites/{siteId}/people/sample.csv`. Note that `/approve/{token}` may be an add request.

---

### Task 4: Tests

**Files:**
- Create: `backend/test/person-add.test.js`
- Create: `backend/test/people-csv.test.js`

- [ ] **Step 1: person-add proofs (spec §11 items 1–5, 10)**

Use `createOwnedSite` + `seedRoster`. Do not print tokens in expect messages.

1. Booth `request-add` → 200, `lastMail().to` is the manager, `GET /people` does not include the new name yet.
2. `POST /approve/:token` approve → person on list with that `managerId`; second gate of the same company sees them in people.
3. Deny → still absent from people.
4. Public `gate/request-add` then approve → person on list.
5. Company B token cannot approve company A’s add (POST A’s token against… use B’s token on A’s person: 404 or no A names in body).
6. Stringified B snapshot / people has none of A’s add-request names.

Also: empty name 400; no manager 400; existing employee ID 409 `already_on_list`.

- [ ] **Step 2: CSV proofs (spec §11 items 6–9)**

Owner cookie only. Booth cookie on import → 403.

1. CSV with manager then employee (manager name match) → employee `managerId` set.
2. Second CSV: same employee ID, different manager name → updated; a person not in the file still listed.
3. Two managers same name → that employee row skipped `manager_name_ambiguous`; other rows apply.
4. Gmail on a manager row → skipped `email_domain_not_allowed`.

Sample GET returns `example.com` only (reuse seed test style).

- [ ] **Step 3: Run**

`cd /workspace/backend && npm test`

Expect all previous tests still pass plus the new files. Stop after two failed checks on the same task.

---

### Task 5: Booth and QR UI

**Files:**
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/pages/Booth.jsx`
- Modify: `frontend/src/pages/Gate.jsx`

- [ ] **Step 1: API client**

```js
requestAdd: (id, body) =>
  req(`/api/v1/sites/${id}/people/request-add`, { method: 'POST', body: JSON.stringify(body) }),
gateRequestAdd: (id, body) =>
  req(`/api/v1/sites/${id}/gate/request-add`, { method: 'POST', body: JSON.stringify(body) }),
importPeople: (id, csv) =>
  req(`/api/v1/sites/${id}/people/import`, { method: 'POST', body: JSON.stringify({ csv }) }),
```

Sample URL: `/api/v1/sites/${id}/people/sample.csv` (cookie via same origin; use `<a href>` with credentials not needed if cookie is sent on navigation — prefer `fetch` blob download with `credentials: 'include'`).

- [ ] **Step 2: Booth out-pass modal**

Keep the employee/manager dropdowns. Add a control `t.notOnList` that shows: name, optional employee ID, manager select, submit. Calls `api.requestAdd`. Success: same “email sent” copy as out-pass (`t.emailSent` or `t.addRequested`). Errors: `already_on_list` → `t.alreadyOnList`; `manager_required` → `t.noRoster` / no managers; else required.

If `managers.length === 0`, disable the add form and show that the owner must add a manager first.

Visitor form unchanged.

- [ ] **Step 3: Gate QR**

Same not-on-list block. Calls `api.gateRequestAdd`. Public roster stays names only.

---

### Task 6: People page, approve page, i18n

**Files:**
- Modify: `frontend/src/pages/Setup.jsx`
- Modify: `frontend/src/pages/Approve.jsx`
- Modify: `frontend/src/i18n.js`

- [ ] **Step 1: Setup people card**

Download sample button. File input accept `.csv,text/csv`. Read as text, `api.importPeople`. Show `added` / `updated` / skipped count and skipped `name` + reason. Map reason codes to i18n. Never display emails from the result (API already omits them).

- [ ] **Step 2: Approve page**

If `data.kind === 'person_add'`: title `t.addPersonTitle`, show name, employee ID, gate name, no outing reason. Waiting / approved / denied badges. Approve still adds them only. Deny optional reason.

Out-pass tokens keep current UI (`data.entry`).

- [ ] **Step 3: i18n AR+EN**

Add both languages: `notOnList`, `addRequested`, `alreadyOnList`, `addPersonTitle`, `downloadSample`, `uploadCsv`, `csvHint`, `csvAdded`, `csvUpdated`, `csvSkipped`, plus skip-reason strings. No em-dash. No comments unless the file already has them.

- [ ] **Step 4: Frontend build**

`cd /workspace/frontend && npx vite build`

Expect success.

---

### Task 7: Spec status and sanity

- [x] Spec already `approved`. Do not start a real factory. Do not commit `.env`.
- [x] Run `cd /workspace/backend && npm test` and `cd /workspace/frontend && npx vite build` once more.
- [x] Commit only if the user asks.

---

## Self-review

| Spec item | Plan task |
|---|---|
| Two steps: add then outing | Tasks 2–3, 5 |
| Booth + QR add request | Tasks 3, 5 |
| Manager email `/a/:token` | Task 3 step 5, Task 6 Approve |
| Owner CSV any time, keep others | Tasks 2 step 6, 3, 6 |
| Link by manager name | Task 2 step 6 |
| Duplicate ID / ambiguous name | Tasks 2, 4 |
| Company walls | Task 4 item 5–6 |
| No `.xlsx` parser / no extra deps | CSV only, `csv.js` |
| No gate-man upload | Import is owner-only |

Placeholder scan: no TBD. CSV-not-xlsx is explicit. Add-requests are not entries.

---

## Execution notes

- Smallest change. No extra npm packages.
- Never print real PIN/email/phone/token from `backend/data/db.json`.
- Stop after two failed checks on the same task.
- Commit only if the user asks.
