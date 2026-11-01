# Sign up without a gate, home Admin/Gate, per-gate PIN, forgot-password — design

Date: 2026-10-28
Status: approved
Product: Gate Daftar

## 1. Goal

Sign up is company and admin only. It does not ask for a gate name and does not create a gate.

The public home has two doors: **Admin** and **Gate**. Admin uses work email and password. Gatekeeper types that door’s PIN. They are the same company: admin adds the gate, sees the PIN once, and gives it to the keeper.

The owner can reset a forgotten password with a one-time email link to the same work email used at login.

This is not the offline booth. One company QR, cross-gate find/exit, named personal PINs, changing the work email, SMTP setup, and legal review stay later.

## 2. What exists today (must change)

- The landing page offers Sign up, Open demo booth, and Owner sign in as three equal links. There is no Admin / Gate split.
- Sign up asks for company name **and** gate name. It creates a company and a first gate together.
- Unlock uses a **named guard** PIN that works at every gate of that company. The old per-site PIN hash is unused.
- There is no forgot-password.

## 3. Home

Two buttons only: **Admin** and **Gate**.

**Admin**

- First time: Sign up, then Your gates.
- Next times: email + password (Forgot password on that screen).

**Gate**

- Number pad only. Type the 6-digit PIN for that door. That gate’s booth opens.
- No email, no company list, no People.

Demo: keep a small **Open demo booth** under the two buttons, or behind Gate with the seeded demo PIN. Do not make demo look like a third equal door.

## 4. Sign up

Fields on `/setup` (reached from Admin → first time):

| Field | Required | Notes |
|---|---|---|
| Company name | yes | |
| Your name | no | same as today’s owner name |
| Work email | yes | one email = one company |
| Password | yes | at least 8 characters |
| Country | yes | same defaults as today |
| Time zone | yes | follows country unless they change it |
| Site type | yes | stored on the **company**. First gate inherits it. |

No gate name. No PIN. No people.

Creates: one company, one owner user with a stored password hash. Zero gates.

They land on Your gates, signed in (cookie set).

Used email: tell them to log in instead. Short password: same message as today.

`POST /api/sites` keeps the same handler as sign up (company, no gate).

## 5. Your gates and the gate PIN

List is empty after sign up. Short line: add a gate first, then people.

**Add a gate** (name only). New gate uses the company’s country, time zone, and site type. The server makes a 6-digit PIN, stores only the hash on **that gate**, and returns the PIN **once**. The screen shows it once. Admin writes it down and gives it to that door’s keeper.

Then the list shows that gate with Open booth, People, Reports.

Owner can **reset this gate’s PIN** from the gate card or People. New PIN shown once. Old PIN stops working.

People on that gate: workers and managers (hand add + CSV) unchanged. No named Guard list and no personal PIN in this change.

No people or CSV until there is a gate.

Adding a second gate later: another name, another PIN, shown once. Gate 1 PIN does not open Gate 2.

## 6. Gate tab unlock

`POST /guard/unlock` with `{ pin }` (slug optional).

Look up the site whose PIN hash matches. None: `bad_pin` (do not say which). Two hashes (must not happen): treat as `bad_pin`. Generate new PINs until the hash is unused across sites.

On match: booth cookie for that site’s company, booth opens on that site. Same 12-hour window as today. Same PIN lock after repeated wrong tries (key by site + IP when site is known; by IP only when not).

Wrong PIN does not list companies or gates.

Named-guard PIN unlock is removed for this change. Seeded demo uses the demo **gate** PIN (printed once at seed), not a personal Guard Ali PIN.

## 7. Forgot password

On Admin sign in: a **Forgot password** link.

1. Owner types the same work email used at sign up. Submit.
2. If that email exists, email a one-time link (`/reset/:token`). If it does not exist, the screen still says “if that email is on an account, we sent a link.” Do not say whether the email is known.
3. Link is hashed, 12 hours, one use (same family as manager approval). Opens a page: new password (min 8) + confirm. Submit sets the hash and burns the token. They land on Admin login.
4. Until SMTP is set, the link is printed in the API log (same as manager mail today). Demo `example.com` only.

Guessing a token only hits that one reset. Another company’s token cannot reset this one.

After a successful reset, the old password fails. The new password logs in.

Out of this section: gate PIN reset by email, changing the work email.

## 8. What stays the same

- Company walls: `session.companyId === site.companyId`. Other company: 401 / 403, not an empty list.
- Booth live book, visitor, out-pass, not-on-the-list add request, manager `/a/:token`.
- One **QR per gate** (`/g/:slug`). One company QR and “exit at another gate” are later.
- Reports stay per gate. Owner still picks a gate from Your gates.

## 9. Locks

| Action | Allowed when |
|---|---|
| Sign up | public; creates a company with no gate |
| Admin log in | work email + password |
| Request password reset | public; always the same reply |
| Set new password via token | token bound to that one owner |
| Open Your gates | owner cookie’s company |
| Add a gate | owner cookie’s company; PIN returned once |
| Reset gate PIN | owner cookie’s company for that gate |
| Unlock Gate tab | PIN hash matches that one gate |
| Open booth / People / reports | that gate exists and cookie company matches |

Wrong company or no login: 401 / 403, no names from the other company.

## 10. Data shape

- `companies`: keep country. Add site type (`pack`) on the company. Existing companies: copy pack from their first gate if present, else `warehouse`.
- `sites`: created only by Add a gate (or seed). `guard_pin_hash` is the PIN for that gate again. Sign up no longer inserts a site.
- Password reset: table `password_reset_requests` (id, user_id, company_id, magic_token_hash, expires_at, used_at, created_at). Not an entry. Raw token never stored.
- Passwords and PINs stay hashes. Never print a real password or PIN after the one-time show.

## 11. When something is wrong

- Sign up used email: “that email already has a company.”
- Sign up short password: same message as today.
- Add a gate with empty name: required.
- Forgot-password unknown email: same “if that email is on an account…” message as a known email.
- Reset token expired or already used: link expired.
- New password under 8, or confirm mismatch: refuse.
- Wrong gate PIN: “wrong PIN.” After several tries, short wait.
- Owner with zero gates opens a guessed booth/setup slug: closed door.

Do not return another company’s people or gate names in any of the above.

## 12. Screens (Arabic and English)

- Home: Admin / Gate.
- Sign up: no gate name field.
- Your gates: empty-state line; PIN once after Add a gate; reset PIN control.
- Admin login: Forgot password.
- Reset page: new password + confirm.
- Gate tab: PIN pad (no guard name dropdown).
- Copy in `frontend/src/i18n.js` for both languages. No em-dash placeholders.

## 13. How we prove it

Automated checks must cover:

1. Sign up with company + owner only creates a company and a login; zero gates.
2. Sign up still refuses a used email and a short password.
3. After login, Your gates is empty until Add a gate.
4. First gate inherits country, time zone, and site type from the company.
5. Add a gate returns a 6-digit PIN once; later reads do not include the PIN; hash is stored.
6. That PIN unlocks that gate’s booth and does not unlock a second gate of the same company, nor another company.
7. Reset gate PIN: old PIN fails, new PIN works once as the unlock.
8. Forgot-password: existing email stores only a token hash; the raw link is not in the JSON. Unknown email returns the same “if that email is on an account…” message.
9. Reset link works once, then refuses reuse; expired link is refused.
10. New password min 8; after reset, old password fails and new password logs in.
11. Company walls unchanged: A cannot open B.

## 14. Out of scope

- Offline booth
- One company QR
- Finding a visit at another gate / exit at another door
- Named personal gate-man PINs
- Gate PIN reset by email
- Changing the work email
- SMTP setup (keep stdout + inbox)
- Mixing all gates into one report
- Production hosting, legal review, accessibility
- Replacing the whole people list from CSV

## 15. Demo

Seeded demo company still has its demo gate. Seed prints the demo **gate** PIN once (same pattern as today’s one-time PIN line). Do not print real emails or PINs. Reset-mail lines in tests use `example.com` only.
