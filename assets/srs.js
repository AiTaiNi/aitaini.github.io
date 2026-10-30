/* Spaced repetition for any private page: FSRS scheduling, an offline write queue, and a card/schedule store kept in
   Supabase tables. Load after sync.js. How to give a page its own deck (tables, code, what the ratings mean):
   _docs/flashcards.md. First user: personal/learning/indonesian/idn.js.

     SRS.outcomes(cur, now, retention)   the four possible results of rating a card (pure, for previews and tests)
     SRS.label(ms)                       "10 min", "4 d", "3 mo"…
     SRS.deck(options)                   a store for one set of tables, see below
     SRS.all(db, table, cols, ...order)  every row of a table, 1000 at a time
     SRS.uuid(), SRS.dayKey(date), SRS.startOfDay(date)

   SRS.deck({ cards, schedule, review, queue, uniqueBy?, ops?, coalesce?, retention?, onFlush? }):
     cards/schedule    table names (e.g. 'idn_cards', 'idn_schedule')
     review            name of the save-a-review database function (e.g. 'idn_review')
     queue             localStorage key for writes not uploaded yet (e.g. 'idn-queue')
     uniqueBy          a card column that's unique per user (e.g. 'deck_id'): if two devices add the same card, the
                       second one switches to the first one's row instead of failing
     ops               extra write types: { type: async op => supabase result } (e.g. study-time rows)
     coalesce          op => key: queued writes with the same key replace each other (only the latest is sent)
     retention         () => target retention, 0.7–0.97 (default 0.9)
     onFlush           called after each upload attempt (e.g. to show "3 changes waiting")
   It gives: cards (Map id -> row), sched (Map "cardId|direction" -> FSRS state), load(), due(), preview(),
   answer(), addCard(), patchCard(), enqueue(), flush(), pending(). */
window.SRS = (() => {
    const MIN = 6e4, DAY = 864e5;
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const pad = n => String(n).padStart(2, '0');
    const dayKey = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const uuid = () => crypto.randomUUID();

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

    /* The four outcomes (1 Again, 2 Hard, 3 Good, 4 Easy) for a card; cur = its schedule row, or null when new.
       States: 0 new, 1 learning, 2 review, 3 relearning. Learning steps: a new card comes back after 1 / 6 / 10 min
       (Again / Hard / Good) and graduates to days with Good (from learning) or Easy (straight away). In review,
       Again sends it back to relearning for 10 min. Intervals always keep Hard < Good < Easy. */
    function outcomes(cur, now, retention = 0.9) {
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

    /* Every row of a table, 1000 at a time; `order` must make rows unique so pages don't overlap */
    async function all(db, table, cols, ...order) {
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

    /* ---------- a deck: cards + schedule in Supabase, every write through an offline queue ---------- */
    function deck(o) {
        const db = Sync.db, cards = new Map(), sched = new Map();
        const retention = o.retention || (() => 0.9);
        const key = (cardId, dir) => cardId + '|' + dir;

        const readQ = () => {
            try {
                return JSON.parse(localStorage.getItem(o.queue)) || [];
            } catch {
                return [];
            }
        };

        const writeQ = q => {
            try {
                localStorage.setItem(o.queue, JSON.stringify(q));
            } catch {
            }
        };

        const offline = e => !e || /fetch|network|load failed/i.test(e.message || '');
        let flushing = false;

        function enqueue(op) {
            const q = readQ(), k = o.coalesce && o.coalesce(op);

            if (k != null) {
                const i = q.findIndex(x => o.coalesce(x) === k);

                if (i > -1) q.splice(i, 1);
            }

            q.push(op);
            writeQ(q);
            flush();
        }

        /* Another device added the same card first (uniqueBy clash): adopt its row and move everything over */
        async function adopt(row) {
            const { data } = await db.from(o.cards).select('*').eq(o.uniqueBy, row[o.uniqueBy]).maybeSingle();

            if (!data) return false;

            const q = readQ();

            q.forEach(x => {
                if (x.r && x.r.card_id === row.id) x.r.card_id = data.id;

                if (x.t === 'patch' && x.id === row.id) x.id = data.id;
            });

            writeQ(q);
            cards.delete(row.id);
            cards.set(data.id, data);

            for (const [k, s] of [...sched]) {
                if (s.card_id === row.id) {
                    sched.delete(k);
                    sched.set(key(data.id, s.direction), Object.assign(s, { card_id: data.id }));
                }
            }

            return true;
        }

        async function send(op) {
            let res;

            try {
                if (op.t === 'card') res = await db.from(o.cards).upsert(op.row, { onConflict: 'id' });
                else if (op.t === 'review') res = await db.rpc(o.review, { r: op.r, s: op.s });
                else if (op.t === 'patch') res = await db.from(o.cards).update(op.patch).eq('id', op.id);
                else if (o.ops && o.ops[op.t]) res = await o.ops[op.t](op);
                else return 'unknown write type ' + op.t;
            } catch {
                return 'offline';
            }

            const e = res.error;

            if (!e) return '';

            if (offline(e)) return 'offline';

            if (op.t === 'card' && e.code === '23505' && o.uniqueBy && op.row[o.uniqueBy] && await adopt(op.row)) return '';

            return e.message;
        }

        async function flush() {
            if (flushing || !db || !Sync.user) return;

            flushing = true;

            try {
                while (readQ().length) {
                    const op = readQ()[0], err = await send(op);

                    if (err === 'offline') break;

                    if (err) console.warn('SRS (' + o.cards + '): a save was refused and dropped:', err, op);

                    const q = readQ();

                    q.shift();
                    writeQ(q);
                }
            } finally {
                flushing = false;

                if (o.onFlush) o.onFlush(readQ().length);
            }
        }

        addEventListener('online', flush);
        Sync.ready().then(flush);

        return {
            cards, sched, enqueue, flush,
            pending: () => readQ().length,

            /* Cards and schedule from the database, plus whatever is still waiting in the offline queue */
            async load() {
                const [cs, ss] = await Promise.all([
                    all(db, o.cards, '*', 'id'),
                    all(db, o.schedule, 'card_id,direction,state,due,stability,difficulty,reps,lapses,last_review', 'card_id', 'direction')
                ]);

                cs.forEach(c => cards.set(c.id, c));
                ss.forEach(s => sched.set(key(s.card_id, s.direction), s));

                readQ().forEach(op => {
                    if (op.t === 'card') cards.set(op.row.id, Object.assign(cards.get(op.row.id) || {}, op.row));

                    if (op.t === 'review') sched.set(key(op.r.card_id, op.r.direction), Object.assign({ card_id: op.r.card_id, direction: op.r.direction, last_review: op.r.reviewed_at }, op.s));

                    if (op.t === 'patch' && cards.has(op.id)) Object.assign(cards.get(op.id), op.patch);
                });

                flush();
            },

            /* Scheduled cards due before `end` (default: end of today), split into learning and review, soonest first.
               Suspended cards are left out. */
            due(end = startOfDay() + DAY) {
                const learn = [], review = [];

                for (const s of sched.values()) {
                    const card = cards.get(s.card_id);

                    if (!card || card.suspended || Date.parse(s.due) >= end) continue;

                    (s.state === 1 || s.state === 3 ? learn : review).push({ card, dir: s.direction, s });
                }

                const byDue = (a, b) => Date.parse(a.s.due) - Date.parse(b.s.due);

                return { learn: learn.sort(byDue), review: review.sort(byDue) };
            },

            state: (card, dir) => (card && sched.get(key(card.id, dir))) || null,

            /* The wait each rating would give, as labels for the four buttons */
            preview(card, dir) {
                const out = outcomes(card ? sched.get(key(card.id, dir)) || null : null, Date.now(), retention());

                return { 1: label(out[1].wait), 2: label(out[2].wait), 3: label(out[3].wait), 4: label(out[4].wait) };
            },

            /* Rate a card (1–4) in one direction: schedules it, saves the review; returns the new state */
            answer(card, dir, rating, ms) {
                const cur = sched.get(key(card.id, dir)) || null, now = Date.now();
                const out = outcomes(cur, now, retention())[rating];
                let wait = out.wait;

                /* a little spread so cards learned together don't all come back on the same day */
                if (wait >= 3 * DAY) wait = Math.round(wait / DAY * (0.95 + Math.random() * 0.1)) * DAY;

                const at = new Date(now).toISOString();
                const s = { state: out.state, due: new Date(now + wait).toISOString(), stability: out.stability, difficulty: out.difficulty, reps: out.reps, lapses: out.lapses };

                sched.set(key(card.id, dir), Object.assign({ card_id: card.id, direction: dir, last_review: at }, s));
                enqueue({ t: 'review', r: { client_id: uuid(), card_id: card.id, direction: dir, rating, duration_ms: Math.round(ms || 0), reviewed_at: at }, s });

                return Object.assign({ isNew: !cur }, s);
            },

            /* A new card (any columns the cards table has); returns the row with its id */
            addCard(row) {
                const r = Object.assign({ id: uuid(), created_at: new Date().toISOString(), tags: [], suspended: false }, row);

                cards.set(r.id, r);
                enqueue({ t: 'card', row: r });

                return r;
            },

            patchCard(card, patch) {
                Object.assign(card, patch);
                enqueue({ t: 'patch', id: card.id, patch });
            }
        };
    }

    return { outcomes, label, deck, all, uuid, dayKey, startOfDay, MIN, DAY };
})();
