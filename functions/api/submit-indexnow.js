/**
 * Cloudflare Pages Function — /api/submit-indexnow
 * Route: GET or POST /api/submit-indexnow
 *
 * Submits all Explore Invergordon pages to Bing via IndexNow.
 * Call this after any publish/update to get instant Bing indexing.
 *
 * URLs are read LIVE from /sitemap.xml (single source of truth) via Cloudflare's
 * internal ASSETS binding — so this never goes stale when new pages are added,
 * and never makes a slow/looping request to its own public hostname.
 * If the sitemap can't be read, it falls back to the built-in list below.
 *
 * Responses set Cache-Control: no-store so the endpoint always runs fresh
 * (otherwise Cloudflare can serve a cached old result).
 *
 * Usage:
 *   Browser: visit https://exploreinvergordon.scot/api/submit-indexnow
 *   curl:    curl -X POST https://exploreinvergordon.scot/api/submit-indexnow
 *
 * IndexNow docs: https://www.indexnow.org/documentation
 */

const HOST         = 'exploreinvergordon.scot';
const KEY          = '03a2eaaa9a984a128f324a630df8c7fe';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

// Fallback only — used if the sitemap can't be read/parsed. Keep reasonably current.
const FALLBACK_URLS = [
  `https://${HOST}/`,
  `https://${HOST}/blog`,
  `https://${HOST}/cruise-hub`,
  `https://${HOST}/murals`,
  `https://${HOST}/nc500`,
  `https://${HOST}/gallery`,
  `https://${HOST}/plan-my-day`,
  `https://${HOST}/work-with-me`,
];

const JSON_HEADERS = {
  'Content-Type':                 'application/json',
  'Cache-Control':                'no-store, max-age=0',
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Read /sitemap.xml from this deployment via the ASSETS binding (no public fetch).
async function getUrlsFromSitemap(context) {
  try {
    if (!context || !context.env || !context.env.ASSETS) {
      return { urls: [], source: 'no-assets-binding' };
    }
    const u = new URL(context.request.url);
    u.pathname = '/sitemap.xml';
    u.search = '';
    const res = await context.env.ASSETS.fetch(new Request(u.toString()));
    if (!res.ok) return { urls: [], source: `sitemap-error-${res.status}` };
    const xml = await res.text();
    const urls = [];
    const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const v = m[1].trim().replace(/&amp;/g, '&');
      if (v) urls.push(v);
    }
    return { urls, source: 'sitemap' };
  } catch (err) {
    return { urls: [], source: `sitemap-exception: ${err.message}` };
  }
}

async function handleRequest(context) {
  const { urls: sitemapUrls } = await getUrlsFromSitemap(context);
  const usingFallback = sitemapUrls.length === 0;
  const URLS = usingFallback ? FALLBACK_URLS : sitemapUrls;

  const payload = { host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: URLS };

  let indexNowRes;
  // Hard timeout — without this, a hanging IndexNow call lets the Function exceed
  // its runtime limit and Cloudflare kills it, returning a branded 502 "Bad gateway"
  // page (bypassing the JSON error handling below). AbortController makes it fail fast.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    indexNowRes = await fetch('https://api.indexnow.org/indexnow', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body:    JSON.stringify(payload),
      signal:  controller.signal,
    });
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return new Response(
      JSON.stringify({
        success: false,
        error: timedOut ? 'IndexNow API did not respond within 8s (timed out)' : 'Network error contacting IndexNow API',
        detail: err.message,
        note: 'Static site, sitemap and key file are unaffected. You can also reindex manually in Bing Webmaster Tools.',
      }, null, 2),
      { status: 504, headers: JSON_HEADERS }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const success = indexNowRes.status === 200 || indexNowRes.status === 202;
  const result = {
    success,
    indexnow_status: indexNowRes.status,
    url_source:      usingFallback ? 'FALLBACK (sitemap unreadable)' : 'sitemap.xml',
    submitted_urls:  URLS,
    url_count:       URLS.length,
    host:            HOST,
    key:             KEY,
    timestamp:       new Date().toISOString(),
    message: success
      ? `✅ ${URLS.length} URLs submitted to Bing IndexNow from ${usingFallback ? 'fallback list' : 'sitemap.xml'}. Indexing typically begins within minutes.`
      : `⚠️ IndexNow returned status ${indexNowRes.status}. Check the key file is accessible at ${KEY_LOCATION}`,
  };

  return new Response(JSON.stringify(result, null, 2), { status: success ? 200 : 502, headers: JSON_HEADERS });
}

export async function onRequestGet(context)     { return handleRequest(context); }
export async function onRequestPost(context)    { return handleRequest(context); }
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}
