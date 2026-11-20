# CSA at BYU website

The Corporate Strategy Association's website: public pages for prospective members and recruiters, plus a member login that unlocks Internship Scout and the resource library for students with paid dues.

Everything here runs on free tiers. Total cost: $0.

| Piece | What it does | Service (free tier) |
|---|---|---|
| Website pages | Home, Events Calendar, For Students, For Companies, Team, Login, Resources, Scout | GitHub Pages or Cloudflare Pages |
| Member login + data | Accounts, membership check, member-only content | Supabase |
| Roster + Scout sync | Imports the BYU Clubs roster and the Scout sheet every hour, emails officers | Google Apps Script (club Google account) |

## How membership works

1. A student joins CSA and pays dues on clubs.byu.edu.
2. They create an account on the site with their BYU email and a password.
3. The site checks their email or NetID against the latest roster upload: dues paid, Status "Active", expiration date not passed. Current officers (anyone with a title in the Officer column who is Active) always get access. People on the permanent access list (the `access_overrides` table in Supabase; Caleb Schaack and Shawn Egan to start) always get access no matter what the roster says. Add or remove NetIDs there in the Table Editor.
   - **On the roster and paid:** member pages unlock immediately.
   - **Not on the roster yet:** they see a "pending" screen. Officers get an email within the hour. When an officer uploads a fresh roster, the account unlocks automatically and the student gets a "you're in" email.
   - **Expired:** they see a "renew" screen. Renewing and the next roster upload restores access with the same login.
4. The check runs on every visit, so access ends on the roster's expiration date even if someone stays signed in.

The only recurring officer task: **export the roster from clubs.byu.edu and drop the file in the "CSA Roster" Drive folder**, at the start of each semester and whenever the sign-up alert email says people are waiting.

## Demo mode

With `SUPABASE_URL` empty in `js/config.js`, the site runs in demo mode with a yellow banner. Any `@byu.edu` email and any password signs in and shows sample data. Emails starting with `pending` or `expired` (for example `pending@byu.edu`) preview those screens. Use this for the proposal before any accounts exist.

To preview locally: open a terminal in this folder, run `python3 -m http.server 8000`, and visit http://localhost:8000.

---

## Setup (about 1 hour, one time)

Use a **club-owned Google account** (for example csa.byu@gmail.com or the club's byu.edu account) for every service below, so the site doesn't depend on any one officer after they graduate. Store the passwords in a shared officer password manager or with the faculty advisor.

### 1. Put the code on GitHub

1. Create a free GitHub organization for CSA (github.com > + > New organization > Free).
2. Create a repository, for example `csa-site`. It can be public: nothing secret lives in this code.
3. Upload every file in this folder (Add file > Upload files), keeping the folder structure.
4. Add each officer as an organization member.

### 2. Publish the site

**GitHub Pages:** repository > Settings > Pages > Source: "Deploy from a branch" > Branch: `main` / `(root)` > Save. The site appears at `https://<org>.github.io/csa-site/` within a few minutes.

**Or Cloudflare Pages:** dash.cloudflare.com > Workers & Pages > Create > Pages > Connect to Git > pick the repo > Build command: *(none)*, Output directory: `/` > Deploy.

**Custom address (optional):** if the Strategy program approves a byu.edu subdomain (like `csa.byu.edu`), BYU IT creates a DNS record pointing to GitHub/Cloudflare, and you add the domain under Pages settings. Both hosts support this for free.

Every change pushed to the repository republishes the site automatically.

### 3. Set up Supabase (login + member data)

1. Create a free account at supabase.com with the club Google account, then **New project**. Name it `csa-site`, choose region West US, and save the database password somewhere safe.
2. **SQL Editor > New query**: paste all of `supabase/schema.sql` and click **Run**. It creates the tables, access rules, and starter resources. Safe to re-run.
3. **Authentication > Sign In / Providers > Email**: keep Email enabled, keep **Confirm email** ON, and set minimum password length to 8.
4. **Authentication > URL Configuration**:
   - Site URL: your site address (for example `https://csa.byu.edu`)
   - Redirect URLs: add `https://<your-site>/login.html*`
5. **Email sending (required).** Supabase's built-in email is for testing only and won't reliably reach students. Under **Authentication > Emails > SMTP Settings**, turn on custom SMTP with one of these free options:
   - **Club Gmail:** host `smtp.gmail.com`, port `587`, username = the club Gmail address, password = a Gmail **app password** (Google Account > Security > 2-Step Verification > App passwords). Up to roughly 500 emails a day.
   - **Resend:** free tier at resend.com; follow their Supabase SMTP guide.
6. **Project Settings > API**: copy the **Project URL** and the **anon / publishable key** into `js/config.js`:
   ```js
   SUPABASE_URL: "https://abcdefgh.supabase.co",
   SUPABASE_ANON_KEY: "eyJ...",   // or sb_publishable_...
   ```
   Commit that change. The site leaves demo mode.

> The anon key is meant to be public. The **service_role / secret key** is NOT. It goes only in the Apps Script (step 4), never in the website code.

### 4. Set up the roster + Scout sync (Google Apps Script)

1. In the club Google Drive, create a folder named **CSA Roster** and share it with the officers. Copy its ID from the URL (`drive.google.com/drive/folders/<THIS_PART>`).
2. Get the Internship Scout Google Sheet's ID from its URL (`docs.google.com/spreadsheets/d/<THIS_PART>/edit`). The sync reads the **Opportunities** tab.
3. Go to script.google.com > **New project**, name it "CSA site sync", delete the sample code, and paste all of `apps-script/CSASync.gs`.
4. **Project Settings (gear) > Script properties > Add**:

   | Property | Value |
   |---|---|
   | `SUPABASE_URL` | Project URL from Supabase |
   | `SUPABASE_SERVICE_KEY` | Supabase > Project Settings > API > **service_role** (or secret) key |
   | `ROSTER_FOLDER_ID` | CSA Roster folder ID |
   | `SCOUT_SHEET_ID` | Internship Scout sheet ID |
   | `TEAM_SHEET_ID` | Officers sheet ID (Team page; see "Leadership changes" below) |
   | `OFFICER_EMAILS` | Comma-separated officer emails for alerts |
   | `SITE_URL` | Your site address |

5. If clubs.byu.edu exports Excel (.xlsx) files: **Services (+) > Drive API > Add**. Not needed for CSV.
6. Select `setup` in the function dropdown and click **Run**. Approve the permissions prompt (Drive, Sheets, email, external requests). This installs an hourly trigger and runs the first sync.
7. Drop a roster export in the CSA Roster folder, then check **Executions** for a "Roster synced: N members" log line.

The script reads the BYU Clubs member export as is (Members tab in Manage Association → download arrow; it saves an .xls). Upload it unfiltered. It uses these columns: First Name, Last Name, NetID, Email, Status (Active/Inactive), Officer, Dues Paid Date (blank = unpaid) and Dues Expiration Date. Status matters: people who paid for an earlier semester stay in the export with a future-looking expiration date but are marked Inactive, so they don't get access. If BYU changes the export headings, adjust the patterns in `parseRoster_()`.

**Safety check:** if a new roster file has less than half as many people as the current roster, the sync skips it and emails officers. This stops a partial or filtered export from locking out real members. To apply a smaller roster on purpose, run `forceRosterSync()`.

Because the sync contacts Supabase every hour, it should also keep the free project from pausing for inactivity.

---

## Officer routine

| When | Task | Time |
|---|---|---|
| Start of each semester | Export the roster from clubs.byu.edu and drop it in CSA Roster | 2 min |
| When you get a "sign-ups waiting" email | Same as above | 2 min |
| When you get a "roster is 30 days old" reminder | Same as above | 2 min |
| As needed | Add events in Luma (the site updates itself) | 2 min |
| When officers change | Edit the Officers sheet (and upload new headshots) | 5 min |

You can leave old roster files in the folder. The sync always uses the newest one.

### Leadership changes

1. **Officers sheet:** in the club Google Drive, keep a sheet with a tab named **Officers** and these columns: `Name`, `Title`, `Photo`, `Company Contact`, `Term`. One row per officer, in the order they should appear. `Company Contact` = Yes for whoever is listed on For Companies (today: the VPs of Corporate Outreach). `Term` (e.g. 2027–28) sets the Team page heading. The sheet's ID goes in the `TEAM_SHEET_ID` script property.
2. **Headshots:** upload square photos in Supabase > **Storage > team-photos** and put the file name (e.g. `jane-doe.jpg`) in the `Photo` column. Leave it blank to show initials.
3. **Member access:** automatic. New officers get access once BYU Clubs lists them in the Officer column and the roster is uploaded. Permanent access for site admins lives in **Table Editor > access_overrides** (by NetID).
4. **Account ownership:** add the new presidents as owners of the CSA Google account (shared password and 2-Step Verification), the GitHub organization, and the Supabase organization.

The Team page updates within the hour. If the sheet is ever empty or broken, the site keeps the last good team.

## Editing content

- **Events (Luma):** create a CSA calendar on Luma, then paste two links into `js/config.js`: `LUMA_EMBED_URL` (Luma > calendar > Settings > Embed, the iframe's `src`) and `LUMA_CALENDAR_URL` (the calendar's public page). The Events Calendar page (`events.html`) then shows live upcoming events, and its "Subscribe to calendar" button points to Luma. New events appear automatically when you add them in Luma.
- **Member resources (files):** upload the file in Supabase > **Storage > resources** (folders are fine, e.g. `recruiting/strategy-resume-template.docx`). Then in **Table Editor > resources**, put that path in `file_path` and set `status` to `live`. The bucket is private: files have no public link, and the site only hands an active member a link that expires after 5 minutes. Use this for anything members-only. Free plan storage (about 1 GB) is plenty for Excel files, slide decks, and documents.
- **Member resources (links):** for outside tools like the case agent, paste the link into `url` instead. Those links work for anyone who has them, so don't use `url` for files you want kept to members.
- Add rows to add resources; `sort` controls order. Changes show immediately.
- **Casing Preparation Agent:** listed first under "Case practice" in the resources table. It's a claude.ai artifact, so the owner must share it (Share on its page) before members can open it. If the link changes, update that row's `url`.
- **Locked preview:** non-members see the full catalogue on `resources.html`, locked (names and descriptions only, never links or files). It reads from the same resources table, so adding, renaming, or deleting a row updates both views. The list written into `resources.html` only shows if the database can't be reached.
- **Internship Scout:** edit the Scout Google Sheet as usual. The site picks up changes within the hour.
- **Logos:** add a trimmed PNG to `assets/logos/` and a tile in the "Where CSA members have landed" section of `index.html`.
- **Team and the For Companies contact:** come from the **Officers** Google Sheet (see "Leadership changes").

## Placeholders to fill before launch

Search the files for `[` to find them:

- Club email and LinkedIn URL: footer of every page, `companies.html`
- Weekly meeting time and room: `index.html`
- This week's session in the top banner: `index.html`
- Luma calendar links: `js/config.js` (see Editing content)
- "Submit a role" form link: `js/config.js` (`SUBMIT_ROLE_URL`)
- Member profile stat: `companies.html`
- Flagship programs are tagged **Proposed** in `index.html`. Remove the tag once a program is committed. Check the Spring Trek against Marriott's club travel policy first.

## Security notes

- The roster (emails, NetIDs, dues status) is never readable from a browser. Only the Apps Script, using the service key, can write it, and nothing can read it except the membership check itself.
- Member resources and Scout rows are filtered in the database (row-level security). Hiding a page in the browser isn't what protects them.
- Resource files sit in a private storage bucket. Only an active member can get a download link, and it expires after 5 minutes. A member could still save a file and pass it on; nothing on a website can stop that.
- Accounts require a confirmed @byu.edu email, so nobody can claim another student's paid membership without access to that inbox.
- If the service key is ever exposed, rotate it in Supabase > Project Settings > API and update the Apps Script property.

## File map

```
index.html, events.html, students.html, companies.html, team.html   public pages
login.html, pending.html, resources.html, scout.html   member area
css/site.css                                           all styles (colors from the CSA logo)
js/config.js                                           Supabase keys and links (edit this)
js/auth.js                                             login, membership check, data loading, demo mode
js/login.js, pending.js, resources.js, scout.js, team.js   page logic
js/demo-data.js                                        sample content for demo mode
supabase/schema.sql                                    database setup (run once)
apps-script/CSASync.gs                                 hourly roster + Scout sync and emails
assets/                                                CSA logo and company logos
```
