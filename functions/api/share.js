/**
 * Cloudflare Pages Function — /api/share
 * Per-photo social preview (Open Graph) for the gallery.
 *
 * Crawlers (Facebook, X/Twitter, WhatsApp, iMessage) read the OG/Twitter tags
 * here and show the ACTUAL photo. Human visitors are redirected to
 * /gallery?photo=<id> (opens that photo in the gallery lightbox).
 *
 * Takes ONLY ?p=<photo-id> (the gallery deep-link id). It looks the photo's
 * image URL + caption up from /gallery itself (read via the ASSETS binding),
 * so there are no fragile query params to be stripped at the edge, and it
 * stays in sync automatically as photos are added to the gallery.
 *
 * Deploy: via GitHub push (dashboard direct-upload cannot build Functions).
 */

const HOST          = 'exploreinvergordon.scot';
const SITE          = 'https://' + HOST;
const MAIN_BASE     = '/website_image_files/main-gallery/';
const DEFAULT_IMG   = SITE + '/website_image_files/background_images/elgol-harbour-og.jpg';
const DEFAULT_TITLE = 'Explore Invergordon — Scottish Highlands';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function idOf(src) {
  src = String(src).split('?')[0];
  var b = src.split('/').pop() || '';
  return b.replace(/\.[a-z0-9]+$/i, '');
}

// Look up {img, title} for a photo id by reading /gallery (My Gallery data-photos
// arrays + the static Visitor Gallery images).
async function lookupPhoto(context, pid) {
  try {
    if (!context || !context.env || !context.env.ASSETS) return null;
    var u = new URL(context.request.url);
    u.pathname = '/gallery'; u.search = '';
    var res = await context.env.ASSETS.fetch(new Request(u.toString()));
    if (!res.ok) return null;
    var html = await res.text();
    var m;

    // My Gallery — data-folder="X" data-photos='[{src,cap,...}]'
    var reMain = /data-folder="([^"]*)"\s+data-photos='([^']*)'/g;
    while ((m = reMain.exec(html)) !== null) {
      var folder = m[1], arr;
      try { arr = JSON.parse(m[2]); } catch (e) { arr = []; }
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && idOf(arr[i].src) === pid) {
          return {
            img:   SITE + MAIN_BASE + (folder ? folder + '/' : '') + arr[i].src,
            title: (arr[i].cap || DEFAULT_TITLE)
          };
        }
      }
    }

    // Visitor Gallery — static <img src="website_image_files/visitor_gallery/..." alt="...">
    var reVis = /<img[^>]*src="(website_image_files\/visitor_gallery\/[^"]+)"[^>]*alt="([^"]*)"/g;
    while ((m = reVis.exec(html)) !== null) {
      if (idOf(m[1]) === pid) {
        var cap = m[2].replace(/\s*—\s*photo by.*$/i, '').trim();
        return { img: SITE + '/' + m[1], title: (cap || DEFAULT_TITLE) };
      }
    }
    return null;
  } catch (e) { return null; }
}

export async function onRequestGet(context) {
  var url = new URL(context.request.url);
  var p   = (url.searchParams.get('p') || '').trim();
  var pid = /^[A-Za-z0-9._-]{1,160}$/.test(p) ? p : '';

  var found = pid ? await lookupPhoto(context, pid) : null;
  var img   = found ? found.img   : DEFAULT_IMG;
  var title = found ? found.title : DEFAULT_TITLE;
  var dest  = pid ? (SITE + '/gallery?photo=' + encodeURIComponent(pid)) : (SITE + '/gallery');

  var html =
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
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' }
  });
}
