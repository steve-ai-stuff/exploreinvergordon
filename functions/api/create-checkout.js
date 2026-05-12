
/**
 * Cloudflare Pages Function — SumUp Checkout Creator
 * Route: /api/create-checkout (POST)
 *
 * Creates a £15 GBP SumUp checkout and returns the checkoutId
 * to the client so the Payment Widget can mount.
 *
 * Environment variable required (set in Cloudflare Pages dashboard):
 *   SUMUP_API_KEY  — your SumUp production API key
 */

const MERCHANT_CODE = 'MDHCAGRZ';
const AMOUNT        = 15.00;
const CURRENCY      = 'GBP';

export async function onRequestPost(context) {
  const { env, request } = context;

  // Read optional metadata from the page (name, ship, date)
  // so the checkout description in SumUp matches the order
  let meta = {};
  try {
    meta = await request.json();
  } catch (_) { /* body may be empty — that's fine */ }

  const name = meta.name  || 'Guest';
  const ship = meta.ship  || 'Unknown ship';
  const date = meta.date  || 'Unknown date';

  const description = `Shore Day Concierge — ${name} — ${ship} — ${date}`;
  const reference   = `ei-concierge-${Date.now()}`;

  // Create the checkout via SumUp API
  let apiResponse;
  try {
    apiResponse = await fetch('https://api.sumup.com/v0.1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SUMUP_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        checkout_reference: reference,
        amount:             AMOUNT,
        currency:           CURRENCY,
        description:        description,
        merchant_code:      MERCHANT_CODE,
      }),
    });
  } catch (networkErr) {
    return jsonResponse({ error: 'Network error reaching SumUp API' }, 502);
  }

  if (!apiResponse.ok) {
    const detail = await apiResponse.text();
    return jsonResponse({ error: 'SumUp API error', detail }, 502);
  }

  const data = await apiResponse.json();

  return jsonResponse({ checkoutId: data.id }, 200);
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
