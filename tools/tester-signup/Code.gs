/**
 * Zomello tester sign-up automation (Google Apps Script, bound to the form's responses sheet).
 *
 * When someone sends the "Help test Zomello" form, this:
 *   1. adds their Google Play email to the testers group (Android closed test access),
 *   2. emails them the links for the devices they picked,
 *   3. fills in the status columns at the right of the sheet.
 *
 * Setup is in README.md next to this file. Nothing here is secret; the links below are public.
 */

const CONFIG = {
  GROUP: 'zomello-testers@zombeatzmedia.com',
  // Play Console > Zomello > Closed testing > your track > Testers > "Join on Android" link.
  PLAY_OPT_IN: 'https://play.google.com/apps/testing/com.zombeatz.zomello',
  // App Store Connect > TestFlight > your external group > Public link. Ours is
  // https://testflight.apple.com/join/WJUtJKEN but only fill it in once a build passes Beta App Review;
  // before that the link just says the beta isn't accepting testers.
  TESTFLIGHT: '',
  RELEASES: 'https://github.com/ZomBeatz/Zomello/releases/latest',
  SERVER_GUIDE: 'https://docs.zombeatzmedia.com/zomello/server',
  GUIDE: 'https://docs.zombeatzmedia.com/zomello/',
  TEST_PAGE: 'https://docs.zombeatzmedia.com/zomello/help-test',
  FROM_NAME: 'ZomBeatz Media',
  REPLY_TO: 'info@zombeatzmedia.com',
};

// Words that pick out each form question in the sheet's header row (case doesn't matter), so a
// small change to a question's wording, or a curly apostrophe typed on a phone, doesn't break anything.
const Q = {
  name: 'your name',
  devices: 'which devices',
  play: 'google play email',
  apple: 'apple id email',
  contact: 'email address', // only present when the form collects email addresses
};

/** The column index (0-based) whose header contains the words for question q, or -1. */
function col_(head, q) {
  return head.findIndex((h) => String(h).toLowerCase().includes(q));
}

const STATUS = ['Play added', 'Play link', 'TestFlight', 'Email sent', 'Notes'];

/** Installable trigger: From spreadsheet > On form submit. */
function onFormSubmit(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    processRow_(e.range.getSheet(), e.range.getRow());
  } finally {
    lock.releaseLock();
  }
}

/** Adds a Testers menu to the sheet. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Testers')
    .addItem('Run again for the selected row', 'rerunSelectedRow')
    .addItem('Send the Play link to everyone waiting', 'sendWaitingPlay')
    .addItem('Send the TestFlight link to everyone waiting', 'sendWaitingTestFlight')
    .addToUi();
}

function rerunSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveRange().getRow();
  if (row < 2) return;
  processRow_(sheet, row);
}

const WAITING = {
  play: {
    column: 'Play link',
    link: () => CONFIG.PLAY_OPT_IN,
    setting: 'CONFIG.PLAY_OPT_IN',
    subject: 'Zomello for Android is ready to test',
    body: (link) => `The Android test for Zomello is open. On your Android phone or tablet, open this link and tap "Become a tester", then use the Google Play link on that page to install Zomello:\n${link}\n\nUse the same Google account as the Play email you gave us.`,
  },
  apple: {
    column: 'TestFlight',
    link: () => CONFIG.TESTFLIGHT,
    setting: 'CONFIG.TESTFLIGHT',
    subject: 'Zomello for iPhone and iPad is ready to test',
    body: (link) => `The iPhone and iPad test for Zomello is open. Install the free TestFlight app from the App Store, then open this link on your device:\n${link}`,
  },
};

function sendWaitingPlay() { sendWaiting_(WAITING.play); }
function sendWaitingTestFlight() { sendWaiting_(WAITING.apple); }

/** Once a link exists, sends it to everyone who signed up before it did (rows marked "Waiting for link"). */
function sendWaiting_(kind) {
  const link = kind.link();
  if (!link) {
    SpreadsheetApp.getUi().alert(`Put the link in ${kind.setting} first, then save the script.`);
    return;
  }
  const sheet = SpreadsheetApp.getActiveSheet();
  const cols = statusColumns_(sheet);
  const rows = sheet.getDataRange().getValues();
  const head = rows[0];
  let sent = 0;
  for (let r = 1; r < rows.length; r++) {
    if (rows[r][cols[kind.column] - 1] !== 'Waiting for link') continue;
    const get = (q) => { const i = col_(head, q); return i < 0 ? '' : String(rows[r][i] || '').trim(); };
    const to = get(Q.contact) || get(Q.play) || get(Q.apple);
    if (!looksLikeEmail_(to)) continue;
    const text = `Hi ${firstName_(get(Q.name))},\n\n${kind.body(link)}\n\nPlease keep Zomello installed for 14 days and tell us what you notice by replying to this email.\n\nThanks for helping,\nZomBeatz Media`;
    GmailApp.sendEmail(to, kind.subject, text, {
      htmlBody: toHtml_(text), name: CONFIG.FROM_NAME, replyTo: CONFIG.REPLY_TO,
    });
    sheet.getRange(r + 1, cols[kind.column]).setValue('Link sent ' + today_());
    sent++;
  }
  SpreadsheetApp.getUi().alert(`Sent the link to ${sent} tester(s).`);
}

function processRow_(sheet, row) {
  const cols = statusColumns_(sheet);
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const values = sheet.getRange(row, 1, 1, head.length).getValues()[0];
  const get = (q) => {
    const i = col_(head, q);
    return i < 0 ? '' : String(values[i] || '').trim();
  };
  const set = (col, value) => sheet.getRange(row, cols[col]).setValue(value);

  const name = get(Q.name);
  const devices = get(Q.devices);
  const play = get(Q.play).toLowerCase();
  const apple = get(Q.apple).toLowerCase();
  const to = get(Q.contact) || play || apple;
  const wants = {
    android: /android/i.test(devices),
    apple: /iphone|ipad/i.test(devices),
    computer: /computer/i.test(devices),
    server: /server/i.test(devices),
  };
  const notes = [];

  // 1. Android: put their Play email in the group the closed test uses.
  if (wants.android) {
    if (!looksLikeEmail_(play)) {
      set('Play added', 'No');
      notes.push('No Google Play email given');
    } else {
      try {
        AdminDirectory.Members.insert({ email: play, role: 'MEMBER' }, CONFIG.GROUP);
        set('Play added', 'Yes ' + today_());
      } catch (err) {
        if (/already exists/i.test(err.message)) {
          set('Play added', 'Already in group');
        } else {
          set('Play added', 'No');
          notes.push('Group add failed: ' + err.message);
        }
      }
    }
  }

  if (wants.android) set('Play link', CONFIG.PLAY_OPT_IN ? 'Link sent ' + today_() : 'Waiting for link');

  // 2. iPhone and iPad: the public TestFlight link, or a note to send it later.
  if (wants.apple) set('TestFlight', CONFIG.TESTFLIGHT ? 'Link sent ' + today_() : 'Waiting for link');

  // 3. The welcome email.
  if (!looksLikeEmail_(to)) {
    notes.push('No email address to write to');
  } else {
    const text = welcomeText_(firstName_(name), wants);
    GmailApp.sendEmail(to, 'Welcome to the Zomello beta test', plain_(text), {
      htmlBody: toHtml_(text), name: CONFIG.FROM_NAME, replyTo: CONFIG.REPLY_TO,
    });
    set('Email sent', today_());
  }

  set('Notes', notes.join('; '));
}

function welcomeText_(first, wants) {
  const parts = [`Hi ${first},`, 'Thanks for signing up to test Zomello. Here is how to get it on the devices you picked.'];

  if (wants.android) {
    parts.push(CONFIG.PLAY_OPT_IN
      ? `# Android phone or tablet\n1. On your Android device, open this link and tap "Become a tester":\n${CONFIG.PLAY_OPT_IN}\n2. Then tap the Google Play link on that page to install Zomello.\nUse the same Google account as the Play email you gave us. It can take a few minutes after signing up for the link to work.`
      : '# Android phone or tablet\nWe will email your Google Play link as soon as the Android test opens.');
  }
  if (wants.apple) {
    parts.push(CONFIG.TESTFLIGHT
      ? `# iPhone or iPad\n1. Install the free TestFlight app from the App Store.\n2. Open this link on your iPhone or iPad:\n${CONFIG.TESTFLIGHT}`
      : '# iPhone or iPad\nWe will email your TestFlight link as soon as the iPhone and iPad test opens. Installing the free TestFlight app from the App Store now saves a step.');
  }
  if (wants.computer) {
    parts.push(`# Computer\nDownload the file for Windows or Linux from:\n${CONFIG.RELEASES}`);
  }
  if (wants.server) {
    parts.push(`# Server\nSetting up Zomello Server (direct install or Docker):\n${CONFIG.SERVER_GUIDE}`);
  }

  parts.push(
    `# What we ask\nPlease keep Zomello installed for 14 days in a row and use it the way you normally would. When something is confusing, broken or missing, just reply to this email. A sentence is plenty.`,
    `The guide is at ${CONFIG.GUIDE} and everything about the test is at ${CONFIG.TEST_PAGE}`,
    'Thanks for helping,\nZomBeatz Media',
  );
  return parts.join('\n\n');
}

/** Makes sure the status columns exist at the right of the sheet and returns their column numbers. */
function statusColumns_(sheet) {
  const last = sheet.getLastColumn();
  const head = sheet.getRange(1, 1, 1, last).getValues()[0];
  const cols = {};
  let next = last + 1;
  for (const title of STATUS) {
    const i = head.indexOf(title);
    if (i >= 0) {
      cols[title] = i + 1;
    } else {
      sheet.getRange(1, next).setValue(title).setFontWeight('bold');
      cols[title] = next++;
    }
  }
  return cols;
}

/** Headings are written as "# Heading" lines; plain-text email shows them without the marker. */
function plain_(text) {
  return text.replace(/^# /gm, '');
}

function toHtml_(text) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linked = esc.replace(/(https:\/\/[^\s]+)/g, '<a href="$1" style="color:#2580c3">$1</a>');
  const blocks = linked.split('\n\n').map((b) => {
    const lines = b.split('\n');
    if (lines[0].startsWith('# ')) lines[0] = `<strong>${lines[0].slice(2)}</strong>`;
    return `<p style="margin:0 0 16px">${lines.join('<br>')}</p>`;
  });
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1c2030;max-width:560px">${blocks.join('')}</div>`;
}

function firstName_(name) {
  return (name || '').split(/\s+/)[0] || 'there';
}

function looksLikeEmail_(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
