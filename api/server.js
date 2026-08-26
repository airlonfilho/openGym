/* opengym-api — passkey (WebAuthn) auth + per-user state storage for openGym
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'openGym';
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 5 * 1024 * 1024;
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

fs.mkdirSync(DATA, { recursive: true });

/* ---------- secret + db ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

const dbFile = path.join(DATA, 'db.json');
let db = { users: [], creds: [], subs: [], invites: [] };
try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch {}
db.subs = db.subs || [];
db.invites = db.invites || [];
const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));
function saveDb() { atomicWrite(dbFile, JSON.stringify(db, null, 2)); }
function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function readState(uid) {
  try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
}

/* ---------- leagues (roadmap "Challenges between profiles") ----------
   Small groups (<= 6) on one instance run a weekly, points-based competition. Each
   member's client scores its own week and PUTs a compact "pulse"; the server only
   stores and relays those — no training logic here, mirroring the frontend split.
   Kept in its own file so a write never contends with db.json's user/cred writes. */
const LEAGUE_MAX_MEMBERS = 6;
const LEAGUE_MAX_PER_USER = 6;
const PULSE_KEEP_WEEKS = 12;
const groupsFile = path.join(DATA, 'groups.json');
let groups = [];
try { groups = JSON.parse(fs.readFileSync(groupsFile, 'utf8')).groups || []; } catch {}
function saveGroups() { atomicWrite(groupsFile, JSON.stringify({ groups }, null, 2)); }
const groupById = id => groups.find(g => g.id === id);
const memberView = uid => { const u = db.users.find(x => x.id === uid); return { id: uid, name: u ? u.name : '—' }; };
const clampGoal = n => Math.max(1, Math.min(14, Math.round(+n) || 3));
const newLeagueCode = () => { let c; do { c = crypto.randomBytes(4).toString('hex').toUpperCase(); } while (groups.some(g => g.code === c)); return c; };
// ISO week keys look like "2026-34" / "2026-3" — order by year then week number.
const weekNum = wk => { const [y, w] = String(wk).split('-').map(Number); return (y || 0) * 100 + (w || 0); };
// Drop pulses for people who left, and keep only the newest PULSE_KEEP_WEEKS per member.
function pruneGroup(g) {
  g.pulses = g.pulses || {};
  for (const uid of Object.keys(g.pulses)) {
    if (!g.members.includes(uid)) { delete g.pulses[uid]; continue; }
    const wks = Object.keys(g.pulses[uid]).sort((a, b) => weekNum(a) - weekNum(b));
    for (const wk of wks.slice(0, Math.max(0, wks.length - PULSE_KEEP_WEEKS))) delete g.pulses[uid][wk];
  }
}

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);
const RECAP_TIME = /^\d{2}:\d{2}$/.test(process.env.RECAP_TIME || '') ? process.env.RECAP_TIME : '19:00';

/* ---------- push copy localization ----------
   The server can't import the frontend i18n, and these are the only user-facing strings it
   emits. English is the key; anything not in a table falls through untranslated. Keep in
   step with frontend/src/locales when a push string changes. */
const PUSH_STRINGS = {
  pt: {
    'Rest over 💪': 'Descanso acabou 💪',
    'Time for your next set.': 'Hora da próxima série.',
    '{0} today': '{0} hoje',
    'Workout planned today': 'Treino planejado hoje',
    "It's on your plan — let's go 💪": 'Está no seu plano — bora 💪',
    'Test notification ✅ — this is what alerts look like.': 'Notificação de teste ✅ — é assim que os alertas aparecem.',
    'Your week 🔥': 'Sua semana 🔥',
    '{0} workouts · {1} kg · {2} PRs · streak at {3}': '{0} treinos · {1} kg · {2} PRs · sequência em {3}',
    '{0} workout · {1} kg · {2} PRs · streak at {3}': '{0} treino · {1} kg · {2} PRs · sequência em {3}',
  },
};
function pt(lang, s, ...args) {
  let v = (PUSH_STRINGS[lang] && PUSH_STRINGS[lang][s]) || s;
  args.forEach((a, i) => { v = v.split('{' + i + '}').join(a); });
  return v;
}
const langOf = uid => { const S = readState(uid); return (S && S.lang) || 'en'; };

/* ---------- date + weekly-recap helpers (duplicated from frontend lib/, tiny pure fns) ---------- */
const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function weekKey(d) {
  const dt = new Date(d + 'T12:00:00');
  const day = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - day + 3);
  const jan4 = new Date(dt.getFullYear(), 0, 4);
  const week = 1 + Math.round(((dt - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return dt.getFullYear() + '-' + week;
}
const volOf = w => (w.vol != null ? w.vol
  : (w.entries || []).reduce((v, e) => v + (e.sets || []).reduce((s, x) => s + (x.done ? (x.w || 0) * (x.r || 0) : 0), 0), 0));
function streakOf(S) {
  const weeks = new Set((S.workouts || []).map(w => weekKey(w.d)));
  if (!weeks.size) return 0;
  let streak = 0;
  const cur = new Date();
  for (let i = 0; i < 520; i++) {
    if (weeks.has(weekKey(isoOf(cur)))) streak++;
    else if (i > 0) break;
    cur.setDate(cur.getDate() - 7);
  }
  return streak;
}
// Numbers for the Sunday recap push — the current ISO week (Sunday belongs to it). null when
// nothing was trained: no "0 workouts" nag.
function serverRecap(S, todayIso) {
  const wk = weekKey(todayIso);
  const ws = (S.workouts || []).filter(w => weekKey(w.d) === wk);
  if (!ws.length) return null;
  return {
    sessions: ws.length,
    volume: Math.round(ws.reduce((v, w) => v + volOf(w), 0)),
    prs: ws.reduce((n, w) => n + (w.prs ? w.prs.length : 0), 0),
    streak: streakOf(S),
  };
}

async function sendPush(userId, payload) {
  const subs = db.subs.filter(s => s.userId === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  await Promise.all(subs.map(async sub => {
    // urgency 'high' is the one lever we have over delivery speed — iOS/Android throttle
    // low-urgency background push more aggressively under battery-saving modes. TTL is left
    // at the library default (long) so a briefly-offline device still gets it once reconnected,
    // rather than risking it being dropped for the sake of shaving off latency that TTL doesn't
    // actually control anyway.
    try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { urgency: 'high' }); }
    catch (e) {
      console.error('push send failed', userId, e.statusCode, e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
      }
    }
  }));
  if (dirty) saveDb();
}

// Rest-timer alerts: client schedules on start/extend, cancels on skip or on-screen completion —
// this only fires when the tab was backgrounded/suspended and never got to cancel it itself.
const restTimers = new Map(); // userId -> Timeout
function scheduleRestTimer(userId, sec) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    const l = langOf(userId);
    sendPush(userId, { title: pt(l, 'Rest over 💪'), body: pt(l, 'Time for your next set.'), tag: 'rest-timer' });
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

// "Workout planned today" reminder — one per user per day, at their chosen time.
// Duplicated (not imported) from frontend/src/lib/history.js effectiveRoutineId — tiny pure helper, not worth sharing across the two runtimes.
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}
// Computes "now" in an arbitrary IANA zone (e.g. "Europe/Lisbon") instead of the server's own —
// each user's reminder fires by their own clock, wherever they and their phone actually are.
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; } // unknown/invalid tz string — skip this user rather than guess
}
setInterval(() => {
  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    const S = readState(user.id);
    if (!S) continue;
    // S.tz is stamped on every sync; reminder.tz is the older per-reminder copy — either works.
    const tz = S.tz || S.reminder?.tz;
    const now = tz ? userNow(tz) : null;
    if (!now) continue;
    const l = S.lang || 'en';

    // "Workout planned today" — one per user per day, at their chosen time.
    if (S.reminder?.on && S.reminder.time === now.hhmm && user.lastReminder !== now.date
        && !(S.workouts || []).some(w => w.d === now.date)) {
      const rid = effectiveRoutineId(S, now.date);
      const routine = rid && (S.routines || []).find(r => r.id === rid);
      if (rid) {
        user.lastReminder = now.date;
        saveDb();
        sendPush(user.id, {
          title: routine ? pt(l, '{0} today', `${routine.emoji || '🏋️'} ${routine.name}`) : pt(l, 'Workout planned today'),
          body: pt(l, "It's on your plan — let's go 💪"),
          tag: 'day-reminder',
        });
      }
    }

    // Weekly recap — Sunday at RECAP_TIME local, once per ISO week, only if push is on and
    // there was training. Independent of the day-reminder toggle.
    if (now.hhmm === RECAP_TIME && new Date(now.date + 'T12:00:00').getDay() === 0) {
      const rwk = weekKey(now.date);
      if (user.lastRecap !== rwk) {
        const rc = serverRecap(S, now.date);
        if (rc) {
          user.lastRecap = rwk;
          saveDb();
          const key = rc.sessions === 1
            ? '{0} workout · {1} kg · {2} PRs · streak at {3}'
            : '{0} workouts · {1} kg · {2} PRs · streak at {3}';
          sendPush(user.id, {
            title: pt(l, 'Your week 🔥'),
            body: pt(l, key, rc.sessions, rc.volume, rc.prs, rc.streak),
            tag: 'weekly-recap',
          });
        }
      }
    }
  }
// Checked every 10s (not 60s) — ticks aren't aligned to the top of the minute, so a 60s
// interval could sit on your target minute for up to 59s before noticing. 10s caps that at ~9s.
}, 10000).unref();

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}
// Session payload is `<uid>:<expiry>:<version>`, where the version is the user's `sv` counter.
// Bumping `sv` (POST /api/logout/all) makes every cookie ever handed out for that account stop
// verifying, which is the only revocation there was before short of deleting ./data/secret and
// signing out the whole instance. Cookies minted before `sv` existed have no third field and are
// read as version 0, matching a user who has never bumped — they stay valid until they expire.
const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}
function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid) || null;
  if (!user) return null;
  if (user.disabled) return null;           // disabled accounts are locked out everywhere
  // Missing third field = pre-versioning cookie = version 0. Anything non-numeric is a malformed
  // payload (it still had to pass the HMAC, so this is belt-and-braces) and is refused outright.
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}
// Guard for /api/admin/* — resolves the caller and 401/403s if they aren't an admin.
function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isAdmin(user)) { json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
function sessionCookie(user) {
  return `gymsid=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
}
const clearCookie = `gymsid=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;

/* ---------- challenge store (in-memory, 5 min TTL) ---------- */
const challenges = new Map(); // cid -> {challenge, name?, uid?, exp}
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const b64uToBuf = s => Buffer.from(s, 'base64url');

/* ---------- live presence (in-memory) ---------- */
// Clients heartbeat /api/activity while a workout is on screen; the admin dashboard reads who's
// live. Purely ephemeral — never persisted. Expires shortly after the last ping.
const presence = new Map();               // uid -> { name, exIdx, exTotal, setsDone, setsTotal, startedAt, updatedAt }
const PRESENCE_TTL = 70000;               // ~3.5× the 20s client heartbeat
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: db.users.length }),

  // Public config the login screen needs before anyone is signed in.
  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY }),

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } });
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const code = String(body.code || '').trim().toUpperCase();
    if (INVITE_ONLY && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked))
      return json(res, 403, { error: 'a valid invite code is required' });
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid) return json(res, 400, { error: 'challenge expired — try again' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) return json(res, 409, { error: 'credential already registered' });
    // Re-check the invite at the last moment (it may have been used/revoked since options), then burn it.
    let invite = null;
    if (INVITE_ONLY) {
      invite = db.invites.find(i => i.code === c.code && !i.usedBy && !i.revoked);
      if (!invite) return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
    }
    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    saveDb();
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login/options': async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c) return json(res, 400, { error: 'challenge expired — try again' });
    const cred = db.creds.find(x => x.id === body.credential?.id);
    if (!cred) return json(res, 404, { error: 'unknown passkey — create a profile first' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports
        }
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    cred.counter = verification.authenticationInfo.newCounter;
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) return json(res, 500, { error: 'user missing' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/logout': async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }),

  // "Sign out everywhere" — bumps this user's session version, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sv = sessionVersion(user) + 1;
    saveDb();
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(user.id), 'utf8'));
      json(res, 200, { state });
    } catch { json(res, 200, { state: null }); }
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;              // in-progress workouts stay device-local
    atomicWrite(stateFile(user.id), JSON.stringify(body.state));
    json(res, 200, { ok: true, ts: body.state._ts || null });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, { title: 'openGym', body: pt(langOf(user.id), 'Test notification ✅ — this is what alerts look like.'), tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  // Live-workout heartbeat: client pings while a workout is on screen; { active:false } drops it.
  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  // One row per user, cheap enough for a personal instance (reads each state file once).
  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const users = db.users.map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, created: u.created || null,
        disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: db.subs.some(s => s.userId === u.id),
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  // Drill-down: full workout history + body-weight log for one user.
  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()   // newest first for display
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    u.disabled = !!body.disabled;
    if (u.disabled) presence.delete(u.id);   // drop them off "training now" at once
    saveDb();
    json(res, 200, { ok: true, id: u.id, disabled: u.disabled });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // resolve usedBy uid → name for display
    const invites = db.invites.map(i => ({
      ...i, usedByName: i.usedBy ? (db.users.find(u => u.id === i.usedBy) || {}).name || null : null
    }));
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code;
    // 16 hex chars = 64 bits, up from 8 chars / 32 bits. The app has no rate limiting by design
    // (that's the reverse proxy's job) and /api/register/options tells a caller whether a code is
    // good, so the code itself has to be the thing that isn't worth guessing. Codes already in
    // db.json keep working — validation is an exact string compare, never a length or format check.
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    db.invites.push(invite);
    saveDb();
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    db.invites = db.invites.filter(i => i.code !== inv.code);
    saveDb();
    json(res, 200, { ok: true });
  },

  /* ---------- leagues ---------- */
  'GET /api/groups': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const mine = groups.filter(g => g.members.includes(user.id)).map(g => ({
      id: g.id, name: g.name, owner: g.owner, weeklyGoal: g.weeklyGoal,
      isOwner: g.owner === user.id,
      code: g.owner === user.id ? g.code : undefined,   // only the owner needs the join code
      members: g.members.map(memberView)
    }));
    json(res, 200, { groups: mine });
  },

  'POST /api/groups': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (groups.filter(g => g.members.includes(user.id)).length >= LEAGUE_MAX_PER_USER)
      return json(res, 400, { error: 'you are in the maximum number of leagues' });
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40) || 'League';
    const g = {
      id: crypto.randomBytes(9).toString('base64url'),
      name, owner: user.id, members: [user.id], code: newLeagueCode(),
      weeklyGoal: clampGoal(body.weeklyGoal), created: new Date().toISOString(), pulses: {}
    };
    groups.push(g);
    saveGroups();
    json(res, 200, { id: g.id });
  },

  'POST /api/groups/join': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const code = String(body.code || '').trim().toUpperCase();
    const g = groups.find(x => x.code === code);
    if (!g) return json(res, 404, { error: 'no league with that code' });
    if (!g.members.includes(user.id)) {
      if (g.members.length >= LEAGUE_MAX_MEMBERS) return json(res, 400, { error: 'this league is full' });
      if (groups.filter(x => x.members.includes(user.id)).length >= LEAGUE_MAX_PER_USER)
        return json(res, 400, { error: 'you are in the maximum number of leagues' });
      g.members.push(user.id);
      saveGroups();
    }
    json(res, 200, { id: g.id });
  }
};

// /api/groups/<id> and /api/groups/<id>/<action> — the id segment means these can't sit
// in the exact-match table above. Returns a handler or null (→ 404 in the dispatcher).
function groupRoute(method, pathname) {
  const m = pathname.match(/^\/api\/groups\/([^/]+)(?:\/([a-z]+))?$/);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  const action = m[2] || '';

  // Resolve caller + group, members only; `needOwner` additionally requires ownership.
  // Writes the error response and returns null on any failure.
  const resolve = (req, res, needOwner) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    const g = groupById(id);
    if (!g || !g.members.includes(user.id)) { json(res, 404, { error: 'no such league' }); return null; }
    if (needOwner && g.owner !== user.id) { json(res, 403, { error: 'only the league owner can do that' }); return null; }
    return { user, g };
  };

  if (method === 'GET' && !action) return async (req, res) => {
    const ctx = resolve(req, res); if (!ctx) return;
    const { user, g } = ctx;
    json(res, 200, {
      group: {
        id: g.id, name: g.name, owner: g.owner, weeklyGoal: g.weeklyGoal,
        isOwner: g.owner === user.id, code: g.owner === user.id ? g.code : undefined,
        members: g.members.map(memberView)
      },
      pulses: g.pulses || {}
    });
  };

  if (method === 'PUT' && action === 'pulse') return async (req, res) => {
    const ctx = resolve(req, res); if (!ctx) return;
    const { user, g } = ctx;
    const b = await readBody(req);
    const wk = String(b.week || '');
    if (!/^\d{4}-\d{1,2}$/.test(wk)) return json(res, 400, { error: 'bad week key' });
    const int = (v, max) => Math.max(0, Math.min(max, Math.round(+v) || 0));
    g.pulses = g.pulses || {};
    g.pulses[user.id] = g.pulses[user.id] || {};
    g.pulses[user.id][wk] = {
      points: int(b.points, 100000), sessions: int(b.sessions, 100),
      streak: int(b.streak, 1040), prs: int(b.prs, 200), volBeat: !!b.volBeat, ts: Date.now()
    };
    pruneGroup(g);
    saveGroups();
    json(res, 200, { ok: true });
  };

  if (method === 'POST' && action === 'leave') return async (req, res) => {
    const ctx = resolve(req, res); if (!ctx) return;
    const { user, g } = ctx;
    g.members = g.members.filter(u => u !== user.id);
    if (g.pulses) delete g.pulses[user.id];
    if (!g.members.length) groups = groups.filter(x => x.id !== g.id);      // last one out closes it
    else if (g.owner === user.id) g.owner = g.members[0];                   // hand ownership on
    saveGroups();
    json(res, 200, { ok: true });
  };

  if (method === 'POST' && action === 'rename') return async (req, res) => {
    const ctx = resolve(req, res, true); if (!ctx) return;
    const b = await readBody(req);
    if (b.name != null) ctx.g.name = String(b.name).trim().slice(0, 40) || ctx.g.name;
    if (b.weeklyGoal != null) ctx.g.weeklyGoal = clampGoal(b.weeklyGoal);
    saveGroups();
    json(res, 200, { ok: true });
  };

  if (method === 'POST' && action === 'kick') return async (req, res) => {
    const ctx = resolve(req, res, true); if (!ctx) return;
    const b = await readBody(req);
    const target = String(b.uid || '');
    if (target === ctx.user.id) return json(res, 400, { error: 'use leave to remove yourself' });
    ctx.g.members = ctx.g.members.filter(u => u !== target);
    if (ctx.g.pulses) delete ctx.g.pulses[target];
    saveGroups();
    json(res, 200, { ok: true });
  };

  if (method === 'POST' && action === 'code') return async (req, res) => {
    const ctx = resolve(req, res, true); if (!ctx) return;
    ctx.g.code = newLeagueCode();
    saveGroups();
    json(res, 200, { code: ctx.g.code });
  };

  return null;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;
  const handler = routes[key] || groupRoute(req.method, url.pathname);
  if (!handler) return json(res, 404, { error: 'not found' });
  try { await handler(req, res); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));
