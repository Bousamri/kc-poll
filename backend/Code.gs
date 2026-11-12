/**
 * Keratoconus talk: audience poll backend (Google Apps Script web app).
 * Stores one row per answer in a Google Sheet and returns live tallies.
 *
 * ONE-TIME SETUP
 *   1. Put this code in an Apps Script project: either open the Google Sheet and use
 *      Extensions > Apps Script (leave SHEET_ID empty), or a standalone project at
 *      script.google.com (put the sheet's ID in SHEET_ID).
 *   2. Deploy > New deployment > gear icon > Web app.
 *        Execute as: Me
 *        Who has access: Anyone
 *      Press Deploy.
 *   3. Authorize access > choose your account > "Google hasn't verified this app" >
 *      Advanced > Go to (unsafe) > Allow. Google shows this for every personal script.
 *   4. Copy the Web app URL (it ends in /exec) into config.js on GitHub.
 *
 * If you change this file later: Deploy > Manage deployments > pencil > Version: New version > Deploy.
 * The URL stays the same.
 */

// The sheet that stores the votes: the long ID in its address, between /d/ and /edit.
// Leave empty when this script was opened from the sheet itself.
var SHEET_ID = '';

var QUESTIONS = { q1: ['A', 'B', 'C', 'D', 'E'], q2: ['A', 'B', 'C', 'D', 'E'] };

// SHA-256 of the presenter key. The key itself is not stored anywhere in this repository.
var PRESENTER_KEY_SHA256 = '99fc0b7807d64722cf1cc01f75bf2031bb956537e687772a9b739075a12e1659';

var VOTES_SHEET = 'votes';
var HEADER = ['time', 'session', 'voter', 'question', 'choice', 'note', 'ms'];
var COUNTS_CACHE_SECONDS = 2;
var STATE_CACHE_SECONDS = 120;

/** Run this once from the editor if you want to check the setup. It creates the "votes" tab. */
function setup() {
  var sh = votesSheet_();
  Logger.log('Ready. Votes go to the "' + sh.getName() + '" tab. Live state: ' + JSON.stringify(publicState_('live', true)));
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  var s = cleanSession_(p.s);
  try {
    var action = p.action || 'state';
    if (action === 'state') return json_(publicState_(s, false));
    if (action === 'results') return json_(publicState_(s, true));
    if (action === 'ping') return json_({ ok: true, now: Date.now() });
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: errText_(err) });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad request' });
  }
  var s = cleanSession_(body.s);
  try {
    if (body.action === 'vote') return json_(vote_(s, body));
    if (body.action === 'admin') return json_(admin_(s, body));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: errText_(err) });
  }
}

/* ---------- votes ---------- */

function vote_(s, b) {
  var q = String(b.q || '');
  var c = String(b.c || '').toUpperCase();
  if (!QUESTIONS.hasOwnProperty(q) || QUESTIONS[q].indexOf(c) < 0) return { ok: false, error: 'bad vote' };
  var v = String(b.v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!v) return { ok: false, error: 'bad vote' };

  var st = getState_(s);
  var late = st.reveal[q] === true;
  var sh = votesSheet_();
  var now = new Date();
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(10000);
  try {
    sh.appendRow([now, s, v, q, c, late ? 'after reveal' : '', now.getTime()]);
    SpreadsheetApp.flush();
  } finally {
    if (locked) lock.releaseLock();
  }
  var out = publicState_(s, false, st);
  out.accepted = !late;
  out.q = q;
  return out;
}

/* ---------- presenter actions ---------- */

function admin_(s, b) {
  if (!keyOk_(b.k)) return { ok: false, error: 'not authorized' };
  var op = String(b.op || '');
  if (op !== 'whoami') {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var st = readState_(s);
      if (op === 'reveal') {
        var q = String(b.q || '');
        if (!QUESTIONS.hasOwnProperty(q)) return { ok: false, error: 'bad question' };
        st.reveal[q] = b.v !== false;
      } else if (op === 'reset') {
        st.round = Date.now();
        st.reveal = { q1: false, q2: false };
      } else {
        return { ok: false, error: 'unknown op' };
      }
      writeState_(s, st);
    } finally {
      lock.releaseLock();
    }
  }
  var out = publicState_(s, true);
  out.presenter = true;
  return out;
}

function keyOk_(k) {
  if (!k) return false;
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(k), Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = (bytes[i] + 256) % 256;
    hex += (v < 16 ? '0' : '') + v.toString(16);
  }
  return hex === PRESENTER_KEY_SHA256;
}

/* ---------- state (reveal flags and reset round), kept in script properties ---------- */

function defaultState_() {
  return { round: 0, reveal: { q1: false, q2: false } };
}

function normalizeState_(p) {
  var st = defaultState_();
  if (p) {
    st.round = Number(p.round) || 0;
    st.reveal = { q1: !!(p.reveal && p.reveal.q1), q2: !!(p.reveal && p.reveal.q2) };
  }
  return st;
}

function readState_(s) {
  var raw = PropertiesService.getScriptProperties().getProperty('state:' + s);
  if (!raw) return defaultState_();
  try { return normalizeState_(JSON.parse(raw)); } catch (e) { return defaultState_(); }
}

function writeState_(s, st) {
  var txt = JSON.stringify(st);
  PropertiesService.getScriptProperties().setProperty('state:' + s, txt);
  var cache = CacheService.getScriptCache();
  cache.put('state:' + s, txt, STATE_CACHE_SECONDS);
  cache.remove('counts:' + s);
}

function getState_(s) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('state:' + s);
  if (hit) {
    try { return normalizeState_(JSON.parse(hit)); } catch (e) { /* fall through */ }
  }
  var st = readState_(s);
  cache.put('state:' + s, JSON.stringify(st), STATE_CACHE_SECONDS);
  return st;
}

/* ---------- tallies: last answer per phone per question counts ---------- */

function counts_(s, st) {
  var cache = CacheService.getScriptCache();
  var key = 'counts:' + s;
  var hit = cache.get(key);
  if (hit) {
    try {
      var h = JSON.parse(hit);
      if (h.round === st.round) return h;
    } catch (e) { /* recompute */ }
  }
  var sh = votesSheet_();
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, HEADER.length).getValues() : [];
  var latest = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[1]) !== s) continue;
    if (r[5]) continue; // arrived after the answer was shown
    var ms = Number(r[6]) || (r[0] instanceof Date ? r[0].getTime() : 0);
    if (st.round && ms < st.round) continue;
    latest[String(r[2]) + '|' + String(r[3])] = String(r[4]);
  }
  var out = { round: st.round, voters: 0, q: {} };
  for (var q in QUESTIONS) {
    if (!QUESTIONS.hasOwnProperty(q)) continue;
    out.q[q] = { n: 0 };
    for (var j = 0; j < QUESTIONS[q].length; j++) out.q[q][QUESTIONS[q][j]] = 0;
  }
  var voters = {};
  for (var k in latest) {
    if (!latest.hasOwnProperty(k)) continue;
    var parts = k.split('|');
    var qq = parts[1];
    var cc = latest[k];
    if (out.q[qq] && out.q[qq].hasOwnProperty(cc)) {
      out.q[qq][cc] += 1;
      out.q[qq].n += 1;
      voters[parts[0]] = true;
    }
  }
  out.voters = Object.keys(voters).length;
  cache.put(key, JSON.stringify(out), COUNTS_CACHE_SECONDS);
  return out;
}

/* full = true: tallies for every question (presenter screen).
   full = false: tallies only for questions already revealed (audience phones). */
function publicState_(s, full, st) {
  st = st || getState_(s);
  var out = { ok: true, now: Date.now(), s: s, round: st.round, reveal: st.reveal };
  if (full) {
    var c = counts_(s, st);
    out.counts = c.q;
    out.voters = c.voters;
  } else if (st.reveal.q1 || st.reveal.q2) {
    var c2 = counts_(s, st);
    out.counts = {};
    for (var q in st.reveal) {
      if (st.reveal.hasOwnProperty(q) && st.reveal[q]) out.counts[q] = c2.q[q];
    }
  }
  return out;
}

/* ---------- helpers ---------- */

function book_() {
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Set SHEET_ID at the top of this file, or open the script from its Google Sheet.');
  return ss;
}

function votesSheet_() {
  var ss = book_();
  var sh = ss.getSheetByName(VOTES_SHEET);
  if (sh) return sh;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sh = ss.getSheetByName(VOTES_SHEET);
    if (!sh) {
      sh = ss.insertSheet(VOTES_SHEET);
      sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  } finally {
    lock.releaseLock();
  }
  return sh;
}

function cleanSession_(s) {
  s = String(s || 'live').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  return s || 'live';
}

function errText_(err) {
  return String((err && err.message) || err || 'error');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
