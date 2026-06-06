/**
 * Cloudflare Pages Function — /api/leaderboard
 * Routes:
 *   GET  /api/leaderboard   →  { month, monthly:[top10], allTime:[top10] }
 *   POST /api/leaderboard   →  submit a run, returns updated boards + your rank
 *       body: { token, name, town, score, distance, timeSec, items, bonus }
 *
 * Required Cloudflare KV binding: LEADERBOARD
 * Required Cloudflare secret:     RUN_SECRET   (same value as /api/run-token)
 *
 * ── Anti-cheat (robust, not infallible) ──────────────────────────────────────
 * The game runs client-side, so values can be forged. We make that expensive:
 *   1. Verify the HMAC run token (browser can't forge it).
 *   2. REAL-TIME check: server compares its own clock to the token's issue time;
 *      the claimed distance must be physically reachable in that real window at
 *      96 mph. Faking a top score requires actually keeping a session open.
 *   3. RECOMPUTE: the score must equal floor(distance*2.5)+bonus, and every
 *      component is bounded to physically-possible limits. Can't POST a big number.
 *   4. One-time nonce stops replaying the same token.
 * KV has no transactions, so two simultaneous submits could in theory clobber one
 * another — acceptable for a low-traffic local game.
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ── game constants (MUST match game-nc500.html) ──
const TOP_SPEED_UNITS = 68.6;                        // game-units/sec at max (≈96 mph)
const MILES_PER_UNIT  = 0.014;
const MAX_DIST_UNITS  = 516 / MILES_PER_UNIT + 1500; // full NC500 + slack
const CAP_KEEP        = 25;                           // entries stored per board
const NAME_MAX = 18, TOWN_MAX = 24;

// basic profanity guard (rejects the name/town back to 'Anonymous'/'')
const BANNED = ['fuck', 'shit', 'cunt', 'nigger', 'faggot', 'bitch', 'wank', 'twat', 'bastard', 'dick', 'piss', 'slut', 'whore', 'rape', 'nazi'];

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(s)));
}
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// strip control chars + angle brackets, collapse whitespace, cap length, profanity-reject
function clean(str, max) {
  str = String(str == null ? '' : str);
  let out = '';
  for (let i = 0; i < str.length && out.length < max; i++) {
    const ch = str[i], code = str.charCodeAt(i);
    if (code < 32 || ch === '<' || ch === '>') continue;
    out += ch;
  }
  out = out.replace(/\s+/g, ' ').trim();
  const low = out.toLowerCase();
  for (let j = 0; j < BANNED.length; j++) { if (low.indexOf(BANNED[j]) >= 0) return ''; }
  return out;
}

async function verifyToken(env, token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const dot = token.indexOf('.');
  const p = token.slice(0, dot), sig = token.slice(dot + 1);
  const expect = await hmacHex(env.RUN_SECRET, p);
  if (!sig || sig.length !== expect.length) return null;
  let diff = 0;                                       // constant-time-ish compare
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  if (diff !== 0) return null;
  try { return JSON.parse(b64urlDecode(p)); } catch (_) { return null; }
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }

// returns null if the run is plausible, or a string reason if it should be rejected
function validate(body, iat, now) {
  const distance = num(body.distance), timeSec = num(body.timeSec),
        items = num(body.items), bonus = num(body.bonus), score = num(body.score);
  if ([distance, timeSec, items, bonus, score].some(Number.isNaN)) return 'bad numbers';
  if (distance < 0 || timeSec < 0 || items < 0 || score < 0) return 'negative values';
  if (distance > MAX_DIST_UNITS) return 'distance too high';
  if (timeSec > 7200) return 'time too high';

  const realElapsed = (now - iat) / 1000;
  if (realElapsed < 3) return 'submitted too fast';
  if (realElapsed > 7 * 3600) return 'token expired';

  // the game clock can be LESS than real time (a backgrounded tab pauses it) but never meaningfully more
  if (timeSec > realElapsed * 1.25 + 5) return 'game time exceeds real time';
  // can't cover more ground than top speed allows over the GAME clock…
  if (distance > TOP_SPEED_UNITS * timeSec * 1.1 + 50) return 'distance vs game-time impossible';
  // …and the REAL wall-clock must also allow that distance (the key check)
  if (realElapsed < distance / TOP_SPEED_UNITS * 0.85) return 'distance vs real-time impossible';

  if (items > distance / 8 + 12) return 'too many items';
  if (bonus > items * 700 + 9000) return 'bonus too high';
  if (bonus < -200000) return 'bonus too low';

  // score must be derived from its parts — kills "just send a huge score"
  const expected = Math.max(0, Math.floor(distance * 2.5) + Math.round(bonus));
  if (Math.abs(score - expected) > 2) return 'score does not match components';
  return null;
}

function monthKey(now) {
  const d = new Date(now);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
async function readBoard(env, key) {
  const v = await env.LEADERBOARD.get(key);
  if (!v) return [];
  try { return JSON.parse(v) || []; } catch (_) { return []; }
}
function insert(board, entry) {
  board.push(entry);
  board.sort((a, b) => b.score - a.score);
  return board.slice(0, CAP_KEEP);
}
function top10(board) {
  return board.slice(0, 10).map(e => ({ name: e.name, town: e.town, score: e.score }));
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.LEADERBOARD) return json({ error: 'LEADERBOARD KV namespace not bound' }, 500);
  const mk = monthKey(Date.now());
  const [monthly, allTime] = await Promise.all([
    readBoard(env, 'board:' + mk), readBoard(env, 'board:all'),
  ]);
  return json({ month: mk, monthly: top10(monthly), allTime: top10(allTime) });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.LEADERBOARD) return json({ error: 'LEADERBOARD KV namespace not bound' }, 500);
  if (!env.RUN_SECRET)  return json({ error: 'RUN_SECRET not configured' }, 500);

  let body = {};
  try { body = await request.json(); } catch (_) { return json({ error: 'bad json' }, 400); }

  const payload = await verifyToken(env, body.token);
  if (!payload || typeof payload.iat !== 'number' || !payload.n) {
    return json({ accepted: false, error: 'invalid run token' }, 403);
  }

  // one-time use (replay protection)
  const nonceKey = 'nonce:' + payload.n;
  if (await env.LEADERBOARD.get(nonceKey)) return json({ accepted: false, error: 'token already used' }, 409);

  const now = Date.now();
  const reason = validate(body, payload.iat, now);
  if (reason) return json({ accepted: false, error: 'rejected: ' + reason }, 422);

  const name = clean(body.name, NAME_MAX) || 'Anonymous';
  const town = clean(body.town, TOWN_MAX);
  const score = Math.max(0, Math.floor(num(body.score)));
  const entry = { name, town, score, ts: now };

  // burn the nonce (TTL just beyond max token life)
  await env.LEADERBOARD.put(nonceKey, '1', { expirationTtl: 8 * 3600 });

  const mk = monthKey(now);
  const monthlyKey = 'board:' + mk, allKey = 'board:all';
  let monthly = await readBoard(env, monthlyKey);
  let allTime = await readBoard(env, allKey);
  monthly = insert(monthly, entry);
  allTime = insert(allTime, entry);
  await Promise.all([
    env.LEADERBOARD.put(monthlyKey, JSON.stringify(monthly)),
    env.LEADERBOARD.put(allKey, JSON.stringify(allTime)),
  ]);

  const rankMonthly = monthly.findIndex(e => e.ts === now && e.score === score) + 1;
  return json({
    accepted: true, month: mk,
    rankMonthly: rankMonthly > 0 ? rankMonthly : null,
    monthly: top10(monthly), allTime: top10(allTime),
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
