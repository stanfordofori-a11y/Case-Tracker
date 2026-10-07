# Post-Analytical Tracker

A shared web tool that follows laboratory samples from outside collection centres to the lab, and tracks outstanding tests from the MT **"Outstanding Lab Specimens"** report. Bench staff paste the report in; the tracker works out what is new, what is still outstanding and what has finished, flags cases that are past their TAT, and produces shift delay reports. Everyone signed in sees the same list, and changes from other benches appear within a second or two.

- **Front end:** React 19, TypeScript, Vite, Tailwind CSS
- **Back end:** Supabase (Postgres database, sign-in, Row Level Security, live updates, one Edge Function)
- **Hosting:** Render (static site)

---

## Contents

1. [What it does](#what-it-does)
2. [Using the tracker](#using-the-tracker)
3. [Sample collection and reception](#sample-collection-and-reception)
4. [Report delivery (GHA-POSTF001)](#report-delivery-gha-postf001)
5. [How the tracker decides things](#how-the-tracker-decides-things)
6. [Roles and permissions](#roles-and-permissions)
7. [Setting it up from scratch](#setting-it-up-from-scratch)
8. [Configuration](#configuration)
9. [Project structure](#project-structure)
10. [Database overview](#database-overview)
11. [Security and data protection](#security-and-data-protection)
12. [Backups, archiving and housekeeping](#backups-archiving-and-housekeeping)
13. [Troubleshooting](#troubleshooting)
14. [Known limitations](#known-limitations)
15. [Local development](#local-development)

---

## What it does

- **Reads the MT report as pasted text.** No integration with MT is needed; staff copy the report and paste it in.
- **Splits every requisition by department** (Hematology, Microbiology, Chemistry, Immunology) using a keyword dictionary, so each bench sees its own work.
- **Tracks each test separately.** When a test disappears from the report it is marked finished, even if other tests on the same requisition are still pending.
- **Shows urgency at a glance.** Cases are grouped into *Overdue*, *Due within the hour* and *Due later*, each with a TAT bar that fills as the deadline approaches.
- **Flags A-List clients** using a keyword list of priority accounts.
- **Reviews before saving.** Every paste shows exactly what will change (new, still outstanding, to be marked completed, unreadable) before anything is written.
- **Undo.** The most recent paste can be undone for everyone, repeatedly, newest first.
- **Delay reports** for any time window: by department, A-List vs standard, and by individual test, with print and CSV export.
- **Courier collection by phone.** Couriers photograph the tubes at the collection centre; every barcode in the photo is read and the samples go live as *In transit*. The photo is kept as proof of pickup and deleted automatically after a set number of days.
- **Reception at pre-analytical** with a handheld barcode scanner: each scan marks the sample received, shows its centre and transit time, and flags duplicates and samples no courier logged.
- **Report delivery (GHA-POSTF001) by phone:** couriers scan reports at pick-up, the receiver signs on the phone, every non-delivery needs a reason, and post-analytical reviews and prints the form.
- **Sample journey in each case:** the tracker shows when and where a requisition's tubes were collected and when the lab received them.
- **Staff accounts** managed inside the app by admins.
- **Display options** per computer: five text sizes, light / dark / high-contrast themes, three typefaces, and compact or comfortable rows.

---

## Using the tracker

### Daily routine

1. In MT, open the **Outstanding Lab Specimens** report and copy the whole thing.
2. In the tracker, click **Paste MT list**, paste, and click **Review changes**.
3. Read the summary:
   - **New to the tracker**: requisitions seen for the first time
   - **Still outstanding**: already tracked, still pending
   - **Tests finished inside cases still open**: some tests on a requisition are done, others aren't
   - **Will be marked completed**: tracked cases that are no longer on the report
   - **Couldn't be read**: listed by R# with the reason (usually an unrecognised date)
4. Choose:
   - **Apply full list** when you pasted the *complete* report. Anything missing is marked completed.
   - **Add / update only** when you pasted part of the report (one page, one department). Nothing is marked completed.
5. Paste a fresh list regularly. Completion times are only as precise as the gap between pastes (see [below](#completion-times)). The header shows when the list was last updated and warns when it is more than two hours old.

> If the review warns that a large share of outstanding cases would be marked completed, check that you copied the whole report. If not, use **Add / update only** or cancel.

### Reading the worklist

| Element | Meaning |
|---|---|
| Coloured tube cap | Department: lavender Hematology, teal Microbiology, gold Chemistry, pink Immunology, grey unclassified |
| **A-List** badge | Client matches the A-List dictionary |
| Red left edge | Case is past its TAT |
| TAT bar | Blue while comfortable, amber in the last quarter of the time, red once overdue |
| *"41d 1h over"* / *"52m left"* | Time past or remaining to TAT |
| Test chips | Tests still pending; *"2 done"* shows tests already finished on that requisition |

Click any row to open the **case panel**: status, TAT, when the case was first seen and last seen pending, the requisition's other departments, and a timeline of every test with its own outcome.

Use the department buttons, search box (R#, client or test name), status and sort menus, and **A-List only** to narrow the list. **Export this view (CSV)** downloads exactly what is on screen.

### Undoing a mistake

The strip under the header shows the last paste and who made it. **Undo that paste** returns every case to exactly how it was before. You can undo repeatedly, newest paste first. Undo is no longer possible for pastes made before an archive, import or clear-all.

### Delay report

**Delay report** tab → choose *From* and *To* (or **Today so far**) → **Generate report**.

- **On time / Delayed / Unclear** are explained in [How the tracker decides things](#how-the-tracker-decides-things).
- **Delay rate** = delayed ÷ (on time + delayed). Unclear and not-yet-due cases are excluded.
- **Average delay** is shown as a range when finish times are only known within a paste interval.
- **Grace periods** (minutes allowed past TAT before a case counts as delayed) can be set separately for standard and A-List clients. They are shared by everyone.
- **Delay trend by test** judges each test on its own finish time, so a fast test is never blamed for a slow one on the same requisition.

Use **Print** (prints on white paper regardless of theme) or **Export CSV**.

### Display settings

Click **Display** (top right):

- **Text size:** Small, Standard, Large, Larger, Largest. Everything scales, including reports and the case panel.
- **Theme:** Light (default), Dark (night shift), High contrast (black on white, strongest outlines).
- **Typeface:** *Hyperlegible* (default; designed so 0/O and 1/l/I are easy to tell apart), *Standard*, or the computer's own font.
- **Row spacing:** Comfortable or Compact.

Settings are saved in that browser only, so each bench PC can have its own.

### Installing it as an app

The tracker can be installed so it opens in its own window with its own icon, like a normal app. The site must be the **https** Render address.

- **Chrome or Edge on a PC:** open the site, then click the install icon at the right of the address bar (a small monitor with a down arrow), or open the ⋮ menu and choose **Cast, save and share → Install page as app** (older versions: **Install Post-Analytical Tracker**).
- **Android (Chrome):** ⋮ menu → **Add to home screen → Install**.
- **iPhone (Safari):** Share button → **Add to Home Screen**.

Installed copies update themselves: each time the app opens with a connection, it loads the latest version from Render. It needs a connection to work, since all data lives in Supabase.

### Keeping the dictionaries accurate

**Settings** tab (changes apply to everyone):

- **Unrecognised test names** lists names from pastes that match no department keyword. For each, choose a department and click **Add**, or **Ignore** it if it is a qualifier rather than a test (for example "Ultra sensi" after CRP).
- **A-List clients:** keyword plus display name. A case is A-List if its client text *contains* the keyword (not case-sensitive). Use a short, unique fragment such as `LANCET`.
- **Department keywords:** keyword plus department. Saving re-sorts cases on every screen immediately; test history is never changed.
- **Reset to defaults** restores the built-in lists. The previous list is kept in the activity log.

---

## Sample collection and reception

### Courier (on a phone)

1. Open the tracker's web address on the phone and sign in with the courier account an admin created. Couriers only ever see the collection screen.
2. Tap the centre you are collecting from. This starts a **collection**.
3. Tap **Take photo of samples**. Several tubes can go in one photo; keep barcodes flat, in focus and well lit.
4. Check the barcodes the app found. Untick any that are wrong, or type a number that could not be read, then tap **Log samples**. Each logged tube is now *In transit* for the lab to see.
5. Repeat for more tubes. **Remove** takes out a tube logged by mistake (only before the lab receives it).
6. At the lab, tap **Hand over to the lab**. The collection is closed; **Recent handovers** then shows how many of its tubes the lab has scanned in.

Barcodes are read on the phone itself. The tube barcode carries the same R# number as the MT report, so each sample links to its case in the tracker automatically (the first run of 4 or more digits in the barcode is taken as the R#).

### Pre-analytical department (PC with a handheld scanner)

Open the **Samples** tab. The large scan box is always ready: scan each tube (the scanner types the barcode and presses Enter). Each scan gives a sound and a coloured result:

| Result | Meaning |
|---|---|
| Green: **Received** | The courier logged it. Shows centre, courier, collection time and time in transit. |
| Amber: **Already received** | Scanned before; nothing changed. |
| Red: **Not logged by a courier** | No collection record. It is recorded as received and flagged; find out where it came from. |

**Undo this scan** reverses a mistaken scan. Below the scan box:

- **In transit**, grouped by collection (centre, courier, handed over or still collecting), with each tube's time in transit. Tubes past the alert time (default 3 hours) are shown in red. **Photo** opens the pickup photo.
- **Received today**, newest first, with transit times and flags.
- Filter by centre, find a barcode or R#, and **Export (CSV)**.

In the **Tracker**, opening a case shows a **Sample journey** section for its tubes.

### Checking pickup photos

**Samples → Pickup photos** shows every photo couriers took that is still kept, grouped by day and by collection (centre and courier). Each photo shows its time, how many tubes were logged from it, and whether they have all been received.

- Filter by period, courier or centre, or find a barcode or R#.
- Click a photo to open it full screen. Zoom (+ / −, or click the photo), **Rotate**, **Open full size**, and move through photos with **Previous / Next** or the arrow keys.
- Beside the photo is the list of tubes logged from it, with their status. **Check that every tube in the photo appears in the list and that the numbers match the labels**: a tube that is in the photo but not in the list was not logged.

Photos are also linked from **Photo** buttons in the in-transit and received lists, and from **View pickup photo** in a tracker case's sample journey. Links to photos expire after 30 minutes for security; **Refresh** renews them.

### Admin settings for collection

**Settings → Sample collection: centres and photos**

- Add, rename or hide **centres** (hidden centres disappear from couriers' lists but keep their history).
- **Delete pickup photos after** N days (default 14) and **flag samples in transit longer than** N minutes (default 180).
- **Delete expired photos now.** Expired photos are also deleted automatically, whenever the Samples screen is opened (at most every 6 hours per computer).

Create courier accounts in **Staff** with the role **Courier**.

---

## Report delivery (GHA-POSTF001)

The paper *Proof of delivery of clients' medical reports* form (GHA-POSTF001) is filled in on the courier's phone and printed from the app in the same layout.

### Courier (on a phone)

1. Sign in and tap **Deliver reports** at the top.
2. Enter the **delivery location** and **department**, **sign** in the box (courier signature) and tap **Start delivery sheet**. This is the pick-up.
3. Add each report: **Scan report barcodes (photo)**, or type the R#. The client name is filled in from the tracker when the R# is known; otherwise tap **Add client name**.
4. At the client, tap **Record delivery** on the report and choose:
   - **Delivered (D):** the receiver types their full name and signs on the phone.
   - **Not delivered (ND)**, **Client unavailable (CU)** or **Closed (C):** a reason is required.
   The date and time are recorded automatically.
5. When every report has a status, tap **Close sheet and send to the lab**.

A report can only be out for delivery on one sheet at a time. **Remove** takes off a report added by mistake (before its outcome is recorded).

### Post-analytical (Deliveries tab)

- Counts of reports out for delivery, delivered and not delivered today, and sheets awaiting review.
- Each sheet shows its reports, statuses, receivers and signatures. Filter by status or search by R#, client, receiver or courier.
- **Review and sign off** completes *Reviewed by / Date* on a closed sheet (with an optional note).
- **Print GHA-POSTF001** prints the sheet on landscape A4 in the paper form's layout, with signatures, the status legend and the document-control footer. Undelivered rows show the attempt time in the reason column.
- **Export (CSV)** for audits.

In the **Tracker**, opening a case shows a **Report delivery** section: picked up, delivered to whom and when, or why not.

The form's document-control details (form number, version, issue date, author, approver) are in `src/lib/formTemplate.ts`; update them there when QA issues a new version of the form.

---

## How the tracker decides things

### Department of a test

Each pending test name is matched against the department dictionary. A keyword only matches as a whole token, so `Hb` does not match inside `HBA1C`, and the **longest** matching keyword wins. A name that matches nothing is usually a qualifier of the test printed before it, so it joins that test's department; if nothing before it matched, it goes to *Unclassified*. Every such name is also listed under **Settings → Unrecognised test names** for review.

### TAT

The TAT for a requisition is the earliest **"@ REPORT Collection Date"** found in its block of the report. Dates are read as DD/MM/YYYY (MM/DD is used only when the second number is over 12), with an optional time as `14:30` or `1430`.

### Completion times

The tracker only knows what is on each pasted list, so a test that disappears finished **sometime between the last paste it appeared on and the first paste it was missing from**. The tracker records both times and uses them honestly:

| Outcome | Rule |
|---|---|
| **On time** | Gone by the TAT (plus any grace period) |
| **Delayed** | Still on a list at or after the TAT, or still outstanding past it |
| **Unclear** | The TAT falls between the two pastes, so it may or may not have been on time |
| **Not yet due** | Still outstanding, TAT not reached |

More frequent pastes mean fewer *Unclear* cases and tighter delay ranges. The report shows the average paste interval for the window.

---

## Roles and permissions

| Action | Courier | Lab staff | Admin |
|---|:--:|:--:|:--:|
| View tracker, case details and reports | | ✓ | ✓ |
| Paste lists, undo pastes | | ✓ | ✓ |
| Edit A-List and department dictionaries, grace periods | | ✓ | ✓ |
| Download a backup | | ✓ | ✓ |
| Add staff, reset passwords, change roles, deactivate | | | ✓ |
| Import from a backup file | | | ✓ |
| Archive old completed cases | | | ✓ |
| Clear all tracked cases | | | ✓ |
| Collect samples by phone (start collection, photograph, hand over) | ✓ | ✓ | ✓ |
| Receive samples at pre-analytical, undo a receipt | | ✓ | ✓ |
| View and check pickup photos (Samples → Pickup photos) | | ✓ | ✓ |
| Manage centres, photo retention and transit alert time | | | ✓ |
| Fill in report delivery sheets (pick-up, receiver signature, status) | ✓ | | |
| View, review and print delivery sheets (GHA-POSTF001) | | ✓ | ✓ |

Couriers see only the collection screen and only their own collections; they cannot see the tracker, reports or other couriers' work. Every user can change their own password from the menu under their name. Deactivating someone blocks their sign-in immediately; their past work stays in the records.

---

## Setting it up from scratch

You need free accounts on **Supabase**, **GitHub** and **Render**.

### 1. Supabase project

1. Create a project (the London region is closest to West Africa). Save the database password somewhere safe.
2. **SQL Editor → New query**: paste and run `supabase/01_database_setup.sql`. The final result should list 11 tables, all with `rls_enabled = true`.
3. **SQL Editor → New query**: paste and run `supabase/02_first_admin_setup.sql`.
4. **SQL Editor → New query**: run, one at a time, `supabase/03_sample_transport.sql` (couriers, centres, samples and the private `sample-photos` bucket; ends with *sample transport installed*), `supabase/04_fix_table_permissions.sql` (ends with *table permissions fixed*) and `supabase/05_report_delivery.sql` (report delivery sheets; ends with *report delivery installed*). All three are safe to run again.
5. **Authentication → Sign In / Providers**: switch **off** "Allow new users to sign up". Leave the Email provider enabled.

### 2. The `manage-staff` Edge Function

This small server-side function creates and manages logins. It is the only place the Supabase secret key is used, and it checks that the caller is an admin before doing anything.

1. **Edge Functions → Deploy a new function → Via Editor.**
2. Name it exactly `manage-staff`, replace the sample code with `supabase/functions/manage-staff/index.ts`, and deploy.
3. In the function's **Settings**, turn **Verify JWT off**. The function checks sign-in and admin rights itself, and the one-time setup screen must be able to reach it before anyone has a login.
4. **Edge Functions → Secrets**: add `SETUP_CODE` with a private value of at least 8 characters.

### 3. Render

1. Put this repository on GitHub. If you use GitHub's web upload, **drag folders** (such as `src/` and `supabase/`) onto the page; the "choose your files" button cannot upload folders.
2. Render → **New → Static Site** → select the repository.
3. **Build command:** `npm ci && npm run build`
   **Publish directory:** `dist`
4. Create the site. Every push to GitHub redeploys automatically.
   (Alternatively, **New → Blueprint** uses `render.yaml`, which sets all of this.)
5. In Supabase, **Authentication → URL Configuration → Site URL**: enter the Render address.

### 4. First sign-in

Open the Render address. Because nobody exists yet, the app shows **Create the first admin**: enter your name, email, a password and the `SETUP_CODE`. This form works exactly once; afterwards everyone sees the normal sign-in screen. Add colleagues from the **Staff** tab (lab staff, couriers, admins), and add your collection centres under **Settings**. You may then delete the `SETUP_CODE` secret.

### 5. Upgrading an existing installation

1. Run any of `supabase/03_sample_transport.sql`, `04_fix_table_permissions.sql` and `05_report_delivery.sql` not yet run, in that order, in the SQL Editor.
2. Redeploy the `manage-staff` Edge Function with the current `supabase/functions/manage-staff/index.ts` (it adds the Courier role and photo clean-up). Keep **Verify JWT** off.
3. Push the updated code to GitHub so Render redeploys.

### 6. Bringing in data from the old browser version (optional)

In the old single-file tracker (rev 11 to 13), use **Download full backup**. In this app, as an admin: **Settings → Data and backup → Import from backup file**. Requisitions already in the database are skipped; you can choose whether to replace the dictionaries too.

---

## Configuration

The Supabase address and publishable key have defaults in `src/lib/api.ts`. To override them without editing code, set these in Render → **Environment**, then **Manual Deploy → Clear build cache & deploy** (they are fixed at build time):

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_KEY` | The **publishable** key (`sb_publishable_…`) |

Never put the **secret** key (`sb_secret_…` or `service_role`) in Render, the code or the browser.

---

## Project structure

```
index.html                  Page shell
public/                     App icons, manifest.json and sw.js (make the tracker installable)
vite.config.ts              Build configuration
render.yaml                 Render blueprint (optional)
package.json / package-lock.json
src/
  main.tsx                  Entry point
  App.tsx                   Sign-in flow, data sync, header, navigation
  index.css                 Themes, text sizes, typefaces, print styles
  lib/
    tracker.ts              MT parser, date parser, per-test model, timing verdicts
    report.ts               Delay report calculations
    api.ts                  Supabase reads, writes and the staff function
    defaults.ts             Built-in A-List and department dictionaries
    display.ts              Per-computer display settings
    formTemplate.ts         Document-control details printed on GHA-POSTF001
    barcode.ts              Reads barcodes from photos on the phone; shrinks photos for upload
  components/
    AuthScreen.tsx          First-admin setup and sign-in
    TrackerView.tsx         Worklist, filters and case panel
    PasteFlow.tsx           Paste, review and apply
    ReportView.tsx          Delay report
    SettingsView.tsx        Dictionaries, unrecognised names, backup, admin tools
    CentresPanel.tsx        Collection centres, photo retention, transit alert
    CourierView.tsx         Courier phone screen: collections, photos, handover
    ReceptionView.tsx       Pre-analytical scanning, in transit, received today
    PhotoReview.tsx         Pickup photo gallery and viewer
    DeliveryCourier.tsx     Courier screen for delivering reports
    DeliveriesView.tsx      Lab view of delivery sheets: review, print, export
    PodForm.tsx             Printable GHA-POSTF001 layout
    Signature.tsx           Signature pad and signature display
    StaffView.tsx           Staff accounts (admins)
    DisplayMenu.tsx         Text size, theme, typeface, row spacing
    ui.tsx                  Shared buttons, panels, badges, tube-cap icons
supabase/
  01_database_setup.sql     Tables, security rules, paste/undo/admin functions, default dictionaries
  02_first_admin_setup.sql  One-time first-admin claim
  03_sample_transport.sql   Couriers, centres, samples, reception functions, photo bucket
  04_fix_table_permissions.sql  Read permissions for signed-in users (safe to run any time)
  05_report_delivery.sql    Delivery sheets and report deliveries (GHA-POSTF001)
  functions/manage-staff/index.ts   Edge Function for staff accounts
  optional_add_staff_by_sql.sql     Manual alternative to the Staff tab
```

---

## Database overview

| Table | Holds |
|---|---|
| `requisitions` | One row per R#: client text, TAT |
| `requisition_tests` | One row per test on a requisition: status, first seen, last seen pending, completed time |
| `pastes`, `paste_changes` | Who pasted what and when, plus the previous state needed for undo |
| `alist_keywords`, `dept_keywords` | The two dictionaries |
| `unmatched_tokens`, `ignored_tokens` | Unrecognised test names and names marked as qualifiers |
| `app_settings` | Grace periods, archive age |
| `staff` | Who may use the tracker, and their role |
| `centres` | Collection centres |
| `courier_runs` | One collection: courier, centre, start and handover time |
| `samples` | One row per tube: barcode, R#, collection (who, where, when, photo) and reception (who, when) |
| `delivery_sheets` | One GHA-POSTF001 sheet: courier and signature, location, department, pick-up, closed, reviewed by |
| `report_deliveries` | One report on a sheet: R#, client, status (D/ND/CU/C), receiver name and signature, time, reason |
| `activity_log` | Undo, dictionary replacements, staff changes, imports, archives, clear-all |

Department splits are worked out when the page loads, from the current dictionary, so editing the dictionary never rewrites stored data. All writes go through database functions (`apply_paste`, `undo_last_paste`, `replace_keywords`, and so on) that check the caller's role; a lock stops two simultaneous pastes from interfering.

---

## Security and data protection

- **Nothing is readable without signing in.** Row Level Security is on for every table, and only active people on the `staff` list can read data. Having a login alone is not enough.
- **Public sign-up is disabled.** Accounts are created by admins through the Edge Function.
- **The publishable key in the page is safe by design**; the secret key never leaves Supabase.
- **Data kept:** R# numbers, client (account) names as printed by MT, test names, barcodes and timestamps. The tracker's tables do **not** store patient names, dates of birth or other personal identifiers.
- **Pickup photos can show patient details** printed on tube labels. They are kept in a private storage bucket that only lab staff and admins can view (couriers can upload but not view), are opened through short-lived links, and are deleted automatically after the retention period. Keep the retention as short as your lab's procedures allow, and confirm the practice with your data-protection lead. R# numbers can still be linked to patients inside the lab's systems, so treat the tracker as confidential and follow your lab's data-protection policy and Ghana's Data Protection Act.
- **Audit trail:** every paste records who made it; administrative actions are recorded in `activity_log`.
- Remove access promptly when someone leaves (**Staff → Deactivate**).

---

## Backups, archiving and housekeeping

- **Download full backup** (Settings) saves all cases and dictionaries as JSON. It can be re-imported by an admin.
- **Archive** (admins) removes requisitions whose tests all finished more than *N* days ago and downloads them as a JSON file first. Reports for those dates will no longer include them, so keep the file.
- **Supabase free plan:** projects pause after about a week with no activity. Daily use keeps it awake. A paid plan adds automatic daily backups.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Render build: `Could not resolve './.figma/make/site.json'` | Old Figma build settings. Use the `vite.config.ts` in this repository. |
| Render build: `Failed to resolve /src/main.tsx` | The `src` folder is missing from GitHub. Upload it by **dragging the folder** onto GitHub's upload page. |
| Render build fails on the Node version | `.node-version` (22) must be in the repository root, or set `NODE_VERSION=22` in Render → Environment. |
| Sign-in page says it couldn't reach `manage-staff` | Deploy the function with exactly that name and turn **Verify JWT** off. |
| "Setup is not enabled" | Add the `SETUP_CODE` secret (8+ characters) under Edge Functions → Secrets. |
| "Wrong setup code" | Check the secret's value; it is case-sensitive. |
| "Database setup incomplete: run 3_first_admin_setup.sql" | Run `supabase/02_first_admin_setup.sql` in the SQL Editor (the same file, renamed for this repository). |
| "This login is not on the staff list" | The account exists but isn't on the staff list, or was deactivated. An admin can add or reactivate it on the Staff tab. |
| Header shows **Reconnecting** instead of **Live** | Live updates dropped (network). Data still refreshes every five minutes and when the tab is reopened. |
| "Couldn't load the latest data (…: permission denied for table …)" | The table is missing its read permission for signed-in users. Run `supabase/04_fix_table_permissions.sql` in the SQL Editor, then reload. |
| "Couldn't load the latest data" banner | Network or Supabase outage, or the project is paused. It retries automatically; check Supabase's dashboard and status page. |
| A case is missing after a paste | Look at the review's **Couldn't be read** list; usually the collection date line was missing or in an unusual format. |
| Cases wrongly marked completed | Probably a partial paste applied as a full list. Use **Undo that paste**, then re-paste with **Add / update only**. |
| Chrome says "This app cannot be installed" | Use the https Render address (not a downloaded file), make sure `public/` (icons, `manifest.json`, `sw.js`) was uploaded to GitHub and the site redeployed, then reload the page once before installing. |
| Courier's phone doesn't open the camera | The site must be opened over **https** (Render addresses are). Allow camera access for the browser in the phone's settings. |
| "No barcode could be read" | Retake closer, flatter and in better light, with fewer tubes per photo; or type the number. |
| Scans at reception do nothing | Click once on the Samples page so the browser window has focus; the scan box then takes focus automatically. Check the scanner is set to send Enter after each code. |
| "Couldn't load deliveries" | Run `supabase/05_report_delivery.sql`. |
| "Couldn't load samples" / "Couldn't load centres" | Run `supabase/03_sample_transport.sql`. |
| Photos are not being deleted | Redeploy the current `manage-staff` function; use **Settings → Delete expired photos now** to test. |
| A test is in the wrong department | Add or fix its keyword in **Settings → Department keywords** (or accept it from **Unrecognised test names**). |

---

## Known limitations

- **One TAT per requisition.** The earliest collection date in the requisition's block is used for all its departments.
- **Completion time precision** depends on how often the list is pasted.
- **Qualifier handling** assumes an unrecognised name belongs with the test printed before it; review **Unrecognised test names** regularly.
- **Parsing depends on the MT report layout.** If the report format changes, the parser in `src/lib/tracker.ts` may need updating.
- **Photo proof is per photo, not per tube**: tubes logged from the same photo share it.
- **Undo** covers pastes and individual sample receipts. Dictionary replacements are logged (with the previous list) in `activity_log` but are not undone from the app.

---

## Local development

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

The development server connects to the same Supabase project unless `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` are set in a `.env.local` file. For experiments, create a separate Supabase project and run the files in `supabase/` against it.
