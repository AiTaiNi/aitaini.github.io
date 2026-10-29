# Making a private page

Any page can use the same sign-in and synced storage as the dashboard. This assumes the one-time setup in
[sync-setup.md](sync-setup.md) is done.

**Quickest route:** copy [template/](template/) (a complete page with sign-in, sync and the dashboard's styling).
Its [README](template/README.md) has the steps. The rest of this file explains what the template does.

## Steps

1. In the page's `<head>`, **before** its own scripts:

   ```html
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js"></script>
   <script src="/assets/sync.js"></script>
   ```

   That alone puts the page behind the sign-in screen. You're signed in on all private pages at once (it's the
   same site), so there's no extra login per page.

2. In the page's script, use `Sync` in place of `localStorage`:

   ```js
   const KEY = 'reading-list';                 // pick a unique key per page/feature
   Sync.use([KEY]);                            // sync this key

   let list = Sync.get(KEY, []);               // read (second argument = default)
   render();

   function add(item) {
     list.push(item);
     Sync.set(KEY, list);                      // save + upload
     render();
   }

   Sync.on(KEY, v => { list = v; render(); }); // newer copy from another device
   ```

3. Optional: if two devices might both have data the first time, pass a merge function so neither copy is lost:

   ```js
   Sync.use([KEY], { merge: { [KEY]: (local, remote) => [...new Set([...remote, ...local])] } });
   ```

4. Optional: before changing data **another page owns** (as Expenses does with the Calendar's events), wait for
   `Sync.ready()`. It resolves once the server's copies are in, so an old copy on this device can't overwrite newer
   data. It never resolves while signed out or offline.

## Guidelines

- **Key names**: lowercase with dashes, unique across all pages (`dash-cfg`, `reading-list`, …). The same key on
  two pages means shared data.
- **Size**: each key is one JSON value that's uploaded whole on every change. Great for lists, settings and logs
  up to a few hundred KB. For something big or ever-growing (e.g. thousands of journal entries), split it across
  keys (`journal-2026`, `journal-2027`) or create a dedicated table with the same RLS rule and use `Sync.db`
  (the Supabase client) directly. [statements.md](statements.md) is a worked example (tables, rules and an
  import function).
- **No new SQL is needed** for new keys; the `kv` table holds any key.
- **No secrets in page code**: the page source is public; only the stored data is private.

## Installed app

`/personal/` can be installed as an app (Chrome/Edge/Android: the **Install app** button on the hub or the
browser's install icon; iPhone/iPad: Share → Add to Home Screen). It opens on the hub in its own window, and every
page under `/personal/` opens inside it, so a new page needs nothing extra.

- [personal/manifest.webmanifest](../personal/manifest.webmanifest): name, colours, icons (`personal/icons/`), and
  shortcuts to Today, Calendar and Expenses. A new page can get a shortcut there.
- [personal/sw.js](../personal/sw.js): the service worker, registered by `personal/hub.js` with scope `/personal/`.
  It's **network first**: the network copy is used whenever there is one, so a deploy shows up on the next load,
  and the cached copy is only used offline. It caches page files only (this site, supabase-js, the font).
  Supabase API calls never go through the cache, so private data stays in Sync's local copy and the database.
- Offline, pages open with Sync's local copy and upload changes when back online. Pages that read tables
  (Statements, Expenses) need the network.
- If a change to `sw.js` itself doesn't seem to apply, bump `CACHE` (`personal-v2`) so old caches are dropped.
