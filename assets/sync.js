/* Sign-in + cross-device sync for personal pages, backed by Supabase.
   Setup steps: _docs/sync-setup.md. Adding pages: _docs/private-pages.md.

   On a page (in <head>, before the page's own scripts):
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js"></script>
     <script src="/assets/sync.js"></script>

   Then in the page's script:
     Sync.use(['my-key'])          keys this page syncs (optionally { merge: { 'my-key': (local, remote) => combined } })
     Sync.get('my-key', fallback)  read, instantly, from this browser's copy
     Sync.set('my-key', value)     save here, then upload
     Sync.on('my-key', fn)         fn(value) runs when a newer copy arrives from another device

   Values are stored in localStorage under the same key, so the page still works offline. */
(() => {
  const SUPABASE_URL = 'https://uiifjgogxvsprwzkexsq.supabase.co';   /* Project URL, e.g. https://abcdefgh.supabase.co */
  const SUPABASE_KEY = 'sb_publishable_FaCgeELZ3-Yj-q1o_eLCrA_f-J9lsCc';   /* Publishable (or legacy anon) key. Meant to be public; the database rules protect the data. */
  const TABLE = 'kv';

  /* ---------- local copy ---------- */
  const read = k => { try { const v = localStorage.getItem(k); return v === null ? undefined : JSON.parse(v); } catch { return undefined; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
  const ms = t => t ? Date.parse(t) : 0;
  const now = () => new Date().toISOString();

  /* Per key: t = time of the local copy, synced = version last matched with the server, dirty = local edit not uploaded yet */
  const meta = read('sync-meta') || {};
  const saveMeta = () => write('sync-meta', meta);

  const keys = new Set(), merges = {}, handlers = {}, timers = {};
  const emit = k => (handlers[k] || []).forEach(fn => { try { fn(read(k)); } catch (e) { console.error(e); } });

  const db = SUPABASE_URL && SUPABASE_KEY && window.supabase ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
  let user = null;

  /* Lock the page until we know who is signed in, so private data never flashes on screen */
  if (db) document.documentElement.classList.add('sync-locked');

  /* ---------- server ---------- */
  async function push(k) {
    const m = meta[k], value = read(k);
    if (!user || !m || !m.dirty || value === undefined) return;

    const at = m.t;
    const { error } = await db.from(TABLE).upsert({ user_id: user.id, key: k, value, updated_at: at });
    if (error) return status('error', error.message);

    if (m.t === at) m.dirty = false;   /* a newer edit made during the upload gets its own push */
    m.synced = at;
    saveMeta();
    status('ok');
  }

  const pushAll = () => Promise.all([...keys].map(push));

  function takeRemote(k, r) {
    write(k, r.value);
    meta[k] = { t: r.updated_at, synced: r.updated_at, dirty: false };
    emit(k);
  }

  async function pull() {
    if (!user || !keys.size) return;
    status('busy');

    const { data, error } = await db.from(TABLE).select('key,value,updated_at').in('key', [...keys]);
    if (error) return status('error', error.message);

    const remote = Object.fromEntries(data.map(r => [r.key, r]));

    for (const k of keys) {
      const r = remote[k], m = meta[k] ||= {}, local = read(k);

      if (!r) {
        /* Nothing on the server yet: upload this device's copy */
        if (local !== undefined) { m.t ||= now(); m.dirty = true; }
      } else if (!m.synced) {
        /* First sync on this device: combine if the page knows how, otherwise the server wins (local copy kept as a backup) */
        if (local !== undefined && merges[k]) {
          write(k, merges[k](local, r.value));
          Object.assign(m, { t: now(), synced: r.updated_at, dirty: true });
          emit(k);
        } else {
          if (local !== undefined && JSON.stringify(local) !== JSON.stringify(r.value)) write(k + '.backup', local);
          takeRemote(k, r);
        }
      } else if (m.dirty && ms(m.t) >= ms(r.updated_at)) {
        /* Local edit is the newest: keep it, upload below */
      } else if (ms(r.updated_at) > ms(m.synced)) {
        /* Changed on another device: the newer copy wins */
        takeRemote(k, r);
      }
    }

    saveMeta();
    await pushAll();
    status('ok');
  }

  /* ---------- page API ---------- */
  let pullTimer;
  const schedulePull = () => { clearTimeout(pullTimer); pullTimer = setTimeout(pull, 0); };

  window.Sync = {
    get: (k, d) => { const v = read(k); return v === undefined ? d : v; },

    set(k, v) {
      write(k, v);
      meta[k] = Object.assign(meta[k] || {}, { t: now(), dirty: true });
      saveMeta();

      if (!user) return;
      status('busy');
      clearTimeout(timers[k]);
      timers[k] = setTimeout(() => push(k), 800);
    },

    use(list, opts = {}) {
      list.forEach(k => keys.add(k));
      Object.assign(merges, opts.merge || {});
      if (user) schedulePull();
    },

    on: (k, fn) => (handlers[k] ||= []).push(fn),

    /* For pages that need more than key/value storage (their own tables etc.) */
    get db() { return db; },
    get user() { return user; }
  };

  /* ---------- sign-in screen + status pill ---------- */
  const CSS = `
    html.sync-locked body > :not(#sync-gate) { visibility: hidden }
    #sync-gate { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; padding: 16px;
      background: var(--bg, #f4f4f5); color: var(--fg, #222); font: 15px/1.5 system-ui, sans-serif }
    html:not(.sync-locked) #sync-gate { display: none }
    #sync-gate form { display: grid; gap: 10px; max-width: 340px; width: 100%; box-sizing: border-box; padding: 28px;
      border-radius: 14px; text-align: center; background: var(--card, #fff); border: 1px solid var(--bd, #ddd) }
    #sync-gate h2 { margin: 0; font-size: 20px }
    #sync-gate p { margin: 0 0 8px; color: var(--mut, #666) }
    #sync-gate input { font: inherit; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--bd, #ddd);
      background: var(--bg, #fff); color: inherit }
    #sync-gate button { font: inherit; padding: 9px 18px; border-radius: 8px; cursor: pointer; border: 0;
      background: var(--ac, #333); color: var(--card, #fff) }
    #sync-gate button:disabled { opacity: .6; cursor: wait }
    #sync-gate .err { margin: 14px 0 0; color: #c0392b }
    #sync-pill { position: fixed; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 9998;
      display: flex; align-items: center; gap: 8px; padding: 5px 6px 5px 11px; border-radius: 99px; font: 12px system-ui, sans-serif;
      background: var(--card, #fff); color: var(--mut, #666); border: 1px solid var(--bd, #ddd) }
    #sync-pill i { width: 8px; height: 8px; border-radius: 50%; background: #9aa0a6 }
    #sync-pill[data-s=ok] i { background: #2db039 }
    #sync-pill[data-s=busy] i { background: #f9d457 }
    #sync-pill[data-s=error] i { background: #c0392b }
    #sync-pill button { font: inherit; padding: 2px 9px; border-radius: 99px; cursor: pointer;
      border: 1px solid var(--bd, #ddd); background: transparent; color: inherit }
    #sync-pill button[hidden] { display: none }`;

  let pill, pillText, outBtn, gateErr;
  const LABELS = { ok: 'Synced', busy: 'Syncing…', error: 'Sync error, saved on this device', off: 'Sync not set up, saved on this device only', out: 'Signed out' };

  function status(s, detail) {
    if (s === 'error') console.warn('Sync:', detail);
    if (!pill) return;
    pill.dataset.s = s;
    pillText.textContent = LABELS[s];
    pill.title = detail || '';
  }

  function buildUi() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    pill = document.createElement('div');
    pill.id = 'sync-pill';
    pill.innerHTML = '<i></i><span></span><button type="button" hidden>Sign out</button>';
    pillText = pill.querySelector('span');
    outBtn = pill.querySelector('button');
    outBtn.onclick = signOut;
    document.body.appendChild(pill);

    if (!db) return;

    /* Sign-in only. Accounts are created by hand in Supabase, so there is deliberately no sign-up form. */
    const gate = document.createElement('div');
    gate.id = 'sync-gate';
    gate.innerHTML = '<form><h2>Private page</h2><p>Sign in to open this page and sync it across your devices.</p>' +
      '<input type="email" name="email" placeholder="Email" autocomplete="username" required aria-label="Email">' +
      '<input type="password" name="password" placeholder="Password" autocomplete="current-password" required aria-label="Password">' +
      '<button type="submit">Sign in</button><p class="err" hidden></p></form>';
    gate.querySelector('form').onsubmit = signIn;
    gateErr = gate.querySelector('.err');
    document.body.appendChild(gate);
  }

  function showError(t) {
    gateErr.textContent = t;
    gateErr.hidden = !t;
  }

  /* ---------- auth ---------- */
  async function signIn(e) {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button');

    btn.disabled = true;
    showError('');

    const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });

    btn.disabled = false;
    if (error) showError(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
    else f.password.value = '';
  }

  /* Upload anything pending, then remove the synced data from this browser (it stays on the server) */
  async function signOut() {
    status('busy');
    await pushAll();
    await db.auth.signOut();
    keys.forEach(k => { try { localStorage.removeItem(k); } catch { } delete meta[k]; });
    saveMeta();
    location.reload();
  }

  function setUser(u) {
    if ((u && u.id) === (user && user.id)) return;
    user = u || null;
    document.documentElement.classList.toggle('sync-locked', !user);
    outBtn.hidden = !user;
    if (user) schedulePull(); else status('out');
  }

  async function start() {
    buildUi();
    if (!db) {
      console.warn('Sync: not configured (see _docs/sync-setup.md), so data is saved on this device only.');
      return status('off');
    }

    const { data } = await db.auth.getSession();
    setUser(data.session && data.session.user);
    db.auth.onAuthStateChange((_, s) => setTimeout(() => setUser(s && s.user), 0));

    /* Catch up when coming back to the tab; upload right away when leaving it */
    document.addEventListener('visibilitychange', () => document.hidden ? pushAll() : schedulePull());
    addEventListener('online', schedulePull);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
