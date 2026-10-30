/* Statements page: load JSON made by tools/parse-statements.py, review, save to Supabase.
   Tables, the import_statement function and the JSON format: _docs/statements.md.
   Loaded files live in memory only; nothing sensitive is written to browser storage. */
(() => {
    const $ = id => document.getElementById(id);
    const db = Sync.db;
    const ACC = { credit: 'Credit card', debit: 'Debit account' };

    const files = [];    /* { id, name, status, msg, st: statement fields from the JSON, result } */
    let saved = [], current = null, seq = 0;

    /* ---------- helpers ---------- */
    const cur = c => c === 'USD' ? 'US$' : 'S/';

    function money(cents, c) {
        return cur(c) + ' ' + (cents < 0 ? '−' : '') + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function parseCents(s) {
        const t = String(s).replace(/[−–]/g, '-').replace(/[,\s]|S\/|US\$/g, '');

        return /^[+-]?\d+(\.\d{1,2})?$/.test(t) ? Math.round(parseFloat(t) * 100) : null;
    }

    const toCents = v => Math.round(Number(v) * 100);
    const toUnits = c => +(c / 100).toFixed(2);
    const DATE = /^\d{4}-\d{2}-\d{2}$/;

    function el(tag, props, kids) {
        const e = document.createElement(tag);

        Object.assign(e, props || {});
        (kids || []).forEach(k => e.append(k));

        return e;
    }

    function say(t) {
        $('msg').textContent = t;
    }

    /* Two clicks for destructive actions: the first arms the button for 3 seconds */
    function armed(btn, label) {
        if (btn.dataset.armed) return true;

        btn.dataset.armed = '1';
        const old = btn.textContent;
        btn.textContent = label;

        setTimeout(() => {
            delete btn.dataset.armed;
            btn.textContent = old;
        }, 3000);

        return false;
    }

    function totals(txs) {
        const t = {};

        txs.forEach(x => {
            const o = t[x.currency] || (t[x.currency] = { in: 0, out: 0, count: 0 });

            if (x.cents < 0) o.out += x.cents; else o.in += x.cents;

            o.count++;
        });

        return t;
    }

    function sums(txs) {
        const s = {};

        txs.forEach(t => s[t.currency] = (s[t.currency] || 0) + t.cents);

        return s;
    }

    /* Opening + movements should equal closing. Card balances are debt, so spending (negative) raises them. */
    function check(account, balances, s) {
        return Object.keys(balances || {}).filter(c => balances[c].opening != null && balances[c].closing != null).map(c => {
            const b = balances[c], expected = account === 'credit' ? b.opening - (s[c] || 0) : b.opening + (s[c] || 0);

            return { currency: c, ok: expected === b.closing, expected, closing: b.closing, diff: b.closing - expected };
        });
    }

    function balancesToCents(b) {
        const out = {};

        Object.keys(b || {}).forEach(c => {
            out[c] = {};
            ['opening', 'closing'].forEach(k => {
                if (b[c][k] != null) out[c][k] = toCents(b[c][k]);
            });
        });

        return out;
    }

    const savedFor = r => saved.find(s => s.account === r.account && s.period.slice(0, 7) === r.period);

    /* ---------- loading JSON ---------- */
    /* One tools/parse-statements.py file → { st, result } or an error message */
    function load(o) {
        if (!o || o.format !== 'bcp-statement' || !o.statement || !Array.isArray(o.transactions)) return 'Not a statement file from tools/parse-statements.py.';

        const s = o.statement;

        if (!ACC[s.account] || !/^\d{4}-\d{2}$/.test(s.period || '') || typeof s.file_hash !== 'string') return 'Statement details are missing or invalid.';

        const txs = [];

        for (const t of o.transactions) {
            if (!t || !DATE.test(t.posted_on || '') || typeof t.amount !== 'number' || !/^(PEN|USD)$/.test(t.currency)) return 'A transaction is missing its date, amount or currency.';

            txs.push({
                posted_on: t.posted_on, value_date: DATE.test(t.value_date || '') ? t.value_date : null, description: String(t.description || '').slice(0, 300),
                cents: toCents(t.amount), currency: t.currency, reference: t.reference ? String(t.reference).slice(0, 60) : null, raw: t.raw ? String(t.raw).slice(0, 1000) : null,
                flags: Array.isArray(t.flags) ? t.flags.map(String) : []
            });
        }

        const warnings = (Array.isArray(o.warnings) ? o.warnings.map(String) : []).concat(
            (Array.isArray(o.checks) ? o.checks : []).filter(c => c && !c.ok).map(c => 'Parser check failed: ' + c.check + ' (movements give ' + c.expected + ', statement says ' + c.printed + ')')
        );

        return {
            st: s,
            result: {
                account: s.account, period: s.period, periodStart: DATE.test(s.period_start || '') ? s.period_start : null, periodEnd: DATE.test(s.period_end || '') ? s.period_end : null,
                parser: String(s.parser || 'unknown'), balances: balancesToCents(s.balances), transactions: txs, warnings
            }
        };
    }

    function addFiles(list) {
        [...list].filter(f => /\.json$/i.test(f.name) || f.type === 'application/json').forEach(file => {
            const f = { id: 'f' + (++seq), name: file.name, status: 'reading' };

            files.push(f);

            file.text().then(text => {
                let o;

                try {
                    o = JSON.parse(text);
                } catch {
                    o = null;
                }

                const r = load(o);

                if (typeof r === 'string') {
                    f.status = 'error';
                    f.msg = r;
                } else if (files.some(x => x !== f && x.st && x.st.file_hash === r.st.file_hash)) {
                    f.status = 'error';
                    f.msg = 'Already in the list';
                } else {
                    Object.assign(f, r, { status: 'parsed' });
                }

                renderFiles();
            }, () => {
                f.status = 'error';
                f.msg = 'Couldn’t read the file.';
                renderFiles();
            });
        });

        renderFiles();
    }

    /* ---------- saving ---------- */
    function problems(r) {
        if (!r.transactions.length) return 'No transactions to save.';

        const bad = r.transactions.findIndex(t => !DATE.test(t.posted_on || '') || !Number.isInteger(t.cents) || !/^(PEN|USD)$/.test(t.currency));

        return bad > -1 ? 'Row ' + (bad + 1) + ' needs a valid date, amount and currency.' : '';
    }

    async function save(f) {
        const r = f.result, err = !db ? 'Supabase isn’t set up, so this can’t be saved.' : !Sync.user ? 'Sign in first.' : problems(r);

        if (err) {
            f.msg = err;
            renderFiles();

            return false;
        }

        const balances = {};

        Object.keys(r.balances).forEach(c => {
            balances[c] = {};
            Object.keys(r.balances[c]).forEach(k => balances[c][k] = toUnits(r.balances[c][k]));
        });

        const tt = totals(r.transactions), tu = {};

        Object.keys(tt).forEach(c => tu[c] = { in: toUnits(tt[c].in), out: toUnits(tt[c].out), count: tt[c].count });

        const s = {
            account: r.account, period: r.period + '-01', period_start: r.periodStart, period_end: r.periodEnd, parser: r.parser,
            file_name: f.st.file_name || f.name, file_hash: f.st.file_hash, page_count: f.st.page_count || null, balances, totals: tu, tx_count: r.transactions.length
        };

        const txs = r.transactions.map((t, i) => ({
            line_no: i + 1, posted_on: t.posted_on, value_date: t.value_date || null, description: t.description || '',
            amount: (t.cents / 100).toFixed(2), currency: t.currency, reference: t.reference || null, raw: t.raw || null
        }));

        f.status = 'saving';
        renderFiles();

        const { error } = await db.rpc('import_statement', { s, txs });

        if (error) {
            f.status = 'parsed';
            f.msg = 'Save failed: ' + error.message;
            renderFiles();

            return false;
        }

        f.status = 'saved';
        f.msg = '';
        await loadSaved();

        return true;
    }

    $('saveAll').onclick = async () => {
        const ready = files.filter(f => f.status === 'parsed' && !problems(f.result));
        let n = 0;

        for (const f of ready) if (await save(f)) n++;

        say('Saved ' + n + ' of ' + ready.length + '.');
    };

    /* ---------- file list ---------- */
    function checkChip(account, balances, s) {
        const ch = check(account, balances, s);

        if (!ch.length) return el('span', { className: 'chip', textContent: 'no balances', title: 'Opening/closing balances weren’t found, so totals can’t be verified' });

        const ok = ch.every(c => c.ok);

        return el('span', {
            className: 'chip ' + (ok ? 'good' : 'bad'),
            textContent: ok ? '✓ balances' : '✗ balances',
            title: ch.map(c => c.currency + ': ' + (c.ok ? 'matches' : 'off by ' + money(c.diff, c.currency))).join('\n')
        });
    }

    const STATUS = { reading: 'Reading…', parsed: 'Ready', saving: 'Saving…', saved: 'Saved', error: 'Error' };

    function renderFiles() {
        const t = $('files');
        t.innerHTML = '';
        $('saveAll').hidden = files.filter(f => f.status === 'parsed').length < 2;

        if (!files.length) return;

        t.append(el('tr', {}, ['File', 'Account', 'Month', 'Rows', 'Check', 'Status', ''].map(h => el('th', { textContent: h }))));

        files.forEach(f => {
            const r = f.result, flagged = r ? r.transactions.filter(x => x.flags && x.flags.length).length : 0;
            const st = el('span', { className: 'chip' + (f.status === 'error' ? ' bad' : f.status === 'saved' ? ' good' : r && r.warnings.length ? ' warn' : ''), textContent: STATUS[f.status] });
            const stCell = el('td', {}, [st]);

            if (f.msg) stCell.append(el('div', { className: 'flags', textContent: f.msg }));

            if (r && r.warnings.length && f.status === 'parsed') stCell.append(el('div', { className: 'flags', textContent: r.warnings.length + ' warning' + (r.warnings.length > 1 ? 's' : '') + ', see Review' }));

            if (r && f.status === 'parsed' && savedFor(r)) stCell.append(el('div', { className: 'flags', textContent: 'Replaces the saved ' + r.period }));

            const acts = el('div', { className: 'btns' });

            if (r) acts.append(el('button', { textContent: 'Review', onclick: () => openFile(f) }));

            if (f.status === 'parsed') acts.append(el('button', { className: 'pri', textContent: 'Save', onclick: () => save(f) }));

            acts.append(el('button', {
                textContent: '×', title: 'Remove from list', onclick: () => {
                    files.splice(files.indexOf(f), 1);

                    if (current && current.f === f) closeReview();

                    renderFiles();
                }
            }));

            t.append(el('tr', {}, [
                el('td', { textContent: f.name, title: f.st ? 'From ' + f.st.file_name : '' }),
                el('td', { textContent: r ? ACC[r.account] : '' }),
                el('td', { textContent: r ? r.period : '' }),
                el('td', { className: 'num', textContent: r ? r.transactions.length + (flagged ? ' (' + flagged + ' flagged)' : '') : '' }),
                el('td', {}, r ? [checkChip(r.account, r.balances, sums(r.transactions))] : []),
                stCell,
                el('td', {}, [acts])
            ]));
        });
    }

    /* ---------- review ---------- */
    function openFile(f) {
        current = { f };
        renderReview();
        $('review').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function closeReview() {
        current = null;
        $('review').hidden = true;
    }

    $('rClose').onclick = closeReview;

    $('rAdd').onclick = () => {
        const r = current.f.result;

        r.transactions.push({ posted_on: r.periodEnd || r.period + '-01', value_date: null, description: '', cents: 0, currency: 'PEN', reference: null, raw: '', flags: ['added by hand'] });
        renderReview();
    };

    $('rSave').onclick = async () => {
        const f = current.f;

        if (savedFor(f.result) && !armed($('rSave'), 'Replace saved month?')) return;

        if (await save(f)) closeReview();
        else renderReview();
    };

    function renderSums(txs, account, balances) {
        const box = $('rSums');
        box.innerHTML = '';

        const t = totals(txs);

        Object.keys(t).sort().forEach(c => {
            box.append(el('div', {}, [
                el('b', { textContent: c + ' · ' + t[c].count + ' rows' }),
                'In ' + money(t[c].in, c) + ' · Out ' + money(t[c].out, c)
            ]));
        });

        check(account, balances, sums(txs)).forEach(ch => {
            box.append(el('div', {}, [
                el('b', { className: ch.ok ? 'pos' : 'neg', textContent: ch.currency + ' balance ' + (ch.ok ? '✓' : '✗') }),
                ch.ok ? 'Closing ' + money(ch.closing, ch.currency) : 'Expected ' + money(ch.expected, ch.currency) + ', statement says ' + money(ch.closing, ch.currency)
            ]));
        });
    }

    function renderReview() {
        $('review').hidden = !current;

        if (!current) return;

        const ro = !current.f, f = current.f;
        const r = ro ? current.view : f.result, src = ro ? current.s : f.st;

        $('rTitle').textContent = ACC[r.account] + ' · ' + r.period;
        $('rAdd').hidden = ro;
        $('rSave').hidden = ro;

        $('rInfo').textContent = (r.periodStart ? r.periodStart + ' to ' + r.periodEnd + ' · ' : '') + 'from ' + src.file_name + ' · parser ' + src.parser +
            (ro ? ' · saved ' + new Date(src.imported_at).toLocaleString() : '');

        const w = $('rWarn');
        w.innerHTML = '';
        (ro ? [] : r.warnings).concat(!ro && f.msg ? [f.msg] : []).forEach(t => w.append(el('li', { textContent: t })));

        renderSums(r.transactions, r.account, r.balances);

        const t = $('rTable');
        t.innerHTML = '';
        t.append(el('tr', {}, ['#', 'Date', 'Description', 'Type', 'Currency', 'Amount', ro ? '' : 'Notes', ''].map((h, i) => el('th', { textContent: h, className: i === 5 ? 'num' : '' }))));

        r.transactions.forEach((x, i) => {
            const tr = el('tr', { className: !ro && x.flags && x.flags.length ? 'flag' : '' });
            const amtCls = x.cents < 0 ? 'neg' : 'pos';

            if (ro) {
                tr.append(
                    el('td', { className: 'num', textContent: i + 1 }),
                    el('td', { textContent: x.posted_on }),
                    el('td', { className: 'desc', textContent: x.description, title: x.raw || '' }),
                    el('td', { textContent: x.reference || '' }),
                    el('td', { textContent: x.currency }),
                    el('td', { className: 'num ' + amtCls, textContent: money(x.cents, x.currency) }),
                    el('td'), el('td')
                );
                t.append(tr);

                return;
            }

            /* Any edit marks the row as reviewed */
            const edited = () => {
                x.flags = [];
                tr.className = '';
                notes.textContent = '';
                renderSums(r.transactions, r.account, r.balances);
                renderFiles();
            };

            const date = el('input', { type: 'date', value: x.posted_on || '', onchange: () => { x.posted_on = date.value; edited(); } });
            const desc = el('input', { className: 'd', value: x.description, title: x.raw || '', onchange: () => { x.description = desc.value; edited(); } });
            const curSel = el('select', { onchange: () => { x.currency = curSel.value; edited(); } }, ['PEN', 'USD'].map(c => el('option', { value: c, textContent: c })));
            curSel.value = x.currency;

            const amt = el('input', {
                className: 'amt ' + amtCls, value: (x.cents / 100).toFixed(2), title: 'Negative = money out, positive = money in',
                onchange: () => {
                    const c = parseCents(amt.value);

                    if (c == null) {
                        amt.value = (x.cents / 100).toFixed(2);

                        return;
                    }

                    x.cents = c;
                    amt.value = (c / 100).toFixed(2);
                    amt.className = 'amt ' + (c < 0 ? 'neg' : 'pos');
                    edited();
                }
            });

            const notes = el('td', { className: 'flags', textContent: (x.flags || []).join('; ') });

            const rm = el('button', {
                textContent: '×', title: 'Remove row', onclick: () => {
                    r.transactions.splice(r.transactions.indexOf(x), 1);
                    renderReview();
                    renderFiles();
                }
            });

            tr.append(
                el('td', { className: 'num', textContent: i + 1 }),
                el('td', {}, [date]),
                el('td', { className: 'desc' }, [desc]),
                el('td', { textContent: x.reference || '' }),
                el('td', {}, [curSel]),
                el('td', { className: 'num' }, [amt]),
                notes,
                el('td', {}, [rm])
            );
            t.append(tr);
        });
    }

    /* ---------- saved statements ---------- */
    async function loadSaved() {
        const { data, error } = await db.from('statements')
            .select('id,account,period,period_start,period_end,parser,file_name,file_hash,balances,totals,tx_count,imported_at')
            .order('period', { ascending: false }).order('account');

        if (error) {
            $('saved').innerHTML = '';
            $('saved').append(el('p', { className: 'note', textContent: 'Couldn’t load: ' + error.message + '. Has the SQL in _docs/statements.md been run?' }));

            return;
        }

        saved = data;
        renderSaved();
        renderFiles();
        renderStmtOptions();
        scheduleTx();

        if (!saved.length) showManage(true);
    }

    function renderSaved() {
        const box = $('saved');
        box.innerHTML = '';

        if (!saved.length) {
            box.append(el('p', { className: 'note', textContent: 'Nothing saved yet.' }));

            return;
        }

        const t = el('table');
        const amt = (s, c, k) => s.totals[c] ? money(toCents(s.totals[c][k]), c) : '';

        t.append(el('tr', {}, ['Month', 'Account', 'Rows', 'PEN in', 'PEN out', 'USD in', 'USD out', 'Check', ''].map((h, i) => el('th', { textContent: h, className: i >= 2 && i <= 6 ? 'num' : '' }))));

        saved.forEach(s => {
            const bal = balancesToCents(s.balances), sm = {};

            Object.keys(s.totals || {}).forEach(c => sm[c] = toCents(s.totals[c].in) + toCents(s.totals[c].out));

            const del = el('button', {
                textContent: 'Delete', onclick: async () => {
                    if (!armed(del, 'Sure?')) return;

                    const { error } = await db.from('statements').delete().eq('id', s.id);

                    if (error) return say('Delete failed: ' + error.message);

                    if (current && current.s && current.s.id === s.id) closeReview();

                    loadSaved();
                }
            });

            t.append(el('tr', {}, [
                el('td', { textContent: s.period.slice(0, 7) }),
                el('td', { textContent: ACC[s.account] }),
                el('td', { className: 'num', textContent: s.tx_count }),
                el('td', { className: 'num pos', textContent: amt(s, 'PEN', 'in') }),
                el('td', { className: 'num neg', textContent: amt(s, 'PEN', 'out') }),
                el('td', { className: 'num pos', textContent: amt(s, 'USD', 'in') }),
                el('td', { className: 'num neg', textContent: amt(s, 'USD', 'out') }),
                el('td', {}, [checkChip(s.account, bal, sm)]),
                el('td', {}, [el('div', { className: 'btns' }, [el('button', { textContent: 'View', onclick: () => viewSaved(s, bal) }), del])])
            ]));
        });

        box.append(el('div', { className: 'scroll' }, [t]));
    }

    async function viewSaved(s, bal) {
        const { data, error } = await db.from('transactions').select('posted_on,description,amount,currency,reference,raw').eq('statement_id', s.id).order('line_no');

        if (error) return say('Couldn’t load transactions: ' + error.message);

        current = {
            s,
            view: {
                account: s.account, period: s.period.slice(0, 7), periodStart: s.period_start, periodEnd: s.period_end, balances: bal,
                transactions: data.map(x => ({ posted_on: x.posted_on, description: x.description, cents: toCents(x.amount), currency: x.currency, reference: x.reference, raw: x.raw }))
            }
        };

        renderReview();
        $('review').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /* ---------- viewer ---------- */
    const DEFAULTS = { from: '', to: '', q: '', kind: '', cur: '', min: '', max: '' };
    const F = Object.assign({ account: 'credit', stmt: null }, DEFAULTS);   /* stmt: statement id, '' = all, null = not chosen yet */
    const INPUTS = { from: 'vFrom', to: 'vTo', q: 'vQ', kind: 'vKind', cur: 'vCur', min: 'vMin', max: 'vMax' };
    const PAGE = 300;
    const COLS = 'id,statement_id,account,line_no,posted_on,value_date,description,amount,currency,reference,category,note,raw';

    /* txAll holds either every transaction (full) or just the statements in `have`, while the rest load */
    let txAll = [], full = false, have = new Set(), txGen = 0, txTimer = null, sort = { k: 'date', dir: 1 }, limit = PAGE;

    const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const hay = x => fold([x.description, x.raw, x.reference, x.category, x.note].join(' '));
    const latest = acc => (saved.find(s => s.account === acc) || {}).id || '';

    function vSay(t) {
        $('vMsg').textContent = t;
    }

    function showManage(on) {
        $('manage').hidden = !on;
        $('cog').setAttribute('aria-expanded', on);
    }

    $('cog').onclick = () => showManage($('manage').hidden);

    /* First load right away; several saves in a row (Save all) reload once */
    function scheduleTx() {
        clearTimeout(txTimer);
        txTimer = setTimeout(loadTx, txAll.length || full ? 300 : 0);
    }

    const prep = rows => rows.map(x => Object.assign(x, { cents: toCents(x.amount), hay: hay(x) }));

    async function fetchStmt(id) {
        const { data, error } = await db.from('transactions').select(COLS).eq('statement_id', id);

        if (error) throw error;

        return prep(data);
    }

    /* Supabase returns at most 1000 rows per request: get the count with the first page, then the rest in parallel */
    async function fetchAll() {
        const first = await db.from('transactions').select(COLS, { count: 'exact' }).order('id').range(0, 999);

        if (first.error) throw first.error;

        const pages = [];

        for (let from = 1000; from < (first.count || 0); from += 1000) pages.push(db.from('transactions').select(COLS).order('id').range(from, from + 999));

        const rest = await Promise.all(pages), bad = rest.find(r => r.error);

        if (bad) throw bad.error;

        return prep(first.data.concat(...rest.map(r => r.data)));
    }

    function loadFail(e) {
        $('vEmpty').textContent = 'Couldn’t load transactions: ' + e.message;
        $('vEmpty').hidden = false;
    }

    /* The statement on screen first, so the table appears quickly; everything else (for All statements) after */
    async function loadTx() {
        const gen = ++txGen;   /* a newer reload supersedes this one */

        try {
            if (F.stmt) {
                const rows = await fetchStmt(F.stmt);

                if (gen !== txGen) return;

                txAll = rows;
                have = new Set([F.stmt]);
                full = false;
                renderView();
            }

            const rows = await fetchAll();

            if (gen !== txGen) return;

            const complete = F.stmt && have.has(F.stmt);

            txAll = rows;
            full = true;
            renderCats();

            /* The statement on screen already had all its rows; don't redraw under someone editing a cell */
            if (!complete) renderView();
        } catch (e) {
            if (gen === txGen) loadFail(e);
        }
    }

    /* Switching statement before everything has loaded: fetch just that one */
    async function ensureStmt() {
        const id = F.stmt, gen = txGen;

        if (full || !id || have.has(id)) return;

        try {
            const rows = await fetchStmt(id);

            if (gen !== txGen || full || have.has(id)) return;

            txAll = txAll.concat(rows);
            have.add(id);

            if (F.stmt === id) renderView();
        } catch (e) {
            loadFail(e);
        }
    }

    function renderStmtOptions() {
        const sel = $('vStmt');
        sel.innerHTML = '';
        sel.append(el('option', { value: '', textContent: 'All statements' }));

        saved.filter(s => s.account === F.account).forEach(s => {
            sel.append(el('option', { value: s.id, textContent: s.period.slice(0, 7) + (s.period_start ? ' (' + s.period_start + ' to ' + s.period_end + ')' : '') }));
        });

        if (F.stmt === null || (F.stmt && !saved.some(s => s.id === F.stmt))) F.stmt = latest(F.account);

        sel.value = F.stmt;
    }

    function renderCats() {
        const dl = $('vCats');
        dl.innerHTML = '';
        [...new Set(txAll.map(x => x.category).filter(Boolean))].sort().forEach(c => dl.append(el('option', { value: c })));
    }

    function filtered() {
        const words = fold(F.q).split(/\s+/).filter(Boolean);
        const min = parseCents(F.min), max = parseCents(F.max);

        return txAll.filter(x => x.account === F.account &&
            (!F.stmt || x.statement_id === F.stmt) &&
            (!F.from || x.posted_on >= F.from) &&
            (!F.to || x.posted_on <= F.to) &&
            (!F.kind || (F.kind === 'out' ? x.cents < 0 : x.cents > 0)) &&
            (!F.cur || x.currency === F.cur) &&
            (min == null || Math.abs(x.cents) >= Math.abs(min)) &&
            (max == null || Math.abs(x.cents) <= Math.abs(max)) &&
            words.every(w => x.hay.includes(w)));
    }

    function compare(a, b) {
        const d = sort.k === 'amount' ? a.cents - b.cents : a.posted_on.localeCompare(b.posted_on) || a.statement_id.localeCompare(b.statement_id) || a.line_no - b.line_no;

        return d * sort.dir;
    }

    /* Category and note save straight to the transaction row */
    function cell(x, k) {
        const inp = el('input', { className: 'cell', value: x[k] || '', maxLength: k === 'category' ? 40 : 300, placeholder: '—' });

        inp.setAttribute('aria-label', k + ' for ' + x.description);

        if (k === 'category') inp.setAttribute('list', 'vCats');

        inp.onchange = async () => {
            const v = inp.value.trim() || null;
            const { error } = await db.from('transactions').update({ [k]: v }).eq('id', x.id);

            if (error) {
                inp.value = x[k] || '';

                return vSay('Couldn’t save the ' + k + ': ' + error.message);
            }

            x[k] = v;
            x.hay = hay(x);
            vSay('');

            if (k === 'category') renderCats();
        };

        return inp;
    }

    function sortHead(label, k) {
        const arrow = sort.k === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : '';

        return el('th', { className: k === 'amount' ? 'num' : '' }, [el('button', {
            textContent: label + arrow, onclick: () => {
                sort = { k, dir: sort.k === k ? -sort.dir : 1 };
                renderView();
            }
        })]);
    }

    function renderView() {
        const t = $('vTable'), box = $('vSums');

        t.innerHTML = '';
        box.innerHTML = '';

        if (!full && !(F.stmt && have.has(F.stmt))) {
            $('vEmpty').hidden = false;
            $('vEmpty').textContent = 'Loading…';
            $('vMore').hidden = true;

            return;
        }

        const list = filtered().sort(compare);
        $('vEmpty').hidden = list.length > 0;
        $('vEmpty').textContent = txAll.length ? 'No movements match these filters.' : 'No statements yet. Import some with ⚙ Manage.';

        const tt = totals(list);

        Object.keys(tt).sort().forEach(c => {
            box.append(el('div', {}, [
                el('b', { textContent: c + ' · ' + tt[c].count + ' movements' }),
                el('span', { className: 'pos', textContent: 'In ' + money(tt[c].in, c) }), ' · ',
                el('span', { className: 'neg', textContent: 'Out ' + money(tt[c].out, c) }), ' · ',
                'Net ' + money(tt[c].in + tt[c].out, c)
            ]));
        });

        if (!list.length) {
            $('vMore').hidden = true;

            return;
        }

        t.append(el('tr', {}, [sortHead('Date', 'date'), el('th', { textContent: 'Description' }), el('th', { textContent: 'Type' }), el('th', { textContent: 'Category' }), el('th', { textContent: 'Note' }), sortHead('Amount', 'amount')]));

        list.slice(0, limit).forEach(x => {
            const date = el('td', { textContent: x.posted_on });

            if (x.value_date && x.value_date !== x.posted_on) date.append(el('div', { className: 'sm', textContent: 'used ' + x.value_date }));

            t.append(el('tr', {}, [
                date,
                el('td', { className: 'desc', textContent: x.description, title: x.raw || '' }),
                el('td', { className: 'sm', textContent: x.reference || '' }),
                el('td', {}, [cell(x, 'category')]),
                el('td', {}, [cell(x, 'note')]),
                el('td', { className: 'num ' + (x.cents < 0 ? 'neg' : 'pos'), textContent: money(x.cents, x.currency) })
            ]));
        });

        $('vMore').hidden = list.length <= limit;
        $('vMore').textContent = 'Show all ' + list.length + ' (showing ' + limit + ')';
    }

    $('vMore').onclick = () => {
        limit = Infinity;
        renderView();
    };

    function refilter() {
        limit = PAGE;
        renderView();
    }

    Object.keys(INPUTS).forEach(k => $(INPUTS[k]).addEventListener('input', () => {
        F[k] = $(INPUTS[k]).value;
        refilter();
    }));

    $('vStmt').onchange = () => {
        F.stmt = $('vStmt').value;
        refilter();
        ensureStmt();
    };

    document.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
        F.account = b.dataset.acc;
        F.stmt = latest(F.account);
        document.querySelectorAll('.seg button').forEach(o => o.setAttribute('aria-pressed', o === b));
        renderStmtOptions();
        refilter();
        ensureStmt();
    });

    /* Back to the latest statement of the current account, no other filters */
    $('vReset').onclick = () => {
        Object.assign(F, DEFAULTS, { stmt: latest(F.account) });
        Object.keys(INPUTS).forEach(k => $(INPUTS[k]).value = '');
        $('vStmt').value = F.stmt;
        refilter();
        ensureStmt();
    };

    /* ---------- drop zone ---------- */
    const drop = $('drop');

    $('fileIn').onchange = e => {
        addFiles(e.target.files);
        e.target.value = '';
    };

    ['dragenter', 'dragover'].forEach(n => drop.addEventListener(n, e => {
        e.preventDefault();
        drop.classList.add('over');
    }));

    ['dragleave', 'drop'].forEach(n => drop.addEventListener(n, () => drop.classList.remove('over')));

    drop.addEventListener('drop', e => {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
    });

    /* Warn before closing with loaded but unsaved statements */
    addEventListener('beforeunload', e => {
        if (files.some(f => f.status === 'parsed')) e.preventDefault();
    });

    /* ---------- start ---------- */
    if (!db) {
        $('saved').innerHTML = '';
        $('saved').append(el('p', { className: 'note', textContent: 'Supabase isn’t set up (see _docs/sync-setup.md), so statements can be loaded but not saved.' }));
        $('vEmpty').textContent = 'Supabase isn’t set up, so there’s nothing to show.';
    } else {
        let loaded = false;

        db.auth.onAuthStateChange((_, session) => {
            if (session && !loaded) {
                loaded = true;
                setTimeout(loadSaved, 0);
            }
        });
    }
})();
