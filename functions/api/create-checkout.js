/**
 * Cloudflare Pages Function — /api/create-checkout
 * Route: POST /api/create-checkout
 *
 * Creates a SumUp Hosted Checkout for the Shore Day Concierge service (£15 GBP)
 * and returns the hosted_checkout_url for the client to redirect to.
 *
 * Required Cloudflare secret: SUMUP_API_KEY
 */

const MERCHANT_CODE = 'MDHCAGRZ';
const AMOUNT        = 15.00;
const CURRENCY      = 'GBP';
const REDIRECT_URL  = 'https://exploreinvergordon.scot/cruise-hub.html?booking=confirmed';

export async function onRequestPost(context) {
  const { env, request } = context;

  const headers = {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  const apiKey = env.SUMUP_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'SUMUP_API_KEY not configured in Cloudflare secrets' }),
      { status: 500, headers }
    );
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const ref = `SDC-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const shipName  = (body.ship || 'Cruise passenger').slice(0, 60);
  const portDate  = body.date
    ? new Date(body.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'date TBC';
  const guestName = (body.name || '').slice(0, 40);
  const description = `Shore Day Concierge — ${shipName} · ${portDate}${guestName ? ' · ' + guestName : ''}`;

  let checkoutRes, checkoutData;
  try {
    checkoutRes = await fetch('https://api.sumup.com/v0.1/checkouts', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        amount:             AMOUNT,
        currency:           CURRENCY,
        checkout_reference: ref,
        description:        description,
        merchant_code:      MERCHANT_CODE,
        redirect_url:       REDIRECT_URL,
        hosted_checkout:    { enabled: true },
      }),
    });

    checkoutData = await checkoutRes.json();

    if (!checkoutRes.ok) {
      return new Response(
        JSON.stringify({
          error:  'SumUp checkout creation failed',
          status: checkoutRes.status,
          detail: checkoutData,
        }),
        { status: 502, headers }
      );
    }

  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Network error calling SumUp API', detail: err.message }),
      { status: 502, headers }
    );
  }

  return new Response(
    JSON.stringify({
      hosted_checkout_url: checkoutData.hosted_checkout_url,
      checkoutId:          checkoutData.id,
      reference:           ref,
    }),
    { status: 200, headers }
  );
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
