# Three doors polish, installable PWA, optional vehicle number — design

Date: 2026-10-31
Status: approved
Product: Gate Daftar

## 1. Goal

Make Gate Daftar feel like a tablet app at a manned gate, not a prototype website.

This pass:

- Polishes the three doors (public home, Admin, Gate) without changing login, PIN, or company walls.
- Makes the site installable as a PWA (Add to Home Screen, standalone, cream chrome).
- Adds an **optional** vehicle number on the visitor form (booth and public gate).
- Tightens Reports KPI card type. No new metrics.

Not a full redesign. Not an offline booth. Not residents. Not a required plate.

## 2. What exists today (must change)

- Home (`Landing.jsx`) already has Admin then Gate, both class `btn` (solid green). Demo is a muted link (keep that). vs-paper / how-it-works cards stay.
- Login, forgot-password, Your gates, and the PIN pad work. PIN pad is already buttons only (no text field) on both `/gate` (`GateUnlock.jsx`) and locked `/booth/:slug` (`Booth.jsx`). Keys are 56px today; this pass makes them 64px and adds `aria-label` on both pads.
- Your gates already shows `token-xl` + `t.newPinOnce` on Add a gate / Reset PIN. This pass only puts that PIN above the links more clearly.
- `index.html` theme-color is `#070B14` (dark) while the page is cream `#f4f1ea`. Installed chrome would look wrong.
- No `manifest.webmanifest`, no service worker, no app icons. Not installable. `main.jsx` does not register a worker.
- Visitor form (booth + public `/g/:slug`) has name, phone, company, purpose, host, ID, card. No vehicle. `entries` has no `vehicle` column. Both POSTs (`/sites/:siteId/visitors` and `/sites/:siteId/gate/visitor`) omit it. CSV headers in `index.js` omit it.
- Reports already show KPI cards (`todayTotal`, visitors, out-pass, inside, waiting, overdue, still out, average). This pass only tightens type and spacing. Do not add cards.
- Font is IBM Plex Sans Arabic + IBM Plex Sans. Keep it (Arabic). Do not switch to Inter.
- i18n already has `adminDoor`, `gateDoor`, `homeEmpty`, `newPinOnce`, `pinUnlock`, `pinBad`, `offline`. Add `online` and the install/vehicle keys.

## 3. Visual system (small, not a new brand)

Keep cream paper + green. Tighten tokens in `frontend/src/styles.css` only.

| Token | Value |
|---|---|
| Background | `#f4f1ea` |
| Surface / card | `#ffffff` |
| Ink | `#1c1915` (keep; close to `#1f2937`, already used) |
| Muted | `#5f584e` |
| Primary / CTA | `#1f6b4f` (replace `--accent` and `--cta`, today `#1f4d3a`) |
| Primary hover | `#2e8665` |
| Success | `#1f7a4d` (keep existing ok) |
| Warning | `#b45309` (keep existing wait) |
| Danger | `#b42318` (keep existing bad) |
| Radius | 14px |
| Min tap | 44px. PIN keys **64px**. Primary actions **56px**. |
| Motion | press scale 0.98, under 200ms. No new animation library. |

Do not paint `.btn-in` (Admit) with the new green. It uses `--accent-2` and ink `#042c3a` today; keep Admit on `--in` / `#175cd3`. `--r` is already 14px.

Theme color and manifest background: `#f4f1ea`. Primary actions today 48px; this pass 56px.

Font stays IBM Plex Arabic / IBM Plex Sans / system-ui. AR+EN copy in `frontend/src/i18n.js`. No em-dash.

## 4. Home (public)

Two unequal doors (swap visual weight; Gate is the keeper’s door):

- **Gate**: solid primary button. Goes to `/gate`.
- **Admin**: outline (`ghost`). Goes to `/login`.
- One short line under the title: who each door is for (`t.homeDoors`).
- Demo stays a small muted link under the two buttons, not a third equal door.
- Online / offline line using `navigator.onLine` (`t.online` / `t.offline`). This is network, not live-book SSE. `offline` already exists.
- No visitor counts on the public home. Those numbers are company data.
- Keep the existing vs-paper / vs-Envoy / how-it-works blocks. Do not strip the landing to two buttons only.

## 5. Admin door

Login first. Sign up stays a quiet link to `/setup`. Forgot password stays one extra step on the same screen; after submit always show `t.resetSent`. Do not change the API.

Your gates:

- Zero gates: `t.homeEmpty` (already: add a gate first, then people).
- Each gate is a card: name; links People, Reports, Open booth; Reset PIN.
- When Add a gate or Reset PIN returns a PIN: show it once as `token-xl` plus `t.newPinOnce` on that card. Same as today, just clearer hierarchy (PIN above the links).

Do not redesign People, CSV, Setup after a gate exists, or Approve.

## 6. Gate door and booth pad

`/gate` (`GateUnlock.jsx`) and locked `/booth/:slug` (`Booth.jsx` unauthed pad):

- Keep today’s pad: six dots, keys 1–9 / blank / 0 / backspace, auto-submit at six digits, extra Submit button.
- Keys 64px (today 56px). No `<input type="password">` and no `inputMode` text field (already true).
- Each key `aria-label` (digit, backspace, empty spacer `disabled`).
- Wrong PIN: one line `t.pinBad`.
- After unlock: existing booth. No extra chrome.

Quiet install card **on `/gate` only** (see §8).

## 7. Optional vehicle number

New optional field on **visitor** intake only (not out-pass).

| Place | Field |
|---|---|
| Booth Manual → visitor | after host, before ID |
| Public `/g/:slug` visitor form | same |

Label: `t.vehicle` = رقم المركبة / Vehicle number. Not required. Empty string stored if blank.

Backend:

- Migration `008_visitor_vehicle.sql`: `ALTER TABLE entries ADD COLUMN IF NOT EXISTS vehicle text NOT NULL DEFAULT '';`
- `createVisitor` reads `input.vehicle`, trims, max 32 characters. Longer → `{ error: 'vehicle_long' }` which `fail()` maps to 400. Empty is fine.
- Add `vehicle` to `entryKeys` (after `cardNumber`) and the `createVisitor` object.
- Both visitor POSTs pass `vehicle` from `req.body`: booth `POST /sites/:siteId/visitors` and public `POST /sites/:siteId/gate/visitor`.
- `redactEntry` / snapshot include it automatically. `publicCreated` (thanks + day token) does **not** need `vehicle`.
- CSV: add `vehicle` to the explicit `headers` list in `backend/src/index.js` (after `hostName`). Field name `vehicle`, not a new display label in the file.
- Booth card shows vehicle when present (same line as company · purpose · host).
- Search does **not** add `e.vehicle` to the text haystack in this pass.

No fake “Visitor Registered / vehicle / 3 second auto-return” screen. Public gate already has a thanks + day token; keep that. Booth already toasts and stays on the book.

## 8. PWA

Create (no extra npm packages):

- `frontend/public/manifest.webmanifest`
- `frontend/public/sw.js` (app-shell cache only)
- `frontend/public/icons/icon-192.png` and `icon-512.png` (GD mark, primary green on cream)
- Register the worker from `frontend/src/main.jsx` (production build + localhost)

Manifest:

| Key | Value |
|---|---|
| name | Gate Daftar |
| short_name | قيت دفتر |
| start_url | `/` |
| display | standalone |
| orientation | **any** (gate tablets are landscape; do not lock portrait) |
| background_color | `#f4f1ea` |
| theme_color | `#f4f1ea` |
| lang | ar |
| dir | rtl |
| icons | 192 and 512, `purpose: "any maskable"` |

`index.html`: `theme-color` `#f4f1ea`; link the manifest; `apple-mobile-web-app-capable`; apple touch icon 180 (can be the 192 file).

Service worker cache **only**: `index.html`, built CSS/JS, icons, manifest. Precache from the Vite build file list or a short static list of `/` + hashed assets discovered at install.

**Never cache:** `/api`, `/api/v1`, cookies, visitor records, reports, SSE.

Strategy: shell = cache-first. Data = network-only.

Offline: home, login, and PIN pad HTML/CSS/JS still open. Live book, snapshot, unlock POST, visitor POST need the network. Same booth “offline” dot as today when SSE is down. No queued visits. No background sync. No push.

Install card on `/gate`:

- Copy: `t.installTitle` / `t.installHint` (Install Gate Daftar / Add this app to your tablet home screen for faster access).
- Show only if `beforeinstallprompt` fired (Android/Chrome) **or** iOS Safari (`navigator.standalone === false` and iPhone/iPad UA) with a one-line how-to (Share → Add to Home Screen).
- Dismiss stores `localStorage.gd_install_dismissed = 1`. Do not show again on that browser.
- No blocking modal. No auto prompt on first paint.

HTTPS required for a real install. Preview and localhost are enough to test the manifest.

## 9. Reports KPI cards

`/reports/:siteId` already has the cards (today total, visitors, out-pass, inside, waiting, overdue, still out, average). This pass only uses the new type scale and spacing from §3. Do not add residents, vehicle KPIs, or extra cards.

## 10. Accessibility (this pass only)

- Visible focus rings (already present; keep 3px primary).
- Every control has a label (PIN pad keys `aria-label`).
- Online/offline text, not color-only (no emoji status).
- Min 44px taps; PIN 64px.
- Do not claim a Lighthouse score in CI. Manual check: keyboard to Admin login, Gate pad, dismiss install card.

Full WCAG audit of People/CSV stays later (A10).

## 11. Locks

| Action | Unchanged |
|---|---|
| Admin login / signup / forgot-password | same APIs |
| Gate unlock by per-gate PIN | same APIs |
| Company walls | same |
| Visitor create | same, plus optional `vehicle` |
| Service worker | must not serve stale API JSON |

## 12. Screens (Arabic and English)

New keys in `frontend/src/i18n.js`: `homeDoors`, `online`, `vehicle`, `installTitle`, `installHint`, `installIos`, `dismiss`. Reuse `adminDoor`, `gateDoor`, `homeEmpty`, `newPinOnce`, `pinUnlock`, `pinBad`, `offline`.

## 13. How we prove it

1. Manifest is linked and has name, short_name, display standalone, theme `#f4f1ea`, 192 and 512 icons.
2. Service worker registers in a production build. A fetch to `/api/health` is not stored in Cache Storage.
3. With the network off after a first visit, `/` HTML still loads from cache. Unlock POST without network fails (no fake success).
4. Home: Gate is solid, Admin is outline, demo is not a third equal button, online/offline line present.
5. `/gate` PIN keys are 64px class; no password `<input>` for the PIN.
6. Booth and public visitor POST with `{ vehicle: "ABC 1234" }` store it; snapshot/entry JSON includes `vehicle`; CSV header `vehicle` is present; empty vehicle still 200.
7. Vehicle longer than 32 characters → 400 `vehicle_long`.
8. Install card can be dismissed and stays dismissed (localStorage).
9. `npx vite build` succeeds. Backend tests including a new `test/visitor-vehicle.test.js` pass.

## 14. Out of scope

- Offline booth / queued visits / background sync / push
- Required vehicle number
- Residents, public home KPIs, vehicle search
- Inter font, dark mode, portrait lock
- Extra npm packages (`vite-plugin-pwa` is allowed only if it is the smallest way; default is hand-written `sw.js` + manifest, **no new dependency**)
- People, CSV, Approve, magic-link, SMTP, legal review
- Changing login, PIN hash, or Supabase

## 15. Demo

Demo gate PIN still printed once at seed. Demo visitor forms get the optional vehicle field like any other gate.
