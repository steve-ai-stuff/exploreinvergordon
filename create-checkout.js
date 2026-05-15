/**
 * Cloudflare Pages Function — /api/create-checkout
 *
 * Called by cruise-hub.html after Formspree booking details are submitted.
 * Uses SUMUP_API_KEY (set in Cloudflare Pages → Settings → Variables and Secrets)
 * to create a SumUp Hosted Checkout and returns the hosted_checkout_url.
 *
 * Flow:
 *   1. POST /api/create-checkout  { name, email, ship, date }
 *   2. GET  https://api.sumup.com/v0.1/me  → fetch merchant_code
 *   3. POST https://api.sumup.com/v0.1/checkouts  → create hosted checkout
 *   4. Return { hosted_checkout_url, checkoutId, reference }
 */

export async function onRequestPost(context) {
  const { env, request } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin':  'https://exploreinvergordon.scot',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  /* ── Parse request body ── */
  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    return new Response(
      JSON.stringify({ error: 'Invalid request body' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const apiKey = env.SUMUP_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Payment service not configured — SUMUP_API_KEY missing' }),
      { status: 500, headers: corsHeaders }
    );
  }

  /* ── Step 1: Get merchant_code from /me ── */
  let merchantCode;
  try {
    const meRes = await fetch('https://api.sumup.com/v0.1/me', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!meRes.ok) throw new Error(`/me returned ${meRes.status}`);
    const me = await meRes.json();
    merchantCode = me?.merchant_profile?.merchant_code;
    if (!merchantCode) throw new Error('merchant_code missing from /me response');
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Could not retrieve merchant details', detail: err.message }),
      { status: 502, headers: corsHeaders }
    );
  }

  /* ── Step 2: Unique checkout reference ── */
  const ref = `SDC-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  /* ── Step 3: Human-readable description for SumUp dashboard ── */
  const shipName  = (body.ship  || 'Cruise passenger').slice(0, 60);
  const portDate  = body.date
    ? new Date(body.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'date TBC';
  const guestName = (body.name || '').slice(0, 40);
  const description = `Shore Day Concierge — ${shipName} · ${portDate}${guestName ? ' · ' + guestName : ''}`;

  /* ── Step 4: Create the SumUp Hosted Checkout ── */
  let checkoutData;
  try {
    const checkoutRes = await fetch('https://api.sumup.com/v0.1/checkouts', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        amount:             15.00,
        currency:           'GBP',
        checkout_reference: ref,
        description:        description,
        merchant_code:      merchantCode,
        redirect_url:       'https://exploreinvergordon.scot/cruise-hub.html?booking=confirmed',
        hosted_checkout:    { enabled: true },
      }),
    });

    if (!checkoutRes.ok) {
      const errBody = await checkoutRes.text();
      throw new Error(`SumUp checkout creation failed (${checkoutRes.status}): ${errBody}`);
    }

    checkoutData = await checkoutRes.json();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Could not create payment session', detail: err.message }),
      { status: 502, headers: corsHeaders }
    );
  }

  /* ── Step 5: Return the hosted checkout URL to the client ── */
  return new Response(
    JSON.stringify({
      hosted_checkout_url: checkoutData.hosted_checkout_url,
      checkoutId:          checkoutData.id,
      reference:           ref,
    }),
    { status: 200, headers: corsHeaders }
  );
}

/* ── CORS pre-flight ── */
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  'https://exploreinvergordon.scot',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
