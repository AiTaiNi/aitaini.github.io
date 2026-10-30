/* Shared code for the Indonesian pages (personal/learning/indonesian/). Design: _docs/indonesian.md, tables:
   _docs/indonesian-database.md, data files: _docs/indonesian-data.md.
   Load after sync.js (and /assets/tasks.js, which keeps the two Calendar tasks in step). Gives window.Idn:

     Idn.start(activity)       promise, once signed in and loaded; starts the study-time tracker for `activity`
     Idn.data(name)            a file from data/, fetched once per data version
     Idn.settings, Idn.setSettings(patch)
     Idn.cards, Idn.sched      Map id -> card row; Map "cardId|direction" -> schedule row (FSRS state)
     Idn.face(card, deck)      what a card shows: word, meaning, forms, examples (deck entry and your edits merged)
     Idn.queue()               today's work: learning, review and new items, in order
     Idn.answer(item, rating)  schedule a review, save it (queued offline, sent when possible); returns the new state
     Idn.preview(item)         the interval each rating would give, for the buttons
     Idn.library()             your PDF library rows (idn_library), [] if the table isn't there
     Idn.addCards(rows)        add your own / pulled-forward cards
     Idn.today()               { due, newToday, newLimit, minutes, week, streak }
     Idn.speak(text)           read Indonesian aloud with the browser's id-ID voice
     Idn.plan(planJson)        { week, month, day }: where today is in the 1-year plan */
window.Idn = (() => {
    const db = Sync.db;
    const BASE = '/personal/learning/indonesian/data/';
    const SETTINGS = 'idn-settings', SUMMARY = 'idn-summary', QUEUE = 'idn-queue';
    const MIN = 6e4, DAY = 864e5;

    const DEFAULTS = {
        start: '',            /* first day of the plan (YYYY-MM-DD), set on first use */
        newWeekday: 10,       /* new cards Monday–Friday… */
        newWeekend: 0,        /* …and at weekends (the plan: reviews only) */
        retention: 0.9,       /* FSRS target: chance of remembering a card when it's due */
        activeUpTo: 800,      /* deck words up to here are also reviewed English -> Indonesian (typed) */
        maxReviews: 200,      /* reviews per day at most; the rest move on (after missed days) */
        voice: '',            /* speech voice URI; '' = the first Indonesian one */
        autoplay: false,      /* read each card aloud when it's shown */
        tasks: true           /* keep the two daily tasks on the Calendar */
    };

    Sync.use([SETTINGS, SUMMARY]);

    /* ---------- small helpers ---------- */
    const pad = n => String(n).padStart(2, '0');
    const dayKey = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const uuid = () => crypto.randomUUID();
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

    function el(tag, props, kids) {
        const e = document.createElement(tag);

        Object.assign(e, props || {});
        (kids || []).forEach(k => k != null && e.append(k));

        return e;
    }

    /* ---------- settings ---------- */
    const api = { el, dayKey, cards: new Map(), sched: new Map(), deck: [], deckIndex: new Map(), sentences: {} };

    api.settings = Object.assign({}, DEFAULTS, Sync.get(SETTINGS, {}));

    api.setSettings = patch => {
        api.settings = Object.assign({}, api.settings, patch);
        Sync.set(SETTINGS, api.settings);
    };

    Sync.on(SETTINGS, v => api.settings = Object.assign({}, DEFAULTS, v));

    /* ---------- data files ---------- */
    let manifest = null;
    const files = {};

    api.data = async name => {
        manifest = manifest || fetch(BASE + 'manifest.json', { cache: 'no-cache' }).then(r => r.json());

        const m = await manifest, v = (m.files[name] || {}).hash || m.version;

        return files[name] = files[name] || fetch(BASE + name + '?v=' + v).then(r => {
            if (!r.ok) throw new Error(name + ': ' + r.status);

            return r.json();
        });
    };

    /* ---------- FSRS (v5 formulas, default weights) with short learning steps ---------- */
    const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
    const F = 19 / 81, C = -0.5;
    const R = (t, s) => Math.pow(1 + F * t / s, C);
    const days = (s, r) => clamp(Math.round(s / F * (Math.pow(r, 1 / C) - 1)), 1, 36500);
    const D0 = g => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
    const nextD = (d, g) => clamp(W[7] * D0(4) + (1 - W[7]) * (d - W[6] * (g - 3) * (10 - d) / 9), 1, 10);
    const recallS = (d, s, r, g) => s * (Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1) + 1);
    const forgetS = (d, s, r) => Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
    const shortS = (s, g) => s * Math.exp(W[17] * (g - 3 + W[18]));

    /* The four outcomes for a card (cur = schedule row, or null when new). Learning steps: Again 1 min, Hard 6 min,
       Good 10 min for new cards; a card graduates to days with Good/Easy. Intervals keep Hard < Good < Easy. */
    function outcomes(cur, now, retention) {
        const res = {};

        for (const g of [1, 2, 3, 4]) {
            let state, S, D, wait, lapses = cur ? cur.lapses : 0;

            if (!cur || cur.state === 0) {
                S = W[g - 1];
                D = D0(g);
                [state, wait] = g === 4 ? [2, days(S, retention) * DAY] : [1, [MIN, 6 * MIN, 10 * MIN][g - 1]];
            } else if (cur.state === 1 || cur.state === 3) {
                S = shortS(cur.stability, g);
                D = nextD(cur.difficulty, g);
                [state, wait] = g >= 3 ? [2, days(S, retention) * DAY] : [cur.state, g === 1 ? MIN : 6 * MIN];
            } else {
                const t = Math.max(0, (now - Date.parse(cur.last_review || cur.due)) / DAY), r = R(t, cur.stability);

                D = nextD(cur.difficulty, g);

                if (g === 1) {
                    S = forgetS(cur.difficulty, cur.stability, r);
                    [state, wait] = [3, 10 * MIN];
                    lapses++;
                } else {
                    S = t < 1 ? shortS(cur.stability, g) : recallS(cur.difficulty, cur.stability, r, g);
                    [state, wait] = [2, days(S, retention) * DAY];
                }
            }

            res[g] = { state, stability: S, difficulty: D, reps: (cur ? cur.reps : 0) + 1, lapses, wait };
        }

        /* Hard < Good < Easy, in whole days once they're in days */
        if (res[2].state === 2 && res[3].wait <= res[2].wait) res[3].wait = res[2].wait + DAY;

        if (res[4].state === 2 && res[3].state === 2 && res[4].wait <= res[3].wait) res[4].wait = res[3].wait + DAY;

        return res;
    }

    function label(ms) {
        if (ms < 3600e3) return Math.max(1, Math.round(ms / MIN)) + ' min';

        if (ms < DAY) return Math.round(ms / 3600e3) + ' h';

        const d = Math.round(ms / DAY);

        return d < 31 ? d + ' d' : d < 365 ? Math.round(d / 30) + ' mo' : (d / 365).toFixed(1) + ' y';
    }

    /* ---------- offline queue: every write goes through it, in order ---------- */
    const readQ = () => {
        try {
            return JSON.parse(localStorage.getItem(QUEUE)) || [];
        } catch {
            return [];
        }
    };

    const writeQ = q => {
        try {
            localStorage.setItem(QUEUE, JSON.stringify(q));
        } catch {
        }
    };

    function enqueue(op) {
        const q = readQ();

        /* a study session's minutes only need their latest value */
        if (op.t === 'session') {
            const i = q.findIndex(o => o.t === 'session' && o.row.id === op.row.id);

            if (i > -1) q.splice(i, 1);
        }

        q.push(op);
        writeQ(q);
        flush();
    }

    const offline = e => !e || /fetch|network|load failed/i.test(e.message || '');
    let flushing = false;

    async function send(op) {
        let res;

        try {
            if (op.t === 'card') res = await db.from('idn_cards').upsert(op.row, { onConflict: 'id' });
            else if (op.t === 'review') res = await db.rpc('idn_review', { r: op.r, s: op.s });
            else if (op.t === 'session') res = await db.from('idn_sessions').upsert(op.row, { onConflict: 'id' });
            else if (op.t === 'patch') res = await db.from('idn_cards').update(op.patch).eq('id', op.id);
        } catch (e) {
            return 'offline';
        }

        const e = res.error;

        if (!e) return '';

        if (offline(e)) return 'offline';

        /* another device introduced the same deck word first: use its card and point queued reviews at it */
        if (op.t === 'card' && e.code === '23505' && op.row.deck_id) {
            const { data } = await db.from('idn_cards').select('*').eq('deck_id', op.row.deck_id).maybeSingle();

            if (data) {
                const q = readQ();

                q.forEach(o => {
                    if (o.r && o.r.card_id === op.row.id) o.r.card_id = data.id;
                });

                writeQ(q);
                api.cards.delete(op.row.id);
                api.cards.set(data.id, data);

                for (const dir of ['recognise', 'recall']) {
                    const s = api.sched.get(op.row.id + '|' + dir);

                    if (s) {
                        api.sched.delete(op.row.id + '|' + dir);
                        api.sched.set(data.id + '|' + dir, Object.assign(s, { card_id: data.id }));
                    }
                }

                return '';
            }
        }

        return e.message;
    }

    async function flush() {
        if (flushing || !db || !Sync.user) return;

        flushing = true;

        try {
            while (readQ().length) {
                const op = readQ()[0], err = await send(op);

                if (err === 'offline') break;

                if (err) console.warn('Indonesian: a save was refused and dropped:', err, op);

                const q = readQ();

                q.shift();
                writeQ(q);
            }
        } finally {
            flushing = false;
            api.pending = readQ().length;
            changed();
        }
    }

    addEventListener('online', flush);

    /* ---------- loading ---------- */
    /* Every row of a table, 1000 at a time; `order` must make rows unique so pages don't overlap */
    async function all(table, cols, ...order) {
        const out = [];

        for (let from = 0; ; from += 1000) {
            let q = db.from(table).select(cols);

            order.forEach(o => q = q.order(o));

            const { data, error } = await q.range(from, from + 999);

            if (error) throw error;

            out.push(...data);

            if (data.length < 1000) return out;
        }
    }

    let base = { minutes: 0, week: 0, days: new Set() };

    async function load() {
        const [deck, sentences, cards, sched, sessions] = await Promise.all([
            api.data('deck.json'), api.data('sentences.json'),
            all('idn_cards', '*', 'id'),
            all('idn_schedule', 'card_id,direction,state,due,stability,difficulty,reps,lapses,last_review', 'card_id', 'direction'),
            db.from('idn_sessions').select('day,kind,minutes').gte('day', dayKey(new Date(Date.now() - 400 * DAY))).then(r => {
                if (r.error) throw r.error;

                return r.data;
            })
        ]);

        api.deck = deck;
        api.sentences = sentences;
        deck.forEach((d, i) => api.deckIndex.set(d.id, Object.assign(d, { pos: i + 1 })));
        cards.forEach(c => api.cards.set(c.id, c));
        sched.forEach(s => api.sched.set(s.card_id + '|' + s.direction, s));

        /* work done offline and not uploaded yet counts already */
        readQ().forEach(op => {
            if (op.t === 'card') api.cards.set(op.row.id, Object.assign(api.cards.get(op.row.id) || {}, op.row));

            if (op.t === 'review') api.sched.set(op.r.card_id + '|' + op.r.direction, Object.assign({ card_id: op.r.card_id, direction: op.r.direction, last_review: op.r.reviewed_at }, op.s));
        });

        const today = dayKey(), monday = dayKey(new Date(startOfDay() - ((new Date().getDay() + 6) % 7) * DAY));

        sessions.forEach(s => {
            if (s.kind !== 'study') return;

            const m = Number(s.minutes) || 0;

            if (m > 0) base.days.add(s.day);

            if (s.day === today) base.minutes += m;

            if (s.day >= monday) base.week += m;
        });

        if (!api.settings.start) api.setSettings({ start: today });

        api.pending = readQ().length;
        flush();
    }

    /* ---------- cards ---------- */
    /* What a card shows: your own edits win over the deck entry */
    api.face = (card, deck) => {
        const d = deck || (card && card.deck_id ? api.deckIndex.get(card.deck_id) : null) || {};
        const c = card || {};
        const ex = c.example ? [[c.example, c.example_en || '']] : (d.x || []).map(i => api.sentences[i]).filter(Boolean).concat(d.xi ? [d.xi] : []);

        return {
            w: c.indonesian || d.w || '', en: c.english || d.g || '', std: c.formal || d.std || '', root: c.root || d.r || '',
            reg: c.register || d.reg || 'neutral', pr: d.pr || '', note: c.notes || d.n || '', also: d.also || [], ex, tags: c.tags || [],
            lemma: d.id || (c.indonesian || '').toLowerCase(), pos: d.pos || 0
        };
    };

    const isWeekend = () => [0, 6].includes(new Date().getDay());

    function summary() {
        const s = Sync.get(SUMMARY, {});

        return s.day === dayKey() ? s : { day: dayKey(), newToday: 0 };
    }

    /* Today's work: learning cards due now, reviews due today (capped), then new cards: cards you added that
       haven't been studied, then the deck in order. Recall (typed) for active cards starts the day after their
       first recognition review. */
    api.queue = () => {
        const end = startOfDay() + DAY, now = Date.now(), today = startOfDay();
        const learn = [], review = [], fresh = [], recall = [];
        const live = c => c && !c.suspended;

        for (const s of api.sched.values()) {
            const card = api.cards.get(s.card_id);

            if (!live(card) || Date.parse(s.due) >= end) continue;

            (s.state === 1 || s.state === 3 ? learn : review).push({ card, dir: s.direction, s });
        }

        learn.sort((a, b) => Date.parse(a.s.due) - Date.parse(b.s.due));
        review.sort((a, b) => Date.parse(a.s.due) - Date.parse(b.s.due));

        for (const card of api.cards.values()) {
            if (!live(card)) continue;

            const rec = api.sched.get(card.id + '|recognise');

            if (!rec) fresh.push({ card, dir: 'recognise', isNew: true });
            else if (card.active && !api.sched.get(card.id + '|recall') && rec.last_review && Date.parse(rec.last_review) < today) recall.push({ card, dir: 'recall', s: null });
        }

        fresh.sort((a, b) => (a.card.created_at || '').localeCompare(b.card.created_at || ''));

        const taken = new Set([...api.cards.values()].map(c => c.deck_id).filter(Boolean));
        const limit = Math.max(0, api.newLimit() - summary().newToday);
        const news = fresh.slice(0, limit);

        for (const d of api.deck) {
            if (news.length >= limit) break;

            if (!taken.has(d.id)) news.push({ card: null, deck: d, dir: 'recognise', isNew: true });
        }

        const reviews = review.concat(recall).slice(0, api.settings.maxReviews);

        return { learn, review: reviews, news, dueLater: learn.filter(i => Date.parse(i.s.due) > now).length };
    };

    api.newLimit = () => isWeekend() ? api.settings.newWeekend : api.settings.newWeekday;

    api.preview = item => {
        const cur = item.card ? api.sched.get(item.card.id + '|' + item.dir) || null : null, o = outcomes(cur, Date.now(), api.settings.retention);

        return { 1: label(o[1].wait), 2: label(o[2].wait), 3: label(o[3].wait), 4: label(o[4].wait) };
    };

    function newCardRow(d) {
        const pos = api.deckIndex.get(d.id).pos;

        return { id: uuid(), deck_id: d.id, active: pos <= api.settings.activeUpTo, created_at: new Date().toISOString(), tags: [], suspended: false };
    }

    api.answer = (item, rating, ms) => {
        let card = item.card;

        if (!card) {
            card = newCardRow(item.deck);
            api.cards.set(card.id, card);
            enqueue({ t: 'card', row: card });
            item.card = card;
        }

        const key = card.id + '|' + item.dir, cur = api.sched.get(key) || null, now = Date.now();
        const o = outcomes(cur, now, api.settings.retention)[rating];
        let wait = o.wait;

        /* a little spread so cards learned together don't all come back on the same day */
        if (wait >= 3 * DAY) wait = Math.round(wait / DAY * (0.95 + Math.random() * 0.1)) * DAY;

        const at = new Date(now).toISOString(), due = new Date(now + wait).toISOString();
        const s = { state: o.state, due, stability: o.stability, difficulty: o.difficulty, reps: o.reps, lapses: o.lapses };

        api.sched.set(key, Object.assign({ card_id: card.id, direction: item.dir, last_review: at }, s));

        if (!cur && item.dir === 'recognise') {
            const sm = summary();

            Sync.set(SUMMARY, Object.assign({}, Sync.get(SUMMARY, {}), sm, { newToday: sm.newToday + 1 }));
        }

        enqueue({ t: 'review', r: { client_id: uuid(), card_id: card.id, direction: item.dir, rating, duration_ms: Math.round(ms || 0), reviewed_at: at }, s });
        changed();

        return s;
    };

    /* Cards you add (a topic set from your PDFs, or pulled forward from the deck); they come first among new cards */
    api.addCards = rows => {
        rows.forEach(r => {
            const row = Object.assign({ id: uuid(), created_at: new Date().toISOString(), tags: [], suspended: false, active: true }, r);

            api.cards.set(row.id, row);
            enqueue({ t: 'card', row });
        });

        changed();
    };

    /* Immersion time logged by hand (watching, reading…), queued like everything else */
    api.logSession = row => enqueue({ t: 'session', row: Object.assign({ id: uuid(), day: dayKey(), started_at: new Date().toISOString() }, row) });

    api.patchCard = (card, patch) => {
        Object.assign(card, patch);
        enqueue({ t: 'patch', id: card.id, patch });
        changed();
    };

    /* ---------- PDF library ---------- */
    let lib = null;

    api.library = () => lib = lib || all('idn_library', 'id,kind,indonesian,english,lemma,root,also,pos,example,example_en,topic,file,page,status,deck_pos', 'id').catch(e => {
        console.warn('Indonesian: no PDF library (' + e.message + ')');

        return [];
    });

    /* ---------- study time ---------- */
    let session = null, secs = 0, lastInput = Date.now();

    function track(activity) {
        ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(n => addEventListener(n, () => lastInput = Date.now(), { passive: true }));

        const save = () => {
            if (!session || secs < 5) return;

            enqueue({ t: 'session', row: Object.assign({}, session, { minutes: Math.round(secs / 6) / 10 }) });
        };

        setInterval(() => {
            if (document.hidden || Date.now() - lastInput > 60e3) return;

            /* a new day starts a new session row */
            if (!session || session.day !== dayKey()) {
                if (session) {
                    save();
                    base = { minutes: 0, week: new Date().getDay() === 1 ? 0 : base.week + secs / 60, days: base.days };
                }

                session = { id: uuid(), day: dayKey(), kind: 'study', activity, started_at: new Date().toISOString(), minutes: 0 };
                secs = 0;
            }

            secs += 5;

            if (secs % 30 === 0) save();

            if (secs % 60 === 0) changed();
        }, 5000);

        addEventListener('visibilitychange', () => document.hidden && save());
        addEventListener('pagehide', save);
    }

    api.today = () => {
        const q = api.queue(), minutes = base.minutes + secs / 60, days = new Set(base.days);
        let streak = 0;

        if (minutes >= 1) days.add(dayKey());

        /* consecutive days with study, counting back from today (or from yesterday, if today hasn't started yet) */
        let d = new Date();

        if (!days.has(dayKey(d))) d = new Date(d.getTime() - DAY);

        while (days.has(dayKey(d))) {
            streak++;
            d = new Date(d.getTime() - DAY);
        }

        const due = q.learn.length + q.review.length;
        const known = [...api.sched.values()].filter(s => s.direction === 'recognise' && s.state === 2).length;

        return { due, newToday: summary().newToday, newLimit: api.newLimit(), newLeft: q.news.length, minutes, week: base.week + secs / 60, streak, known, cards: api.cards.size };
    };

    /* ---------- hub summary and Calendar tasks ---------- */
    let syncReady = false, last = '';

    Sync.ready().then(() => {
        syncReady = true;
        flush();
        changed();
    });

    const listeners = [];

    api.onChange = fn => listeners.push(fn);

    function changed() {
        if (!loaded) return;

        const t = api.today(), sm = summary();
        const next = Object.assign({}, Sync.get(SUMMARY, {}), sm, { due: t.due, minutes: Math.floor(t.minutes), streak: t.streak, known: t.known });
        const sig = JSON.stringify(next);

        if (sig !== last) {
            last = sig;

            if (sig !== JSON.stringify(Sync.get(SUMMARY, {}))) Sync.set(SUMMARY, next);
        }

        if (syncReady && window.Tasks && Tasks.syncTask) {
            if (api.settings.tasks) {
                Tasks.syncTask({ id: 'idn-reviews', name: 'Indonesian reviews' }, t.due === 0 && t.minutes >= 1 ? 1 : 0);
                Tasks.syncTask({ id: 'idn-study', name: 'Indonesian study (15-min blocks)', max: 4 }, Math.floor(t.minutes / 15));
            } else {
                Tasks.dropTask('idn-reviews');
                Tasks.dropTask('idn-study');
            }
        }

        listeners.forEach(fn => fn(t));
    }

    /* ---------- speech ---------- */
    api.voices = () => (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter(v => /^(id|in)\b/i.test(v.lang));

    api.speak = text => {
        if (!window.speechSynthesis || !text) return;

        const u = new SpeechSynthesisUtterance(text);
        const v = api.voices().find(x => x.voiceURI === api.settings.voice) || api.voices()[0];

        u.lang = 'id-ID';
        u.rate = 0.9;

        if (v) u.voice = v;

        speechSynthesis.cancel();
        speechSynthesis.speak(u);
    };

    /* ---------- plan ---------- */
    api.plan = plan => {
        const start = new Date((api.settings.start || dayKey()) + 'T00:00').getTime();
        const week = Math.max(1, Math.floor((startOfDay() - start) / (7 * DAY)) + 1);
        const month = clamp(Math.floor((week - 1) / (52 / 12)) + 1, 1, 12);
        const wd = ((new Date().getDay() + 6) % 7) + 1;

        return { week, month: plan.months.find(m => m.n === month), day: plan.week[wd], wd };
    };

    /* ---------- start ---------- */
    let loaded = false, starting = null;

    api.start = activity => starting = starting || new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Supabase isn’t set up (see _docs/sync-setup.md).'));

        let done = false;

        db.auth.onAuthStateChange((_, s) => {
            if (!s || done) return;

            done = true;

            setTimeout(() => load().then(() => {
                loaded = true;
                track(activity);
                changed();
                resolve(api);
            }, reject), 0);
        });
    });

    return api;
})();
