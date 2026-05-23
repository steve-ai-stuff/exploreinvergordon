/**
 * Cloudflare Pages Function — /api/submit-indexnow
 * Route: GET or POST /api/submit-indexnow
 *
 * Submits all Explore Invergordon pages to Bing via IndexNow.
 * Call this after any publish/update to get instant Bing indexing.
 *
 * Usage:
 *   Browser: visit https://exploreinvergordon.scot/api/submit-indexnow
 *   curl:    curl -X POST https://exploreinvergordon.scot/api/submit-indexnow
 *
 * IndexNow docs: https://www.indexnow.org/documentation
 */

const HOST        = 'exploreinvergordon.scot';
const KEY         = '03a2eaaa9a984a128f324a630df8c7fe';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

// All indexable pages — update this list when new pages are added
const URLS = [
  `https://${HOST}/`,
  `https://${HOST}/index.html`,
  `https://${HOST}/blog.html`,
  `https://${HOST}/cruise-hub.html`,
  `https://${HOST}/gallery.html`,
  `https://${HOST}/murals.html`,
  `https://${HOST}/nc500.html`,
  `https://${HOST}/plan-my-day.html`,
  `https://${HOST}/work-with-me.html`,
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function handleRequest() {
  const payload = {
    host:        HOST,
    key:         KEY,
    keyLocation: KEY_LOCATION,
    urlList:     URLS,
  };

  let indexNowRes, indexNowBody;

  try {
    indexNowRes = await fetch('https://api.indexnow.org/indexnow', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body:    JSON.stringify(payload),
    });

    // IndexNow returns 200 or 202 on success, no body
    indexNowBody = indexNowRes.status;

  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error:   'Network error contacting IndexNow API',
        detail:  err.message,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  const success = indexNowRes.status === 200 || indexNowRes.status === 202;

  const result = {
    success,
    indexnow_status: indexNowRes.status,
    submitted_urls:  URLS,
    url_count:       URLS.length,
    host:            HOST,
    key:             KEY,
    timestamp:       new Date().toISOString(),
    message: success
      ? `✅ ${URLS.length} URLs submitted to Bing IndexNow. Indexing typically begins within minutes.`
      : `⚠️ IndexNow returned status ${indexNowRes.status}. Check key file is accessible at ${KEY_LOCATION}`,
  };

  return new Response(
    JSON.stringify(result, null, 2),
    {
      status:  success ? 200 : 502,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    }
  );
}

export async function onRequestGet()     { return handleRequest(); }
export async function onRequestPost()    { return handleRequest(); }
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
