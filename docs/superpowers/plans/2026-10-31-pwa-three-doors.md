# Three doors polish, installable PWA, optional vehicle number — implementation plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cream tablet look on the three doors, installable app-shell PWA, optional visitor vehicle number. Login, PIN, and company walls stay the same.

**Architecture:** Keep PostgreSQL, Express, Vite/React. One new column `entries.vehicle`. Hand-written `manifest.webmanifest` + `sw.js` (no `vite-plugin-pwa`, no extra npm). Shell cache-first; `/api` network-only.

**Tech stack:** Node ESM, `pg`, Vitest + supertest. AR/EN in `frontend/src/i18n.js`. IBM Plex Arabic stays.

**Spec:** `docs/superpowers/specs/2026-10-31-pwa-three-doors-design.md`

---

## File map

Create:

- `backend/migrations/008_visitor_vehicle.sql`
- `backend/test/visitor-vehicle.test.js`
- `frontend/public/manifest.webmanifest`
- `frontend/public/sw.js`
- `frontend/public/icons/icon-192.png`
- `frontend/public/icons/icon-512.png`
- `frontend/scripts/write-pwa-icons.mjs` (one-off, Node zlib only, no extra npm)

Edit:

- `backend/src/store.js` — `entryKeys`, `createVisitor` (`vehicle`, max 32)
- `backend/src/index.js` — both visitor POSTs pass `vehicle`; CSV `headers` add `vehicle` after `hostName`
- `frontend/index.html` — theme-color, manifest, apple meta
- `frontend/src/main.jsx` — register `sw.js` in production builds
- `frontend/src/styles.css` — tokens, PIN 64px, primary 56px, KPI type
- `frontend/src/i18n.js` — new keys both AR and EN
- `frontend/src/pages/Landing.jsx` — Gate solid, Admin ghost, `homeDoors`, online line
- `frontend/src/pages/CompanyHome.jsx` — each gate its own card; PIN already above links
- `frontend/src/pages/GateUnlock.jsx` — 64px keys already via CSS; `aria-label`; install card
- `frontend/src/pages/Booth.jsx` — pad `aria-label`; visitor `vehicle`; card line
- `frontend/src/pages/Gate.jsx` — visitor `vehicle`

Do not edit `Dashboard.jsx` (KPI cards already exist; Task 3 CSS only).

Do not edit `.env`. Do not add npm packages. Do not print real emails or PINs. Do not change login, PIN hash, unlock, or company walls. Do not cache `/api`. Do not paint `.btn-in` (Admit) green. Commit only if the user asks.

Stop after two failed checks on the same task.

---

### Task 1: Migration + store + both visitor POSTs + CSV

**Files:**

- Create: `backend/migrations/008_visitor_vehicle.sql`
- Create: `backend/test/visitor-vehicle.test.js`
- Modify: `backend/src/store.js`
- Modify: `backend/src/index.js`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE entries ADD COLUMN IF NOT EXISTS vehicle text NOT NULL DEFAULT '';
```

`insertRow` maps `vehicle` to `vehicle`. No `truncateAll` change (column lives on `entries`).

- [ ] **Step 2: Store**

In `entryKeys`, add `'vehicle'` immediately after `'cardNumber'`.

In `createVisitor`, after `cardNumber`:

```js
vehicle: String(input.vehicle || '').trim(),
```

Before `insertRow`, if `entry.vehicle.length > 32` return `{ error: 'vehicle_long' }`. Empty is fine. Do not add `vehicle` to `searchEntries` text.

`createOutPass` does not set `vehicle`; default `''` from the column is enough if `entryKeys` requires a value. If `insertRow` reads `obj.vehicle` as `undefined`, set `vehicle: ''` on the out-pass object too so the INSERT does not write null.

- [ ] **Step 3: Routes and CSV**

`POST /sites/:siteId/visitors` and `POST /sites/:siteId/gate/visitor`: destructure `vehicle` from `req.body` and pass it into `createVisitor`.

CSV `headers` in `backend/src/index.js`: add `'vehicle'` after `'hostName'`. Do not add a display label. `fail()` already maps unknown errors to 400.

Do not put `vehicle` on `publicCreated`.

- [ ] **Step 4: Tests**

`backend/test/visitor-vehicle.test.js` using `createOwnedSite`, `resetAll`, booth cookie or owner cookie:

1. Booth POST `{ name, phone, vehicle: 'ABC 1234' }` → 200; `entry.vehicle === 'ABC 1234'`.
2. Snapshot (or GET entry) includes `vehicle`.
3. Public `POST /api/sites/:slug/gate/visitor` with vehicle → 201; later owner snapshot still has `vehicle`.
4. Empty / omitted vehicle → 200 and `entry.vehicle === ''`.
5. Vehicle 33 characters → 400 `{ error: 'vehicle_long' }`.
6. Export `?format=csv` body contains `,vehicle,` (header after hostName) and the stored plate.
7. Search for the plate string does **not** have to return the row (do not index vehicle).

Phone: use a valid SA number already used in other tests (`966555888999`).

- [ ] **Step 5: Run tests**

Run: `cd /workspace/backend && npm test -- test/visitor-vehicle.test.js`

Expect pass. If migration is missing on the test DB, `runMigrations` in setup applies `008`. If this fails twice, stop.

---

### Task 2: i18n keys

**Files:**

- Modify: `frontend/src/i18n.js`

- [ ] **Step 1: Add both languages**

Arabic:

```
homeDoors: 'البوابة للحارس. الإدارة لصاحب الشركة.',
online: 'متصل',
vehicle: 'رقم المركبة',
installTitle: 'ثبّت قيت دفتر',
installHint: 'أضف هذا التطبيق إلى الشاشة الرئيسية للجهاز اللوحي لفتح أسرع.',
installIos: 'مشاركة، ثم إضافة إلى الشاشة الرئيسية.',
dismiss: 'إخفاء',
```

English:

```
homeDoors: 'Gate is for the keeper. Admin is for the company owner.',
online: 'Online',
vehicle: 'Vehicle number',
installTitle: 'Install Gate Daftar',
installHint: 'Add this app to your tablet home screen for faster access.',
installIos: 'Share, then Add to Home Screen.',
dismiss: 'Dismiss',
```

Reuse `offline`, `adminDoor`, `gateDoor`, `openDemo`, `pinUnlock`, `pinBad`, `newPinOnce`. No em-dash. Do not rewrite `homeHint`.

---

### Task 3: Visual tokens (CSS only)

**Files:**

- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Color tokens**

Set `--accent` and `--cta` to `#1f6b4f`. Do **not** set `--accent-2` to the new green (Admit `.btn-in` uses it). Leave `--accent-2: #1f4d3a` or point `.btn-in` at `--in` / `#175cd3` so Admit stays blue. `--ok`, `--wait`, `--bad`, `--ink`, `--muted`, `--bg`, `--r: 14px` stay.

Optional: `--cta-hover: #2e8665` and use it on `.btn:hover` instead of `filter: brightness`. Smallest: keep brightness hover.

- [ ] **Step 2: Sizes**

`.btn` (and `.btn-ok` / `.btn-bad` if they share the block) `min-height: 56px`. `.ghost` / `.lang-btn` can stay 48px. `.pin-pad button` `min-height: 64px`. Keep `transform: scale(0.98)` under 200ms.

- [ ] **Step 3: Reports type**

`.stat-num` from `1.8rem` to `2.2rem`. Do not add or remove cards. Do not edit `Dashboard.jsx` except if a class name is required (prefer CSS only).

---

### Task 4: Three doors UI

**Files:**

- Modify: `frontend/src/pages/Landing.jsx`
- Modify: `frontend/src/pages/CompanyHome.jsx`
- Modify: `frontend/src/pages/GateUnlock.jsx`
- Modify: `frontend/src/pages/Booth.jsx`

- [ ] **Step 1: Home**

Gate: `className="btn"` to `/gate`. Admin: `className="ghost"` to `/login`. Put Gate first. Keep demo muted link. Under the title (or under `lede`) add `t.homeDoors`.

Online line: `useState` + `online` / `offline` window events; text `t.online` / `t.offline`. No emoji. No visitor counts. Keep vs-paper / how-it-works.

- [ ] **Step 2: Your gates**

Each site is its own `article.card` (not one `ul.card` list). Order inside the card: name, then PIN (`token-xl` + `t.newPinOnce`) if this site just got a PIN, then links. Same APIs.

- [ ] **Step 3: PIN pads**

On `GateUnlock.jsx` and locked pad in `Booth.jsx`, set `aria-label` on each key: digit, backspace `t.pinUnlock` or a short `aria-label="backspace"` / Arabic via `t` if you add no new key, English word is ok for SR only; prefer `aria-label={k === '⌫' ? 'backspace' : k}`. Spacer stays `disabled`. Do not add an `<input>`. CSS handles 64px.

---

### Task 5: Optional vehicle on both forms + booth card

**Files:**

- Modify: `frontend/src/pages/Booth.jsx`
- Modify: `frontend/src/pages/Gate.jsx`

- [ ] **Step 1: State**

Add `vehicle: ''` to both visitor `useState` objects.

- [ ] **Step 2: Field**

After host, before ID:

```jsx
<label htmlFor="vv">{t.vehicle}</label>
<input id="vv" value={v.vehicle} onChange={(e) => setV({ ...v, vehicle: e.target.value })} />
```

Not required. Existing `api.visitor` / `api.gateVisitor` already POST the whole `v` object.

- [ ] **Step 3: Booth card**

Visitor meta line:

```js
[entry.company, entry.purpose, entry.hostName, entry.vehicle].filter(Boolean).join(' · ')
```

No new success screen.

---

### Task 6: PWA shell

**Files:**

- Create: `frontend/public/manifest.webmanifest`
- Create: `frontend/public/sw.js`
- Create: `frontend/public/icons/icon-192.png`
- Create: `frontend/public/icons/icon-512.png`
- Create: `frontend/scripts/write-pwa-icons.mjs`
- Modify: `frontend/index.html`
- Modify: `frontend/src/main.jsx`
- Modify: `frontend/src/pages/GateUnlock.jsx`

- [ ] **Step 1: Manifest**

`frontend/public/manifest.webmanifest`:

```json
{
  "name": "Gate Daftar",
  "short_name": "قيت دفتر",
  "start_url": "/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#f4f1ea",
  "theme_color": "#f4f1ea",
  "lang": "ar",
  "dir": "rtl",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 2: Icons**

`write-pwa-icons.mjs`: Node built-in `zlib` + `fs` only. Draw a cream `#f4f1ea` square and a green `#1f6b4f` circle or “GD” block; write 192 and 512 PNGs under `frontend/public/icons/`. Run once: `node frontend/scripts/write-pwa-icons.mjs`. Commit the PNGs. No extra npm.

- [ ] **Step 3: Service worker**

`frontend/public/sw.js`:

- Cache name `gd-shell-v1`.
- `install`: `cache.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'])`.
- `fetch`: if URL path starts with `/api` (or `/api/v1`) → `fetch(event.request)` only, never `cache.put`. Same for `EventSource` (do not intercept POST unlock / visitor).
- Same-origin GET for `document`, `style`, `script`, `image`, `font`, or dest empty HTML → cache-first; on network success, `cache.put` shell only.
- Never cache Set-Cookie responses. Never cache POST.

- [ ] **Step 4: Register + HTML**

`index.html`: `theme-color` `#f4f1ea`; `<link rel="manifest" href="/manifest.webmanifest" />`; `apple-mobile-web-app-capable`; `apple-touch-icon` `/icons/icon-192.png`.

`main.jsx`: if `import.meta.env.PROD` and `'serviceWorker' in navigator`, `navigator.serviceWorker.register('/sw.js')`. Do not register during Vite HMR (`import.meta.env.DEV`). Preview production build is enough for proof 2.

- [ ] **Step 5: Install card on `/gate` only**

In `GateUnlock.jsx`, a quiet `article.card` (not a modal):

- Hidden if `localStorage.gd_install_dismissed === '1'`.
- Shown if `beforeinstallprompt` fired (listen, `preventDefault`, keep event; button calls `prompt()`), **or** iOS Safari (`/iPad|iPhone|iPod/` UA and `!navigator.standalone`) with `t.installIos`.
- Title `t.installTitle`, hint `t.installHint`, dismiss button `t.dismiss` writes `localStorage.gd_install_dismissed = '1'` and hides.
- No auto `prompt()` on first paint.

- [ ] **Step 6: Build**

Run: `cd /workspace/frontend && npx vite build`

Expect success. Confirm `dist/manifest.webmanifest` and `dist/sw.js` exist. If build fails twice, stop.

---

### Task 7: Proof sweep

- [ ] **Step 1: Backend suite**

Run: `cd /workspace/backend && npm test`

Expect pass (includes `visitor-vehicle`). If fail twice, stop.

- [ ] **Step 2: File proofs (no browser required)**

- `frontend/index.html` theme-color `#f4f1ea` and manifest link.
- Manifest has `display: standalone`, `orientation: any`, icons 192 and 512.
- `sw.js` contains `/api` skip (string check).
- `Landing.jsx`: Gate `btn`, Admin `ghost`.
- `GateUnlock.jsx` / `Booth.jsx`: no `<input type="password">` on the pad.
- `.pin-pad button` is 64px in CSS.

Manual later (not a task gate): install card dismiss; offline `/` after production preview; `/api/health` absent from Cache Storage.

---

## Out of scope (do not do)

- Offline booth, queued visits, background sync, push
- Required plate, vehicle search, residents, public home KPIs
- Inter font, dark mode, portrait lock, extra npm
- People / CSV / Approve / SMTP / login / PIN hash / Supabase
- `vite-plugin-pwa`
