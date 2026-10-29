/* Service worker for the installed Personal app (scope /personal/). Registered by personal/hub.js.
   Network first, so a deploy shows up on the next load; the cached copy is only used offline.
   Caches page files only (this site, plus the pinned supabase-js and the font). Supabase API calls and anything
   else from other sites always go to the network and are never stored, so private data stays in Sync's own
   copy (localStorage) and the database. */
const CACHE = 'personal-v1';
const OTHER = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
    const r = e.request, url = new URL(r.url);

    if (r.method !== 'GET' || !(url.origin === location.origin || OTHER.some(p => r.url.startsWith(p)))) return;

    /* Statement files are git-ignored and shouldn't exist on the site, but never cache them if they do */
    if (url.pathname.startsWith('/personal/statements/json/') || /\.pdf$/i.test(url.pathname)) return;

    e.respondWith(fetch(r).then(res => {
        if (res.ok || res.type === 'opaque') {
            const copy = res.clone();

            caches.open(CACHE).then(c => c.put(r, copy));
        }

        return res;
    }).catch(() => caches.match(r, { ignoreSearch: url.origin === location.origin }).then(hit => hit || Response.error())));
});
