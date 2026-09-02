/**
 * EnergyTech Quiz App Google Sheets backend
 *
 * Setup:
 * 1. Create a Google Sheet.
 * 2. Extensions > Apps Script.
 * 3. Paste this file into Code.gs.
 * 4. Run setup() once and authorize it.
 * 5. Deploy > New deployment > Web app.
 *    - Execute as: Me
 *    - Who has access: Anyone with the link
 *
 * Instructor accounts:
 * The first time the backend runs, it automatically creates one bootstrap
 * admin account using ADMIN_USERNAME / ADMIN_DEFAULT_PASSWORD below.
 * Log in with that account first and change the password immediately
 * (Instructor Mode > Change my password). Colleagues can then request
 * their own account from the app; you approve them from the admin panel.
 */

const SHEET_SESSIONS = 'Sessions';
const SHEET_ATTEMPTS = 'Attempts';
const SHEET_ITEMS = 'ItemResponses';
const SHEET_INSTRUCTORS = 'Instructors';
const SHEET_INTAKES = 'Intakes';
const SHEET_GROUPS = 'Groups';
const SHEET_TRAINEES = 'Trainees';
const SHEET_RETAKES = 'Retakes';

// Bootstrap admin account. Change ADMIN_DEFAULT_PASSWORD here before your
// first deployment if you can, and change it again from inside the app
// right after your first login either way -- it is a real login password now,
// not just a client-side gate, so do not leave it at the default.
const ADMIN_USERNAME = 'adnen';
const ADMIN_DEFAULT_PASSWORD = '12341234';

// How long a login stays valid before an instructor has to log in again.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const SESSION_HEADERS = [
  'Timestamp', 'Session Code', 'Session Name', 'Group', 'Mode',
  'Question Set', 'Question Set Key', 'Seed', 'Question Count',
  'Order Mode', 'Show Original Numbers', 'Require All',
  'Owner Username', 'Owner Display Name',
  'Intake', 'Allow Walk-In', 'Shuffle Each Launch', 'Results Published'
];

const ATTEMPT_HEADERS = [
  'Timestamp', 'Attempt ID', 'Name', 'Group', 'EnergyTech ID',
  'Session Code', 'Session Name', 'Mode',
  'Question Set', 'Question Set Key', 'Seed', 'Question Count', 'Order Mode',
  'Score', 'Total', 'Percentage', 'Wrong Questions', 'Unanswered Questions',
  'User Agent', 'Owner Username', 'Owner Display Name',
  'Intake', 'Registered', 'Order Seed'
];

const ITEM_HEADERS = [
  'Timestamp', 'Attempt ID', 'Name', 'Group', 'EnergyTech ID',
  'Session Code', 'Session Name', 'Mode',
  'Question Set', 'Question Set Key', 'Seed',
  'Quiz Question', 'Original Question', 'Lesson',
  'Trainee Answer', 'Correct Answer', 'Result',
  'Owner Username', 'Owner Display Name'
];

/* Set this to the exact words in the error message to arm eraseAllRecords_().
 * Left empty, that function refuses to run. Nothing else reads it. */
const CONFIRM_ERASE = '';

/* Creates the sheets and their header rows. Safe to run whenever, against a
 * live spreadsheet, as often as you like: a sheet that already holds rows is
 * left exactly as it was.
 *
 * It did not always work that way. Every run used to clear Sessions, Attempts
 * and ItemResponses back to their headers -- which is a reasonable way to
 * prepare an empty spreadsheet, and a disastrous thing to do to one in use.
 * Pressing Run in the Apps Script editor is how anybody checks a deployment is
 * alive, and doing so threw away every paper on record. Erasing is now a
 * separate function that has to be armed by hand, and this one only ever adds
 * what is missing. */
function setup() {
  ensureSheetWithHeaders_(SHEET_SESSIONS, SESSION_HEADERS);
  ensureSheetWithHeaders_(SHEET_ATTEMPTS, ATTEMPT_HEADERS);
  ensureSheetWithHeaders_(SHEET_ITEMS, ITEM_HEADERS);

  // Instructors has never been cleared here, so re-running setup() cannot
  // delete colleague accounts. It is created only if missing.
  getOrCreateInstructorsSheet_();
}

/* Create the sheet if it is missing, write the header row if the sheet is
 * empty, and touch nothing otherwise. The one thing it must never do is remove
 * a row somebody's mark is sitting in. */
function ensureSheetWithHeaders_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  sheet.setFrozenRows(1);
  return sheet;
}

/* Empties Sessions, Attempts and ItemResponses and puts their headers back.
 *
 * This throws away every recorded attempt and cannot be undone from inside the
 * script. It is deliberately awkward: set CONFIRM_ERASE at the top of this file
 * to the words in the message below, run this once, then set it back to ''.
 * Nothing in the app calls it, and it is not reachable over the web. */
function eraseAllRecords_() {
  if (CONFIRM_ERASE !== 'ERASE EVERYTHING') {
    throw new Error(
      'eraseAllRecords_ is not armed, and has done nothing. It deletes every ' +
      'recorded attempt. If that is really what you want, set CONFIRM_ERASE at ' +
      'the top of Code.gs to "ERASE EVERYTHING", run this once, then set it ' +
      'back to "". Take a copy of the spreadsheet first.');
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [[SHEET_SESSIONS, SESSION_HEADERS],
   [SHEET_ATTEMPTS, ATTEMPT_HEADERS],
   [SHEET_ITEMS, ITEM_HEADERS]].forEach(function (pair) {
    const sheet = ss.getSheetByName(pair[0]);
    if (!sheet) return;
    sheet.clear();
    sheet.appendRow(pair[1]);
    sheet.setFrozenRows(1);
  });
  getOrCreateInstructorsSheet_();
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : '{}');
    ensureSheets_();
    if (payload.type === 'quiz_session') {
      const auth = requireAuth_({ token: payload.token });
      if (!auth.ok) return json_(auth);
      saveSession_(payload.session || {}, auth.instructor);
      return json_({ ok: true, type: 'quiz_session' });
    }
    if (payload.type === 'trainee_import') {
      const out = traineeImport_(payload);
      SpreadsheetApp.flush();
      return json_(out);
    }
    // saveAttempt_ can refuse -- a second sitting of an exam. The browser posts
    // no-cors and cannot read this, but returning the refusal rather than a
    // blanket ok keeps the reply honest for anything that can.
    const saved = saveAttempt_(payload);
    SpreadsheetApp.flush();
    if (saved && saved.ok === false) return json_(saved);
    return json_({ ok: true, type: 'quiz_attempt' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  const params = e.parameter || {};
  let data;
  try {
    ensureSheets_();
    if (params.action === 'summary') {
      data = buildSummary_(params);
    } else if (params.action === 'session') {
      data = getSession_(params.code || '', params.token || '');
    } else if (params.action === 'ping') {
      data = { ok: true, message: 'EnergyTech Quiz backend is running.' };
    } else if (params.action === 'auth_signup') {
      data = authSignup_(params);
    } else if (params.action === 'auth_login') {
      data = authLogin_(params);
    } else if (params.action === 'auth_logout') {
      data = authLogout_(params);
    } else if (params.action === 'auth_change_password') {
      data = authChangePassword_(params);
    } else if (params.action === 'admin_list_instructors') {
      data = adminListInstructors_(params);
    } else if (params.action === 'admin_set_status') {
      data = adminSetStatus_(params);
    } else if (params.action === 'admin_set_role') {
      data = adminSetRole_(params);
    } else if (params.action === 'roster_list') {
      data = rosterList_(params);
    } else if (params.action === 'trainee_list') {
      data = traineeList_(params);
    } else if (params.action === 'intake_save') {
      data = intakeSave_(params);
    } else if (params.action === 'intake_delete') {
      data = intakeDelete_(params);
    } else if (params.action === 'group_save') {
      data = groupSave_(params);
    } else if (params.action === 'group_delete') {
      data = groupDelete_(params);
    } else if (params.action === 'trainee_save') {
      data = traineeSave_(params);
    } else if (params.action === 'trainee_delete') {
      data = traineeDelete_(params);
    } else if (params.action === 'trainee_history') {
      data = traineeHistory_(params);
    } else if (params.action === 'attempt_detail') {
      data = attemptDetail_(params);
    } else if (params.action === 'my_history') {
      data = myHistory_(params);
    } else if (params.action === 'my_attempt') {
      data = myAttempt_(params);
    } else if (params.action === 'session_list') {
      data = sessionList_(params);
    } else if (params.action === 'session_publish') {
      data = sessionPublish_(params, true);
    } else if (params.action === 'session_unpublish') {
      data = sessionPublish_(params, false);
    } else if (params.action === 'retake_allow') {
      data = retakeAllow_(params);
    } else if (params.action === 'retake_list') {
      data = retakeList_(params);
    } else if (params.action === 'session_report') {
      data = sessionReport_(params);
    } else if (params.action === 'trainee_move') {
      data = traineeMove_(params);
    } else if (params.action === 'trainee_set_account') {
      data = traineeSetAccount_(params);
    } else if (params.action === 'trainee_signup') {
      data = traineeSignup_(params);
    } else if (params.action === 'trainee_login') {
      data = traineeLogin_(params);
    } else if (params.action === 'trainee_logout') {
      data = traineeLogout_(params);
    } else if (params.action === 'trainee_me') {
      data = traineeMe_(params);
    } else if (params.action === 'trainee_change_password') {
      data = traineeChangePassword_(params);
    } else {
      data = { ok: true, message: 'EnergyTech Quiz backend is running.' };
    }
  } catch (err) {
    data = { ok: false, error: String(err), stack: err && err.stack ? String(err.stack) : '' };
  }

  // Any pending Sheets write is committed before the reply goes out, so the
  // browser's next read is guaranteed to see what this call just did.
  try { SpreadsheetApp.flush(); } catch (e) { /* nothing pending */ }

  if (params.callback) {
    return ContentService
      .createTextOutput(String(params.callback) + '(' + JSON.stringify(data) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(data);
}

/* ---------------- Instructor accounts / authentication ---------------- */

function normalizeUsername_(u) {
  return String(u || '').trim().toLowerCase();
}

function makeSalt_() {
  return Utilities.getUuid();
}

function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + ':' + String(password));
  return bytes.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('');
}

function makeToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function getOrCreateInstructorsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_INSTRUCTORS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_INSTRUCTORS);
    sheet.appendRow([
      'Timestamp', 'Username', 'Display Name', 'Password Hash', 'Salt',
      'Role', 'Status', 'Requested At', 'Approved By', 'Approved At',
      'Token', 'Token Expires'
    ]);
    sheet.setFrozenRows(1);
  }
  ensureAdmin_(sheet);
  return sheet;
}

function ensureAdmin_(sheet) {
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (normalizeUsername_(values[r][1]) === normalizeUsername_(ADMIN_USERNAME)) return;
  }
  const salt = makeSalt_();
  const now = new Date();
  sheet.appendRow([
    now, ADMIN_USERNAME, 'Admin', hashPassword_(ADMIN_DEFAULT_PASSWORD, salt), salt,
    'admin', 'approved', now, 'system', now, '', ''
  ]);
}

function findInstructorRow_(sheet, predicate) {
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (predicate(values[r])) return { rowNumber: r + 1, row: values[r] };
  }
  return null;
}

function instructorPublicInfo_(row) {
  return {
    username: String(row[1] || ''),
    displayName: String(row[2] || ''),
    role: String(row[5] || 'instructor'),
    status: String(row[6] || 'pending'),
    requestedAt: row[7] instanceof Date ? row[7].toISOString() : String(row[7] || '')
  };
}

function authSignup_(params) {
  const username = normalizeUsername_(params.username);
  const password = String(params.password || '');
  const displayName = String(params.displayName || '').trim();
  if (!username || !/^[a-z0-9._-]{3,30}$/.test(username)) {
    return { ok: false, error: 'Username must be 3-30 characters (letters, numbers, dot, dash, underscore).' };
  }
  if (!displayName) return { ok: false, error: 'Enter your display name.' };
  if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };

  const sheet = getOrCreateInstructorsSheet_();
  const existing = findInstructorRow_(sheet, row => normalizeUsername_(row[1]) === username);
  if (existing) return { ok: false, error: 'That username is already taken or already requested.' };

  const salt = makeSalt_();
  const now = new Date();
  appendTextRow_(sheet, [
    now, username, displayName, hashPassword_(password, salt), salt,
    'instructor', 'pending', now, '', '', '', ''
  ], [2, 3]);
  return { ok: true, status: 'pending', message: 'Account requested. An admin must approve it before you can log in.' };
}

function authLogin_(params) {
  const username = normalizeUsername_(params.username);
  const password = String(params.password || '');
  if (!username || !password) return { ok: false, error: 'Enter a username and password.' };

  const sheet = getOrCreateInstructorsSheet_();
  const found = findInstructorRow_(sheet, row => normalizeUsername_(row[1]) === username);
  if (!found) return { ok: false, error: 'No account with that username.' };

  const row = found.row;
  const hash = hashPassword_(password, String(row[4] || ''));
  if (hash !== String(row[3] || '')) return { ok: false, error: 'Incorrect password.' };

  const status = String(row[6] || 'pending');
  if (status === 'pending') return { ok: false, error: 'Your account is waiting for admin approval.' };
  if (status !== 'approved') return { ok: false, error: 'Your account access was turned off. Contact your admin.' };

  const token = makeToken_();
  const expires = new Date(Date.now() + TOKEN_TTL_MS);
  sheet.getRange(found.rowNumber, 11, 1, 2).setValues([[token, expires]]);

  return {
    ok: true,
    token,
    username: String(row[1] || ''),
    displayName: String(row[2] || username),
    role: String(row[5] || 'instructor')
  };
}

function authLogout_(params) {
  const auth = requireAuth_(params);
  if (auth.ok) {
    const sheet = getOrCreateInstructorsSheet_();
    sheet.getRange(auth.rowNumber, 11, 1, 2).setValues([['', '']]);
  }
  return { ok: true };
}

function authChangePassword_(params) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;

  const oldPassword = String(params.oldPassword || '');
  const newPassword = String(params.newPassword || '');
  if (newPassword.length < 6) return { ok: false, error: 'New password must be at least 6 characters.' };

  const sheet = getOrCreateInstructorsSheet_();
  const values = sheet.getDataRange().getValues();
  const row = values[auth.rowNumber - 1];
  const currentHash = hashPassword_(oldPassword, String(row[4] || ''));
  if (currentHash !== String(row[3] || '')) return { ok: false, error: 'Current password is incorrect.' };

  const salt = makeSalt_();
  sheet.getRange(auth.rowNumber, 4, 1, 2).setValues([[hashPassword_(newPassword, salt), salt]]);
  return { ok: true, message: 'Password changed.' };
}

// Verifies a token on every authenticated call and re-checks the account's
// current status from the sheet (not just the token), so revoking or
// rejecting an account cuts off access immediately even with an unexpired token.
function requireAuth_(params) {
  const token = String((params && params.token) || '');
  if (!token) return { ok: false, error: 'Not logged in.' };

  const sheet = getOrCreateInstructorsSheet_();
  const found = findInstructorRow_(sheet, row => String(row[10] || '') === token);
  if (!found) return { ok: false, error: 'Session expired. Please log in again.' };

  const row = found.row;
  const status = String(row[6] || 'pending');
  if (status !== 'approved') return { ok: false, error: 'Account access is no longer approved.' };

  const expires = row[11] ? new Date(row[11]) : null;
  if (!expires || isNaN(expires.getTime()) || expires.getTime() < Date.now()) {
    return { ok: false, error: 'Session expired. Please log in again.' };
  }

  return {
    ok: true,
    rowNumber: found.rowNumber,
    instructor: {
      username: String(row[1] || ''),
      displayName: String(row[2] || ''),
      role: String(row[5] || 'instructor')
    }
  };
}

function adminListInstructors_(params) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;
  if (auth.instructor.role !== 'admin') return { ok: false, error: 'Admin access required.' };

  const sheet = getOrCreateInstructorsSheet_();
  const values = sheet.getDataRange().getValues();
  const instructors = [];
  for (let r = 1; r < values.length; r++) instructors.push(instructorPublicInfo_(values[r]));
  return { ok: true, instructors };
}

function adminSetStatus_(params) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;
  if (auth.instructor.role !== 'admin') return { ok: false, error: 'Admin access required.' };

  const status = String(params.status || '');
  if (['approved', 'rejected', 'pending'].indexOf(status) === -1) return { ok: false, error: 'Invalid status.' };

  const target = normalizeUsername_(params.targetUsername);
  const sheet = getOrCreateInstructorsSheet_();
  const found = findInstructorRow_(sheet, row => normalizeUsername_(row[1]) === target);
  if (!found) return { ok: false, error: 'Instructor not found.' };

  sheet.getRange(found.rowNumber, 7).setValue(status);
  sheet.getRange(found.rowNumber, 9, 1, 2).setValues([[auth.instructor.username, new Date()]]);
  if (status !== 'approved') sheet.getRange(found.rowNumber, 11, 1, 2).setValues([['', '']]); // revoke any active token

  return { ok: true, username: target, status };
}

function adminSetRole_(params) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;
  if (auth.instructor.role !== 'admin') return { ok: false, error: 'Admin access required.' };

  const role = String(params.role || '');
  if (['admin', 'instructor'].indexOf(role) === -1) return { ok: false, error: 'Invalid role.' };

  const target = normalizeUsername_(params.targetUsername);
  const sheet = getOrCreateInstructorsSheet_();
  const values = sheet.getDataRange().getValues();
  const found = findInstructorRow_(sheet, row => normalizeUsername_(row[1]) === target);
  if (!found) return { ok: false, error: 'Instructor not found.' };

  if (role === 'instructor' && String(found.row[5]) === 'admin') {
    const approvedAdmins = values.slice(1).filter(row => String(row[5]) === 'admin' && String(row[6]) === 'approved').length;
    if (approvedAdmins <= 1) return { ok: false, error: 'Cannot remove the last admin.' };
  }

  sheet.getRange(found.rowNumber, 6).setValue(role);
  return { ok: true, username: target, role };
}

/* ---------------- Sessions / attempts / dashboard ---------------- */


/* =====================================================================
 * Intake management: Intakes -> Groups -> Trainees
 *
 * These three sheets are created on demand and are never cleared by
 * setup(), so resetting quiz results cannot wipe a roster.
 * ===================================================================== */

/* Google Sheets converts anything that looks like a date or a number as it is
 * written: an intake labelled MAY26 comes back as 26 May 2026, and an all-digit
 * trainee ID silently loses its leading zeros. Formatting the target cells as
 * plain text is what prevents it, and it has to happen BEFORE the write --
 * reformatting afterwards only changes how the already-converted value is
 * displayed, it does not give the original text back.
 *
 * textCols are 1-based column numbers that must stay verbatim. */
function writeRow_(sheet, row, values, textCols) {
  (textCols || []).forEach(c => sheet.getRange(row, c).setNumberFormat('@'));
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  return row;
}

function appendTextRow_(sheet, values, textCols) {
  return writeRow_(sheet, sheet.getLastRow() + 1, values, textCols);
}

function writeRows_(sheet, startRow, rows, textCols) {
  if (!rows.length) return;
  (textCols || []).forEach(c => sheet.getRange(startRow, c, rows.length, 1).setNumberFormat('@'));
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
}

function setTextCell_(sheet, row, col, value) {
  sheet.getRange(row, col).setNumberFormat('@').setValue(value);
}

function setTextBlock_(sheet, row, col, values) {
  sheet.getRange(row, col, 1, values.length).setNumberFormat('@');
  sheet.getRange(row, col, 1, values.length).setValues([values]);
}

function ensureHeaders_(sheet, headers) {
  // Append any header this version expects but the sheet does not have yet,
  // so an existing spreadsheet gains new columns without losing its rows.
  const width = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getLastRow() ? sheet.getRange(1, 1, 1, width).getValues()[0] : [];
  const missing = headers.filter(h => existing.indexOf(h) === -1);
  if (!missing.length) return;
  if (!sheet.getLastRow()) {
    sheet.appendRow(headers);
  } else {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  sheet.setFrozenRows(1);
}

const GROUP_NAME_RE = /^G([1-9]|1[0-9]|20)$/;

const INTAKE_HEADERS  = ['Timestamp', 'Label', 'Status', 'Created By'];
const GROUP_HEADERS   = ['Timestamp', 'Intake', 'Group', 'Created By'];
/* One Name column rather than Family + Given: Saudi names run
 * given-father-grandfather-family and do not split cleanly in two. */
/* One row per retake granted. A row is a permission to sit an exam once more;
 * it is spent by being used, not deleted. */
const RETAKE_HEADERS  = ['Timestamp', 'Session Code', 'EnergyTech ID', 'Granted By'];
const TRAINEE_HEADERS = ['Timestamp', 'EnergyTech ID', 'Name',
                         'Intake', 'Group', 'Account Status', 'Password Hash', 'Salt',
                         'Token', 'Token Expires', 'Created By'];

var ENSURED_ = {};        // reset on every execution, so it cannot go stale

/* Existing sheets carry Family Name and Given Name. Join them into one Name --
 * given first, so "Mohammed Abdullah Saleh" + "Al-Otaibi" reads as the full name
 * in the usual order -- then drop the spare column. Runs once: after it, there
 * is no 'Given Name' header to find. */
function migrateTraineeNames_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_TRAINEES);
  if (!sheet || sheet.getLastRow() < 1) return;

  const width = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, width).getValues()[0].map(h => String(h || ''));
  const gi = header.indexOf('Given Name');
  const fi = header.indexOf('Family Name');
  if (gi === -1 || fi === -1) return;                   // nothing to migrate

  const rows = sheet.getLastRow() - 1;
  if (rows > 0) {
    const fam = sheet.getRange(2, fi + 1, rows, 1).getValues();
    const giv = sheet.getRange(2, gi + 1, rows, 1).getValues();
    const merged = fam.map((r, i) =>
      [(String(giv[i][0] || '').trim() + ' ' + String(r[0] || '').trim()).trim()]);
    sheet.getRange(2, fi + 1, rows, 1).setNumberFormat('@');
    sheet.getRange(2, fi + 1, rows, 1).setValues(merged);
  }
  sheet.deleteColumn(gi + 1);
  sheet.getRange(1, fi + 1).setValue('Name');
}

function rosterSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    ENSURED_[name] = true;
    return sheet;
  }
  if (!ENSURED_[name]) {
    ensureHeaders_(sheet, headers);
    ENSURED_[name] = true;
  }
  return sheet;
}

function intakesSheet_()  { return rosterSheet_(SHEET_INTAKES, INTAKE_HEADERS); }
function groupsSheet_()   { return rosterSheet_(SHEET_GROUPS, GROUP_HEADERS); }
function traineesSheet_() { return rosterSheet_(SHEET_TRAINEES, TRAINEE_HEADERS); }
function retakesSheet_()  { return rosterSheet_(SHEET_RETAKES, RETAKE_HEADERS); }

/* ------------------------- one sitting per exam --------------------------- */

/* How many times this trainee has submitted this session, and how many sittings
 * they are entitled to: one, plus one for each retake the instructor has
 * granted. Counting grants rather than flipping a flag means a grant is spent
 * by being used, so "let them sit it again" cannot quietly become "let them sit
 * it as often as they like". */
function sittingsFor_(code, id) {
  code = String(code || '').toUpperCase().trim();
  id = normId_(id);
  if (!code || !id) return { sat: 0, allowed: 1, maySit: true };

  let sat = 0;
  rowsOf_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ATTEMPTS)).forEach(row => {
    if (String(row[5] || '').toUpperCase().trim() === code && normId_(row[4]) === id) sat++;
  });
  let granted = 0;
  rowsOf_(retakesSheet_()).forEach(row => {
    if (String(row[1] || '').toUpperCase().trim() === code && normId_(row[2]) === id) granted++;
  });
  return { sat: sat, allowed: 1 + granted, maySit: sat < 1 + granted };
}

/* Exams only. A practice quiz may be sat as often as the trainee likes -- that
 * is what practice is for. Returns null when the sitting is allowed. */
function examBlocked_(code, id, mode) {
  if (String(mode || '').toLowerCase() !== 'assessment') return null;
  if (!normId_(id)) return null;             // a guest has no roster identity
  const s = sittingsFor_(code, id);
  return s.maySit ? null : s;
}

function retakeAllow_(params) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;
  ensureSheets_();

  const code = String(params.sessionCode || '').toUpperCase().trim();
  const id = normId_(params.energytechId);
  if (!code || !id) return { ok: false, error: 'Name both the session and the trainee.' };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SESSIONS);
  const rowNumber = sessionRowNumber_(sheet, code);
  if (!rowNumber) return { ok: false, error: 'Session ' + code + ' not found.' };
  const owner = normalizeUsername_(sheet.getRange(rowNumber, 13).getValue());
  if (auth.instructor.role !== 'admin' && owner !== normalizeUsername_(auth.instructor.username)) {
    return { ok: false, error: 'That session belongs to another instructor.' };
  }
  if (!findTraineeRow_(traineesSheet_(), id)) {
    return { ok: false, error: 'Trainee ' + id + ' is not on the roster.' };
  }

  appendTextRow_(retakesSheet_(), [new Date(), code, id, auth.instructor.username], [2, 3]);
  SpreadsheetApp.flush();
  const s = sittingsFor_(code, id);
  return { ok: true, sessionCode: code, energytechId: id, sat: s.sat, allowed: s.allowed };
}

/* Who has sat this session, and who is free to sit it again. */
function retakeList_(params) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;
  ensureSheets_();

  const code = String(params.sessionCode || '').toUpperCase().trim();
  if (!code) return { ok: false, error: 'No session named.' };

  const byId = {};
  rowsOf_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ATTEMPTS)).forEach(row => {
    if (String(row[5] || '').toUpperCase().trim() !== code) return;
    const id = normId_(row[4]);
    if (!id) return;
    if (!byId[id]) byId[id] = { energytechId: id, name: String(row[2] || ''), sat: 0, allowed: 1 };
    byId[id].sat++;
  });
  rowsOf_(retakesSheet_()).forEach(row => {
    if (String(row[1] || '').toUpperCase().trim() !== code) return;
    const id = normId_(row[2]);
    if (!byId[id]) byId[id] = { energytechId: id, name: '', sat: 0, allowed: 1 };
    byId[id].allowed++;
  });
  const list = Object.keys(byId).map(k => {
    byId[k].maySitAgain = byId[k].sat < byId[k].allowed;
    return byId[k];
  }).sort((a, b) => a.energytechId.localeCompare(b.energytechId));
  return { ok: true, sessionCode: code, trainees: list };
}

function normLabel_(x) { return String(x || '').trim().toUpperCase(); }
function normId_(x)    { return String(x || '').trim().toUpperCase(); }

function requireAdmin_(params) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;
  if (auth.instructor.role !== 'admin') return { ok: false, error: 'Admin access required.' };
  return auth;
}

function rowsOf_(sheet) {
  const v = sheet.getDataRange().getValues();
  return v.length > 1 ? v.slice(1) : [];
}

/* ---------------- read ---------------- */

function rosterList_(params) {
  const auth = requireAuth_(params);              // any signed-in instructor may read
  if (!auth.ok) return auth;

  const intakes = rowsOf_(intakesSheet_()).map(r => ({
    label: String(r[1] || ''), status: String(r[2] || 'active'),
    createdBy: String(r[3] || '')
  })).filter(i => i.label);

  const groups = rowsOf_(groupsSheet_()).map(r => ({
    intake: String(r[1] || ''), name: String(r[2] || '')
  })).filter(g => g.intake && g.name);

  const counts = {};
  const accounts = {};
  rowsOf_(traineesSheet_()).forEach(r => {
    const k = String(r[3] || '') + '|' + String(r[4] || '');
    counts[k] = (counts[k] || 0) + 1;
    if (String(r[5] || '') === 'active') accounts[k] = (accounts[k] || 0) + 1;
  });

  return {
    ok: true,
    intakes: intakes,
    groups: groups.map(g => Object.assign(g, {
      trainees: counts[g.intake + '|' + g.name] || 0,
      withAccount: accounts[g.intake + '|' + g.name] || 0
    })),
    viewer: { username: auth.instructor.username, role: auth.instructor.role }
  };
}

function traineeList_(params) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;
  const intake = normLabel_(params.intake);
  const group = normLabel_(params.group);
  const out = [];
  rowsOf_(traineesSheet_()).forEach(r => {
    if (intake && normLabel_(r[3]) !== intake) return;
    if (group && normLabel_(r[4]) !== group) return;
    out.push({
      energytechId: String(r[1] || ''), name: String(r[2] || ''),
      intake: String(r[3] || ''), group: String(r[4] || ''),
      accountStatus: String(r[5] || 'none')
    });
  });
  return { ok: true, trainees: out };
}

/* ---------------- intakes ---------------- */

function intakeSave_(params) {
  const auth = requireAdmin_(params);
  if (!auth.ok) return auth;
  const label = normLabel_(params.label);
  const previous = normLabel_(params.previousLabel);
  if (!label || !/^[A-Z0-9 _-]{2,30}$/.test(label)) {
    return { ok: false, error: 'Intake label must be 2-30 characters (letters, numbers, space, dash, underscore).' };
  }
  const sheet = intakesSheet_();
  const rows = rowsOf_(sheet);
  const clash = rows.some((r, i) => normLabel_(r[1]) === label && normLabel_(r[1]) !== previous);
  if (clash) return { ok: false, error: 'An intake with that label already exists.' };

  if (previous) {                                  // rename, cascading to children
    let found = -1;
    rows.forEach((r, i) => { if (normLabel_(r[1]) === previous) found = i + 2; });
    if (found === -1) return { ok: false, error: 'Intake not found.' };
    setTextCell_(sheet, found, 2, label);
    const g = groupsSheet_();
    rowsOf_(g).forEach((r, i) => { if (normLabel_(r[1]) === previous) setTextCell_(g, i + 2, 2, label); });
    const t = traineesSheet_();
    rowsOf_(t).forEach((r, i) => { if (normLabel_(r[3]) === previous) setTextCell_(t, i + 2, 4, label); });
    return { ok: true, label: label, renamedFrom: previous };
  }

  appendTextRow_(sheet, [new Date(), label, 'active', auth.instructor.username], [2]);
  return { ok: true, label: label };
}

function intakeDelete_(params) {
  const auth = requireAdmin_(params);
  if (!auth.ok) return auth;
  const label = normLabel_(params.label);
  const groups = rowsOf_(groupsSheet_()).filter(r => normLabel_(r[1]) === label);
  const trainees = rowsOf_(traineesSheet_()).filter(r => normLabel_(r[3]) === label);
  if (groups.length || trainees.length) {
    return { ok: false, error: 'Intake ' + label + ' still has ' + groups.length + ' group(s) and '
      + trainees.length + ' trainee(s). Delete or move them first.' };
  }
  const sheet = intakesSheet_();
  const rows = rowsOf_(sheet);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (normLabel_(rows[i][1]) === label) sheet.deleteRow(i + 2);
  }
  return { ok: true, deleted: label };
}

/* ---------------- groups ---------------- */

function groupSave_(params) {
  const auth = requireAdmin_(params);
  if (!auth.ok) return auth;
  const intake = normLabel_(params.intake);
  const name = normLabel_(params.name);
  const previous = normLabel_(params.previousName);
  if (!intake) return { ok: false, error: 'Choose an intake for this group.' };
  if (!rowsOf_(intakesSheet_()).some(r => normLabel_(r[1]) === intake)) {
    return { ok: false, error: 'Intake ' + intake + ' does not exist.' };
  }
  if (!GROUP_NAME_RE.test(name)) {
    return { ok: false, error: 'Group name must be G1 to G20.' };
  }
  const sheet = groupsSheet_();
  const rows = rowsOf_(sheet);
  if (rows.some(r => normLabel_(r[1]) === intake && normLabel_(r[2]) === name && name !== previous)) {
    return { ok: false, error: name + ' already exists in ' + intake + '.' };
  }
  if (previous) {
    let found = -1;
    rows.forEach((r, i) => { if (normLabel_(r[1]) === intake && normLabel_(r[2]) === previous) found = i + 2; });
    if (found === -1) return { ok: false, error: 'Group not found.' };
    setTextCell_(sheet, found, 3, name);
    const t = traineesSheet_();
    rowsOf_(t).forEach((r, i) => {
      if (normLabel_(r[3]) === intake && normLabel_(r[4]) === previous) setTextCell_(t, i + 2, 5, name);
    });
    return { ok: true, intake: intake, name: name, renamedFrom: previous };
  }
  appendTextRow_(sheet, [new Date(), intake, name, auth.instructor.username], [2, 3]);
  return { ok: true, intake: intake, name: name };
}

function groupDelete_(params) {
  const auth = requireAdmin_(params);
  if (!auth.ok) return auth;
  const intake = normLabel_(params.intake);
  const name = normLabel_(params.name);
  const trainees = rowsOf_(traineesSheet_())
    .filter(r => normLabel_(r[3]) === intake && normLabel_(r[4]) === name);
  if (trainees.length) {
    return { ok: false, error: name + ' in ' + intake + ' still has ' + trainees.length
      + ' trainee(s). Remove them first.' };
  }
  const sheet = groupsSheet_();
  const rows = rowsOf_(sheet);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (normLabel_(rows[i][1]) === intake && normLabel_(rows[i][2]) === name) sheet.deleteRow(i + 2);
  }
  return { ok: true, deleted: intake + ' / ' + name };
}

/* ---------------- trainees ---------------- */

function findTraineeRow_(sheet, id) {
  const rows = rowsOf_(sheet);
  for (let i = 0; i < rows.length; i++) {
    if (normId_(rows[i][1]) === normId_(id)) return { rowNumber: i + 2, row: rows[i] };
  }
  return null;
}

function traineeSave_(params) {
  const auth = requireAdmin_(params);
  if (!auth.ok) return auth;
  const id = normId_(params.energytechId);
  const previousId = normId_(params.previousId);
  const name = String(params.name || '').trim();
  const intake = normLabel_(params.intake);
  const group = normLabel_(params.group);

  if (!id) return { ok: false, error: 'EnergyTech ID is required.' };
  if (!name) return { ok: false, error: 'Enter the trainee\'s name.' };
  if (!rowsOf_(groupsSheet_()).some(r => normLabel_(r[1]) === intake && normLabel_(r[2]) === group)) {
    return { ok: false, error: 'Group ' + group + ' does not exist in intake ' + intake + '.' };
  }

  const sheet = traineesSheet_();
  const existing = findTraineeRow_(sheet, id);
  if (existing && normId_(existing.row[1]) !== previousId) {
    return { ok: false, error: 'A trainee with ID ' + id + ' already exists in '
      + String(existing.row[3] || '') + ' / ' + String(existing.row[4] || '') + '.' };
  }
  if (previousId) {
    const target = findTraineeRow_(sheet, previousId);
    if (!target) return { ok: false, error: 'Trainee not found.' };
    setTextBlock_(sheet, target.rowNumber, 2, [id, name, intake, group]);
    return { ok: true, energytechId: id, updated: true };
  }
  appendTextRow_(sheet, [new Date(), id, name, intake, group, 'none', '', '', '', '',
                         auth.instructor.username], [2, 3, 4, 5]);
  return { ok: true, energytechId: id };
}

function traineeDelete_(params) {
  const auth = requireAdmin_(params);
  if (!auth.ok) return auth;
  const id = normId_(params.energytechId);
  const sheet = traineesSheet_();
  const target = findTraineeRow_(sheet, id);
  if (!target) return { ok: false, error: 'Trainee ' + id + ' not found.' };

  // Refuse while the trainee has recorded attempts, so results never lose their owner.
  const attempts = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ATTEMPTS);
  let used = 0;
  if (attempts) {
    rowsOf_(attempts).forEach(r => { if (normId_(r[4]) === id) used++; });
  }
  if (used) {
    return { ok: false, error: 'Trainee ' + id + ' has ' + used + ' recorded attempt(s). '
      + 'Their results would lose their owner, so the record is kept. Revoke the account instead.' };
  }
  sheet.deleteRow(target.rowNumber);
  return { ok: true, deleted: id };
}

function traineeSetAccount_(params) {
  const auth = requireAdmin_(params);
  if (!auth.ok) return auth;
  const id = normId_(params.energytechId);
  const status = String(params.status || '');
  if (['active', 'revoked', 'none'].indexOf(status) === -1) return { ok: false, error: 'Invalid status.' };
  const sheet = traineesSheet_();
  const target = findTraineeRow_(sheet, id);
  if (!target) return { ok: false, error: 'Trainee ' + id + ' not found.' };
  sheet.getRange(target.rowNumber, 6).setValue(status);
  if (status !== 'active') sheet.getRange(target.rowNumber, 9, 1, 2).setValues([['', '']]);
  if (status === 'none') sheet.getRange(target.rowNumber, 7, 1, 2).setValues([['', '']]);
  return { ok: true, energytechId: id, status: status };
}

/* Imports a whole intake in one file. Each row may name its own group, so the
 * registry's single list for the intake goes in as-is instead of being split
 * into twenty per-group files; any group named in the file that does not exist
 * yet is created. A payload-level `group` still works, which is what a
 * per-group import sends. */
function traineeImport_(payload) {
  const auth = requireAdmin_({ token: payload.token });
  if (!auth.ok) return auth;

  const intake = normLabel_(payload.intake);
  if (!rowsOf_(intakesSheet_()).some(r => normLabel_(r[1]) === intake)) {
    return { ok: false, error: 'Intake ' + intake + ' does not exist.' };
  }
  const fallbackGroup = normLabel_(payload.group);
  const rows = payload.rows || [];

  const groupsSheet = groupsSheet_();
  const known = {};
  rowsOf_(groupsSheet).forEach(r => { if (normLabel_(r[1]) === intake) known[normLabel_(r[2])] = true; });

  // Validate every group the file asks for before creating any of them, so a
  // typo does not leave half the groups made and the rest refused.
  const wanted = [];
  const badNames = [];
  rows.forEach(t => {
    const g = normLabel_(t.group) || fallbackGroup;
    if (!g) return;
    if (!GROUP_NAME_RE.test(g)) {
      if (badNames.indexOf(g) === -1) badNames.push(g);
    } else if (wanted.indexOf(g) === -1) {
      wanted.push(g);
    }
  });
  if (badNames.length) {
    return { ok: false, error: 'These group names are not between G1 and G20: ' + badNames.join(', ') + '.' };
  }

  const created = [];
  wanted.forEach(g => {
    if (!known[g]) {
      appendTextRow_(groupsSheet, [new Date(), intake, g, auth.instructor.username], [2, 3]);
      known[g] = true;
      created.push(g);
    }
  });

  const sheet = traineesSheet_();
  const seen = {};
  rowsOf_(sheet).forEach(r => { seen[normId_(r[1])] = true; });

  const toAdd = [];
  let skipped = 0;
  let ungrouped = 0;
  const now = new Date();
  rows.forEach(t => {
    const id = normId_(t.energytechId);
    const g = normLabel_(t.group) || fallbackGroup;
    if (!id || seen[id]) { skipped++; return; }
    if (!g) { ungrouped++; return; }
    seen[id] = true;
    toAdd.push([now, id, String(t.name || '').trim(),
                intake, g, 'none', '', '', '', '', auth.instructor.username]);
  });
  if (toAdd.length) writeRows_(sheet, sheet.getLastRow() + 1, toAdd, [2, 3, 4, 5]);

  return { ok: true, added: toAdd.length, skipped: skipped, ungrouped: ungrouped, groupsCreated: created };
}

/* Moving trainees is its own action: doing it through trainee_save would need
 * one round trip per person and would rewrite names that are not changing. */
function traineeMove_(params) {
  const auth = requireAdmin_(params);
  if (!auth.ok) return auth;
  const intake = normLabel_(params.intake);
  const group = normLabel_(params.group);
  if (!rowsOf_(groupsSheet_()).some(r => normLabel_(r[1]) === intake && normLabel_(r[2]) === group)) {
    return { ok: false, error: 'Group ' + group + ' does not exist in intake ' + intake + '.' };
  }
  const ids = String(params.ids || '').split(',').map(normId_).filter(function (x) { return x; });
  if (!ids.length) return { ok: false, error: 'No trainees were chosen.' };

  const sheet = traineesSheet_();
  const missing = [];
  let moved = 0;
  ids.forEach(id => {
    const found = findTraineeRow_(sheet, id);
    if (!found) { missing.push(id); return; }
    setTextBlock_(sheet, found.rowNumber, 4, [intake, group]);
    moved++;
  });
  return { ok: true, moved: moved, missing: missing, intake: intake, group: group };
}


/* =====================================================================
 * Trainee accounts
 *
 * A trainee signs up with the EnergyTech ID that is already on a roster
 * and chooses a password. Being on a roster is what authorises the
 * account, so there is no approval queue -- but an admin can revoke one.
 * ===================================================================== */

function traineePublic_(row) {
  return {
    energytechId: String(row[1] || ''),
    name: String(row[2] || ''),
    intake: String(row[3] || ''),
    group: String(row[4] || ''),
    accountStatus: String(row[5] || 'none')
  };
}

function traineeSignup_(params) {
  const id = normId_(params.energytechId);
  const password = String(params.password || '');
  if (!id) return { ok: false, error: 'Enter your EnergyTech ID.' };
  if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };

  const sheet = traineesSheet_();
  const found = findTraineeRow_(sheet, id);
  if (!found) {
    return { ok: false, error: 'That EnergyTech ID is not on any intake list. Ask your instructor to add you.' };
  }
  const status = String(found.row[5] || 'none');
  if (status === 'active') {
    return { ok: false, error: 'An account already exists for this ID. Use Log in, or ask an admin to reset it.' };
  }
  if (status === 'revoked') {
    return { ok: false, error: 'Access for this ID has been turned off. Contact your instructor.' };
  }

  const salt = makeSalt_();
  const token = makeToken_();
  const expires = new Date(Date.now() + TOKEN_TTL_MS);
  sheet.getRange(found.rowNumber, 6, 1, 5)
       .setValues([['active', hashPassword_(password, salt), salt, token, expires]]);
  found.row[5] = 'active';                       // report the row as it now is
  return { ok: true, token: token, trainee: traineePublic_(found.row) };
}

function traineeLogin_(params) {
  const id = normId_(params.energytechId);
  const password = String(params.password || '');
  if (!id || !password) return { ok: false, error: 'Enter your EnergyTech ID and password.' };

  const sheet = traineesSheet_();
  const found = findTraineeRow_(sheet, id);
  if (!found) return { ok: false, error: 'No trainee with that EnergyTech ID.' };

  const status = String(found.row[5] || 'none');
  if (status === 'none') return { ok: false, error: 'No account yet for this ID. Use "Create my account" first.' };
  if (status !== 'active') return { ok: false, error: 'Access for this ID has been turned off. Contact your instructor.' };

  if (hashPassword_(password, String(found.row[7] || '')) !== String(found.row[6] || '')) {
    return { ok: false, error: 'Incorrect password.' };
  }
  const token = makeToken_();
  const expires = new Date(Date.now() + TOKEN_TTL_MS);
  sheet.getRange(found.rowNumber, 9, 1, 2).setValues([[token, expires]]);
  return { ok: true, token: token, trainee: traineePublic_(found.row) };
}

// Re-reads the roster row on every call, so revoking an account or moving a
// trainee to another group takes effect immediately even on an unexpired token.
function requireTrainee_(params) {
  const token = String((params && params.token) || '');
  if (!token) return { ok: false, error: 'Not logged in.' };
  const sheet = traineesSheet_();
  const rows = rowsOf_(sheet);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][8] || '') !== token) continue;
    if (String(rows[i][5] || '') !== 'active') {
      return { ok: false, error: 'Access for this ID has been turned off. Contact your instructor.' };
    }
    const expires = rows[i][9] ? new Date(rows[i][9]) : null;
    if (!expires || isNaN(expires.getTime()) || expires.getTime() < Date.now()) {
      return { ok: false, error: 'Session expired. Please log in again.' };
    }
    return { ok: true, rowNumber: i + 2, trainee: traineePublic_(rows[i]) };
  }
  return { ok: false, error: 'Session expired. Please log in again.' };
}

function traineeMe_(params) {
  const auth = requireTrainee_(params);
  if (!auth.ok) return auth;
  return { ok: true, trainee: auth.trainee };
}

function traineeLogout_(params) {
  const auth = requireTrainee_(params);
  if (auth.ok) traineesSheet_().getRange(auth.rowNumber, 9, 1, 2).setValues([['', '']]);
  return { ok: true };
}

function traineeChangePassword_(params) {
  const auth = requireTrainee_(params);
  if (!auth.ok) return auth;
  const newPassword = String(params.newPassword || '');
  if (newPassword.length < 6) return { ok: false, error: 'New password must be at least 6 characters.' };
  const sheet = traineesSheet_();
  const row = rowsOf_(sheet)[auth.rowNumber - 2];
  if (hashPassword_(String(params.oldPassword || ''), String(row[7] || '')) !== String(row[6] || '')) {
    return { ok: false, error: 'Current password is incorrect.' };
  }
  const salt = makeSalt_();
  sheet.getRange(auth.rowNumber, 7, 1, 2).setValues([[hashPassword_(newPassword, salt), salt]]);
  return { ok: true, message: 'Password changed.' };
}

function saveSession_(s, owner) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_SESSIONS);
  const timestamp = new Date();
  const code = String(s.sessionCode || '').toUpperCase();
  if (!code) throw new Error('Missing session code.');

  appendTextRow_(sheet, [
    timestamp,
    code,
    s.sessionName || '',
    s.group || '',
    s.mode || 'practice',
    s.questionSet || '',
    s.questionSetKey || '',
    s.seed || '',
    s.questionCount || '',
    s.orderMode || 'original',
    s.showOriginalNumbers === false ? false : true,
    s.requireAll === false ? false : true,
    (owner && owner.username) || '',
    (owner && owner.displayName) || '',
    s.intake || '',
    s.allowWalkIn === true,
    s.shuffleEachLaunch === true,
    ''                       // Results Published -- set later, by the instructor
  ], [2, 3, 4, 15]);
}

/* The latest row for a session code. Saving a session appends rather than
 * overwrites, so "the session" is always the last row bearing the code. */
function sessionRowNumber_(sheet, code) {
  code = String(code || '').toUpperCase().trim();
  if (!code) return 0;
  const values = sheet.getDataRange().getValues();
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][1]).toUpperCase().trim() === code) return r + 1;
  }
  return 0;
}

/* Session code -> whether its results have been released to the trainees.
 * Read once per request; a doGet touches this for every attempt row. */
function publishedByCode_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SESSIONS);
  const out = {};
  if (!sheet) return out;
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    const code = String(values[r][1] || '').toUpperCase().trim();
    if (!code) continue;
    // Later rows win: re-saving a session supersedes the earlier row, and with
    // it any release. That is deliberate -- a re-saved exam is a new exam.
    out[code] = Boolean(values[r][17]);
  }
  return out;
}

/* `token`, when a signed-in trainee is asking, lets the reply say whether they
 * have already sat this exam -- so the app can refuse before drawing a paper
 * rather than after they have answered it. */
function getSession_(code, token) {
  ensureSheets_();
  code = String(code || '').toUpperCase().trim();
  if (!code) return { ok: false, error: 'Missing session code.' };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SESSIONS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: false, error: 'No sessions found.' };

  for (let r = values.length - 1; r >= 1; r--) {
    const row = values[r];
    if (String(row[1]).toUpperCase().trim() === code) {
      const mode = String(row[4] || 'practice');
      let sitting = null;
      if (token) {
        const who = requireTrainee_({ token: token });
        if (who.ok) {
          const s = sittingsFor_(code, who.trainee.energytechId);
          sitting = {
            sat: s.sat,
            allowed: s.allowed,
            maySit: mode.toLowerCase() !== 'assessment' ? true : s.maySit
          };
        }
      }
      return {
        ok: true,
        sitting: sitting,
        session: {
          sessionCode: String(row[1] || ''),
          sessionName: String(row[2] || ''),
          group: String(row[3] || ''),
          mode: mode,
          questionSet: String(row[5] || ''),
          questionSetKey: String(row[6] || ''),
          seed: String(row[7] || ''),
          questionCount: Number(row[8] || 30),
          orderMode: String(row[9] || 'original'),
          showOriginalNumbers: row[10] !== false,
          requireAll: row[11] !== false,
          intake: String(row[14] || ''),
          // A session made before these columns existed has no flag, and guests
          // stay locked out of it -- which is the safe default.
          allowWalkIn: row[15] === true || String(row[15]).toUpperCase() === 'TRUE',
          shuffleEachLaunch: row[16] === true || String(row[16]).toUpperCase() === 'TRUE',
          resultsPublished: Boolean(row[17])
        }
      };
    }
  }
  return { ok: false, error: 'Session code not found.' };
}

// Attempts come from trainees, who never log in, so the owning instructor
// is looked up from the session record itself rather than from the request.
function ownerForSessionCode_(code) {
  code = String(code || '').toUpperCase().trim();
  if (!code) return { username: '', displayName: '' };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SESSIONS);
  const values = sheet.getDataRange().getValues();
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][1]).toUpperCase().trim() === code) {
      return { username: String(values[r][12] || ''), displayName: String(values[r][13] || '') };
    }
  }
  return { username: '', displayName: '' };
}

function saveAttempt_(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const attempts = ss.getSheetByName(SHEET_ATTEMPTS);
  const items = ss.getSheetByName(SHEET_ITEMS);

  const timestamp = new Date();
  const student = p.student || {};
  const quiz = p.quiz || {};
  const session = p.session || {};
  const score = p.score || {};
  const attemptId = p.attemptId || ('ATT-' + timestamp.getTime());
  const sessionCode = quiz.sessionCode || session.sessionCode || '';
  const owner = ownerForSessionCode_(sessionCode);

  // If a trainee token came with the submission, take the name, ID, group and
  // intake from the roster row rather than from anything the browser typed.
  // A walk-in has no token and is recorded as unregistered.
  let identity = {
    name: student.name || '',
    group: student.group || '',
    energytechId: (student.energytechId || student.spspId || ''),
    intake: '',
    registered: 'walk-in'
  };
  if (p.traineeToken) {
    const t = requireTrainee_({ token: p.traineeToken });
    if (t.ok) {
      identity = {
        name: t.trainee.name,
        group: t.trainee.group,
        energytechId: t.trainee.energytechId,
        intake: t.trainee.intake,
        registered: 'yes'
      };
    }
  }

  // The app refuses to draw a second exam paper, but that is the browser's
  // opinion and the browser is not to be trusted. This is where it actually
  // holds: a second submission for an exam already sat is not written, whatever
  // sent it. A trainee mid-exam is unaffected -- they have no attempt yet.
  const blocked = examBlocked_(
    sessionCode,
    identity.registered === 'yes' ? identity.energytechId : '',
    quiz.mode || session.mode || ''
  );
  if (blocked) {
    return { ok: false, error: 'This exam has already been submitted for '
      + identity.energytechId + '. Ask your instructor to allow another sitting.' };
  }

  appendTextRow_(attempts, [
    timestamp,
    attemptId,
    identity.name,
    identity.group,
    identity.energytechId,
    sessionCode,
    quiz.sessionName || session.sessionName || '',
    quiz.mode || session.mode || '',
    quiz.questionSet || '',
    quiz.questionSetKey || '',
    quiz.seed || '',
    quiz.questionCount || '',
    quiz.orderMode || '',
    score.correct || 0,
    score.total || 0,
    score.percent || 0,
    (score.wrongQuestions || []).join(', '),
    (score.unansweredQuestions || []).join(', '),
    p.userAgent || '',
    owner.username,
    owner.displayName,
    identity.intake,
    identity.registered,
    // The per-launch seed. The session seed picks WHICH questions; this one
    // picks the order they and their choices were shown in, and without it the
    // review could not rebuild the paper this trainee actually saw.
    quiz.orderSeed || ''
  ], [3, 4, 5, 6, 22, 24]);

  const rows = (p.items || []).map(item => [
    timestamp,
    attemptId,
    identity.name,
    identity.group,
    identity.energytechId,
    sessionCode,
    quiz.sessionName || session.sessionName || '',
    quiz.mode || session.mode || '',
    quiz.questionSet || '',
    quiz.questionSetKey || '',
    quiz.seed || '',
    item.quizNumber || '',
    item.originalNumber || '',
    item.lesson || '',
    item.studentAnswer || '',
    item.correctAnswer || '',
    item.result || '',
    owner.username,
    owner.displayName
  ]);

  if (rows.length) {
    writeRows_(items, items.getLastRow() + 1, rows, [3, 4, 5]);
  }
}

/* One trainee's whole record: every attempt, plus how they do lesson by lesson.
 * The lesson tally is what turns a list of scores into something an instructor
 * can act on -- it names the topics to go back over.
 *
 * `mine(owner)` decides which rows the caller may see. An instructor passes a
 * filter that hides other instructors' sessions; a trainee reading their own
 * record passes one that allows everything, because their history is theirs no
 * matter who ran the session. Both routes share this body so that a change to
 * the lesson analysis can never apply to one and not the other. */
function historyFor_(id, mine, gateResults) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const found = findTraineeRow_(traineesSheet_(), id);
  const trainee = found ? traineePublic_(found.row) : { energytechId: id, name: '', intake: '', group: '', accountStatus: 'none' };

  const published = gateResults ? publishedByCode_() : null;
  const withheld = {};          // attempt ids whose marks are not out yet

  const attempts = [];
  rowsOf_(ss.getSheetByName(SHEET_ATTEMPTS)).forEach(row => {
    if (normId_(row[4]) !== id || !mine(row[19])) return;
    const attemptId = String(row[1] || '');
    const code = String(row[5] || '').toUpperCase().trim();
    const isExam = String(row[7] || '').toLowerCase() === 'assessment';
    const hold = Boolean(gateResults && isExam && !published[code]);
    if (hold) withheld[attemptId] = true;

    attempts.push({
      timestamp: row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ''),
      // No id on a withheld row: there is nothing to open, and handing out the
      // id would only invite a request the backend is going to refuse anyway.
      attemptId: hold ? '' : attemptId,
      sessionCode: String(row[5] || ''),
      sessionName: String(row[6] || ''),
      mode: String(row[7] || ''),
      questionSet: String(row[8] || ''),
      questionSetKey: hold ? '' : String(row[9] || ''),
      seed: hold ? '' : String(row[10] || ''),
      questionCount: Number(row[11] || 0),
      orderMode: hold ? '' : String(row[12] || 'original'),
      orderSeed: hold ? '' : String(row[23] || ''),
      // The mark itself, and everything it could be reconstructed from.
      score: hold ? null : Number(row[13] || 0),
      total: hold ? null : Number(row[14] || 0),
      percent: hold ? null : Number(row[15] || 0),
      released: !hold,
      // A guest sitting types their own ID, so a walk-in row can land on a real
      // trainee's record. It is still a paper sat under that ID, so it is shown
      // rather than hidden -- but it is labelled, so nobody has to guess why an
      // unfamiliar quiz is in their list.
      registered: String(row[22] || '')
    });
  });
  attempts.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

  // Lesson tallies come from the item rows, which carry the lesson per question.
  // An unreleased exam must not feed them: "you are at 40% on lesson 1-1.1"
  // gives away the mark just as surely as printing it would.
  const tally = {};
  rowsOf_(ss.getSheetByName(SHEET_ITEMS)).forEach(row => {
    if (normId_(row[4]) !== id || !mine(row[17])) return;
    if (withheld[String(row[1] || '')]) return;
    const lesson = String(row[13] || '').trim();
    if (!lesson) return;
    if (!tally[lesson]) tally[lesson] = { lesson: lesson, correct: 0, total: 0 };
    tally[lesson].total++;
    if (String(row[16] || '').toLowerCase() === 'correct') tally[lesson].correct++;
  });
  const lessons = Object.keys(tally).map(k => {
    const t = tally[k];
    t.percent = t.total ? Math.round((t.correct / t.total) * 100) : 0;
    return t;
  }).sort((a, b) => a.percent - b.percent || b.total - a.total);

  return { ok: true, trainee: trainee, attempts: attempts, lessons: lessons };
}

function traineeHistory_(params) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;
  const id = normId_(params.energytechId);
  if (!id) return { ok: false, error: 'No trainee named.' };

  const isAdmin = auth.instructor.role === 'admin';
  const viewer = normalizeUsername_(auth.instructor.username);
  // No gate: the instructor is the one who decides when marks go out, so they
  // see every mark whether it has been released or not.
  return historyFor_(id, owner => isAdmin || normalizeUsername_(owner) === viewer, false);
}

/* A trainee reading their own record. The identity comes from the token, never
 * from a parameter, so there is no id to tamper with. Exam marks are gated on
 * the instructor having released that session. */
function myHistory_(params) {
  const auth = requireTrainee_(params);
  if (!auth.ok) return auth;
  return historyFor_(normId_(auth.trainee.energytechId), function () { return true; }, true);
}

/* Every question of one attempt, so it can be shown back the way the trainee
 * saw it when they submitted.
 *
 * `allow(row)` is the access test, applied to the attempt row itself. */
function attemptFor_(attemptId, allow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let attempt = null;
  rowsOf_(ss.getSheetByName(SHEET_ATTEMPTS)).forEach(row => {
    if (String(row[1] || '') !== attemptId) return;
    if (!allow(row)) return;
    attempt = {
      timestamp: row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ''),
      attemptId: attemptId,
      name: String(row[2] || ''),
      group: String(row[3] || ''),
      energytechId: String(row[4] || ''),
      sessionCode: String(row[5] || ''),
      sessionName: String(row[6] || ''),
      mode: String(row[7] || ''),
      questionSet: String(row[8] || ''),
      questionSetKey: String(row[9] || ''),
      seed: String(row[10] || ''),
      questionCount: Number(row[11] || 0),
      orderMode: String(row[12] || 'original'),
      score: Number(row[13] || 0),
      total: Number(row[14] || 0),
      percent: Number(row[15] || 0),
      intake: String(row[21] || ''),
      registered: String(row[22] || ''),
      orderSeed: String(row[23] || '')
    };
  });
  if (!attempt) return { ok: false, error: 'That attempt is not on record, or belongs to someone else.' };

  const items = [];
  rowsOf_(ss.getSheetByName(SHEET_ITEMS)).forEach(row => {
    if (String(row[1] || '') !== attemptId) return;
    items.push({
      quizNumber: Number(row[11] || 0),
      originalNumber: Number(row[12] || 0),
      lesson: String(row[13] || ''),
      answer: String(row[14] || ''),
      correctAnswer: String(row[15] || ''),
      result: String(row[16] || '')
    });
  });
  items.sort((a, b) => a.quizNumber - b.quizNumber);

  return { ok: true, attempt: attempt, items: items };
}

function attemptDetail_(params) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;
  const attemptId = String(params.attemptId || '').trim();
  if (!attemptId) return { ok: false, error: 'No attempt named.' };

  const isAdmin = auth.instructor.role === 'admin';
  const viewer = normalizeUsername_(auth.instructor.username);
  return attemptFor_(attemptId, row => isAdmin || normalizeUsername_(row[19]) === viewer);
}

/* A trainee opening one of their own attempts. The row's EnergyTech ID must be
 * theirs -- knowing or guessing an attempt id is not enough -- and an exam whose
 * results the instructor has not released stays shut, however it is asked for. */
function myAttempt_(params) {
  const auth = requireTrainee_(params);
  if (!auth.ok) return auth;
  const attemptId = String(params.attemptId || '').trim();
  if (!attemptId) return { ok: false, error: 'No attempt named.' };

  const me = normId_(auth.trainee.energytechId);
  const published = publishedByCode_();
  let held = false;
  const res = attemptFor_(attemptId, function (row) {
    if (normId_(row[4]) !== me) return false;
    if (String(row[7] || '').toLowerCase() === 'assessment'
        && !published[String(row[5] || '').toUpperCase().trim()]) {
      held = true;
      return false;
    }
    return true;
  });
  if (held) {
    return { ok: false, error: 'Your instructor has not released the results of this exam yet.' };
  }
  return res;
}

/* --------------------------- releasing exam marks ------------------------- */

/* Every session this instructor owns, newest first, with how many trainees have
 * sat it and whether its marks are out. */
function sessionList_(params) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;
  ensureSheets_();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const isAdmin = auth.instructor.role === 'admin';
  const viewer = normalizeUsername_(auth.instructor.username);

  const sat = {};
  rowsOf_(ss.getSheetByName(SHEET_ATTEMPTS)).forEach(row => {
    const code = String(row[5] || '').toUpperCase().trim();
    if (code) sat[code] = (sat[code] || 0) + 1;
  });

  // Only the latest row per code: re-saving a session supersedes the earlier one.
  const seen = {};
  const sessions = [];
  const values = rowsOf_(ss.getSheetByName(SHEET_SESSIONS));
  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    const code = String(row[1] || '').toUpperCase().trim();
    if (!code || seen[code]) continue;
    seen[code] = true;
    if (!isAdmin && normalizeUsername_(row[12]) !== viewer) continue;
    sessions.push({
      timestamp: row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ''),
      sessionCode: code,
      sessionName: String(row[2] || ''),
      group: String(row[3] || ''),
      intake: String(row[14] || ''),
      mode: String(row[4] || 'practice'),
      questionSet: String(row[5] || ''),
      shuffleEachLaunch: row[16] === true || String(row[16]).toUpperCase() === 'TRUE',
      published: Boolean(row[17]),
      publishedAt: row[17] instanceof Date ? row[17].toISOString() : String(row[17] || ''),
      attempts: sat[code] || 0,
      owner: String(row[13] || '')
    });
  }
  sessions.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return { ok: true, sessions: sessions };
}

function sessionPublish_(params, release) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;
  ensureSheets_();

  const code = String(params.sessionCode || '').toUpperCase().trim();
  if (!code) return { ok: false, error: 'No session named.' };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SESSIONS);
  const rowNumber = sessionRowNumber_(sheet, code);
  if (!rowNumber) return { ok: false, error: 'Session ' + code + ' not found.' };

  const owner = normalizeUsername_(sheet.getRange(rowNumber, 13).getValue());
  const isAdmin = auth.instructor.role === 'admin';
  if (!isAdmin && owner !== normalizeUsername_(auth.instructor.username)) {
    return { ok: false, error: 'That session belongs to another instructor.' };
  }

  const when = release ? new Date() : '';
  sheet.getRange(rowNumber, 18).setValue(when);
  SpreadsheetApp.flush();
  return {
    ok: true,
    sessionCode: code,
    published: Boolean(release),
    publishedAt: release ? when.toISOString() : ''
  };
}

/* ------------------------- one session, reported on ----------------------- */

/* Everything one sitting of one session produced: who sat it, what each of them
 * scored, and the attempt id needed to open any one paper question by question.
 *
 * Marks are not held back here. Releasing is what lets the *trainees* see
 * theirs; the instructor is the person deciding whether to release, and cannot
 * decide without looking -- so this returns the figures either way, exactly as
 * traineeHistory_ does.
 *
 * A trainee who sat twice -- the instructor granted another sitting after a
 * tablet died mid-paper -- appears once, standing on their most recent sitting,
 * with the earlier ones alongside it. Counting a retake as a second trainee
 * would put the abandoned paper into every average in the report. */
function sessionReport_(params) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;
  ensureSheets_();

  const code = String(params.sessionCode || '').toUpperCase().trim();
  if (!code) return { ok: false, error: 'No session named.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const isAdmin = auth.instructor.role === 'admin';
  const viewer = normalizeUsername_(auth.instructor.username);

  const sheet = ss.getSheetByName(SHEET_SESSIONS);
  const rowNumber = sessionRowNumber_(sheet, code);
  if (!rowNumber) return { ok: false, error: 'Session ' + code + ' not found.' };

  const row = sheet.getRange(rowNumber, 1, 1, SESSION_HEADERS.length).getValues()[0];
  if (!isAdmin && normalizeUsername_(row[12]) !== viewer) {
    return { ok: false, error: 'That session belongs to another instructor.' };
  }

  const session = {
    timestamp: row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ''),
    sessionCode: code,
    sessionName: String(row[2] || ''),
    group: String(row[3] || ''),
    intake: String(row[14] || ''),
    mode: String(row[4] || 'practice'),
    questionSet: String(row[5] || ''),
    questionCount: Number(row[8] || 0),
    shuffleEachLaunch: row[16] === true || String(row[16]).toUpperCase() === 'TRUE',
    published: Boolean(row[17])
  };

  // The roster is the authority on a trainee's name: it can be corrected after
  // a paper has been sat, and a report should show who somebody is now rather
  // than the spelling that happened to be on the row that day.
  const roster = {};
  rowsOf_(traineesSheet_()).forEach(function (r) {
    const id = normId_(r[1]);
    if (id) roster[id] = { name: String(r[2] || ''), intake: String(r[3] || ''), group: String(r[4] || '') };
  });

  const byTrainee = {};
  rowsOf_(ss.getSheetByName(SHEET_ATTEMPTS)).forEach(function (r) {
    if (String(r[5] || '').toUpperCase().trim() !== code) return;
    // Listed only if this viewer could also open it. A row the report offers
    // and attempt_detail then refuses is worse than a row left out.
    if (!isAdmin && normalizeUsername_(r[19]) !== viewer) return;

    const id = normId_(r[4]);
    const known = roster[id];
    if (!byTrainee[id]) {
      byTrainee[id] = {
        energytechId: String(r[4] || ''),
        name: (known && known.name) || String(r[2] || ''),
        // The group as sat: that is who was in the room. The roster fills it in
        // only when the row carries none, as a walk-in's may not.
        group: String(r[3] || '') || (known && known.group) || '',
        intake: String(r[21] || '') || (known && known.intake) || '',
        onRoster: Boolean(known),
        sittings: []
      };
    }
    byTrainee[id].sittings.push({
      attemptId: String(r[1] || ''),
      timestamp: r[0] instanceof Date ? r[0].toISOString() : String(r[0] || ''),
      score: Number(r[13] || 0),
      total: Number(r[14] || 0),
      percent: Number(r[15] || 0),
      registered: String(r[22] || '')
    });
  });

  const trainees = Object.keys(byTrainee).map(function (id) {
    const t = byTrainee[id];
    t.sittings.sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); });
    const latest = t.sittings[0];
    t.attemptId = latest.attemptId;
    t.timestamp = latest.timestamp;
    t.score = latest.score;
    t.total = latest.total;
    t.percent = latest.percent;
    t.registered = latest.registered;
    t.sittingCount = t.sittings.length;
    return t;
  });

  // Who was expected and did not sit. An exam report that lists only the papers
  // handed in cannot tell an instructor that four of their group are missing,
  // which is the first thing they need to know.
  const absent = [];
  if (session.intake && session.group) {
    rowsOf_(traineesSheet_()).forEach(function (r) {
      const id = normId_(r[1]);
      if (!id || byTrainee[id]) return;
      if (String(r[3] || '').trim().toUpperCase() !== session.intake.trim().toUpperCase()) return;
      if (String(r[4] || '').trim().toUpperCase() !== session.group.trim().toUpperCase()) return;
      absent.push({ energytechId: String(r[1] || ''), name: String(r[2] || ''),
                    intake: String(r[3] || ''), group: String(r[4] || '') });
    });
  }

  return { ok: true, session: session, trainees: trainees, absent: absent };
}

function buildSummary_(params) {
  const auth = requireAuth_(params);
  if (!auth.ok) return auth;

  ensureSheets_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const attemptsSheet = ss.getSheetByName(SHEET_ATTEMPTS);
  const itemsSheet = ss.getSheetByName(SHEET_ITEMS);

  const attemptsValues = attemptsSheet.getDataRange().getValues();
  const itemsValues = itemsSheet.getDataRange().getValues();

  const isAdmin = auth.instructor.role === 'admin';
  const viewerUsername = normalizeUsername_(auth.instructor.username);

  const attempts = [];
  for (let r = 1; r < attemptsValues.length; r++) {
    const row = attemptsValues[r];
    const ownerUsername = String(row[19] || '');
    if (!isAdmin && normalizeUsername_(ownerUsername) !== viewerUsername) continue;
    attempts.push({
      timestamp: row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ''),
      attemptId: String(row[1] || ''),
      name: String(row[2] || ''),
      group: String(row[3] || ''),
      energytechId: String(row[4] || ''),
      sessionCode: String(row[5] || ''),
      sessionName: String(row[6] || ''),
      mode: String(row[7] || ''),
      questionSet: String(row[8] || ''),
      questionSetKey: String(row[9] || ''),
      seed: String(row[10] || ''),
      questionCount: Number(row[11] || 0),
      orderMode: String(row[12] || ''),
      score: Number(row[13] || 0),
      total: Number(row[14] || 0),
      percent: Number(row[15] || 0),
      wrongCount: String(row[16] || '').split(',').filter(Boolean).length,
      unansweredCount: String(row[17] || '').split(',').filter(Boolean).length,
      ownerUsername: ownerUsername,
      ownerDisplayName: String(row[20] || ''),
      intake: String(row[21] || ''),
      registered: String(row[22] || '')
    });
  }

  const qMap = {};
  const lessonMap = {};
  for (let r = 1; r < itemsValues.length; r++) {
    const row = itemsValues[r];
    const ownerUsername = String(row[17] || '');
    if (!isAdmin && normalizeUsername_(ownerUsername) !== viewerUsername) continue;

    const sessionCode = String(row[5] || '');
    const mode = String(row[7] || '');
    const set = String(row[8] || '');
    const setKey = String(row[9] || '');
    const orig = String(row[12] || '');
    const lesson = String(row[13] || '');
    const studentAnswer = String(row[14] || '');
    const result = String(row[16] || '');
    const ownerDisplayName = String(row[18] || '');

    const qKey = [sessionCode, setKey, orig, lesson].join('|');
    if (!qMap[qKey]) qMap[qKey] = {
      sessionCode, mode, questionSet: set, questionSetKey: setKey,
      originalNumber: orig, lesson, attempts: 0, correct: 0, wrong: 0, unanswered: 0, wrongChoices: {},
      ownerUsername, ownerDisplayName
    };
    qMap[qKey].attempts++;
    if (result === 'Correct') qMap[qKey].correct++;
    else if (result === 'Unanswered') qMap[qKey].unanswered++;
    else {
      qMap[qKey].wrong++;
      if (studentAnswer) qMap[qKey].wrongChoices[studentAnswer] = (qMap[qKey].wrongChoices[studentAnswer] || 0) + 1;
    }

    const lKey = [sessionCode, setKey, lesson].join('|');
    if (!lessonMap[lKey]) lessonMap[lKey] = {
      sessionCode, mode, questionSet: set, questionSetKey: setKey,
      lesson, attempts: 0, correct: 0, wrong: 0, unanswered: 0,
      ownerUsername, ownerDisplayName
    };
    lessonMap[lKey].attempts++;
    if (result === 'Correct') lessonMap[lKey].correct++;
    else if (result === 'Unanswered') lessonMap[lKey].unanswered++;
    else lessonMap[lKey].wrong++;
  }

  const questionAnalysis = Object.keys(qMap).map(k => {
    const q = qMap[k];
    const commonWrong = Object.keys(q.wrongChoices).sort((a, b) => q.wrongChoices[b] - q.wrongChoices[a])[0] || '';
    return Object.assign(q, {
      successRate: q.attempts ? Math.round((q.correct / q.attempts) * 1000) / 10 : 0,
      commonWrong: commonWrong ? commonWrong + ' (' + q.wrongChoices[commonWrong] + ')' : ''
    });
  });

  const lessonAnalysis = Object.keys(lessonMap).map(k => {
    const l = lessonMap[k];
    return Object.assign(l, {
      successRate: l.attempts ? Math.round((l.correct / l.attempts) * 1000) / 10 : 0
    });
  });

  return {
    ok: true,
    attempts,
    questionAnalysis,
    lessonAnalysis,
    viewer: { username: auth.instructor.username, displayName: auth.instructor.displayName, role: auth.instructor.role }
  };
}

function ensureSheets_() {
  if (ENSURED_.__all) return;              // already done earlier in this request
  ENSURED_.__all = true;
  // setup() adds only what is missing, so it can be called on every request:
  // that also repairs a sheet somebody emptied by hand, which the old
  // "only if the sheet is absent" test walked straight past.
  setup();
  getOrCreateInstructorsSheet_();
  const attemptsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ATTEMPTS);
  if (attemptsSheet) ensureHeaders_(attemptsSheet, ['Intake', 'Registered', 'Order Seed']);
  const sessionsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SESSIONS);
  if (sessionsSheet) ensureHeaders_(sessionsSheet,
    ['Intake', 'Allow Walk-In', 'Shuffle Each Launch', 'Results Published']);
  intakesSheet_();
  groupsSheet_();
  migrateTraineeNames_();          // must precede traineesSheet_'s header check
  traineesSheet_();
  retakesSheet_();
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
