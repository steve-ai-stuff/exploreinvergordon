/**
 * Cloudflare Pages Function — /share
 * Per-photo social preview (Open Graph) for the gallery.
 *
 * Crawlers (Facebook, X/Twitter, WhatsApp) read the OG/Twitter tags here and
 * show the ACTUAL photo. Human visitors are immediately redirected to
 * /gallery?photo=<id>, which opens that photo in the gallery lightbox.
 *
 * Query params (provided by the gallery share buttons):
 *   p   = photo id (gallery deep-link target)
 *   img = full image URL (must be on exploreinvergordon.scot, else ignored)
 *   t   = caption / title (optional)
 *
 * Deploy: via GitHub push (Cloudflare dashboard direct-upload cannot build Functions).
 */

const HOST          = 'exploreinvergordon.scot';
const SITE          = 'https://' + HOST;
const DEFAULT_IMG   = SITE + '/website_image_files/background_images/elgol-harbour-og.jpg';
const DEFAULT_TITLE = 'Explore Invergordon — Scottish Highlands';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Only allow images hosted on our own site (prevents OG/preview injection abuse).
function safeImg(img) {
  return (typeof img === 'string' && img.indexOf(SITE + '/') === 0) ? img : DEFAULT_IMG;
}
// Photo ids are filename-style only.
function safeId(p) {
  return (typeof p === 'string' && /^[A-Za-z0-9._-]{1,160}$/.test(p)) ? p : '';
}

export async function onRequestGet(context) {
  const url   = new URL(context.request.url);
  const p     = safeId(url.searchParams.get('p') || '');
  const img   = safeImg(url.searchParams.get('img') || '');
  const tRaw  = (url.searchParams.get('t') || '').trim();
  const title = tRaw ? tRaw.slice(0, 200) : DEFAULT_TITLE;
  const dest  = p ? (SITE + '/gallery?photo=' + encodeURIComponent(p)) : (SITE + '/gallery');

  const html =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(title) + ' — Explore Invergordon</title>' +
    '<link rel="canonical" href="' + esc(dest) + '">' +
    '<meta property="og:type" content="article">' +
    '<meta property="og:site_name" content="Explore Invergordon">' +
    '<meta property="og:title" content="' + esc(title) + '">' +
    '<meta property="og:description" content="A photograph from Explore Invergordon — the Scottish Highlands.">' +
    '<meta property="og:image" content="' + esc(img) + '">' +
    '<meta property="og:image:alt" content="' + esc(title) + '">' +
    '<meta property="og:url" content="' + esc(dest) + '">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + esc(title) + '">' +
    '<meta name="twitter:image" content="' + esc(img) + '">' +
    '<meta http-equiv="refresh" content="0; url=' + esc(dest) + '">' +
    '<script>location.replace(' + JSON.stringify(dest) + ');</script>' +
    '</head><body style="background:#080f1e;color:#e8eef8;font-family:system-ui,sans-serif;text-align:center;padding:3rem 1rem;">' +
    '<p>Opening photo… <a href="' + esc(dest) + '" style="color:#c9a84c;">View it in the gallery →</a></p>' +
    '</body></html>';

  return new Response(html, {
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
