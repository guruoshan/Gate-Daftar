# Sign up without a gate, then forgot-password — design

Date: 2026-10-28
Status: approved
Product: Gate Daftar

## 1. Goal

Sign up is company and admin only. It does not ask for a gate name and does not create a gate. The owner lands on Your gates, adds the first gate there, then adds people (hand or CSV) on that gate’s People page.

The owner can reset a forgotten password with a one-time email link to the same work email used at login.

This is not the offline booth. Gate-man PIN by email, changing the work email, SMTP setup, and legal review stay later.

## 2. What exists today (must change)

- Sign up asks for company name **and** gate name, plus site type, country, time zone, owner name, email, password.
- Sign up creates one company, one first gate, and one owner user in the same step.
- The owner lands on Your gates with that first gate already listed. People and PIN are still a later step on People, but the gate field on sign up makes it look as if the booth is already set up.
- There is no forgot-password. Wrong password is a closed door with no recovery.

## 3. Sign up

Fields on `/setup`:

| Field | Required | Notes |
|---|---|---|
| Company name | yes | |
| Your name | no | same as today’s owner name |
| Work email | yes | one email = one company |
| Password | yes | at least 8 characters |
| Country | yes | same defaults as today |
| Time zone | yes | follows country unless they change it |
| Site type | yes | manufacturing / warehouse / workshop / logistics / construction. Stored on the **company**. First gate inherits it. |

No gate name. No PIN. No people.

Creates: one company, one owner user with a stored password hash. Zero gates.

They land on Your gates, signed in (cookie set).

One work email belongs to one company. Used email: tell them to log in instead. Short password: same message as today.

The old public “create a site” path (`POST /api/sites`) keeps the same handler as sign up, so it also creates a company with no gate.

## 4. Your gates after sign up

List is empty. Short line: add a gate first, then people.

Same **Add a gate** box as today (gate name only). New gate uses the company’s country, time zone, and site type. Then the list shows that gate with Open booth, People, Reports.

No people, CSV, or PIN until there is a gate. People on that gate is unchanged (hand add + CSV; Guard role shows PIN once).

Owner with zero gates cannot open booth, setup, or reports (closed door). Public QR for a missing gate is still not found.

Adding a second gate later is unchanged.

## 5. Forgot password

On Owner sign in: a **Forgot password** link.

1. Owner types the same work email used at sign up. Submit.
2. If that email exists, email a one-time link (`/reset/:token`). If it does not exist, the screen still says “if that email is on an account, we sent a link.” Do not say whether the email is known.
3. Link is hashed, 12 hours, one use (same family as manager approval). Opens a page: new password (min 8) + confirm. Submit sets the hash and burns the token. They land on login.
4. Until SMTP is set, the link is printed in the API log (same as manager mail today). Demo `example.com` only.

Guessing a token only hits that one reset. Another company’s token cannot reset this one.

After a successful reset, the old password fails. The new password logs in.

Out of this section: gate-man PIN reset by email, changing the work email.

## 6. Locks

Same company walls as today.

| Action | Allowed when |
|---|---|
| Sign up | public; creates a company with no gate |
| Log in | work email + password |
| Request password reset | public; always the same reply |
| Set new password via token | token bound to that one owner |
| Open Your gates | owner cookie’s company |
| Add a gate | owner cookie’s company |
| Open booth / People / reports | that gate’s company matches the cookie, and the gate exists |

Wrong company or no login: 401 / 403, no names from the other company.

## 7. Data shape

- `companies`: keep country. Add site type (`pack`) on the company so the first gate can inherit it. Existing companies: copy pack from their first gate if present, else `warehouse`.
- `sites`: unchanged. Still created only by **Add a gate** (or seed). Sign up no longer inserts a site.
- Password reset: new table `password_reset_requests` (id, user_id, company_id, magic_token_hash, expires_at, used_at, created_at). Must not store the raw token. Must not appear on the live book. Not an entry.
- Passwords stay hashes. Never print a real password or PIN.

## 8. When something is wrong

- Sign up used email: “that email already has a company.”
- Sign up short password: same message as today.
- Add a gate with empty name: required.
- Forgot-password unknown email: same “if that email is on an account…” message as a known email.
- Reset token expired or already used: same style of message as out-pass approval (link expired).
- New password under 8 characters: refuse.
- Confirm password does not match: refuse on the reset page.
- Owner with zero gates opens `/booth/...` or `/setup/...` for a guessed slug: closed door.

Do not return another company’s people or gate names in any of the above.

## 9. Screens (Arabic and English)

- Sign up: no gate name field.
- Your gates: empty-state line when there are no gates.
- Login: Forgot password link + email form.
- Reset page: new password + confirm.
- Copy in `frontend/src/i18n.js` for both languages. No em-dash placeholders.

## 10. How we prove it

Automated checks must cover:

1. Sign up with company + owner only creates a company and a login; zero gates.
2. Sign up still refuses a used email and a short password.
3. After login, Your gates is empty until Add a gate.
4. First gate inherits country, time zone, and site type from the company.
5. Forgot-password: existing email stores only a token hash; the raw link is not in the JSON. Unknown email returns the same “if that email is on an account…” message.
6. Reset link works once, then refuses reuse; expired link is refused.
7. New password min 8; after reset, old password fails and new password logs in.
8. Company walls unchanged: A cannot open B.

## 11. Out of scope

- Offline booth
- Gate-man PIN reset by email
- Changing the work email
- SMTP setup (keep stdout + inbox, same as manager mail)
- Mixing all gates into one report
- Production hosting, legal review, accessibility
- Replacing the whole people list from CSV

## 12. Demo

Seeded demo company still has its demo gate and demo people. Do not print real emails or PINs. Reset-mail lines in tests use `example.com` only.
