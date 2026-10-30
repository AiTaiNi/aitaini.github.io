/* Shared code for the Indonesian pages (personal/learning/indonesian/). Design: _docs/indonesian.md, tables:
   _docs/indonesian-database.md, data files: _docs/indonesian-data.md.
   Scheduling, the card store and the offline queue are the shared flashcard engine, /assets/srs.js (window.SRS);
   this file adds what's Indonesian: the prepared deck and its order, recall cards, the plan, study time, the hub
   summary and Calendar tasks, speech and the PDF library.
   Load after sync.js and srs.js (and /assets/tasks.js, which keeps the two Calendar tasks in step). Gives window.Idn:

     Idn.start(activity)       promise, once signed in and loaded; starts the study-time tracker for `activity`
     Idn.data(name)            a file from data/, fetched once per data version
     Idn.settings, Idn.setSettings(patch)
     Idn.cards, Idn.sched      Map id -> card row; Map "cardId|direction" -> schedule row (FSRS state)
     Idn.face(card, deck)      what a card shows: word, meaning, forms, examples (deck entry and your edits merged)
     Idn.queue()               today's work: learning, review and new items, in order
     Idn.answer(item, rating)  schedule a review, save it (queued offline, sent when possible); returns the new state
     Idn.preview(item)         the wait each rating would give, for the buttons
     Idn.library()             your PDF library rows (idn_library), [] if the table isn't there
     Idn.addCards(rows)        add your own / pulled-forward cards
     Idn.today()               { due, newToday, newLimit, minutes, week, streak }
     Idn.speak(text)           read Indonesian aloud with the browser's id-ID voice
     Idn.plan(planJson)        { week, month, day }: where today is in the 1-year plan */
window.Idn = (() => {
    const db = Sync.db;
    const BASE = '/personal/learning/indonesian/data/';
    const SETTINGS = 'idn-settings', SUMMARY = 'idn-summary';
    const { DAY, dayKey, startOfDay, uuid } = SRS;

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

    function el(tag, props, kids) {
        const e = document.createElement(tag);

        Object.assign(e, props || {});
        (kids || []).forEach(k => k != null && e.append(k));

        return e;
    }

    /* ---------- settings ---------- */
    const api = { el, dayKey, deck: [], deckIndex: new Map(), sentences: {} };

    api.settings = Object.assign({}, DEFAULTS, Sync.get(SETTINGS, {}));

    api.setSettings = patch => {
        api.settings = Object.assign({}, api.settings, patch);
        Sync.set(SETTINGS, api.settings);
    };

    Sync.on(SETTINGS, v => api.settings = Object.assign({}, DEFAULTS, v));

    /* ---------- the card store (shared engine) ---------- */
    const store = SRS.deck({
        cards: 'idn_cards', schedule: 'idn_schedule', review: 'idn_review', queue: 'idn-queue',
        uniqueBy: 'deck_id',
        ops: { session: op => db.from('idn_sessions').upsert(op.row, { onConflict: 'id' }) },
        coalesce: op => op.t === 'session' ? 'session:' + op.row.id : null,   /* only a session's latest minutes matter */
        retention: () => api.settings.retention,
        onFlush: n => {
            api.pending = n;
            changed();
        }
    });

    api.cards = store.cards;
    api.sched = store.sched;

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

    /* ---------- loading ---------- */
    let base = { minutes: 0, week: 0, days: new Set() };

    async function load() {
        const [deck, sentences, , sessions] = await Promise.all([
            api.data('deck.json'), api.data('sentences.json'), store.load(),
            db.from('idn_sessions').select('day,kind,minutes').gte('day', dayKey(new Date(Date.now() - 400 * DAY))).then(r => {
                if (r.error) throw r.error;

                return r.data;
            })
        ]);

        api.deck = deck;
        api.sentences = sentences;
        deck.forEach((d, i) => api.deckIndex.set(d.id, Object.assign(d, { pos: i + 1 })));

        const today = dayKey(), monday = dayKey(new Date(startOfDay() - ((new Date().getDay() + 6) % 7) * DAY));

        sessions.forEach(s => {
            if (s.kind !== 'study') return;

            const m = Number(s.minutes) || 0;

            if (m > 0) base.days.add(s.day);

            if (s.day === today) base.minutes += m;

            if (s.day >= monday) base.week += m;
        });

        if (!api.settings.start) api.setSettings({ start: today });

        api.pending = store.pending();
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
        const now = Date.now(), today = startOfDay();
        const { learn, review } = store.due();
        const fresh = [], recall = [];

        for (const card of store.cards.values()) {
            if (card.suspended) continue;

            const rec = store.state(card, 'recognise');

            if (!rec) fresh.push({ card, dir: 'recognise', isNew: true });
            else if (card.active && !store.state(card, 'recall') && rec.last_review && Date.parse(rec.last_review) < today) recall.push({ card, dir: 'recall', s: null });
        }

        fresh.sort((a, b) => (a.card.created_at || '').localeCompare(b.card.created_at || ''));

        const taken = new Set([...store.cards.values()].map(c => c.deck_id).filter(Boolean));
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

    api.preview = item => store.preview(item.card, item.dir);

    /* A deck word becomes a card row the first time it's answered */
    api.answer = (item, rating, ms) => {
        if (!item.card) {
            const pos = api.deckIndex.get(item.deck.id).pos;

            item.card = store.addCard({ deck_id: item.deck.id, active: pos <= api.settings.activeUpTo });
        }

        const s = store.answer(item.card, item.dir, rating, ms);

        if (s.isNew && item.dir === 'recognise') {
            const sm = summary();

            Sync.set(SUMMARY, Object.assign({}, Sync.get(SUMMARY, {}), sm, { newToday: sm.newToday + 1 }));
        }

        changed();

        return s;
    };

    /* Cards you add (a topic set from your PDFs, or pulled forward from the deck); they come first among new cards */
    api.addCards = rows => {
        rows.forEach(r => store.addCard(Object.assign({ active: true }, r)));
        changed();
    };

    api.patchCard = (card, patch) => {
        store.patchCard(card, patch);
        changed();
    };

    /* Immersion time logged by hand (watching, reading…), queued like everything else */
    api.logSession = row => store.enqueue({ t: 'session', row: Object.assign({ id: uuid(), day: dayKey(), started_at: new Date().toISOString() }, row) });

    /* ---------- PDF library ---------- */
    let lib = null;

    api.library = () => lib = lib || SRS.all(db, 'idn_library', 'id,kind,indonesian,english,lemma,root,also,pos,example,example_en,topic,file,page,status,deck_pos', 'id').catch(e => {
        console.warn('Indonesian: no PDF library (' + e.message + ')');

        return [];
    });

    /* ---------- study time ---------- */
    let session = null, secs = 0, lastInput = Date.now();

    function track(activity) {
        ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(n => addEventListener(n, () => lastInput = Date.now(), { passive: true }));

        const save = () => {
            if (!session || secs < 5) return;

            store.enqueue({ t: 'session', row: Object.assign({}, session, { minutes: Math.round(secs / 6) / 10 }) });
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
        const known = [...store.sched.values()].filter(s => s.direction === 'recognise' && s.state === 2).length;

        return { due, newToday: summary().newToday, newLimit: api.newLimit(), newLeft: q.news.length, minutes, week: base.week + secs / 60, streak, known, cards: store.cards.size };
    };

    /* ---------- hub summary and Calendar tasks ---------- */
    let syncReady = false, last = '';

    Sync.ready().then(() => {
        syncReady = true;
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
        const month = Math.min(12, Math.max(1, Math.floor((week - 1) / (52 / 12)) + 1));
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
