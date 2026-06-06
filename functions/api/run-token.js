/**
 * Cloudflare Pages Function — /api/run-token
 * Route: GET /api/run-token
 *
 * Issues a short-lived, HMAC-signed token stamped with the SERVER's clock at
 * the moment a game starts. The game returns this token when submitting a
 * score; /api/leaderboard then uses the server timestamp to verify that enough
 * REAL wall-clock time elapsed for the claimed distance (the van's top speed is
 * 96 mph, so a 516-mile run physically needs minutes of real play). This is the
 * core anti-cheat: a forged "instant" top score is rejected because the server
 * knows how long ago it issued the token, and the browser can't forge the HMAC.
 *
 * Required Cloudflare secret: RUN_SECRET  (any long random string; same value
 *                                          must be set for /api/leaderboard)
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function b64url(s) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const secret = context.env.RUN_SECRET;
  if (!secret) return json({ error: 'RUN_SECRET not configured in Cloudflare secrets' }, 500);

  const payload = { iat: Date.now(), n: crypto.randomUUID() };
  const p = b64url(JSON.stringify(payload));
  const sig = await hmacHex(secret, p);
  return json({ token: p + '.' + sig });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
