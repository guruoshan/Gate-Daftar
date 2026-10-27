# Company walls — design

Date: 2026-10-25
Status: approved
Product: Gate Daftar

## 1. Goal

Each paying company signs up with a work email and a password they choose. After login they only see their company home, their gates, and their people. Another company cannot open those pages, even if they guess a link or an id.

This is normal multi-company software. It is not the offline booth. Offline save-and-upload is a later spec.

## 2. What exists today (must change)

- Creating a site also creates a new company. There is no company home.
- Owner “login” is work email plus a one-time code, not a password.
- The owner cookie is tied to one gate (`session.siteId` must equal that gate). A second gate of the same company is a closed door.
- Workers, managers, and guards are stored on one gate (`people.site_id` is required).
- Gate-man PIN is checked against that gate only.
- The server already stamps `company_id` on companies, sites, people, entries, and sessions, but the lock still compares gate id, not company id.

## 3. Who belongs to whom

**Company** owns:

- Owner login (work email + password)
- The name list: workers, managers, gate men
- The list of gates

**Gate** owns:

- That gate’s day book (each visitor in and each out-pass is stamped with the gate used)
- That gate’s public QR (`/g/...`)
- That gate’s booth screen (which book the gate man is looking at)

**Other companies** own nothing here. They get a closed door, not an empty list.

A worker, manager, or gate man of Company X may act at every gate of Company X. They may never act at Company Y.

## 4. Accounts and screens

### 4.1 Sign up (owner / admin)

The owner creates the company account (this replaces today’s public “create a site” form):

- Company name
- First gate name
- Owner name
- Work email
- Password they choose (at least 8 characters)
- Country and language (same defaults as today)

This creates one company, one first gate, and one owner user with a stored password hash. They land on the company home.

One work email belongs to one company. If someone needs two companies, they use two emails.

### 4.2 Log in (owner / admin)

The owner types the same work email and password. After login they land on the company home: a list of that company’s gates. From there they open one gate’s booth, setup, or reports.

They can add another gate from the company home. New gates belong to the same company. People are not copied; the company list is already shared.

After a successful sign-up or login, the owner is signed in (cookie set). A Log out control on the company home clears that cookie.

The email-code login is removed. Those request/verify-code routes go away.

### 4.3 Gate man

The owner adds the gate man on the company name list. The gate man does not get email or password.

When the owner adds or resets a gate man, the server makes a PIN, stores only the hash, and shows the PIN once (same as today’s guard PIN). The old shared site PIN is no longer used to unlock.

At a booth they type that PIN. If it matches a gate man of that company, the booth opens on the gate in the URL. The same PIN works at every gate of that company. It does not work at another company.

After a successful PIN, that browser may open any booth of the same company until the cookie ends (same 12-hour window as today).

### 4.4 Manager

Managers stay on the company name list with a company email (existing company-email rule stays). They do not get a password in this change. Approval stays a one-tap email link.

An approval email can be for an out-pass at any gate of that company. The token is bound to that one pass. The link cannot approve another company’s pass. Guessing a token still only hits that one pass, never a list of another company.

### 4.5 Public visitor

The gate QR stays per gate. A visitor walking up to Gate A writes into Gate A’s book. The worker name list on that form is the company list, not a private copy per gate.

## 5. Locks (the walls)

Every request after login carries “this person belongs to Company X.” The server then checks the row’s `company_id`.

| Action | Allowed when |
|---|---|
| Open company home | Owner cookie’s company is that company |
| Open a gate’s booth, setup, or reports | That gate’s `company_id` matches the cookie’s company |
| List or change workers / managers / gate men | Rows belong to that company |
| Create a visitor or out-pass at a gate | The gate belongs to that company |
| Approve an out-pass | The pass’s company matches the manager’s company |
| Search, dashboard, export | Only gates of that company |
| Unlock booth with PIN | PIN matches a gate man of that gate’s company |

Knowing a gate id, slug, or person id is not enough. Wrong company or no login: closed door.

Owner cookie is company-scoped (`companyId` required; `siteId` not used as the lock). Booth cookie is company-scoped the same way; the URL still names which gate’s book to show.

Replace today’s `requireSiteAccess` check of `session.siteId === site.id` with `session.companyId === site.companyId` (and the same role list as today: owner vs booth).

## 6. Data shape (what must move)

- `users`: add a password hash. Stop using the one-time email code for owner login.
- Email uniqueness: one owner email in the whole system (not per company).
- `people`: company is the home. `company_id` is required. `site_id` may stay as “added at this gate” but must not limit where they can work.
- `entries`: unchanged idea — each visit keeps `site_id` and `company_id`. The book on screen is one gate. Company walls still filter by `company_id`.
- Existing rows: keep them. After migration, a person on Gate A of a company is treated as company-wide.

Passwords and PINs are stored only as hashes (same family as today’s PIN hash). Never print a real password or PIN.

## 7. When something is wrong

- Wrong email or password: “check email or password.” Do not say which one.
- Unknown email on login: same message as wrong password (do not reveal that the email exists).
- Sign-up email already used: tell them to log in instead.
- Wrong PIN: “wrong PIN.” After several tries, a short wait (keep today’s PIN lock).
- Opening another company’s link while logged in: closed door (forbidden), not a blank list and not another company’s names.
- Gate man not on that company list: booth stays locked.
- Logged-out owner routes (company home, add gate, setup, reports): ask them to log in.
- Log out: cookie cleared; owner pages ask for login again. Booth cookie is separate and is not cleared by owner logout.

Do not return another company’s people, phones, entries, or gate names in any of the above.

## 8. Out of scope (do not build in this change)

- Offline booth (save locally, upload when the internet returns)
- Forgot-password
- Gate man email + password
- Tick-boxes for “this person may use only Gate B”
- Mixing all gates into one report screen (owner always picks a gate after the home list)
- Production hosting, SMTP setup, legal review, accessibility
- Changing the public approval page beyond the company check

## 9. Screens (Arabic and English)

- Sign up (new)
- Log in with email + password (replace today’s email + code page)
- Company home: list of gates, button to add a gate
- Existing booth, setup, reports, public gate, approval — same jobs, company-wide people, company lock

Copy goes in `frontend/src/i18n.js` for both languages.

## 10. How we prove the walls

Automated checks must cover:

1. Company A’s owner cannot open Company B’s home, gates, people, snapshot, stream, search, dashboard, audit, or export.
2. Company A’s owner can open every gate of Company A after login, without a second email code.
3. A gate-man PIN of Company A unlocks Company A’s Gate A and Gate B, and does not unlock Company B.
4. A manager approval token from Company A cannot approve a Company B pass.
5. A guessed gate id without the right cookie is a closed door.
6. Sign-up with an email that already exists is rejected.
7. Wrong password does not create a session.
8. A worker on the company list can start an out-pass at Gate A and at Gate B of that company.
9. A visit created at Gate A does not appear on Gate B’s live book (it does appear in Gate A’s book).
10. Responses never include another company’s names or phones.

## 11. Demo

The seeded demo company stays on the demo slug. Seed sets the demo owner password hash the same way as a real sign-up. The password is printed once at seed (same pattern as today’s one-time booth PIN line) and never stored in git or in replies after that. Existing rule stands: do not recover or print stored secrets from data files.

## 12. Rollout note

This change is for the demo and for future paying companies. Do not onboard a real factory until legal review and retention are done (unchanged from the product bar). Demo slug stays the demo. Do not print real PINs, emails, or passwords from data files.
