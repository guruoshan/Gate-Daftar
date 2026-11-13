# Gate Daftar — Strategy Handout

Working name only: **Gate Daftar**. Not a brand decision.
Date: 2026-10-11. Strategy only. No architecture, schemas, or build plan.
Research window: competitor pages fetched in this session. Review sites (G2, Capterra, Software Advice, GetApp) returned 403 — all review scores below are **unverified**.

**One finding first:** the beachhead “GCC SME” is too wide, and “manager must be logged in to approve” will lose to WhatsApp. Everything below follows from those two facts.

---

## 1. Executive finding

The real competitor is not Envoy, Greetly, The Receptionist, Sign In App, or MyGatePass. It is a **paper daftar at the gate + a WhatsApp thread with the manager**.

Western “visitor management” products sell an iPad in a lobby. GCC industrial SMEs do not have that lobby. They have a booth, a guard who may not be fluent in English, workers who leave site for lunch or errands, and a manager who only answers on WhatsApp.

**Hero job:** replace the gate book for one manned-gate industrial site, for both **employee out-pass** and **visitor walk-in**, in a browser, in Arabic and English, with approval that feels like WhatsApp.

**Do not build** a lobby VMS, a workplace OS, a form builder, a mobile app, or a GCC-wide platform.

---

## 2. Competitor landscape

Sources are vendor homepages and pricing pages unless marked otherwise. Vendor claims are self-reported.

### 2.1 Paper daftar + WhatsApp (the actual incumbent)

- Guard writes name, ID, plate, time in/out.
- Employee outing: worker texts manager; manager replies “ok”; guard writes it down.
- Owner/HR reconstruct the day from handwriting when something goes wrong.
- Cost: free. Switching cost: habit, not software.
- **Unverified:** how many sites still run this. Treat as the default until a site proves otherwise.

### 2.2 Envoy (Visitors)

- Job: office lobby visitor check-in, iPad/kiosk, host notification, badges, deliveries, rooms.
- Pricing **verified** on envoy.com/pricing: Free = 100 entries/month; Premium = **USD 362 per location per month**, billed annually.
- Trial: signup.envoy.com — name, work email, phone, company, address, password. High-friction vs “live in 5 minutes.”
- App Store listing `id818479885` returned 404 in this session.
- Fit to our ICP: **poor**. Hardware-centric, receptionist-lobby, US/EU office price, no employee out-pass story.

### 2.3 Sign In App (SwipedOn merged into this brand)

- Job: workplace sign-in / visitor / contractor / employee sign-in via iPad or kiosk.
- Self-reported: 25,000 workplaces in 70+ countries. **Unverified.**
- Trial: trial.signinapp.com, 15 days, work email + language/country. Lower friction than Envoy.
- The Receptionist is now branded into this family; iPad/hardware-centric; quote/demo motion on The Receptionist site.
- The Receptionist for iPad: App Store **4.0 from 10 ratings** (fetched). Tiny sample — do not treat as a market signal.
- Fit: **poor** for a GCC factory booth. Same lobby-iPad category.

### 2.4 Greetly

- Job: tablet/kiosk visitor check-in, pre-registration, NDA, multi-language UI (vendor claim).
- Pricing page fetched; **specific numbers not fully extracted — unverified.** Assume quote or mid-market SaaS, not notebook-replacement.
- Fit: lobby/receptionist. Not guard-booth. Not employee outing.

### 2.5 The Receptionist

- Job: iPad visitor check-in for the front desk.
- Sales motion: quote/demo, not self-serve SME.
- Fit: same as Envoy/Greetly. Hardware is the product.

### 2.6 MyGatePass

- Job: UAE-first visitor / gate pass, Arabic + English, UAE Pass, PDPL positioning.
- Sales motion: **contact-to-join, not self-serve.**
- Self-reported on their stats page (page claimed last updated September 2026): 300k+ entries, 20% QR pre-registration, 5 facilities. **Treat as claimed, not audited.**
- Play Store: MyGatePass **10K+ downloads** (fetched). App Store Visitor app **4.2 from 5 ratings** (fetched). Both are weak evidence.
- Fit: **closest named software competitor in GCC**, but enterprise/contact-sales, UAE-shaped (UAE Pass), not “live in 5 minutes,” and not clearly an employee out-pass product for SMEs.

### 2.7 GatepassManagement.com

- Job: custom gate-pass implementation: AI face, WhatsApp/email approval, payroll, GPS (vendor claims).
- Sales: demo/quote only.
- Fit: **opposite of SME self-serve.** Confirms WhatsApp approval is a known local desire. Also confirms the trap: face + payroll + GPS is how these products become projects.

### 2.8 TouchPoint

- touchpoint.in resolved to restaurant POS, not visitor management.
- touchpointonline.com, touchpoint.ae, touchpointindia.com, touchpointonline.in failed in this session.
- **Unverified / likely a different product.** Do not put TouchPoint in the visitor-management set until a real product URL exists.

### 2.9 What this means

| Cluster | Examples | What they optimize | Why they miss the daftar |
|---|---|---|---|
| Lobby iPad VMS | Envoy, Greetly, Receptionist, Sign In App | Host greeting, compliance, badges | Wrong room, wrong country, wrong buyer, hardware |
| GCC contact-sales VMS | MyGatePass | UAE facilities, ID integrations | Not self-serve; not SME 5-minute |
| Custom projects | GatepassManagement | Face, payroll, GPS | Implementation, not a product |
| Incumbent | Paper + WhatsApp | Speed for guard + manager | No search, no overdue, no audit |

There is a hole: **self-serve, web-only, Arabic+English, guard-booth, employee outing + visitor walk-in, WhatsApp-speed approval, per-site price a factory can pay.**

That hole is the company.

---

## 3. Comparison matrix vs our decisions

Legend: Y = they do it as a core job. N = not the job. P = possible / claimed / paid extra. ? = unverified.

| Capability | Paper+WA | Envoy | Sign In App | Greetly | Receptionist | MyGatePass | GatepassMgmt | Our stated design |
|---|---|---|---|---|---|---|---|---|
| Manned gate booth, not lobby iPad | Y | N | N | N | N | P | P | Y — correct |
| Employee out-pass / outing | Y (WA) | N | P (sign-in, not outing) | N | N | ? | P | Y — the wedge |
| Visitor walk-in | Y | Y | Y | Y | Y | Y | Y | Y |
| Approval without a dashboard login | Y (WA reply) | N (app/email host) | N | N | N | ? | P (WA/email claimed) | **Our plan said logged-in manager — wrong** |
| Arabic UI at the booth | N (handwriting) | N | P | P | N | Y | ? | Y — table stakes |
| Live in 5 min, no sales call | Y | N | N | N | N | N | N | Y — correct |
| No hardware, no app store | Y | N | N | N | N | N (apps exist) | N | Y — correct |
| No visitor accounts | Y | Y | Y | Y | Y | ? | ? | Y — correct |
| No employee user accounts | Y | N/A | N | N/A | N/A | ? | ? | Y — QR/link or guard Create Pass; no PIN |
| Guard shared-station PIN switch | N | N | N | N | N | ? | ? | Y — correct |
| ID OCR / biometrics / stored face | N | P | P | P | P | P (UAE Pass) | Y (face) | N in MVP — correct |
| Self-serve pricing page | Free | Y | Trial | ? | Quote | N | Quote | Y — required to beat paper |
| Per-location price | Free | Y (USD 362) | Quote | ? | Quote | Quote | Project | Y — correct shape |
| Starter templates, not form builder | N | Templates | Templates | Templates | Templates | ? | Custom | Y — correct |
| Dual-mode intake (gate QR + guard manual entry) | Y (clipboard) | P | P | P | P | P | P | Y — digital clipboard, not QR-only |
| Searchable “who is inside / who is out” | N | Y | Y | Y | Y | Y | Y | Y — why software wins |
| Emergency unapproved exit log | Informal | N | N | N | N | ? | ? | Y — keep tiny |

Reading the matrix: we only lose if we (a) require manager login, (b) make QR the only intake path with no guard “create pass” fallback, (c) require employee apps or PINs for laborers, or (d) sell “GCC” instead of one site type.

---

## 4. Challenges to our decisions

Only the decisions that are wrong, risky, or too ambitious. The rest stand.

### 4.1 Wrong: manager must be logged in to approve

Paper+WhatsApp wins because approval is a reply, not a session. Managers at 30–150 person sites live in WhatsApp, not in HR software. If an outing request waits for “open laptop, remember password, find the row,” the guard will accept a forwarded screenshot and stop using us.

**Rule:** approval is a one-tap magic link (SMS or WhatsApp message). No account required to tap Yes/No. Logged-in dashboard is for later review, not for the critical path.

WhatsApp Cloud API is **not** a launch blocker. MVP can be: SMS/email magic link, plus a copyable Arabic/English message the worker or guard already sends on WhatsApp. Paid later: official WhatsApp template. Do not wait for Meta to start.

### 4.2 Wrong: beachhead = “GCC SME”

GCC is six labor-law regimes, two dominant ID schemes (Iqama vs Emirates ID), different PDPL clocks, different payment and VAT, different guard-language mixes. That is a region, not a beachhead.

**Rule:** one country, one site type, one gate, 30–150 people. Expand country second, vertical third.

**Recommendation (assumption — founder location not confirmed):** **Saudi light-industrial / warehouse / small factory with a manned gate.** Why KSA not UAE: MyGatePass already sits on UAE Pass and contact-sales in the UAE. Why industrial not office: offices are already the Envoy/iPad story. If the founder is UAE-based and cannot sell KSA, flip to UAE warehouses and accept MyGatePass as the named rival — still one country, still warehouses, still not “GCC.”

### 4.3 Reframed: QR-at-gate is the digital clipboard, not a kiosk

Industrial visitors already know the habit: the guard hands them the physical register or a clipboard, they write their own name, they hand it back. A printed gate QR is that clipboard on a phone. It is not a lobby kiosk, not pre-registration, and not a smartphone test.

The real risk is QR-**only**. Dead phones, no data, shared phones, and people who will not scan still show up at 07:00. If those people have no path, the paper book stays open.

**Rule — dual-mode intake, both first-class, same record:**

- **(a) Self-register:** visitor or employee scans the printed gate QR and fills the no-login web form on their own phone. Same habit as writing on the clipboard. No app. No account.
- **(b) Guard “Manual Entry / Create Pass”:** always visible on the booth screen. Guard fills the form on behalf of anyone whose phone is dead, has no data, or cannot use the form. This is not a fallback buried in settings. It is the other half of handing over the clipboard.

Do not rank one mode as default and the other as advanced. The gate chooses in the moment. Searchability is why we exist; the intake must still feel like the book.

### 4.4 Risky: employee PIN + remembered device as the outing start

Shared phones, borrowed phones, workers without data, and one Android in a camp room are normal. A remembered device on a shared phone is the wrong person. A PIN an entire shift knows is not identity.

**Rule:** two legal ways to start an outing, both first-class, neither requiring an app or a remembered device: (1) worker scans the gate QR / opens the site link and starts an out-pass on their own phone (no-login web form; identity is the name the owner already typed, not a PIN); (2) guard taps “Manual Entry / Create Pass” and picks the name. Do not make (1) mandatory. Never require an employee app. PIN-and-remembered-device is out of MVP.

### 4.5 Risky: “internal card number” as visitor identity

Many SMEs have no visitor card stock. Requiring a card turns a notebook replacement into a hardware project.

**Rule:** card number is optional. Primary keys for exit: name + phone, or a short one-day token the product generates (said aloud / written on a slip). Cards can be a later paid pack for sites that already issue them.

### 4.6 Too ambitious: four personas get value in five minutes

Owner and guard must. Manager must on the first outing, which may be hour two, not minute five. HR’s job is end-of-day “who is still out.” Forcing HR value into minute five inflates onboarding (org chart, departments, exports).

### 4.7 Too ambitious: bilingual as differentiation

Arabic+English at the booth is **table stakes**, not the product. MyGatePass already claims it. Ship it on day one anyway — an English-only booth will not replace a daftar written in Arabic. Do not spend launch narrative on “multilingual.” Spend it on outing + WhatsApp-speed.

### 4.8 Risky: “emergency exit path” as a feature name

This is a liability magnet if it sounds like fire-safety certification. MVP meaning: guard can log “left without manager approval” with a reason and a timestamp. That is an audit row, not a safety system. Do not market it as emergency management.

### 4.9 Stands (do not reopen)

Web-only. No biometrics, no stored visitor/employee photos, no mobile app, no hardware. Cloud multi-tenant. Visitors never create accounts. Employees have no email accounts. Gate staff: personal login + PIN switch. Starter-pack templates, not a form builder. ID OCR postponed. Free to start, no credit card, no employee-list upload, no sales call. Per-site pricing. Activation = a real gate event, not a signup.

---

## 5. The one hero product

**Gate Daftar — the digital gate register for a manned industrial gate.**

One sentence: *From a browser in the booth, the gate records who came in and who went out — visitors and workers either scan the gate QR like a clipboard or the guard creates the pass for them; the manager approves with one tap; the owner can search yesterday.*

### Who it is for

The owner (or admin/HR person) of a **single** warehouse, workshop, or small factory who today keeps a paper book at the gate and approves outings on WhatsApp.

### What it is not

Not visitor management for a glass lobby. Not attendance. Not payroll. Not access control. Not residential “MyGate.” Not a GCC platform.

### Promise

Same speed as the book. Searchable. Overdue outing visible. No iPad purchase. Arabic on the booth screen.

### Why this, not a visitor product

Lobby VMS already exist and are funded. They will not become an out-pass. The outing is the job paper+WhatsApp still owns, and the job that makes a factory keep using you after the first visitor novelty fades.

### Hero surface

Guard booth screen with four tabs only:

1. **Waiting** — needs guard action (visitor to admit, outing to let out).
2. **Approved to go out** — manager said yes, body not through the gate yet.
3. **Inside now** — visitors and contractors currently on site.
4. **Search** — name, phone, token, optional card.

Employee outing and visitor walk-in both land on this screen. Nothing else is the product.

---

## 6. Rejected product alternatives

Exactly one hero. These lose.

| Alternative | Why it is attractive | Why we reject it |
|---|---|---|
| Lobby / receptionist VMS (Envoy clone) | Clear category, Western playbooks | Wrong room, hardware, price, no outing |
| Full workplace OS (gate + attendance + payroll + GPS) | Bigger ACV, GatepassManagement already sells it | Becomes a project; SMEs without IT cannot finish it |
| Employee timeclock / attendance | Obvious HR budget | Different buyer, different habit, crowded |
| Residential/compound visitor app | Consumer virality in GCC | Different gate, different payer, MyGate-shaped |
| Blank form builder for “any pass” | Feels flexible | Owners will not design forms; templates or death |
| Pre-registration portal as the hero | Nice for scheduled guests | Most industrial visitors are unscheduled |
| Hardware + camera + OCR pack as launch | Looks “serious,” demos well | Kills 5-minute activation; photos postponed on purpose |
| Multi-site group dashboard as launch | Matches how groups buy later | Zero sites will be multi-site before one site works |
| Mobile apps for guard or worker | “Everyone has a phone” | Store, install, Arabic device issues, shared phones; web links only |

---

## 7. The one MVP

**One site. Two events. One booth screen. One-tap approval. Arabic + English. Live in under five minutes.**

### In

- Owner starts from a phone or laptop: work email or invite. Creates **one site**. Picks a starter pack: **Warehouse / Factory gate** (not a blank builder).
- Types a handful of people (name + manager phone). No spreadsheet upload.
- Gets a **guard link**. Guard opens it on the booth browser, pins it, signs in once, later switches by PIN.
- **Dual-mode visitor intake:** a printed gate QR for self-service walk-ins (no-login web form on the visitor’s phone — the digital clipboard), backed instantly by a guard-side **Manual Entry / Create Pass** button for anyone whose phone is dead, has no data, or cannot use the form. Same record either way. Optional ID number typed, not scanned. Optional card. Guard admits. Exit by search. No app. No hardware to buy.
- **Self-service employee QR/link:** the same gate QR, or a short link placed at the gate / shared internally, where an employee scans and starts their own out-pass. Request routes to the manager’s WhatsApp magic link. Guard can also start the outing via **Manual Entry / Create Pass** by picking the name. Neither path uses a PIN, a remembered device, or an employee app.
- **Employee outing close:** manager one-tap Approve / Deny. Guard sees it on **Approved to go out**, logs Out, later logs In. Overdue = still Out after promised return.
- **Unapproved leave:** guard logs it. Audit row, not a safety product.
- Guard tabs: Waiting, Approved to go out, Inside now, Search.
- Languages: Arabic + English on booth and visitor form. Owner can work in either.
- Free to start: no card, no app, no hardware, no sales call.

### Out of MVP

Photos, OCR, face, UAE Pass, Absher, fingerprints, printers, badges, GPS, geofence, payroll, attendance, departments beyond a manager phone, multi-site, roles beyond owner/manager/guard, visitor pre-registration campaigns, NDAs, watchlists, parking, deliveries, meeting rooms, WhatsApp Business API as a hard dependency, employee email accounts, custom form builder, billing beyond “this site is on a trial.”

### Definition of done for a site

A stranger can be walked in, and a named employee can be walked out with a manager tap, on the same morning the owner signed up, with the guard using only the four tabs.

### What we will measure instead of signups

See section 10. If this MVP cannot produce a **real Out or In event in 14 days**, the product is wrong — do not add features, change the first run.

---

## 8. Personas and first-five-minutes value

Four people. Only two must smile at minute five.

### Owner (buyer)

- Minute 5: site exists, three names entered, guard link copied, screen looks like a book with tabs. Feels like “I can send this to the gate today.”
- Not minute 5: reports, billing, branches, permissions matrix.

### Gate guard (daily user)

- Minute 5: Arabic booth screen, large type, one primary button, the four tabs. Can admit a visitor without English, without a training call.
- If the guard needs a PDF manual, we failed.

### Manager (approver)

- Not minute 5. First outing: a message, one tap, done. If this requires “create password,” we failed (section 4.1).
- Later: a simple list of who they approved, who is still out.

### HR / admin

- Not minute 5. End of day 1: “who is on site / who is still out.” End of week 1: a searchable log that replaces photographing the daftar.
- Do not build HRIS features to make this persona feel important.

If onboarding asks the owner to serve all four at once, cut HR and manager-dashboard until the first outing exists.

---

## 9. Beachhead, ICP, positioning

### Beachhead (recommendation)

**Saudi warehouses and small factories with one manned gate, 30–150 people, Arabic-speaking guard, owner who has WhatsApp and email, no IT staff.**

Labeled **assumption:** KSA over UAE. Revisit if founder distribution is UAE-only.

### ICP filters (yes)

- Physical gate with a person sitting there.
- Mix of employees leaving during the day and walk-in visitors/contractors/deliveries.
- Today: notebook and WhatsApp.
- One site. Owner can dictate the gate process.

### ICP filters (no)

- Office tower with a receptionist and a budget for iPads.
- Residential compound.
- Airport, hospital, government, oil & gas grade-3 security.
- Multi-country groups asking for SSO and a 40-page RFP.
- Sites that will not run without cameras or UAE Pass.

### Positioning

- **Category we refuse:** Visitor Management System.
- **Category we occupy:** Digital gate register / out-pass.
- **Against paper:** “Same book, but you can search and you can see who did not come back.”
- **Against Envoy/Greetly:** “They are for the lobby. This is for the booth.”
- **Against MyGatePass:** “No sales call. No app. One site this morning.”
- **Against custom face+payroll:** “If you need that, you need a project. We replace the daftar.”

### Launch language

Lead with **out-pass**. Visitor walk-in is included so the book can actually be thrown away. If we lead with “visitor management,” we enter Envoy’s category and die on price and hardware.

---

## 10. Pricing, packaging, activation

### Packaging

One product. One site. One paid SKU later. No modules in year one.

Starter pack at signup: **Warehouse / Factory gate** only. Other packs (office lobby, school, camp) are a later country-expansion tactic, not launch.

### Price shape (not a quote)

- **Free to start, no card.** Time-or-event trial, then pay per site.
- **Per site / month**, not per user (labor-heavy sites would be punished) and not per entry (unpredictable; paper is predictable).
- Envoy Premium at **USD 362/location/month** is a ceiling we must sit far below. Paper is free. **Assumption, not a tested price:** a band of roughly SAR 150–400 per site per month is what to test with owners. Do not publish a number until five owners react to a number.
- Annual prepaid can exist later. Do not require it to start.
- Cards, WhatsApp official templates, extra sites: later paid extras. Not launch levers.

### Sales motion

Self-serve. The opposite of MyGatePass contact-to-join and GatepassManagement demo-to-project. A founder can still WhatsApp an owner; the product must not need that to complete first value.

### Activation metric (the only launch metric)

**A real gate event on a real site within 14 days: either one visitor In or one employee Out, logged by the guard.**

Not: signups, “completed onboarding,” “invited manager,” “opened the app.”

Secondary, still not vanity: **manager one-tap happened** (proves 4.1 is fixed) and **guard used the booth on a second calendar day** (proves the book was actually threatened).

If 14-day gate-event conversion is weak, the cause is almost certainly: manager login friction, QR-only intake with no guard Create Pass, English-only booth, or asking for an employee roster upload. Do not add a mobile app in response.

---

## 11. Assumptions, unknowns, explicit non-goals

### Assumptions (labeled)

- Founder can reach KSA industrial owners (or will name a different single country).
- Guards can use a browser on an existing booth PC or the guard’s Android Chrome; we never ship a device.
- Manager phone numbers are known to the owner; we do not need an HRIS.
- Arabic (MSA) + English is enough for MVP; we do not ship Urdu/Hindi/Bengali at launch even though many guards speak them. **Risk:** if the booth user cannot read MSA, voice/large-icon work is a later research item, not a hidden scope bomb.
- Not storing photos is acceptable to this ICP; sites that demand camera capture are not ICP.
- PDPL / KSA personal-data rules can be satisfied for name/phone/ID-number fields without becoming a legal product. **Unverified — needs counsel before charging.**
- “Internal card” is optional in the wild. If a pilot site insists on cards, they already have them.

### Unknowns (do not invent answers)

- True willingness to pay vs paper. No survey in this research.
- G2/Capterra sentiment for all named tools (403 in this session).
- Greetly exact price.
- Whether MyGatePass already sells employee outing to SMEs (their public story is visitor/facility).
- TouchPoint as a visitor product: not found.
- Envoy iOS app current listing.
- Whether WhatsApp copy-text + magic link is “good enough” vs official WhatsApp templates in KSA. Test in MVP; do not bet launch on Meta APIs.
- Fire/civil-defense expectations around gate logs. Do not claim compliance.

### Explicit non-goals (refuse even if a pilot asks)

- Hardware, printers, cameras, biometrics, facial recognition, stored photos.
- Native iOS/Android apps.
- ID OCR.
- UAE Pass / Absher / Nafath as MVP identity.
- Payroll, attendance, GPS, geofence.
- Blank form builder.
- Multi-country in the first year of the product (multi-site in one country is already post-MVP).
- Watchlists, government integrations, “security operations.”
- Marketing the product as visitor management or as emergency/safety software.

### Build order after this document (still not a build plan)

1. Fix approval to one-tap, no login.
2. Narrow beachhead to one country + warehouse/factory gate.
3. Ship dual-mode intake: printed gate QR (digital clipboard) and guard Manual Entry / Create Pass as equals, for both visitors and employee out-pass.
4. Then, and only then, consider a first site in the wild.

Do not write schemas, choose a stack, or sketch screens as a substitute for those four.

---

*End of handout. One hero: digital gate register for a manned industrial gate. One MVP: one site, visitor In + employee Out, four-tab booth, magic-link approval, Arabic+English, 5-minute start, 14-day real gate event.*
