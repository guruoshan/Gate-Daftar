# Add person from gate and Excel roster — design

Date: 2026-10-27
Status: approved
Product: Gate Daftar

## 1. Goal

If a worker is not on the company list, the gate man (booth) or the worker (gate QR) can type the name, pick a manager from the dropdown, and send that manager one email to approve adding them. After Approve, the worker is on the company list. Only then can an out-pass start (second email, same as today).

The owner can also add people by hand (already exists) and can upload a CSV any time on the people page. The file adds new people, updates matches, and keeps everyone else. Each employee is linked to a manager by manager name.

This is not the offline booth. Forgot-password and gate-man Excel upload are later.

## 2. What exists today (must change)

- Out-pass on the booth and on the public QR is roster-only: pick employee and manager from the list. No typing a new worker.
- People are added one by one on the gate setup / people page by the owner.
- There is no upload of a people file.
- Export of the day book as CSV / Excel already exists. That export is visits, not the name list.
- Manager approval email already exists for out-pass (one tap, no login). We reuse that pattern for “add this person,” as a separate request.

## 3. Two steps (must not merge)

1. **Add request.** Name (required), optional employee ID, manager from the company manager list. Email goes to that manager’s work address. Until they Approve, the person is not on the list and does not appear in the employee dropdown.
2. **Out-pass.** After they are on the list, start a normal out-pass as today (pick them, pick manager, second email for the outing).

One manager tap does not both add them and approve an outing.

Owner adding by hand or by file skips the add-request email. Those people are on the list at once.

## 4. Booth (gate man)

On the out-pass form:

- If the worker is on the list: pick them and a manager, same as today.
- Always show an extra control: “Not on the list.” That opens name, optional employee ID, manager dropdown (company managers only). Submit sends the add request.
- If the typed employee ID is already on this company, refuse and tell them to pick that person from the list. If name-only matches one employee, tell them to pick from the list.
- After submit: show the same style of “email sent to the manager” as out-pass. Do not show the approval link. Do not create an out-pass.
- If the company has no managers yet: do not allow an add request. Tell them the owner must add a manager first (hand or file).

The visitor form does not change.

## 5. Gate QR (worker’s phone)

Same two-step as the booth.

If their name is not in the employee list: they type name, optional employee ID, pick a manager, submit. That is an add request, not an out-pass.

After the manager Approves, they (or the gate man) start a normal out-pass.

The public QR still does not list phones, emails, or PIN hashes. Manager dropdown is names only (same as today’s public roster).

## 6. Excel / CSV (owner, any time)

On the people page (`/setup/:gate`):

- Download a sample CSV that opens in Excel.
- Upload a CSV any time (new people joined, or corrections). Not from the booth. Not from the public QR.

**Format:** CSV only this change (Excel: File, Save as CSV). A real `.xlsx` parser needs an extra library; out of scope. If they upload a non-CSV file, refuse with a short message to save as CSV.

**Columns** (header row, English names in the sample; Arabic UI labels on the page):

| Column | Required | Notes |
|---|---|---|
| Role | yes | `employee` or `manager` (also accept the Arabic words used in the UI) |
| Name | yes | |
| Employee ID | no | Used to match an existing person |
| Work email | manager: yes. employee: no | Same company-email rule as hand add. Gmail / Hotmail refused |
| Phone | no | Same country / digit rules as hand add |
| Manager name | employee: yes if they should be linked | Matched by name |

Process the file in this order:

1. Manager rows first (add or update).
2. Employee rows next. Link each to the manager whose name matches: prefer a manager in this file, else a manager already on the company list. Comparison is case-insensitive and ignores extra spaces. Arabic letters use the same normalize path as search.

Match an existing person on this company:

- If Employee ID is present: match that ID on this company.
- Else: match Name on this company (same normalize as above). If two people share that name and there is no ID, skip the row (ambiguous).
- Update the matched row’s name, email, phone, and manager link. Do not change role. Do not change gate men (if the match is a guard, skip).
- If no match: add a new person with the role from the file.
- Do not remove or retire anyone missing from the file.

Skip a row (do not stop the whole file) when:

- Role missing or not employee/manager
- Name empty
- Manager work email missing or public domain
- Employee’s manager name matches zero managers
- Employee’s manager name matches two or more managers (same name)
- Phone fails the country digit check
- Employee ID already belongs to a different person on this company in a conflicting way (two rows in the file with the same ID but different names)

After upload, show counts: added, updated, skipped. List skipped rows with line number and a short reason. Never print emails or phones in that list beyond what the owner just uploaded (show name + reason).

Gate men are not in this file.

## 7. Pending add (data)

New request kind, not an out-pass. Suggested name: `person_add` (or a small table `person_add_requests`). It stores:

- Company and the gate used
- Typed name, optional employee ID
- Manager id (must be a manager of that company)
- Status: waiting, approved, denied
- One-time email token, hashed, same family and 12-hour expiry as out-pass tokens
- Who asked (booth session name, or “gate” for QR)

The manager email reuses `/a/:token`. Approve creates the employee on the company list and links that manager. Deny leaves them off the list. The link works once.

Approve:

- Creates the employee on the company list, `managerId` set to that manager, `site_id` = the gate used (same “added at this gate” as today), `company_id` = that company
- Marks the request approved, token spent
- Does not create an out-pass

Deny: request denied, person stays off the list.

Guessing a token only hits that one request. Another company’s token cannot approve this one.

If a person with the same employee ID is already on the list when Approve runs: do not create a second person; mark the request approved and leave the existing row (or return already-on-list). Do not leak another company’s names.

Until Approve, they do not appear in employee dropdowns, snapshot people lists used for out-pass, or Excel-export of the roster (there is no roster export in this change).

## 8. Locks

Same company walls as today.

| Action | Allowed when |
|---|---|
| Booth add request | Booth cookie’s company is that gate’s company |
| QR add request | Public write on that gate only (same as public out-pass). No owner/booth cookie required |
| Owner hand add / CSV | Owner cookie’s company is that gate’s company |
| Approve / deny add | Token bound to that one request |
| Open another company’s people or upload | Closed door |

Wrong company or no login on owner upload: 401 / 403, no names from the other company.

## 9. When something is wrong

- Empty name or no manager picked: required
- No managers on the company: cannot send an add request
- Duplicate employee ID already on this company (hand add or Approve): refuse, they already exist
- Excel: skip bad rows, show skipped list, do not fail the whole file
- Add-request email: same “mail not configured” handling as out-pass
- Token expired or already used: same messages as out-pass approval
- CSV parse failure: short error, nothing applied

Do not return another company’s people in any of the above.

## 10. Screens (Arabic and English)

- Booth out-pass: “Not on the list” + add fields
- Public QR out-pass: same
- People page: sample download + CSV upload + result counts
- Manager email for add: name, optional employee ID, gate name, Approve / Deny (no outing reason)
- Copy in `frontend/src/i18n.js` for both languages. No em-dash placeholders.

## 11. How we prove it

Automated checks must cover:

1. Booth add request emails the picked manager and does not put the person on the list yet.
2. After Approve, the person is on the company list with that manager, and appears in the employee dropdown at every gate of that company.
3. Deny leaves them off the list.
4. Public QR can create the same add request; Approve still adds them.
5. Add-request token of company A cannot approve company B.
6. Owner CSV: manager row then employee row with that manager’s name → employee linked.
7. Second CSV: existing employee ID updates manager; a person not in the file stays on the list.
8. Two managers with the same name: that employee row is skipped, others in the file still apply.
9. Gmail on a manager row is skipped.
10. Responses never include another company’s names.

## 12. Out of scope

- Offline booth
- Forgot-password
- Gate man uploading a file
- Replace-the-whole-list / retire missing rows
- Linking by manager email or manager employee ID (name only this change)
- Parsing `.xlsx` (CSV that Excel can open)
- Mixing add + outing in one manager tap
- Changing visitor walk-in
- Production hosting, SMTP, legal review

## 13. Demo

No change to the seeded demo people beyond what already exists. Do not print real emails or PINs. Sample CSV uses fake `example.com` addresses only.
