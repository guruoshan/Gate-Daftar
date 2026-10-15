# Gate Daftar — Application Architecture Audit

Date: 2026-10-12
Scope: live codebase under `/workspace` (`backend/`, `frontend/`, `start.sh`) plus `backend/data/db.json`.
Method: static reverse-engineering of source. No penetration test, no exploit, no live attack traffic.
Verdict: **NO** for real-user or real-PII release.

---

## 1. Executive verdict

Gate Daftar is a working bilingual MVP of a manned-gate register: visitor walk-in, employee out-pass, booth PIN, public gate QR, WhatsApp-shaped magic-link approval, live booth tabs, owner reports, CSV/Excel download.

It is **not** a product you can put in front of a real factory.

Every sensitive API is unauthenticated. Knowing a site id or slug is enough to read people, phones, manager numbers, magic tokens, the booth PIN, the audit log, and the full CSV export. The public gate form loads the same snapshot. Approve links auto-POST from a GET query. Persistence is a single JSON file rewritten on every mutation.

Demo and strategy intent are sound. Security, tenancy isolation, durability, and compliance are not.

**Release bar:** do not onboard real visitors, employees, or managers until auth, secret stripping, POST-only approval, CORS, rate limits, and a durable store exist.

---

## 2. What the system is

Working name only: **Gate Daftar**. Strategy lives in `gcc-sme-gate-pass-strategy.md`. The app implements the hero job from that handout:

- Replace the paper daftar at one manned industrial gate.
- Two jobs: visitor in, employee out-pass.
- Dual intake: printed gate QR (self-register) and booth Manual Entry / Create Pass.
- Manager approves with a one-tap magic link. No login on the critical path.
- Booth is a shared browser station with a 4-digit PIN.
- Arabic RTL and English LTR.
- Owner can search yesterday and download a day file.

It is not a lobby iPad VMS, not a workplace OS, not a mobile app, not biometric, not WhatsApp Cloud API. Approval is a copyable `wa.me` message plus `/a/:token`.

---

## 3. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Vite 5 + React 18 + react-router-dom 6 | SPA, no SSR |
| QR | `qrcode` | Client-side canvas/data URL |
| Backend | Express 4, ESM | `node src/index.js`, optional `--watch` |
| CORS | `cors()` with no origin allowlist | Any browser origin |
| Realtime | Server-Sent Events | `EventSource` on `/api/sites/:siteId/stream` |
| Store | In-memory object + `fs.writeFileSync` | `backend/data/db.json` |
| IDs | `crypto.randomBytes` | `id()`, `token()`, `shortCode()` in `backend/src/ids.js` |
| Audit hash | SHA-256 truncated to 16 hex | Not a real chain of custody |
| Excel | CSV bytes + `application/vnd.ms-excel` | Not xlsx |
| Process | `start.sh` | Backend background, Vite on 5173 |
| Preview | Vite `allowedHosts: ['.monkeycode-ai.live']` | Proxy `/api` to `127.0.0.1:3001` |

No TypeScript. No test runner. No linter config in either package. No Dockerfile. No CI. No env-based secrets besides optional `PUBLIC_ORIGIN` and `PORT`.

---

## 4. Directory and module map

```
backend/
  package.json
  src/index.js          REST + SSE + CSV/XLS export
  src/store.js          tenants, entries, audit, search, seed, persist
  src/countries.js      dial codes, guessIso, normalizePhone
  src/ids.js            id / token / shortCode / now
  data/db.json          live PII store (should stay gitignored)
frontend/
  package.json
  vite.config.js        host, allowedHosts, /api proxy
  src/main.jsx
  src/App.jsx           routes
  src/api.js            fetch wrapper, exportUrl, publicize, share
  src/useLive.js        snapshot + EventSource
  src/i18n.js           AR/EN copy + dir
  src/countries.js      compose / guess / matchQuery / phoneOk
  src/packs.js          five site templates
  src/icons.jsx
  src/styles.css
  src/pages/Landing.jsx
  src/pages/Setup.jsx
  src/pages/Booth.jsx
  src/pages/Gate.jsx
  src/pages/Approve.jsx
  src/pages/QrPage.jsx
  src/pages/Dashboard.jsx
  src/components/PhoneField.jsx
  src/components/ManagerFields.jsx
  src/components/ShareBar.jsx
start.sh
gcc-sme-gate-pass-strategy.md
```

Git HEAD at audit time was strategy-only (`76e0d52`). App trees were untracked. There is no `.gitmodules`.

---

## 5. Data model

One JSON document. Shape after `migrate()`:

```
{
  companies: [],
  sites: [],
  people: [],
  entries: [],
  events: [],
  audit: []
}
```

### Company

- `id` (`co_…`)
- `name`
- `countryIso`
- `createdAt`

Created 1:1 with a site in `createSite()`. There is no company API, no multi-site UI, no `co:{companyId}` subscriber on the HTTP layer. Company is a dormant tenant key.

### Site

- `id` (`site_…`)
- `companyId`
- `slug` (`gd-` + 6-char code, or `demo`)
- `name`, `pack`, `ownerName`, `ownerEmail`
- `lang` (`ar` or `en`)
- `countryIso` (default `SA`)
- `guardPin` (4-digit string, `1000–9999`)
- `createdAt`

Packs in code: `manufacturing`, `warehouse`, `workshop`, `logistics`, `construction`. Live demo row still has drifted pack `warehouse-factory`, which is not in `PACKS`.

`publicSite()` omits PIN, owner email, owner name. `snapshot()` puts `guardPin` back onto `site`.

### Person (roster)

- `id` (`p_…`), `siteId`, `companyId`
- `name`, `role` (`manager` or `employee`)
- `phone`, `managerPhone` (digits, no `+`)
- `employeeId`, `active`, `createdAt`

Roster is optional. Gate and booth still accept free-typed names.

### Entry (the register row)

One table for visitors and out-passes.

Shared fields: `id`, `siteId`, `companyId`, `kind`, `status`, `name`, `phone`, `company`, `source` (`qr` or `guard`), `dayToken` (4–5 Crockford-ish chars), timestamps.

Visitor extras: `purpose`, `hostName`, `idNumber`, `cardNumber`.

Out-pass extras: `employeeId`, `personId`, `reason`, `expectedMinutes`, `managerName`, `managerPhone`, `magicToken` (18 bytes base64url), `denyReason`, `unapprovedReason`, `dueAt`.

### Status machines

Visitor:

`waiting_admit` → `inside` → `exited`

Out-pass:

`waiting_approval` → `approved_out` → `out` → `returned`

or `waiting_approval` → `denied`

Any entry can be forced to `unapproved_leave` with no kind/status check.

### Events and audit

`events` is a thin activity feed. `audit` is append-only rows with `prev` + truncated SHA-256. Actor role/name are client-supplied via `clientMeta()`. IP is first `X-Forwarded-For` hop. Device is User-Agent sliced to 180 chars.

This is not a tamper-evident ledger. Anyone who can write `db.json` can rewrite the chain. Actor identity is not authenticated.

---

## 6. API surface

Base: Express on `0.0.0.0:3001` (or `PORT`). JSON body limit 200kb.

| Method | Path | Auth | What it does |
|---|---|---|---|
| GET | `/api/health` | none | `{ ok, name }` |
| GET | `/api/countries` | none | dial-code list |
| POST | `/api/sites` | none | create company+site, returns PIN |
| GET | `/api/sites/:siteId` | none | public site by id or slug |
| POST | `/api/guard/unlock` | PIN | booth unlock; PIN compared in plaintext |
| GET | `/api/sites/:siteId/snapshot` | none | site **including guardPin**, people, all entries **including magicToken**, events, stats |
| GET | `/api/sites/:siteId/stream` | none | SSE of the same snapshot, then live entries with magic links |
| GET | `/api/sites/:siteId/people` | none | roster with phones |
| POST | `/api/sites/:siteId/people` | none | add person |
| POST | `/api/sites/:siteId/visitors` | none | create visitor |
| POST | `/api/sites/:siteId/outpass` | none | create out-pass, returns `wa.me` + approve URLs |
| GET | `/api/sites/:siteId/search` | none | filter entries; empty `q` returns all |
| GET | `/api/sites/:siteId/dashboard` | none | stats + last 40 audit rows |
| GET | `/api/sites/:siteId/audit` | none | audit tail |
| GET | `/api/sites/:siteId/export` | none | JSON, CSV, or fake Excel of names/phones/tokens |
| POST | `/api/entries/:id/admit` | none | visitor in |
| POST | `/api/entries/:id/exit` | none | visitor out |
| POST | `/api/entries/:id/out` | none | employee walked out |
| POST | `/api/entries/:id/in` | none | employee returned |
| POST | `/api/entries/:id/unapproved` | none | force unapproved leave |
| GET | `/api/approve/:token` | token | out-pass summary for manager page |
| POST | `/api/approve/:token` | token | approve or deny |
| GET | `/api/entries/:id` | none | **full entry object**, including `magicToken` |

`:siteId` accepts either `site.id` or `site.slug` (`siteOr404`).

No sessions. No cookies. No JWT. No API keys. No CSRF tokens. No rate limiter. CORS reflects any origin.

---

## 7. Auth model (what exists, and what does not)

### Booth PIN

- 4 digits, stored plaintext on the site row.
- Unlock: `POST /api/guard/unlock` with `{ slug, pin }`.
- Frontend stores `sessionStorage['gd_pin_' + siteId] = '1'`.
- After unlock, the booth does **not** send the PIN again. Live data comes from open snapshot/stream URLs.
- PIN pad is UX only. Snapshot, stream, search, admit, export work without it.

### Guard PIN lookup

`getSiteByGuardPin(pin)` scans all sites. A 4-digit space is 9000 values (`1000–9999`). Combined with unlock-by-PIN-without-slug, this is a global PIN oracle.

### Owner / reports

`/reports/:siteId` has no login. Setup `/setup/:siteId` loads snapshot (and therefore PIN). If snapshot fails, Setup tries `unlock({ slug, pin: '1234' })`.

### Manager

Magic token in the URL is the capability. GET `/a/:token?d=approve` auto-approves. Token is also present on every snapshot/SSE/entry payload.

### Visitor / employee

No accounts, by design. Public `/g/:siteId` is supposed to be a clipboard. It currently also downloads the roster and live entries.

---

## 8. Frontend routes and UX

| Route | Page | Chrome | Purpose |
|---|---|---|---|
| `/` | Landing | yes | pitch + start |
| `/setup` | Setup | yes | create site |
| `/setup/:siteId` | Setup | yes | PIN, people, booth/gate links, reports link |
| `/booth/:siteId` | Booth | hidden | PIN gate, then live register |
| `/g/:siteId` | Gate | hidden | public visitor / out-pass forms |
| `/qr/:siteId` | QrPage | yes | printable gate QR |
| `/reports/:siteId` | Dashboard | yes | stats, audit, CSV/XLS |
| `/a/:token` | Approve | hidden | manager magic page |
| `*` | redirect `/` | | |

Language: `localStorage` via `readLang` / `writeLang`. `applyDir` sets `dir` and `lang` on `documentElement`.

Booth tabs: Waiting, Approved to go out, Inside now, Search. Search is always on and also switches to the Search tab on focus. Create Pass and Gate QR are first-class. Overdue strip lists names of out-passes past `dueAt`.

Gate: two big choices (I am a visitor / I am going out). Out-pass requires manager name + phone. Optional roster pick fills name, employee id, manager.

Approve: loads entry; if `?d=approve` or `?d=deny` and status is `waiting_approval`, it immediately POSTs.

ShareBar: Web Share API or clipboard; `publicize()` rewrites `localhost:3001` to `window.location.origin`.

PhoneField: country dropdown, per-country national length, stores dial+national digits.

---

## 9. Real-time design

Backend `EventEmitter` channels:

- `site:{siteId}` — used
- `co:{companyId}` — emitted, never subscribed over HTTP

`subscribe(siteId, fn)` is per-process. SSE handler:

1. `hello`
2. full snapshot (PIN + magic tokens + `withLinks`)
3. on `entries`, push mapped entries and `stats`
4. otherwise echo `msg.type`
5. comment ping every 15s
6. unsubscribe on close

Frontend `useLive(siteId)` opens `EventSource` plus an initial snapshot fetch. Booth uses this after PIN. Gate does **not** subscribe; it one-shots snapshot.

Limits:

- No auth on stream.
- Payload is the whole site, not a delta.
- `setMaxListeners(400)` is a leak bandage, not backpressure.
- Single Node process. Restart drops all SSE clients; they reconnect and pull snapshot again.
- Vite proxy sets `timeout: 0` / `proxyTimeout: 0` so SSE is not killed. Preview/production without that proxy will buffer or drop the stream.

---

## 10. Tenancy and isolation

Intended shape: company has sites; data keyed by `siteId` and copied `companyId`.

Actual isolation: URL guessability.

- Slugs are `gd-` + 6 chars from a 32-symbol alphabet (~1e9 space, but they are printed on QR sheets and returned by create-site).
- Demo slug `demo` is public.
- `GET /api/sites/demo/snapshot` is a full dump.
- Entry ids are 16 hex after prefix. Fine if secret; they are listed by snapshot.
- Magic tokens are 18 bytes base64url. Fine if secret; they are listed by snapshot and SSE.
- Guard PIN is 4 digits and is listed by snapshot.

There is no row-level auth. `POST /api/entries/:id/admit` only needs the entry id. `unapprovedLeave` does not check site membership of the caller because there is no caller.

`exportRows` / `listAudit` / `dashboard` filter by `siteId` only. That is the entire tenancy story.

---

## 11. Phone, country, i18n

Countries (both `backend/src/countries.js` and `frontend/src/countries.js`): SA, AE, OM, KW, QA, BH, IN, EG, JO, PK, BD.

Normalization:

- strip non-digits
- strip leading `00`
- guess ISO by longest matching dial
- strip dial and a leading `0`
- require exact national length
- store `e164` as `dial + national` with **no plus**

`wa.me` uses those digits. Search strips leading `0`/`00` and matches name, phone, company, employee id, token, host, manager, id number, reason, purpose.

Site `countryIso` is the default, not a hard lock. A Saudi site can still accept an Indian number if the user picks IN in PhoneField.

i18n is a static `STR` map in `frontend/src/i18n.js`. Humanized copy was a product requirement (no em-dash placeholders). Direction flips with language. Some status strings still echo raw `status` if unknown.

---

## 12. Magic-link approval flow

1. Out-pass created with `magicToken = token(18)`.
2. `withLinks()` builds:
   - `approveUrl` = `{origin}/a/{token}?d=approve`
   - `denyUrl` = `{origin}/a/{token}?d=deny`
   - `pageUrl` = `{origin}/a/{token}`
   - `waLink` = `https://wa.me/{digits}?text=…`
   - `smsBody` = Arabic or English message including both URLs
3. Origin resolution order: `PUBLIC_ORIGIN`, then `Origin`, then `Referer`, then `X-Forwarded-Proto` + `X-Forwarded-Host` / `Host`.
4. Worker or guard shares via ShareBar / WhatsApp.
5. Manager opens `/a/:token`. Approve.jsx GET-fetches `/api/approve/:token`. If query `d` is set, it POSTs the decision immediately.

GET `/api/approve/:token` is relatively tight: it returns a redacted entry (no manager phone, no magic token echo). The damage is elsewhere: snapshot and `GET /api/entries/:id` leak the token, and the WhatsApp message itself is a capability URL.

`already_decided` is returned as 200 with the existing entry, so refresh does not error. There is no expiry, no single-use after view, no bind to manager phone, no confirm step on `?d=approve`.

Link-preview crawlers and mail scanners that hit `?d=approve` can approve an outing.

---

## 13. Security findings

Severity is relative to “real people at a real gate.”

### Critical

1. **Unauthenticated snapshot IDOR.** `GET /api/sites/:id/snapshot` returns `guardPin`, roster phones, every entry, every `magicToken`, WhatsApp links. Gate.jsx calls this for the public QR page.
2. **Unauthenticated SSE IDOR.** Same payload, pushed forever.
3. **Unauthenticated export IDOR.** CSV/XLS of names, phones, manager phones, tokens. No owner session.
4. **Unauthenticated mutation IDOR.** Admit, exit, out, in, unapproved, add person, create visitor/out-pass: all need only ids in the URL.
5. **GET-driven approval.** `/a/:token?d=approve` auto-POSTs. Prefetch = approve.
6. **Entry GET dumps secrets.** `GET /api/entries/:id` returns the raw store object, including `magicToken` and manager phone.

### High

7. **4-digit global PIN.** `getSiteByGuardPin` plus unlock. Demo PIN `1234` is documented. Setup retries `1234` on snapshot failure.
8. **PIN in snapshot.** `snapshot()` spreads `guardPin` into the public site object. Booth PIN is theater.
9. **CORS `*`.** Any website can read/write the API from a browser.
10. **Actor spoofing.** Audit `actor` is whatever the server infers from `source` or hardcodes (`Booth`, visitor name). Not identity.
11. **`unapprovedLeave` has no status/kind guard.** Any entry can be smashed into `unapproved_leave`.
12. **No rate limits.** PIN spray, site create, export, SSE fan-out.

### Medium

13. **Host header origin.** If `PUBLIC_ORIGIN` is unset, magic links follow `Origin` / `Referer` / `X-Forwarded-Host`. Link poisoning is possible behind a misconfigured proxy.
14. **sessionStorage PIN flag.** Any script on the origin can set `gd_pin_* = 1` and skip the pad. The pad was never a server session.
15. **Excel is CSV.** Users may believe they downloaded a real workbook. Formula injection in name fields (`=cmd|…`) is possible if opened in Excel.
16. **PII in git-adjacent JSON.** Live `db.json` held a real-looking owner email (redacted), live PINs and phones.
17. **No helmet, no body size beyond 200kb on JSON only, no request timeouts.** SSE connections are unbounded.

### Low / product

18. Pack drift: live demo `pack: "warehouse-factory"` vs code enum.
19. `co:` bus unused.
20. Company has no ACL.
21. Truncated audit hash is cosmetic.

This audit does not include PoCs, payloads, or exploit steps.

---

## 14. Persistence and durability

- Load: `JSON.parse(fs.readFileSync(db.json))` at process start.
- Save: full-file `writeFileSync` on almost every mutation (`createSite`, `addPerson`, visitor, out-pass, decide, admit, exit, out, in, unapproved, seed).
- No fsync guarantee beyond writeFileSync.
- No backup, no rotation, no WAL.
- Parse failure returns `emptyDb()` and **does not** preserve the corrupt file. Next persist can overwrite.
- Concurrent Node cluster is unsafe (single in-memory `db`). One process only.
- Seed: if `sites.length === 0`, create Al-Noor Warehouse demo. If sites exist, only `migrate()` then persist.

This store will lose data on disk full, partial write, or a bad deploy that starts with an empty volume.

---

## 15. Privacy and PII

Collected today:

- Visitor: name, phone, company, purpose, host, ID number, optional card, IP, User-Agent
- Employee out-pass: name, phone, employee id, reason, duration, manager name, manager phone
- Owner: name, email
- Roster: name, role, phone, manager phone, employee id
- Audit: IP, User-Agent, action, names

No privacy policy route. No retention job. No delete-person or delete-entry API (and this environment also forbids agent-driven deletes). No PDPL/GDPR mapping. No encryption at rest. No access log separate from the JSON file.

For KSA PDPL / UAE PDPL this is not a lawful processing design. It is a prototype notebook.

Live file at audit time: 3 companies, 3 sites (`demo`, `gd-d82pwc` Muscatera, `gd-jw4w5x` Gulf Plant). Demo PIN `1234`. Muscatera PIN present in plaintext. Treat `db.json` as sensitive.

---

## 16. Operational risks

- Preview exposes Vite 5173; API is only reachable via `/api` proxy **if** both processes run. `start.sh` is the supported pair.
- Backend last known start pattern: `node src/index.js` in a background terminal.
- Demo URLs: `/booth/demo` PIN `1234`; `/reports/demo`; `/g/demo`.
- No process manager, no health-based restart, no disk monitor.
- SSE + JSON rewrite on every gate event will not survive a busy shift if the file grows (audit + events never compact).
- `bus.setMaxListeners(400)` implies expected connection pile-up.
- No migrations beyond “add company if missing” and default `countryIso: SA`.

---

## 17. Gaps versus strategy handout

Strategy (`gcc-sme-gate-pass-strategy.md`) said:

| Rule | MVP status |
|---|---|
| Web-only, no hardware, no app | Met |
| Dual intake QR + Create Pass | Met |
| No employee accounts / no outing PIN | Met |
| Magic-link approve, not manager login | Met in UX; broken in security (token leak, GET approve) |
| Arabic + English day one | Met |
| Card number optional | Met |
| Search who is inside / who is out | Met |
| Unapproved leave as audit row, not “emergency system” | Met as a button; over-broad backend |
| Free to start, no employee-list upload required | Met |
| Per-site, one gate | Mostly; company object unused |
| Owner search yesterday | Dashboard is today-centric stats + full export, not a real day browser |
| Gate staff personal login + PIN switch | **Not built.** Shared PIN only |
| Cloud multi-tenant | Process is multi-tenant; security is not |
| Activation = real gate event | Demo seed fakes it |

Largest product lies vs strategy: manager login was correctly avoided, but the magic link is not actually secret. Shared-station PIN switch without personal guard login was accepted for MVP and then undermined by snapshot PIN leak.

---

## 18. Testing, quality, observability

- Zero test files.
- No ESLint / Prettier / tsc.
- No structured logger. `stdout` on listen only.
- Errors are short codes (`site_not_found`, `bad_pin`, `phone_invalid`) with no request id.
- Frontend `req()` throws `Error(data.error)`. Callers map a few codes to i18n.
- No metrics. Dashboard numbers are computed from the same JSON on each request.

---

## 19. Deployment topology (as built)

```
Browser
  -> Vite :5173  (SPA + /api proxy + SSE proxy)
       -> Express :3001
            -> memory `db`
            -> backend/data/db.json
```

`originFrom()` must see the **browser** origin, not `localhost:3001`, or WhatsApp links point at the API port. `publicize()` is a client-side bandage for that.

`allowedHosts: ['.monkeycode-ai.live']` is required for the preview host. Do not remove it.

There is no production build path in `start.sh`. `frontend` has `vite build` / `vite preview`, but preview has no `/api` proxy (proxy is only under `server`). A `vite preview` deploy would 404 the API unless a reverse proxy is added.

---

## 20. Recommendations (fix direction only)

Do not treat this as an implementation spec. Order is release-blocking first.

1. **Authz on every non-public route.** Public: health, countries, create-site (maybe), gate **form POST**, approve GET/POST by token. Not public: snapshot, stream, people, search, dashboard, audit, export, admit/exit/out/in/unapproved, entry GET.
2. **Strip secrets from any payload the gate QR can load.** No `guardPin`, no `magicToken`, no full roster phones on `/g/:siteId`. Gate needs site name, country, optional name list without phones if you must keep pick-from-roster.
3. **POST-only decisions.** Stop honoring `?d=approve` on page load. Show the page; require a tap. Consider a confirm token bound to Accept header / form POST.
4. **Do not put capability URLs in snapshot or SSE.** Booth can show “waiting for manager” without the token. Share links only at create-pass response time.
5. **Server-side booth session.** PIN creates an HttpOnly cookie or short-lived bearer. PIN not in JSON. Unlock-by-PIN-without-slug should die.
6. **CORS allowlist.** Preview origin + production origin only.
7. **Rate limits** on unlock, create-site, approve, export.
8. **`unapprovedLeave`:** require `kind === 'outpass'` and a small set of from-statuses; require reason.
9. **Durable store** (SQLite at minimum) with backups. Stop rewriting one JSON blob.
10. **Real export** or honest CSV-only labeling. Sanitize `=`-prefixed cells.
11. **Set `PUBLIC_ORIGIN`.** Never trust `X-Forwarded-Host` alone.
12. **Ignore / encrypt `db.json`.** Rotate demo PIN. Treat the Muscatera email/PIN as spilled.
13. **Tests** for status machines, phone normalize, search, approve idempotency.
14. **Personal guard login** when you leave shared-PIN MVP.

---

## 21. Final verdict

| Question | Answer |
|---|---|
| Does the MVP match the hero job? | Yes, as a demo. |
| Can a guard run a shift in AR/EN? | Yes, in a trusted lab. |
| Can a manager approve from WhatsApp? | Yes, if the link is not leaked first. |
| Can an owner export yesterday? | CSV/XLS dump exists; auth does not. |
| Is tenancy real? | Keys exist; locks do not. |
| Is PII safe? | No. |
| Ship to a real gate? | **NO.** |

Stop condition: this audit is the deliverable. Next engineering step is hardening, and only if someone explicitly asks for it.

---

## Appendix A — Live demo pointers

- Booth: `/booth/demo` with PIN `1234`
- Gate: `/g/demo`
- Reports: `/reports/demo`
- Health: `/api/health`

Do not paste live PINs, emails, or phones from `backend/data/db.json` into tickets or chat beyond what this appendix already states for the seeded demo.

## Appendix B — Entry status cheat sheet

| status | kind | meaning |
|---|---|---|
| waiting_admit | visitor | at the gate, not inside |
| inside | visitor | admitted |
| exited | visitor | left |
| waiting_approval | outpass | manager has not tapped |
| approved_out | outpass | manager yes, still on site |
| out | outpass | walked out |
| returned | outpass | walked back in |
| denied | outpass | manager no |
| unapproved_leave | any (bug) | logged as left without approval |
