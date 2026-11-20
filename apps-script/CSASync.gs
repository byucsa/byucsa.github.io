/**
 * CSA member site: roster + Internship Scout sync (Google Apps Script)
 *
 * Runs every hour from the club's Google account. It:
 *   1. Reads the newest BYU Clubs roster export in a Drive folder and replaces
 *      the site's member roster (paid / active / expiration date).
 *   2. Copies the Internship Scout "Opportunities" tab to the site.
 *   3. Emails officers when someone signs up but isn't on the roster yet,
 *      and emails that person once a later roster upload unlocks them.
 *   4. Reminds officers when the roster file is more than 30 days old.
 *   5. Copies the "Officers" sheet to the site's Team page and For Companies contact card.
 *
 * Setup (see README.md, "Roster sync"):
 *   Project Settings > Script properties, add:
 *     SUPABASE_URL          https://<project>.supabase.co
 *     SUPABASE_SERVICE_KEY  service_role / secret key (never put this in the website)
 *     ROSTER_FOLDER_ID      Drive folder where officers drop the roster export
 *     SCOUT_SHEET_ID        Internship Scout Google Sheet ID
 *     OFFICER_EMAILS        comma-separated officer emails for alerts
 *     SITE_URL              e.g. https://csa.byu.edu (used in emails)
 *     TEAM_SHEET_ID         Officers Google Sheet ID (Team page)
 *   Optional:
 *     SCOUT_TAB             defaults to "Opportunities"
 *     TEAM_TAB              defaults to "Officers"
 *   Then run setup() once and approve the permissions prompt.
 */

const DEFAULT_SCOUT_TAB = 'Opportunities';
const DEFAULT_TEAM_TAB = 'Officers';
const STALE_ROSTER_DAYS = 30;
const MIN_ROSTER_RATIO = 0.5; // refuse an upload that would shrink the roster by more than half

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------
function setup() {
  const p = props_();
  ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ROSTER_FOLDER_ID', 'OFFICER_EMAILS', 'SITE_URL']
    .forEach((k) => { if (!p[k]) throw new Error('Missing script property: ' + k); });
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'syncAll')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncAll').timeBased().everyHours(1).create();
  syncAll();
  Logger.log('Setup complete. syncAll will run every hour.');
}

function syncAll() {
  const errors = [];
  [syncRoster, syncScout, syncTeam, notifyMembers, remindIfRosterStale].forEach((fn) => {
    try { fn(); } catch (e) { errors.push(fn.name + ': ' + e.message); Logger.log(e.stack || e); }
  });
  if (errors.length) alertOfficersOnce_('sync-error', 'CSA site sync error',
    'The CSA site sync hit a problem:\n\n' + errors.join('\n') +
    '\n\nOpen the Apps Script project > Executions for details.');
}

/** Force a roster re-import even if the file hasn't changed. */
function forceRosterSync() {
  PropertiesService.getScriptProperties().deleteProperty('ROSTER_FILE_STAMP');
  syncRoster();
}

// ---------------------------------------------------------------------------
// 1. Roster
// ---------------------------------------------------------------------------
function syncRoster() {
  const p = props_();
  const file = newestRosterFile_(p.ROSTER_FOLDER_ID);
  if (!file) { Logger.log('No roster file found yet.'); return; }

  const stamp = file.getId() + '@' + file.getLastUpdated().getTime();
  const store = PropertiesService.getScriptProperties();
  if (store.getProperty('ROSTER_FILE_STAMP') === stamp) return; // unchanged since last sync

  const table = readTable_(file);
  const rows = parseRoster_(table);
  if (!rows.length) throw new Error('Roster file "' + file.getName() + '" has no rows with an email address.');

  const current = Number(rpc_('roster_count', {})) || 0;
  if (current >= 20 && rows.length < current * MIN_ROSTER_RATIO) {
    alertOfficersOnce_('roster-shrink-' + stamp, 'CSA roster upload skipped',
      'The newest roster file "' + file.getName() + '" has ' + rows.length + ' members, but the site has ' +
      current + '. It looks like a partial export, so it was NOT applied.\n\n' +
      'Export the full member list from clubs.byu.edu and drop it in the folder again. ' +
      'If the smaller list is correct, run forceRosterSync() after setting MIN_ROSTER_RATIO lower.');
    return;
  }

  const n = rpc_('sync_roster', { rows: rows });
  store.setProperty('ROSTER_FILE_STAMP', stamp);
  store.setProperty('ROSTER_FILE_UPDATED', String(file.getLastUpdated().getTime()));
  Logger.log('Roster synced: ' + n + ' members from ' + file.getName());
}

function newestRosterFile_(folderId) {
  const it = DriveApp.getFolderById(folderId).getFiles();
  let newest = null;
  while (it.hasNext()) {
    const f = it.next();
    const type = f.getMimeType();
    const ok = type === MimeType.CSV || type === MimeType.GOOGLE_SHEETS || type === 'text/plain' ||
      type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      type === 'application/vnd.ms-excel';
    if (ok && (!newest || f.getLastUpdated() > newest.getLastUpdated())) newest = f;
  }
  return newest;
}

/** Returns a 2D array of display strings for CSV, Google Sheets, or Excel files. */
function readTable_(file) {
  const type = file.getMimeType();
  if (type === MimeType.GOOGLE_SHEETS) {
    return SpreadsheetApp.openById(file.getId()).getSheets()[0].getDataRange().getDisplayValues();
  }
  if (type === MimeType.CSV || type === 'text/plain') {
    return Utilities.parseCsv(file.getBlob().getDataAsString());
  }
  // Excel: convert to a temporary Google Sheet (needs the Drive advanced service, see README).
  if (typeof Drive === 'undefined') {
    throw new Error('Roster is an Excel file. Enable the Drive advanced service (Services > Drive API) ' +
      'or export the roster as CSV.');
  }
  const copy = Drive.Files.create({ name: 'tmp-roster', mimeType: MimeType.GOOGLE_SHEETS }, file.getBlob());
  try {
    return SpreadsheetApp.openById(copy.id).getSheets()[0].getDataRange().getDisplayValues();
  } finally {
    DriveApp.getFileById(copy.id).setTrashed(true);
  }
}

/** Maps BYU Clubs export columns to roster rows by header name. */
function parseRoster_(table) {
  const headerIdx = table.findIndex((r) => r.some((c) => /e-?mail/i.test(String(c))));
  if (headerIdx < 0) throw new Error('Could not find a header row with an "Email" column.');
  const headers = table[headerIdx].map((h) => String(h).trim().toLowerCase());
  const col = (...patterns) => headers.findIndex((h) => patterns.some((re) => re.test(h)));

  const c = {
    email: col(/e-?mail/),
    netid: col(/net\s*-?id/),
    name: col(/^full name$/, /^name$/, /member name/, /student name/),
    first: col(/first/),
    last: col(/last name/, /^last$/, /surname/),
    // A yes/no dues column if there is one; otherwise BYU Clubs' "Dues Paid Date".
    paid: headers.findIndex((h) => /dues|paid|payment/.test(h) && !/date|amount|expir|fail/.test(h)),
    paidDate: col(/paid date/, /payment date/),
    active: col(/active/, /membership status/, /^status$/),
    expires: col(/expir/, /end date/, /valid (through|until)/),
    officer: col(/^officer$/, /officer (title|position|role)/),
  };
  Logger.log('Roster columns: ' + JSON.stringify(c));
  if (c.paid < 0 && c.paidDate < 0) throw new Error('Could not find a dues/paid column in the roster export.');
  if (c.expires < 0) Logger.log('Warning: no expiration column found; access will not expire automatically.');

  const yes = /^(paid|yes|y|true|1|active|current|complete|completed)$/i;
  const out = [];
  table.slice(headerIdx + 1).forEach((r) => {
    const email = String(r[c.email] || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    const name = c.name >= 0 ? r[c.name]
      : [c.first >= 0 ? r[c.first] : '', c.last >= 0 ? r[c.last] : ''].join(' ');
    const activeFlag = c.active >= 0 && c.active !== c.paid ? yes.test(String(r[c.active] || '').trim()) : true;
    // Current officers (listed in the Officer column and marked Active) always get access,
    // whether or not they pay dues. Access lasts as long as they stay listed as officers.
    const isOfficer = c.officer >= 0 && String(r[c.officer] || '').trim() !== '' && activeFlag;
    out.push({
      email: email,
      netid: c.netid >= 0 ? String(r[c.netid] || '').trim().toLowerCase() : '',
      full_name: String(name || '').trim(),
      dues_paid: isOfficer || (c.paid >= 0 ? yes.test(String(r[c.paid] || '').trim())
        : String(r[c.paidDate] || '').trim() !== ''),
      active: activeFlag,
      expires_on: isOfficer ? '' : (c.expires >= 0 ? toIsoDate_(r[c.expires]) : ''),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Officers sheet -> Team page + For Companies contact card
// Columns (header row, any order): Name, Title, Photo, Company Contact, Term.
// Row order = order on the page. Photo: a file name uploaded to Supabase >
// Storage > team-photos (e.g. jane-doe.jpg), or an https link. Company Contact:
// Yes for whoever should be listed on the For Companies page.
// ---------------------------------------------------------------------------
function syncTeam() {
  const p = props_();
  if (!p.TEAM_SHEET_ID) return;
  const tab = p.TEAM_TAB || DEFAULT_TEAM_TAB;
  const sheet = SpreadsheetApp.openById(p.TEAM_SHEET_ID).getSheetByName(tab);
  if (!sheet) throw new Error('Team tab "' + tab + '" not found.');
  const rows = parseTeam_(sheet.getDataRange().getDisplayValues());
  if (!rows.length) throw new Error('The Officers sheet has no rows with a Name and Title; the Team page was left as is.');
  const stamp = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(rows)));
  const store = PropertiesService.getScriptProperties();
  if (store.getProperty('TEAM_STAMP') === stamp) return;
  const n = rpc_('sync_team', { rows: rows });
  store.setProperty('TEAM_STAMP', stamp);
  Logger.log('Team synced: ' + n + ' officers');
}

function parseTeam_(table) {
  if (!table || table.length < 2) return [];
  const headers = table[0].map((h) => String(h).trim().toLowerCase());
  const col = (...res) => headers.findIndex((h) => res.some((re) => re.test(h)));
  const c = {
    name: col(/^name$/, /full name/, /officer/),
    title: col(/^title$/, /position/, /role/),
    photo: col(/photo/, /headshot/, /image/),
    contact: col(/compan/, /contact/),
    term: col(/term/, /year/),
  };
  if (c.name < 0 || c.title < 0) throw new Error('The Officers sheet needs "Name" and "Title" columns.');
  const yes = /^(yes|y|true|x|1)$/i;
  const out = [];
  table.slice(1).forEach((r) => {
    const name = String(r[c.name] || '').trim();
    const title = String(r[c.title] || '').trim();
    if (!name || !title) return;
    out.push({
      sort: (out.length + 1) * 10,
      name: name,
      title: title,
      photo: c.photo >= 0 ? String(r[c.photo] || '').trim() : '',
      company_contact: c.contact >= 0 ? yes.test(String(r[c.contact] || '').trim()) : false,
      term: c.term >= 0 ? String(r[c.term] || '').trim() : '',
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 2. Internship Scout
// ---------------------------------------------------------------------------
function syncScout() {
  const p = props_();
  if (!p.SCOUT_SHEET_ID) return;
  const sheet = SpreadsheetApp.openById(p.SCOUT_SHEET_ID).getSheetByName(p.SCOUT_TAB || DEFAULT_SCOUT_TAB);
  if (!sheet) throw new Error('Scout tab "' + (p.SCOUT_TAB || DEFAULT_SCOUT_TAB) + '" not found.');
  const range = sheet.getDataRange();
  const display = range.getDisplayValues();
  const raw = range.getValues();
  if (display.length < 2) { rpc_('sync_scout_roles', { rows: [] }); return; }

  const headers = display[0].map((h) => String(h).trim().toLowerCase());
  const col = (name) => headers.indexOf(name.toLowerCase());
  const c = {
    company: col('Company'), title: col('Internship Title'), location: col('Location'),
    work: col('Work Arrangement'), grad: col('Eligible Graduation Dates'), deadline: col('Deadline'),
    pay: col('Compensation'), resp: col('Strategy Responsibilities'), link: col('Application Link'),
    dates: col('Internship Dates'), notes: col('Eligibility & Notes'), id: col('Posting ID'),
  };
  if (c.company < 0 || c.title < 0) throw new Error('Scout sheet needs "Company" and "Internship Title" columns.');

  const get = (row, i) => (i >= 0 ? String(row[i] || '').trim() : '');
  const rows = [];
  for (let i = 1; i < display.length; i++) {
    const d = display[i];
    const company = get(d, c.company), title = get(d, c.title);
    if (!company || !title) continue;
    const location = get(d, c.location);
    rows.push({
      posting_id: get(d, c.id) || Utilities.base64EncodeWebSafe(
        Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, company + '|' + title + '|' + location)),
      company: company,
      title: title,
      location: location,
      work_arrangement: get(d, c.work),
      eligible_grad: get(d, c.grad),
      deadline: get(d, c.deadline),
      deadline_date: c.deadline >= 0 ? deadlineDate_(raw[i][c.deadline], get(d, c.deadline)) : '',
      compensation: get(d, c.pay),
      responsibilities: get(d, c.resp),
      apply_url: /^https?:\/\//i.test(get(d, c.link)) ? get(d, c.link) : '',
      internship_dates: get(d, c.dates),
      eligibility: get(d, c.notes),
    });
  }
  const n = rpc_('sync_scout_roles', { rows: rows });
  Logger.log('Scout synced: ' + n + ' roles');
}

// ---------------------------------------------------------------------------
// 3. Officer alerts and welcome emails
// ---------------------------------------------------------------------------
function notifyMembers() {
  const p = props_();
  const store = PropertiesService.getScriptProperties();
  const waiting = JSON.parse(store.getProperty('WAITING_SIGNUPS') || '{}'); // email -> first seen ISO
  const states = rpc_('member_signup_states', {}) || [];
  const present = {};
  const newlyWaiting = [];
  const unlocked = [];

  states.forEach((s) => {
    present[s.email] = true;
    if (s.status === 'pending' || s.status === 'expired') {
      if (!waiting[s.email]) {
        waiting[s.email] = new Date().toISOString();
        // Alert officers about new sign-ups only. Expired members are tracked quietly
        // so they still get a welcome-back email when they renew.
        if (s.status === 'pending') newlyWaiting.push(s);
      }
    } else if (s.status === 'active' && waiting[s.email]) {
      unlocked.push(s.email);
      delete waiting[s.email];
    }
  });
  Object.keys(waiting).forEach((e) => { if (!present[e]) delete waiting[e]; });

  if (newlyWaiting.length) {
    const lines = newlyWaiting.map((s) => '  • ' + s.email + (s.status === 'expired' ? ' (membership expired)' : ''));
    MailApp.sendEmail({
      to: p.OFFICER_EMAILS,
      subject: newlyWaiting.length + ' CSA sign-up' + (newlyWaiting.length > 1 ? 's' : '') + ' waiting on the roster',
      body: 'These people created member accounts but aren\'t active on the site roster yet:\n\n' +
        lines.join('\n') + '\n\nIf they\'ve paid, export the latest roster from clubs.byu.edu and drop it in the ' +
        'CSA Roster folder. Their accounts unlock automatically within the hour.\n\n' +
        'Roster folder: https://drive.google.com/drive/folders/' + p.ROSTER_FOLDER_ID,
    });
  }

  unlocked.forEach((email) => {
    MailApp.sendEmail({
      to: email,
      subject: 'You\'re in: CSA member resources are unlocked',
      body: 'Your dues are confirmed and your CSA member account is active.\n\n' +
        'Sign in to open Internship Scout and the resource library:\n' + p.SITE_URL.replace(/\/$/, '') + '/login.html\n\n' +
        'Corporate Strategy Association at BYU',
      name: 'Corporate Strategy Association at BYU',
    });
  });

  store.setProperty('WAITING_SIGNUPS', JSON.stringify(waiting));
}

// ---------------------------------------------------------------------------
// 4. Stale roster reminder
// ---------------------------------------------------------------------------
function remindIfRosterStale() {
  const updated = Number(PropertiesService.getScriptProperties().getProperty('ROSTER_FILE_UPDATED') || 0);
  if (!updated) return;
  const days = (Date.now() - updated) / 86400000;
  if (days < STALE_ROSTER_DAYS) return;
  const week = Math.floor(Date.now() / (7 * 86400000));
  alertOfficersOnce_('stale-' + week, 'Reminder: upload a fresh CSA roster',
    'The member roster on the CSA site is ' + Math.floor(days) + ' days old. Export the latest roster from ' +
    'clubs.byu.edu and drop it in the CSA Roster folder so new and renewing members get access.\n\n' +
    'https://drive.google.com/drive/folders/' + props_().ROSTER_FOLDER_ID);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function props_() {
  const p = PropertiesService.getScriptProperties().getProperties();
  if (p.SUPABASE_URL) p.SUPABASE_URL = p.SUPABASE_URL.replace(/\/$/, '');
  return p;
}

function rpc_(fn, payload) {
  const p = props_();
  const headers = { apikey: p.SUPABASE_SERVICE_KEY };
  // Legacy JWT keys also need an Authorization header; new sb_secret_ keys use apikey alone.
  if (/^eyJ/.test(p.SUPABASE_SERVICE_KEY)) headers.Authorization = 'Bearer ' + p.SUPABASE_SERVICE_KEY;
  const res = UrlFetchApp.fetch(p.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code >= 300) throw new Error(fn + ' failed (' + code + '): ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

function alertOfficersOnce_(key, subject, body) {
  const store = PropertiesService.getScriptProperties();
  const k = 'ALERT_' + key;
  const last = Number(store.getProperty(k) || 0);
  if (Date.now() - last < 24 * 3600000) return; // at most once a day per alert
  MailApp.sendEmail({ to: props_().OFFICER_EMAILS, subject: subject, body: body });
  store.setProperty(k, String(Date.now()));
}

/** Accepts Date objects, "2027-04-30", "4/30/2027", "Apr 30, 2027". Returns "YYYY-MM-DD" or "". */
function toIsoDate_(value) {
  if (value instanceof Date && !isNaN(value)) return Utilities.formatDate(value, 'America/Denver', 'yyyy-MM-dd');
  const s = String(value || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad_(m[2]) + '-' + pad_(m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad_(m[1]) + '-' + pad_(m[2]);
  const d = new Date(s);
  return isNaN(d) ? '' : Utilities.formatDate(d, 'America/Denver', 'yyyy-MM-dd');
}

/** Scout deadlines are often "Jan 15" with no year: pick the next upcoming occurrence. */
function deadlineDate_(rawValue, displayValue) {
  if (rawValue instanceof Date && !isNaN(rawValue)) return toIsoDate_(rawValue);
  const s = String(displayValue || '').trim();
  if (!s || !/\d/.test(s) || /rolling|tbd|n\/a/i.test(s)) return ''; // "-", "Not stated", etc.
  if (/\d{4}/.test(s)) return toIsoDate_(s);
  const now = new Date();
  const guess = new Date(s + ' ' + now.getFullYear());
  if (isNaN(guess)) return '';
  if (guess < new Date(now.getTime() - 60 * 86400000)) guess.setFullYear(now.getFullYear() + 1);
  return Utilities.formatDate(guess, 'America/Denver', 'yyyy-MM-dd');
}

function pad_(n) { return String(n).padStart(2, '0'); }
