/* Expenses page: sorts saved statement rows (see _docs/statements.md) into subscriptions, bills and transport, and
   estimates the next cycle. How the sorting and estimates work: _docs/expenses.md.
   A "month" is a statement's period: the card's cycle and the debit account's calendar month that end in it.
   Corrections made on the page are synced under KEY; the statement rows themselves are only read. */
(() => {
    const $ = id => document.getElementById(id);
    const db = Sync.db;
    const KEY = 'expense-rules';   /* { lineKey: one of the GROUPS keys } */
    const ACC = { credit: 'Credit card', debit: 'Debit account' };

    /* "-y" = paid once a year: shown with its group, but only in the month it's due */
    const GROUPS = { bill: 'Bill', 'bill-y': 'Bill · yearly', sub: 'Subscription', 'sub-y': 'Subscription · yearly', transport: 'Transport', other: 'Other', ignore: 'Ignore' };
    const SHOWN = ['bill', 'sub', 'transport'];
    const base = g => g.replace(/-y$/, '');

    /* Service payments (PAGOSERVIC) are named by the provider code in front of the account number */
    const PROVIDERS = { LUZ: 'Electricity', SEDA: 'Water', BITE: 'Bitel', CLAR: 'Claro', WIN: 'WIN', BFT: 'BFT' };

    /* Insights: bills, subscriptions and transport keep their group as the category. Anything else uses the category
       set on the Statements page, else the first of these that matches the description, else Other. */
    const CATS = [
        ['Groceries & snacks', /\bMASS\b|OXXO|TAMBO|FOOD RETAIL|PLAZA ?VEA|TOTTUS|\bWONG\b|\bMETRO\b|MAKRO|VEND|FENIX|MARKET|BODEGA/],
        ['Food & delivery', /FOOD|RAPPI|PEDIDOSYA|\bKFC\b|DOMINO|CHINAWOK|DUNKIN|CAFE|CHIFA|PIZZA|BURGER|POLLER|RESTAURANT|HIGUERA|RAMBLA/],
        ['Games', /STEAM|KURO|YOSTAR|HONGKONGYON|COGNOSPHERE|AETHER|REVERSE 1999|HUMBLE|NINTENDO|PLAYSTATION|XSOLLA|EPIC GAMES|HOYO/],
        ['Creators & art', /PATREON|FANBOX|PIXIV|BOOTH|KO-?FI|SKEB/],
        ['Health', /BOTICA|FARMA|POLICLINICO|MEDIC|CLINICA|DENTAL/],
        ['Pets', /SUPERPET|VETERINAR/],
        ['Shopping', /ALIEXPRESS|AMAZON|MERCADO ?LIBRE|FALABELLA|RIPLEY|SAGA|TEMU|SHEIN/],
        ['Travel', /LATAM|SKY AIRLINE|JETSMART|HOTEL|AIRBNB|BOOKING/],
        ['Bills & utilities', /LUZ DEL SUR|ENEL|SEDAPAL|CLARO|BITEL|MOVISTAR|ENTEL/],
        ['Web & domains', /PUNTO\.PE|NAME-?CHEAP|ZOHO|GODADDY|CLOUDFLARE|HOSTINGER/],
        ['Transfers (Yape, Plin)', /YAPE|PLIN|TRAN\.CTAS|TRANSF\./],
        ['Loans, taxes & fees', /FINANCIERA|PRESTAMO|IMPUESTO|MUNI|SUNAT|INTERESES|COMISION/]
    ];
    const GROUP_CATS = { bill: 'Bills & utilities', sub: 'Subscriptions', transport: 'Transport' };

    /* A small summary for the hub's Expenses tile, so the hub doesn't have to load every transaction */
    const SUMMARY = 'expense-summary';

    /* Per line: { name, original, reviewed }. A name is shown in place of the automatic one; the statement rows are
       never changed, and `original` keeps the description the line had when it was renamed. `reviewed` is the date
       a long-running subscription was last confirmed as still used. */
    const LINES = 'expense-lines';
    const REVIEW_AGAIN = 6;   /* months before a reviewed subscription asks again */

    /* Calendar events for yearly payments get ids starting with this (see Tasks.syncEvents in /assets/tasks.js) */
    const EV = 'exp-';

    const byKey = (local, remote) => Object.assign({}, local, remote);

    Sync.use([KEY, SUMMARY, LINES], { merge: { [KEY]: byKey, [LINES]: byKey } });

    let rules = Sync.get(KEY, {}), meta = Sync.get(LINES, {});

    Sync.on(KEY, v => {
        rules = v && typeof v === 'object' ? v : {};
        render();
    });

    Sync.on(LINES, v => {
        meta = v && typeof v === 'object' ? v : {};
        render();
    });

    function setMeta(l, fields) {
        const m = Object.assign({}, meta[l.key], fields);

        Object.keys(m).forEach(k => m[k] == null && delete m[k]);
        meta = Object.assign({}, meta, { [l.key]: m });

        if (!Object.keys(m).length) delete meta[l.key];

        Sync.set(LINES, meta);
        render();
    }

    /* ---------- helpers ---------- */
    const cur = c => c === 'USD' ? 'US$' : 'S/';

    function money(cents, c) {
        return cur(c) + ' ' + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function el(tag, props, kids) {
        const e = document.createElement(tag);

        Object.assign(e, props || {});
        (kids || []).forEach(k => e.append(k));

        return e;
    }

    const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const nice = s => s.charAt(0) + s.slice(1).toLowerCase();
    const mean = v => v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;

    function nextMonth(p, by = 1) {
        const [y, m] = p.split('-').map(Number), d = new Date(y, m - 1 + by, 1);

        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    const monthName = p => new Date(p + '-01T00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    function monthsApart(a, b) {
        const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);

        return (yb - ya) * 12 + mb - ma;
    }

    function say(t) {
        $('msg').textContent = t;
    }

    /* ---------- analysis ---------- */
    /* Card purchases are grouped by merchant, so "DLC*MICROSOFT LIMA" and "DLC*Microsoft 365 F" are one line:
       drop the payment processor (DLC*, PAYPAL *, Google …) and anything with digits, keep the first word
       (two if the first is short, so DIDI DRIVE and DIDI FOOD stay apart). */
    function merchant(d) {
        const w = d.replace(/^[A-Z-]{1,8} ?\*\s*/, '').replace(/^GOOGLE /, '').replace(/[^A-Z0-9.&' ]/g, ' ').split(' ').filter(t => t && !/\d/.test(t));

        return w.length ? (w[0].length <= 4 && w[1] ? w[0] + ' ' + w[1] : w[0]) : d;
    }

    /* Everything else (service payments, card charges, debit movements) is one line per exact description */
    function lineOf(t) {
        const d = norm(t.description), m = t.account === 'credit' && t.reference === 'CONSUMO';

        return { key: t.account + '|' + t.currency + '|' + (m ? 'M ' + merchant(d) : d), name: m ? merchant(d) : d };
    }

    function label(l) {
        return (meta[l.key] && meta[l.key].name) || autoLabel(l);
    }

    function autoLabel(l) {
        const p = l.ref === 'PAGOSERVIC' && /^([A-Z]+)0*(\d+)$/.exec(l.name);

        if (p) return (PROVIDERS[p[1]] || p[1]) + ' ·' + p[2].slice(-4);

        return l.ref === 'CONSUMO' ? l.name.split(' ').map(nice).join(' ') : nice(l.name);
    }

    /* periods: { credit: ['2026-01', …], debit: […] }, lines: { key: { acc, cur, ref, name, desc, by: {period: cents}, n: {period: count} } } */
    function build(stmts, txs) {
        const periods = {}, sp = {}, lines = {};

        stmts.forEach(s => {
            const p = s.period.slice(0, 7);

            sp[s.id] = p;
            (periods[s.account] = periods[s.account] || []).push(p);
        });

        Object.values(periods).forEach(v => v.sort());

        txs.forEach(t => {
            const p = sp[t.statement_id], c = Math.round(-Number(t.amount) * 100);

            if (!p || c <= 0) return;

            const { key, name } = lineOf(t);
            const l = lines[key] || (lines[key] = { key, acc: t.account, cur: t.currency, ref: t.reference, name, by: {}, n: {}, cats: {}, last: '' });

            l.by[p] = (l.by[p] || 0) + c;
            l.n[p] = (l.n[p] || 0) + 1;

            if (t.category) l.cats[t.category] = (l.cats[t.category] || 0) + 1;

            if (!l.lastDay || t.posted_on > l.lastDay) l.lastDay = t.posted_on;

            if (!l.firstDay || t.posted_on < l.firstDay) l.firstDay = t.posted_on;

            if (p >= l.last) {
                l.last = p;
                l.desc = t.description;
            }
        });

        return { periods, lines: Object.values(lines) };
    }

    /* The last n statements of an account before month m */
    const before = (A, acc, m, n) => (A.periods[acc] || []).filter(p => p < m).slice(-n);

    const charged = l => Object.keys(l.by).sort();

    /* Yearly: charged once in each of 2+ statements, 11 to 13 months apart (a charge near the card's closing day can
       move a cycle either way), for about the same amount. Uses all history, so it doesn't depend on the month shown. */
    function yearly(l) {
        const ps = charged(l), last = l.by[ps[ps.length - 1]];

        return ps.length >= 2 && ps.every((p, i) => l.n[p] === 1 && Math.abs(l.by[p] - last) <= last * 0.1 && (!i || Math.abs(monthsApart(ps[i - 1], p) - 12) <= 1));
    }

    /* Which group a line falls in for month m when there's no rule for it */
    function auto(A, l, m) {
        const d = norm(l.desc);

        if (l.acc === 'debit' && /VISA|T\.PROP\.VIS/.test(d)) return 'ignore';   /* paying the card: already counted on the card */

        if (/\bDIDI\b/.test(d) && !/FOOD/.test(d)) return 'transport';

        if (yearly(l)) return l.ref === 'CONSUMO' ? 'sub-y' : 'bill-y';

        if (l.ref === 'PAGOSERVIC') return 'bill';

        if (/IMPUESTO ITF/.test(d)) return 'other';

        /* Recurring: in 3+ of the last 6 statements, about once per statement */
        const hit = before(A, l.acc, m, 6).filter(p => l.by[p]);

        if (hit.length < 3 || hit.reduce((a, p) => a + l.n[p], 0) > hit.length * 1.5) return 'other';

        if (l.ref !== 'CONSUMO') return 'bill';   /* installments, insurance, regular transfers */

        /* A purchase is a subscription if the amount also repeats (within 5%, for USD prices billed via soles and back);
           a shop visited monthly for similar but not equal amounts stays other */
        const v = hit.map(p => l.by[p]).sort((a, b) => a - b), med = v[v.length >> 1];

        return v.filter(x => Math.abs(x - med) <= med * 0.05).length >= 3 ? 'sub' : 'other';
    }

    const groupOf = (A, l, m) => rules[l.key] || auto(A, l, m);

    /* One line in month m: the real amount once the account's statement for m is in, otherwise an estimate */
    function item(A, l, m, g) {
        const has = (A.periods[l.acc] || []).includes(m), actual = l.by[m] || 0;
        const active = before(A, l.acc, m, 2).some(p => l.by[p]);

        if (!actual && !active) return null;

        let est, basis, fixed = false;

        if (g === 'transport') {
            /* Spending, not a bill: average of the last 3 statements, months without rides counting as 0 */
            basis = before(A, l.acc, m, 3).map(p => l.by[p] || 0);
            est = mean(basis);
        } else {
            basis = before(A, l.acc, m, 99).filter(p => l.by[p]).slice(-3).map(p => l.by[p]);
            fixed = basis.length >= 2 && basis.every(x => x === basis[basis.length - 1]);
            est = fixed ? basis[basis.length - 1] : mean(basis);
        }

        return { l, g, has, actual, est, basis, fixed, amount: has ? actual : est };
    }

    /* A yearly line in month m: due 12 months after its last charge, or the month after that if the due month's
       statement came without it. Expected at the last amount charged (yearly prices tend to go up, not average out). */
    function yearItem(A, l, m, g) {
        const has = (A.periods[l.acc] || []).includes(m), actual = l.by[m] || 0;
        const prev = charged(l).filter(p => p < m), last = prev[prev.length - 1], due = last && nextMonth(last, 12);
        const late = due && nextMonth(due) === m && (A.periods[l.acc] || []).includes(due) && !l.by[due];

        if (!actual && m !== due && !late) return null;

        const basis = prev.slice(-2).map(p => l.by[p]), est = basis[basis.length - 1] || 0;

        return { l, g, yearly: true, last, has, actual, est, basis, fixed: basis.length >= 2 && basis[0] === basis[1], amount: has ? actual : est };
    }

    function sumBy(items) {
        const s = {};

        items.forEach(i => s[i.l.cur] = (s[i.l.cur] || 0) + i.amount);

        return s;
    }

    /* Everything about month m: the shown lines, their totals, and other spending from imported statements */
    function month(A, m) {
        const items = [], other = {};

        A.lines.forEach(l => {
            const g = groupOf(A, l, m), cancelled = (meta[l.key] || {}).cancelled;

            /* Marked cancelled on the review: after that month only a real charge shows */
            if (cancelled && m > cancelled && !l.by[m] && SHOWN.includes(base(g))) return;

            if (SHOWN.includes(base(g))) {
                const i = g === base(g) ? item(A, l, m, g) : yearItem(A, l, m, base(g));

                if (i) items.push(Object.assign(i, { sel: g }));
            } else if (g === 'other' && l.by[m]) {
                other[l.cur] = (other[l.cur] || 0) + l.by[m];
            }
        });

        const totals = {};

        SHOWN.forEach(g => totals[g] = sumBy(items.filter(i => i.g === g)));

        return { m, items, totals, other, pending: Object.keys(A.periods).filter(a => !A.periods[a].includes(m)) };
    }

    /* The cycle being filled in: the earliest month some account still has no statement for */
    function current(A) {
        const next = Object.values(A.periods).map(v => nextMonth(v[v.length - 1])).sort();

        return next[0] || null;
    }

    /* The category a line counts under in the insights */
    function category(l, g) {
        if (GROUP_CATS[base(g)]) return GROUP_CATS[base(g)];

        const own = Object.keys(l.cats).sort((a, b) => l.cats[b] - l.cats[a])[0];

        if (own) return own;

        const d = norm(l.desc), hit = CATS.find(([, re]) => re.test(d));

        return hit ? hit[0] : 'Other';
    }

    /* Real spending in month m from the given accounts' statements, in soles: per category, per currency and per line */
    function spend(A, m, accs) {
        const cats = {}, cur = {}, top = [];
        let total = 0;

        A.lines.forEach(l => {
            const v = l.by[m], g = groupOf(A, l, m);

            if (!v || !accs.includes(l.acc) || g === 'ignore') return;

            const pen = inPen({ [l.cur]: v }), c = category(l, g);

            cats[c] = (cats[c] || 0) + pen;
            cur[l.cur] = (cur[l.cur] || 0) + pen;
            total += pen;
            top.push({ l, v, pen, n: l.n[m] });
        });

        return { cats, cur, total, top: top.sort((a, b) => b.pen - a.pen) };
    }

    /* ---------- exchange rate ---------- */
    /* The site-wide rate (/assets/fx.js): fetched at most every 12 hours, the same on every page and device */
    let fxInfo = { rate: 3.40, at: null }, fx = fxInfo.rate;

    function setFx(v) {
        fxInfo = v;
        fx = v.rate;
    }

    FX.on(v => {
        setFx(v);
        render();
    });

    const inPen = s => (s.PEN || 0) + Math.round((s.USD || 0) * fx);

    function split(s) {
        return ['PEN', 'USD'].filter(c => s[c]).map(c => money(s[c], c)).join(' + ') || money(0, 'PEN');
    }

    /* ---------- page ---------- */
    let A = null, M = null;

    function groupSelect(l, g) {
        const sel = el('select', { title: 'Group' }, Object.keys(GROUPS).map(k => el('option', { value: k, textContent: GROUPS[k] })));

        sel.value = g;
        sel.setAttribute('aria-label', 'Group for ' + label(l));

        sel.onchange = () => {
            /* Picking what auto-detection would pick anyway clears the rule */
            const next = Object.assign({}, rules);

            delete next[l.key];

            if (sel.value !== auto(A, l, M)) next[l.key] = sel.value;

            rules = next;
            Sync.set(KEY, rules);
            render();
        };

        return sel;
    }

    /* Line name with a rename button; the statement description stays underneath. An empty name goes back to the
       automatic one. Saving stores the name next to the original description in LINES, never in the statement rows. */
    function nameCell(l, prefix) {
        const td = el('td', { className: 'name' }), m = meta[l.key] || {};
        const sub = el('div', { className: 'sm', textContent: (prefix || '') + ACC[l.acc] + ' · ' + (m.name ? 'from ' : '') + l.desc });

        const show = () => {
            const edit = el('button', { className: 'ren', textContent: '✎', title: 'Rename' });

            edit.setAttribute('aria-label', 'Rename ' + label(l));
            edit.onclick = startEdit;
            td.replaceChildren(el('b', { textContent: label(l) }), edit, sub);
        };

        function startEdit() {
            const inp = el('input', { className: 'ren-in', value: label(l), maxLength: 60, placeholder: autoLabel(l) });
            let done = false;

            const finish = save => {
                if (done) return;

                done = true;

                const v = inp.value.trim();

                if (!save || v === label(l)) return show();

                setMeta(l, v && v !== autoLabel(l) ? { name: v, original: l.desc } : { name: null, original: null });
            };

            inp.setAttribute('aria-label', 'New name for ' + label(l));
            /* A block body on purpose: an on* handler that returns false cancels the key, so typing would do nothing */
            inp.onkeydown = e => {
                if (e.key === 'Enter') finish(true);
                else if (e.key === 'Escape') finish(false);
            };
            inp.onblur = () => finish(true);
            td.replaceChildren(inp, sub);
            inp.focus();
            inp.select();
        }

        show();

        return td;
    }

    function statusChip(i) {
        if (i.has) return i.actual ? el('span', { className: 'chip good', textContent: 'Posted' }) : el('span', { className: 'chip', textContent: 'Not charged' });

        return el('span', { className: 'chip warn', textContent: i.yearly ? 'Due' : i.fixed ? 'Expected' : 'Estimate' });
    }

    function basisText(i) {
        const c = i.l.cur;

        if (!i.basis.length) return 'no earlier charges';

        if (i.has) return 'estimated ' + money(i.est, c);

        if (i.yearly) return 'yearly, last paid ' + money(i.est, c) + ' in ' + monthName(i.last);

        if (i.g === 'transport') return 'average of the last ' + i.basis.length + ' statements';

        return i.fixed ? 'same as the last ' + i.basis.length : 'average of ' + i.basis.map(x => money(x, c)).join(', ');
    }

    function renderGroup(id, g, V) {
        const t = $(id), list = V.items.filter(i => i.g === g).sort((a, b) => inPen({ [b.l.cur]: b.amount }) - inPen({ [a.l.cur]: a.amount }));

        t.innerHTML = '';

        if (!list.length) {
            t.append(el('tr', {}, [el('td', { className: 'note', textContent: 'Nothing in this group.' })]));

            return;
        }

        list.forEach(i => {
            t.append(el('tr', { className: i.has ? '' : 'est' }, [
                nameCell(i.l, i.yearly ? 'Yearly · ' : ''),
                el('td', {}, [statusChip(i)]),
                el('td', { className: 'num' }, [el('b', { textContent: money(i.amount, i.l.cur) }), el('div', { className: 'sm', textContent: basisText(i) })]),
                el('td', {}, [groupSelect(i.l, i.sel)])
            ]));
        });

        const s = sumBy(list);

        t.append(el('tr', { className: 'sum' }, [el('td', { textContent: 'Total', colSpan: 2 }), el('td', { className: 'num', textContent: split(s) }), el('td')]));
    }

    function renderCycle(V) {
        const all = {};

        SHOWN.forEach(g => Object.keys(V.totals[g]).forEach(c => all[c] = (all[c] || 0) + V.totals[g][c]));

        const done = !V.pending.length, open = V.items.filter(i => !i.has).length;

        $('tLabel').textContent = done ? 'Paid in ' + monthName(V.m) : 'Expected for ' + monthName(V.m);
        $('tBig').textContent = '≈ ' + money(inPen(all), 'PEN');
        $('tSplit').textContent = split(all) + (open ? ' · ' + open + ' still estimated' : '');

        const n = FX.note(fxInfo);

        $('fxNote').textContent = all.USD ? 'US$ counted at S/ ' + fx.toFixed(3) + ' per US$ · ' + n.charAt(0).toLowerCase() + n.slice(1) : '';

        /* Only the current cycle goes to the hub, and only when it changed, so browsing months doesn't upload anything */
        const sum = { m: V.m, pen: inPen(all), est: open }, old = Sync.get(SUMMARY, {});

        if (V.m === current(A) && (old.m !== sum.m || old.pen !== sum.pen || old.est !== sum.est)) Sync.set(SUMMARY, sum);

        const accs = $('accs');
        accs.innerHTML = '';

        Object.keys(A.periods).sort().forEach(a => {
            const has = !V.pending.includes(a);

            accs.append(el('span', { className: 'chip ' + (has ? 'good' : 'warn'), textContent: ACC[a] + (has ? ' ✓ imported' : ' · pending'), title: has ? 'Amounts from this statement are real' : 'No ' + V.m + ' statement yet, so its lines are estimates' }));
        });

        const tiles = $('tiles');
        tiles.innerHTML = '';

        [['bill', 'Bills & utilities'], ['sub', 'Subscriptions'], ['transport', 'Transport']].forEach(([g, name]) => {
            const list = V.items.filter(i => i.g === g), posted = list.filter(i => i.has).length;

            tiles.append(el('div', { className: 'tile' }, [
                el('span', { className: 'note', textContent: name }),
                el('b', { textContent: money(inPen(V.totals[g]), 'PEN') }),
                el('span', { className: 'sm', textContent: list.length ? posted + ' of ' + list.length + ' posted' : 'none' })
            ]));
        });
    }

    function renderHistory() {
        const t = $('hist'), all = Object.values(A.periods).flat().sort(), first = all[0];

        t.innerHTML = '';
        t.append(el('tr', {}, ['Month', 'Bills', 'Subscriptions', 'Transport', 'Fixed total', 'Everything else'].map((h, i) => el('th', { textContent: h, className: i ? 'num' : '' }))));

        for (let m = M, n = 0; m >= first && n < 12; m = nextMonth(m, -1), n++) {
            const V = month(A, m), est = V.pending.length > 0;
            const fixed = SHOWN.reduce((a, g) => a + inPen(V.totals[g]), 0);
            const cell = (v, cls) => el('td', { className: 'num' + (cls ? ' ' + cls : ''), textContent: money(v, 'PEN') });

            t.append(el('tr', { className: m === M ? 'cur' : '' }, [
                el('td', {}, [m, est ? el('span', { className: 'sm', textContent: ' est.' }) : '']),
                cell(inPen(V.totals.bill)), cell(inPen(V.totals.sub)), cell(inPen(V.totals.transport)),
                cell(fixed, 'strong'), cell(inPen(V.other))
            ]));
        }
    }

    /* Real spending in the month shown, by category and merchant, against the average of the 3 months before it */
    function renderInsights(V) {
        const accs = Object.keys(A.periods).filter(a => A.periods[a].includes(M)), first = Object.values(A.periods).flat().sort()[0];
        const tiles = $('iTiles'), bars = $('iCats'), top = $('iTop');

        tiles.innerHTML = bars.innerHTML = top.innerHTML = '';

        if (!accs.length) {
            $('iNote').textContent = 'No statement for ' + monthName(M) + ' is in yet, so there’s no real spending to break down.';

            return;
        }

        const S = spend(A, M, accs), prev = [];

        /* Earlier months with the same statements in, so the comparison is like for like */
        for (let m = nextMonth(M, -1); prev.length < 3 && m >= first; m = nextMonth(m, -1)) {
            if (accs.every(a => A.periods[a].includes(m))) prev.push(spend(A, m, accs));
        }

        const avg = get => prev.length ? mean(prev.map(get)) : null;
        const change = (v, a) => !a ? (prev.length ? 'new' : '') : (v >= a ? '▲ ' : '▼ ') + Math.abs(Math.round((v / a - 1) * 100)) + '% vs average';

        $('iNote').textContent = 'Real amounts from the ' + accs.map(a => ACC[a].toLowerCase()).join(' and ') + ' statement' +
            (V.pending.length ? ' (the ' + V.pending.map(a => ACC[a].toLowerCase()).join(' and ') + ' statement isn’t in yet)' : '') +
            ', in soles at S/ ' + fx.toFixed(3) + ' per US$' + (prev.length ? ', compared with the average of the ' + prev.length + ' months before.' : '.') +
            ' Card payments from the debit account aren’t counted.';

        const count = S.top.reduce((a, t) => a + t.n, 0), usd = S.cur.USD || 0, big = S.top[0];

        [
            ['Spent', money(S.total, 'PEN'), change(S.total, avg(p => p.total))],
            ['Charges', String(count), count ? 'about ' + money(Math.round(S.total / count), 'PEN') + ' each' : ''],
            ['Paid in US$', money(usd, 'PEN'), S.total ? Math.round(usd / S.total * 100) + '% of the month' : ''],
            ['Biggest', big ? money(big.v, big.l.cur) : '—', big ? label(big.l) : '']
        ].forEach(([name, v, sub]) => tiles.append(el('div', { className: 'tile' }, [
            el('span', { className: 'note', textContent: name }), el('b', { textContent: v }), el('span', { className: 'sm', textContent: sub })
        ])));

        const cats = Object.keys(S.cats).sort((a, b) => S.cats[b] - S.cats[a]), max = S.cats[cats[0]] || 1;

        cats.forEach(c => {
            const v = S.cats[c], share = Math.round(v / S.total * 100), ch = change(v, avg(p => p.cats[c] || 0));
            const fill = el('div', { className: 'fill' });

            fill.style.width = (v / max * 100) + '%';

            bars.append(el('div', { className: 'bar', title: c + ': ' + money(v, 'PEN') + ', ' + share + '% of spending' + (ch ? ', ' + ch : '') }, [
                el('span', { textContent: c }), el('div', { className: 'track' }, [fill]), el('span', { className: 'v', textContent: money(v, 'PEN') }),
                el('span', { className: 'sm', textContent: share + '%' + (ch ? ' · ' + ch : '') })
            ]));
        });

        S.top.slice(0, 8).forEach(t => top.append(el('tr', {}, [
            el('td', { className: 'name' }, [el('b', { textContent: label(t.l) }), el('div', { className: 'sm', textContent: category(t.l, groupOf(A, t.l, M)) })]),
            el('td', { className: 'sm', textContent: t.n + ' charge' + (t.n > 1 ? 's' : '') }),
            el('td', { className: 'num' }, [el('b', { textContent: money(t.v, t.l.cur) }), t.l.cur === 'USD' ? el('div', { className: 'sm', textContent: '≈ ' + money(t.pen, 'PEN') }) : ''])
        ])));
    }

    /* Every yearly line, whether or not it's due in the month shown: last payment and when the next one is due */
    function renderYearly() {
        const t = $('gYear'), year = {};

        t.innerHTML = '';

        const rows = A.lines.map(l => ({ l, g: groupOf(A, l, M) })).filter(r => r.g.endsWith('-y')).map(r => {
            const ps = charged(r.l).filter(p => p <= M), last = ps[ps.length - 1];

            return Object.assign(r, { last, due: last && nextMonth(last, 12) });
        }).filter(r => r.last).sort((a, b) => a.due.localeCompare(b.due));

        if (!rows.length) {
            t.append(el('tr', {}, [el('td', { className: 'note', textContent: 'No yearly payments found yet. Mark one as yearly from its group menu.' })]));
            $('yTotal').textContent = '';

            return;
        }

        t.append(el('tr', {}, ['', 'Last paid', 'Next due', ''].map((h, i) => el('th', { textContent: h, className: i === 1 ? 'num' : '' }))));

        rows.forEach(r => {
            const amt = r.l.by[r.last], c = r.l.cur, late = monthsApart(r.due, M);

            year[c] = (year[c] || 0) + amt;

            t.append(el('tr', {}, [
                nameCell(r.l, GROUPS[r.g] + ' · '),
                el('td', { className: 'num' }, [el('b', { textContent: money(amt, c) }), el('div', { className: 'sm', textContent: monthName(r.last) })]),
                el('td', {}, [monthName(r.due), late === 0 ? el('span', { className: 'chip warn', textContent: 'this month' }) : late > 1 ? el('span', { className: 'chip bad', textContent: 'not seen', title: 'No charge since it was due. Cancelled, or charged under another name?' }) : '']),
                el('td', {}, [groupSelect(r.l, r.g)])
            ]));
        });

        const month = {};

        Object.keys(year).forEach(c => month[c] = Math.round(year[c] / 12));
        $('yTotal').textContent = '≈ ' + money(inPen(year), 'PEN') + ' a year (' + split(year) + '), about ' + money(inPen(month), 'PEN') + ' a month to set aside.' +
            ' Each one is also on the Calendar, repeating yearly on its last charge date, with a countdown two weeks ahead.';
    }

    /* Subscriptions that have been running a year or more: what they've cost, and a prompt to keep or cancel them.
       "Still using" hides the prompt for REVIEW_AGAIN months; "Cancelled" stops the forecast right away (a later
       charge still shows up as real). */
    function renderReview() {
        const t = $('gReview'), C = current(A), today = new Date().toISOString().slice(0, 10);

        t.innerHTML = '';

        const rows = A.lines.map(l => ({ l, g: groupOf(A, l, C), m: meta[l.key] || {} })).filter(r => base(r.g) === 'sub' && !r.m.cancelled).map(r => {
            const ps = charged(r.l), first = ps[0], last = ps[ps.length - 1], yearlyLine = r.g.endsWith('-y');
            const active = yearlyLine ? monthsApart(last, C) <= 13 : before(A, r.l.acc, C, 3).some(p => r.l.by[p]);
            const total = ps.reduce((a, p) => a + r.l.by[p], 0), year = ps.filter(p => monthsApart(p, C) <= 12).reduce((a, p) => a + r.l.by[p], 0);
            const ok = r.m.reviewed && monthsApart(r.m.reviewed.slice(0, 7), today.slice(0, 7)) < REVIEW_AGAIN;

            return Object.assign(r, { first, last, active, total, year, ok, months: monthsApart(first, C), price: r.l.by[last], count: ps.length });
        }).filter(r => r.active && r.months >= 12).sort((a, b) => a.ok - b.ok || inPen({ [b.l.cur]: b.total }) - inPen({ [a.l.cur]: a.total }));

        const open = rows.filter(r => !r.ok).length;

        $('rvNote').textContent = rows.length
            ? (open ? open + ' to review. ' : 'All reviewed. ') + 'Subscriptions charged for a year or more, with what they’ve cost so far.'
            : 'No subscription has been running for a year yet.';

        rows.forEach(r => {
            const c = r.l.cur, yrs = Math.floor(r.months / 12), mos = r.months % 12;
            const span = yrs + ' year' + (yrs > 1 ? 's' : '') + (mos ? ' ' + mos + ' month' + (mos > 1 ? 's' : '') : '');
            const acts = el('div', { className: 'btns' });

            if (r.ok) {
                acts.append(el('span', { className: 'chip good', textContent: '✓ ' + new Date(r.m.reviewed + 'T00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) }),
                    el('button', { textContent: 'Undo', onclick: () => setMeta(r.l, { reviewed: null }) }));
            } else {
                acts.append(el('button', { textContent: 'Still using', title: 'Ask again in ' + REVIEW_AGAIN + ' months', onclick: () => setMeta(r.l, { reviewed: today }) }),
                    el('button', { textContent: 'Cancelled', title: 'Stop expecting it from next month (and drop its Calendar event)', onclick: () => setMeta(r.l, { cancelled: C }) }));
            }

            t.append(el('tr', { className: r.ok ? 'est' : '' }, [
                nameCell(r.l, (r.g.endsWith('-y') ? 'Yearly · ' : '') + 'since ' + monthName(r.first) + ' (' + span + ') · '),
                el('td', { className: 'num' }, [el('b', { textContent: money(r.total, c) }), el('div', { className: 'sm', textContent: r.count + ' charges · ' + money(r.year, c) + ' in the last 12 months' })]),
                el('td', { className: 'num' }, [el('b', { textContent: money(r.price, c) }), el('div', { className: 'sm', textContent: 'last charge' })]),
                el('td', {}, [acts])
            ]));
        });
    }

    /* ---------- calendar ---------- */
    /* Yearly payments as yearly Calendar events on their last charge date, kept in step on every render. Waits for
       the first sync so an old copy of the calendar on this device can't replace newer events. */
    let calReady = false;

    Sync.ready().then(() => {
        calReady = true;
        syncCalendar();
    });

    /* Short stable id from the line key (keys can be long and contain spaces) */
    function hash(s) {
        let h = 5381;

        for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0;

        return h.toString(36);
    }

    function syncCalendar() {
        if (!calReady || !A || !window.Tasks || !Tasks.syncEvents) return;

        const C = current(A);
        const list = A.lines.filter(l => groupOf(A, l, C).endsWith('-y') && l.lastDay && !(meta[l.key] || {}).cancelled)
            .map(l => ({ id: EV + hash(l.key), name: label(l) + ' payment', date: l.lastDay, rep: 'year', icon: '$' }));

        Tasks.syncEvents(EV, list);
    }

    /* Biggest "other" lines over the last 12 statements, to move missed bills or subscriptions into a group.
       The search looks through all history, so a yearly charge from long ago can be found. */
    const OTHER_WIN = 12;

    function renderOther() {
        const t = $('gOther'), q = norm($('oQ').value);
        t.innerHTML = '';

        let rows = A.lines.filter(l => groupOf(A, l, M) === 'other').map(l => {
            const win = before(A, l.acc, nextMonth(M), OTHER_WIN), tot = win.reduce((a, p) => a + (l.by[p] || 0), 0), ps = charged(l);

            return { l, tot, months: win.filter(p => l.by[p]).length, count: win.reduce((a, p) => a + (l.n[p] || 0), 0), last: ps[ps.length - 1] };
        });

        rows = q
            ? rows.filter(r => norm(label(r.l) + ' ' + r.l.desc).includes(q)).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 50)
            : rows.filter(r => r.tot).sort((a, b) => inPen({ [b.l.cur]: b.tot }) - inPen({ [a.l.cur]: a.tot })).slice(0, 25);

        if (!rows.length) t.append(el('tr', {}, [el('td', { className: 'note', textContent: q ? 'Nothing matches.' : 'Nothing else.' })]));

        rows.forEach(r => t.append(el('tr', {}, [
            nameCell(r.l),
            el('td', { className: 'sm', textContent: (r.count ? r.count + ' charge' + (r.count > 1 ? 's' : '') + ' in ' + r.months + ' of ' + OTHER_WIN + ' · ' : '') + 'last ' + r.last }),
            el('td', { className: 'num', textContent: r.tot ? money(r.tot, r.l.cur) : money(r.l.by[r.last], r.l.cur) }),
            el('td', {}, [groupSelect(r.l, 'other')])
        ])));

        /* Rules, including lines that were moved to Ignore and so appear nowhere else, then names and cancellations */
        const keys = Object.keys(rules), byKey = {}, named = Object.keys(meta).filter(k => meta[k].name || meta[k].cancelled);

        A.lines.forEach(l => byKey[l.key] = l);
        $('rulesN').textContent = keys.length + named.length;

        const rt = $('rules');
        rt.innerHTML = '';

        named.forEach(k => {
            const l = byKey[k], m = meta[k];

            rt.append(el('tr', {}, [
                el('td', { className: 'name', textContent: m.name ? m.name : l ? label(l) : k }),
                el('td', { className: 'sm', textContent: [m.name ? 'renamed from “' + (m.original || (l && l.desc) || k) + '”' : '', m.cancelled ? 'cancelled in ' + monthName(m.cancelled) : ''].filter(Boolean).join(' · ') }),
                el('td', {}, [el('button', { textContent: 'Undo', onclick: () => setMeta(l || { key: k }, { name: null, original: null, cancelled: null }) })])
            ]));
        });

        keys.forEach(k => {
            const l = byKey[k];

            rt.append(el('tr', {}, [
                el('td', { className: 'name', textContent: l ? label(l) + ' (' + ACC[l.acc] + ')' : k }),
                el('td', { textContent: '→ ' + GROUPS[rules[k]] + (l ? ' (auto: ' + GROUPS[auto(A, l, M)] + ')' : '') }),
                el('td', {}, [el('button', {
                    textContent: 'Undo', onclick: () => {
                        rules = Object.assign({}, rules);
                        delete rules[k];
                        Sync.set(KEY, rules);
                        render();
                    }
                })])
            ]));
        });
    }

    function renderMonths() {
        const sel = $('mSel'), all = Object.values(A.periods).flat().sort();
        const last = nextMonth(all[all.length - 1], 2);

        sel.innerHTML = '';

        for (let m = last; m >= all[0]; m = nextMonth(m, -1)) sel.append(el('option', { value: m, textContent: monthName(m) + (m === current(A) ? ' (current)' : '') }));

        sel.value = M;
        $('mPrev').disabled = M <= all[0];
        $('mNext').disabled = M >= last;
    }

    function render() {
        if (!A) return;

        const V = month(A, M);

        renderMonths();
        renderCycle(V);
        renderGroup('gBill', 'bill', V);
        renderGroup('gSub', 'sub', V);
        renderGroup('gTransport', 'transport', V);
        renderInsights(V);
        renderYearly();
        renderReview();
        renderHistory();
        renderOther();
        syncCalendar();
    }

    function go(m) {
        M = m;
        render();
    }

    $('mSel').onchange = () => go($('mSel').value);
    $('mPrev').onclick = () => go(nextMonth(M, -1));
    $('mNext').onclick = () => go(nextMonth(M, 1));

    $('oQ').addEventListener('input', () => {
        if (A) renderOther();
    });

    /* ---------- loading ---------- */
    /* Money out only. Supabase returns at most 1000 rows per request: count first, then the rest in parallel. */
    async function fetchOut() {
        const cols = 'statement_id,account,posted_on,description,amount,currency,reference,category';
        const q = () => db.from('transactions').select(cols).lt('amount', 0).order('id');
        const first = await db.from('transactions').select(cols, { count: 'exact' }).lt('amount', 0).order('id').range(0, 999);

        if (first.error) throw first.error;

        const pages = [];

        for (let from = 1000; from < (first.count || 0); from += 1000) pages.push(q().range(from, from + 999));

        const rest = await Promise.all(pages), bad = rest.find(r => r.error);

        if (bad) throw bad.error;

        return first.data.concat(...rest.map(r => r.data));
    }

    async function load() {
        say('Loading statements…');

        try {
            const s = await db.from('statements').select('id,account,period');

            if (s.error) throw s.error;

            if (!s.data.length) {
                $('tBig').textContent = '—';

                return say('No statements saved yet. Import some on the Statements page.');
            }

            const [rows, rate] = await Promise.all([fetchOut(), FX.get()]);

            setFx(rate);
            A = build(s.data, rows);
            M = current(A);
            say('');
            render();

            /* Statements that should be out by now (/assets/statements-due.js) */
            const due = StatementsDue.text(await StatementsDue.check());

            $('due').querySelector('span').textContent = due;
            $('due').hidden = !due;
        } catch (e) {
            say('Couldn’t load statements: ' + e.message);
        }
    }

    if (!db) {
        say('Supabase isn’t set up (see _docs/sync-setup.md), so there are no statements to read.');
    } else {
        let loaded = false;

        db.auth.onAuthStateChange((_, session) => {
            if (session && !loaded) {
                loaded = true;
                setTimeout(load, 0);
            }
        });
    }
})();
