/* Receipts: price history per store, from scanned receipts (see _docs/receipts.md).
     receipts table                one row per receipt: { id, store, date, total, lines: [{ code, name, qty, price }] }
     receipt-names-<store slug>    synced key, the store's item names: { key: { name, alias } }
   An item's key is its code on the receipt, or n:<lowercased name> when it has none. `name` is the name as first read
   off a receipt, `alias` the clear name you gave it. Amounts are céntimos; `price` is what the line cost in total.
   Not linked to Shopping's history or the statements: each store's codes and names stay separate. */
(() => {
    const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    const PICK = 'receipts-store';   /* last chosen store, this device only */
    const COLS = 'id,date,total,lines,created_at';

    const $ = id => document.getElementById(id);
    const db = Sync.db;
    const keyOf = name => name.trim().toLowerCase().replace(/\s+/g, ' ');
    const today = () => new Date().toLocaleDateString('en-CA');
    const namesKey = store => 'receipt-names-' + (Stores.slug(store) || 'store');
    const money = cents => 'S/ ' + (cents / 100).toFixed(2);
    const toCents = s => Math.round(parseFloat(String(s).replace(',', '.')) * 100);
    const itemKey = l => l.code || 'n:' + keyOf(l.name);
    const dateText = d => new Date(d + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

    function el(tag, props, kids) {
        const e = document.createElement(tag);

        Object.assign(e, props || {});
        (kids || []).forEach(k => k != null && e.append(k));

        return e;
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

    /* ---------- names (synced keys) ---------- */
    /* First sync on a device that already has names: a name you gave wins over none */
    function merge(local, remote) {
        const out = Object.assign({}, local, remote);

        Object.entries(local || {}).forEach(([k, v]) => {
            if (v.alias && !(remote[k] || {}).alias) out[k] = v;
        });

        return out;
    }

    const watched = new Set();

    function watch(stores) {
        const keys = stores.map(namesKey).filter(k => !watched.has(k));

        if (!keys.length) return;

        keys.forEach(k => {
            watched.add(k);
            Sync.on(k, () => k === namesKey(store) && renderData());
        });

        Sync.use(keys, { merge: Object.fromEntries(keys.map(k => [k, merge])) });
    }

    const names = () => {
        const v = Sync.get(namesKey(store), {});

        return v && typeof v === 'object' ? v : {};
    };

    const saveNames = items => Sync.set(namesKey(store), items);

    /* ---------- receipts (table) ---------- */
    let store, review = null, signedIn = false;
    const rows = {}, failed = {};   /* per store: its receipts once loaded, or why they couldn't be */
    const data = () => ({ items: names(), receipts: rows[store] || [] });
    const label = (d, k, fallback) => (d.items[k] || {}).alias || (d.items[k] || {}).name || fallback || k;

    /* Supabase returns at most 1000 rows per request: get the count with the first page, then the rest in parallel */
    async function load(s) {
        const q = opts => db.from('receipts').select(COLS, opts).eq('store', s).order('date').order('created_at');

        delete failed[s];

        try {
            const first = await q({ count: 'exact' }).range(0, 999);

            if (first.error) throw first.error;

            const pages = [];

            for (let from = 1000; from < (first.count || 0); from += 1000) pages.push(q().range(from, from + 999));

            const rest = await Promise.all(pages), bad = rest.find(r => r.error);

            if (bad) throw bad.error;

            rows[s] = first.data.concat(...rest.map(r => r.data));
        } catch (e) {
            failed[s] = 'Couldn’t load: ' + e.message + '. Has the SQL in _docs/receipts.md been run?';
        }

        if (s === store) renderData();
    }

    const loadStore = () => signedIn && !rows[store] && load(store);
    const waiting = () => failed[store] || (db ? 'Loading…' : 'Supabase isn’t set up (see _docs/sync-setup.md), so there are no receipts to read.');

    /* ---------- store picker ---------- */
    function renderStores() {
        const list = Stores.list();

        if (!list.includes(store)) {
            let saved;

            try { saved = localStorage.getItem(PICK); } catch { }

            store = list.includes(saved) ? saved : list[0];
        }

        $('stores').replaceChildren(...list.map(n => {
            const b = el('button', { type: 'button', textContent: n });

            b.setAttribute('aria-pressed', n === store);
            b.onclick = () => {
                if (n === store) return;

                store = n;

                try { localStorage.setItem(PICK, n); } catch { }

                closeReview();
                renderStores();
                renderData();
                loadStore();
            };

            return b;
        }));
    }

    Stores.onChange(list => {
        watch(list);
        renderStores();
        renderData();
        loadStore();
    });

    /* ---------- reading a receipt ----------
       Works line by line on the text. An item line ends in an amount (maybe with a tax letter after it) and may start
       with a code: "20512345 LECHE GLORIA 400G 4.20". A quantity line ("2 X 3.50", "1.250 KG X 5.90 7.38") goes with
       the item before it if the amounts agree, otherwise with the next one; a name with no amount waits for one.
       Discount lines take their amount off the item before. Reading stops at the total. */
    const AMT = /(?:S\/\.?\s*)?(-?\d{1,5}[.,]\d{2})\s*[A-Z*]{0,2}$/;
    const QTY = /^(\d+(?:[.,]\d{1,3})?)\s*(?:UN[DI]?|KGS?|K|LT|X)?\s*[xX*@]\s*(?:S\/\.?\s*)?(\d{1,5}[.,]\d{2,3})(?:\s+(?:S\/\.?\s*)?(\d{1,5}[.,]\d{2}))?\s*[A-Z*]{0,2}$/;
    const INQTY = /\s(\d+(?:[.,]\d{1,3})?)\s*(?:UN[DI]?|KGS?|K)?\s*[xX@*]\s*(\d{1,5}[.,]\d{2,3})$/;
    const CODE = /^(\d{4,14})\b\s*/;
    const SKIP = /SUB\s*TOTAL|\bIGV\b|GRAVAD|EXONERAD|INAFECT|REDONDEO|EFECTIVO|VUELTO|CAMBIO|\bVISA\b|MASTERCARD|TARJETA|\bPAGO\b|\bRUC\b|BOLETA|FACTURA|\bCAJA\b|CAJERO|FECHA|\bHORA\b|\bSON\b|ICBPER|\bDNI\b|CLIENTE|PUNTOS|\bITEMS?\b/i;
    const DISC = /DSCTO|DESCUENTO|\bDESC\b|AHORRO|PROMOCI/i;
    const TOTAL = /\bTOTAL\b/i;
    const LETTERS = /[A-Za-zÑñÁÉÍÓÚáéíóú].*[A-Za-zÑñÁÉÍÓÚáéíóú]/;
    const num = s => parseFloat(s.replace(',', '.'));

    function parse(text) {
        const items = [];
        let date = null, total = null, pendName = null, pendQty = null;

        const add = (code, name, price, qty) => {
            items.push({ code: code || '', name: name.replace(/\s{2,}/g, ' ').trim(), qty: qty || pendQty || 1, price });
            pendName = pendQty = null;
        };

        for (const raw of text.split(/\r?\n/)) {
            const line = raw.replace(/\s+/g, ' ').trim();

            if (!line) continue;

            if (!date) {
                const d = line.match(/\b(\d{2})[/.-](\d{2})[/.-](\d{4}|\d{2})\b/);

                if (d && +d[2] >= 1 && +d[2] <= 12) date = (d[3].length === 2 ? '20' + d[3] : d[3]) + '-' + d[2] + '-' + d[1];
            }

            const amt = line.match(AMT);

            if (TOTAL.test(line) && !/SUB\s*TOTAL/i.test(line)) {
                /* "TOTAL DSCTO" sums discounts already taken off the items */
                if (amt && !DISC.test(line)) {
                    total = toCents(amt[1]);
                    break;
                }

                continue;
            }

            if (SKIP.test(line)) continue;

            const q = line.match(QTY);

            if (q) {
                const qty = num(q[1]), each = toCents(q[2]), paid = q[3] ? toCents(q[3]) : Math.round(qty * each);
                const prev = items[items.length - 1];

                if (pendName) add(pendName.code, pendName.name, paid, qty);
                else if (prev && prev.qty === 1 && Math.abs(prev.price - paid) <= 2) prev.qty = qty;
                else pendQty = qty;

                continue;
            }

            if (amt && (DISC.test(line) || amt[1].startsWith('-'))) {
                const prev = items[items.length - 1];

                if (prev) prev.price = Math.max(0, prev.price - Math.abs(toCents(amt[1])));

                continue;
            }

            let rest = amt ? line.slice(0, amt.index).trim() : line, code = '';
            const c = rest.match(CODE);

            if (c) {
                code = c[1];
                rest = rest.slice(c[0].length);
            }

            if (!amt) {
                /* a name waiting for its amount on the next line */
                if (LETTERS.test(rest)) pendName = { code, name: rest };

                continue;
            }

            let qty = null;
            const iq = rest.match(INQTY);

            if (iq) {
                qty = num(iq[1]);
                rest = rest.slice(0, iq.index);
            }

            if (LETTERS.test(rest)) add(code, rest, toCents(amt[1]), qty);
            else if (pendName) add(pendName.code || code, pendName.name, toCents(amt[1]), qty);
        }

        return { date, total, items: items.filter(i => i.price > 0) };
    }

    /* ---------- the text reader (Tesseract.js, loaded on the first scan) ---------- */
    let reader = null, onProgress = () => {};

    function loadScript(src) {
        return new Promise((ok, fail) => {
            const s = el('script', { src, onload: ok, onerror: () => fail(new Error('couldn’t load the text reader (offline?)')) });

            document.head.append(s);
        });
    }

    async function getReader() {
        if (!window.Tesseract) await loadScript(TESS);

        if (!reader) {
            reader = await Tesseract.createWorker('spa', 1, { logger: m => onProgress(m) });
            /* one column of lines, keeping the gaps between name and price */
            await reader.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
        }

        return reader;
    }

    /* Grey and at most 2400px on the long side: faster to read, and phone photos are far bigger than needed */
    async function prepare(file) {
        const img = await createImageBitmap(file);
        const k = Math.min(1, 2400 / Math.max(img.width, img.height));
        const cv = el('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
        const ctx = cv.getContext('2d');

        ctx.filter = 'grayscale(1) contrast(1.3)';
        ctx.drawImage(img, 0, 0, cv.width, cv.height);

        return cv;
    }

    $('scanBtn').onclick = () => $('photo').click();

    $('photo').onchange = async () => {
        const file = $('photo').files[0];

        $('photo').value = '';

        if (!file) return;

        const msg = $('scanMsg'), btn = $('scanBtn');

        btn.disabled = true;
        msg.textContent = 'Loading the text reader…';
        onProgress = m => {
            if (m.status === 'recognizing text') msg.textContent = 'Reading… ' + Math.round(m.progress * 100) + '%';
        };

        try {
            const [w, img] = await Promise.all([getReader(), prepare(file)]);

            msg.textContent = 'Reading…';

            const { data: { text } } = await w.recognize(img);
            const r = parse(text);

            msg.textContent = r.items.length ? 'Found ' + r.items.length + ' lines. Check them against the photo before saving.' : 'No item lines found. Add them by hand, or try a sharper, straighter photo.';
            openReview(r, { text, photo: URL.createObjectURL(file) });
        } catch (e) {
            msg.textContent = 'Couldn’t read the photo: ' + e.message;
        }

        btn.disabled = false;
    };

    $('pasteBtn').onclick = () => {
        $('pasteBox').hidden = false;
        $('pasteText').focus();
    };

    $('pasteCancel').onclick = () => $('pasteBox').hidden = true;

    $('pasteRead').onclick = () => {
        const text = $('pasteText').value, r = parse(text);

        $('pasteBox').hidden = true;
        $('pasteText').value = '';
        $('scanMsg').textContent = r.items.length ? 'Found ' + r.items.length + ' lines.' : 'No item lines found. Add them by hand.';
        openReview(r, { text });
    };

    $('handBtn').onclick = () => {
        $('scanMsg').textContent = '';
        openReview({ date: null, total: null, items: [{ code: '', name: '', qty: 1, price: 0 }] }, {});
    };

    /* ---------- checking what was read ---------- */
    function openReview(r, extra) {
        closeReview();
        review = { id: r.id || null, lines: r.items.map(i => Object.assign({}, i)), photo: extra.photo || null };
        $('rDate').value = r.date && !isNaN(new Date(r.date + 'T00:00')) ? r.date : today();
        $('rTotal').value = r.total != null ? (r.total / 100).toFixed(2) : '';
        $('rPhotoBox').hidden = !extra.photo;
        $('rPhoto').src = extra.photo || '';
        $('rTextBox').hidden = !extra.text;
        $('rText').textContent = extra.text || '';
        $('rSave').textContent = r.id ? 'Save changes' : 'Save receipt';
        $('review').hidden = false;
        renderReview();
        $('review').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function closeReview() {
        if (review && review.photo) URL.revokeObjectURL(review.photo);

        review = null;
        $('review').hidden = true;
        $('rPhoto').src = '';
    }

    function renderReview() {
        const d = data(), hist = history(d), body = $('rLines').tBodies[0];

        body.replaceChildren(...review.lines.map((l, i) => {
            const inp = (field, props) => {
                const e = el('input', Object.assign({ autocomplete: 'off' }, props));

                e.oninput = () => {
                    l[field] = field === 'price' ? (toCents(e.value) || 0) : field === 'qty' ? (num(e.value || '1') || 1) : e.value.trim();
                    hint.textContent = known();
                    each.textContent = l.price ? money(Math.round(l.price / l.qty)) : '';
                    renderSum();
                };

                return e;
            };

            /* a code (or name) already seen at this store: show what it's called */
            const known = () => {
                const k = itemKey(l), it = d.items[k];

                return it ? 'Known' + (it.alias ? ' as ' + it.alias : '') + ' · bought ' + (hist[k] ? hist[k].buys.length : 0) + '×' : '';
            };

            const hint = el('div', { className: 'sm', textContent: known() });
            const each = el('td', { className: 'num each', textContent: l.price ? money(Math.round(l.price / l.qty)) : '' });
            const rm = el('button', { type: 'button', textContent: '×', title: 'Remove line' });

            rm.setAttribute('aria-label', 'Remove line ' + (i + 1));
            rm.onclick = () => {
                review.lines.splice(i, 1);
                renderReview();
            };

            return el('tr', {}, [
                el('td', {}, [inp('code', { value: l.code, inputMode: 'numeric', maxLength: 20, ariaLabel: 'Code' })]),
                el('td', {}, [inp('name', { value: l.name, maxLength: 80, ariaLabel: 'Name on receipt' }), hint]),
                el('td', { className: 'num' }, [inp('qty', { value: l.qty, inputMode: 'decimal', maxLength: 8, ariaLabel: 'Quantity' })]),
                el('td', { className: 'num' }, [inp('price', { value: l.price ? (l.price / 100).toFixed(2) : '', inputMode: 'decimal', maxLength: 10, placeholder: '0.00', ariaLabel: 'Paid' })]),
                each,
                el('td', {}, [rm])
            ]);
        }));

        renderSum();
    }

    function renderSum() {
        const sum = review.lines.reduce((s, l) => s + (l.price || 0), 0), total = toCents($('rTotal').value);

        $('rSum').textContent = 'Lines add up to ' + money(sum) + (isNaN(total) ? '' : total === sum ? ' ✓ matches the total' : ' · ' + money(Math.abs(total - sum)) + (total > sum ? ' missing' : ' too much') + ' against the total');
    }

    $('rTotal').oninput = renderSum;

    $('addLine').onclick = () => {
        review.lines.push({ code: '', name: '', qty: 1, price: 0 });
        renderReview();
        $('rLines').tBodies[0].lastChild.querySelector('input').focus();
    };

    $('rCancel').onclick = () => {
        closeReview();
        $('scanMsg').textContent = '';
    };

    $('rSave').onclick = async () => {
        const lines = review.lines.filter(l => l.name && l.price > 0).map(l => ({ code: l.code, name: l.name, qty: l.qty || 1, price: l.price }));
        const err = !db ? 'Supabase isn’t set up, so this can’t be saved.' : !signedIn ? 'Sign in first.' : !lines.length ? 'Nothing to save: every line needs a name and an amount.' : '';

        if (err) {
            $('rSum').textContent = err;

            return;
        }

        const s = store, id = review.id, total = toCents($('rTotal').value), btn = $('rSave');
        const rec = { date: $('rDate').value || today(), total: isNaN(total) ? null : total, lines };

        btn.disabled = true;

        const { data: row, error } = id
            ? await db.from('receipts').update(rec).eq('id', id).select(COLS).single()
            : await db.from('receipts').insert(Object.assign({ store: s }, rec)).select(COLS).single();

        btn.disabled = false;

        if (error) {
            $('rSum').textContent = 'Save failed: ' + error.message;

            return;
        }

        if (rows[s]) rows[s] = rows[s].filter(x => x.id !== row.id).concat(row);

        /* names are kept as first read; a new code or name gets an entry */
        const items = names();

        if (lines.some(l => !items[itemKey(l)])) {
            lines.forEach(l => items[itemKey(l)] ||= { name: l.name });
            saveNames(items);
        }

        closeReview();
        $('scanMsg').textContent = 'Saved ' + lines.length + ' lines from ' + dateText(row.date) + '.';
        renderData();
    };

    /* ---------- prices ---------- */
    /* Every purchase per item, oldest first, with the price of one */
    function history(d) {
        const out = {};

        d.receipts.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(r => r.lines.forEach(l => {
            const k = itemKey(l);

            (out[k] ||= { key: k, code: l.code, name: l.name, buys: [] }).buys.push({ date: r.date, qty: l.qty, price: l.price, each: Math.round(l.price / (l.qty || 1)) });
        }));

        return out;
    }

    function nameCell(d, h) {
        const td = el('td', { className: 'name' }), it = d.items[h.key] || {};
        const sub = el('div', { className: 'sm', textContent: [it.alias ? it.name || h.name : '', h.code ? '#' + h.code : ''].filter(Boolean).join(' · ') });

        const show = () => {
            const edit = el('button', { className: 'ren', textContent: '✎', title: 'Give it a clear name' });

            edit.setAttribute('aria-label', 'Rename ' + label(d, h.key, h.name));
            edit.onclick = startEdit;
            td.replaceChildren(el('b', { textContent: label(d, h.key, h.name) }), edit, sub);
        };

        /* An empty name goes back to the one on the receipt */
        function startEdit() {
            const inp = el('input', { className: 'ren-in', value: it.alias || '', maxLength: 60, placeholder: it.name || h.name });
            let done = false;

            const finish = ok => {
                if (done) return;

                done = true;

                const v = inp.value.trim();

                if (!ok || v === (it.alias || '')) return show();

                const items = names();

                items[h.key] = Object.assign({ name: h.name }, items[h.key], { alias: v && v !== (it.name || h.name) ? v : undefined });
                saveNames(items);
                renderData();
            };

            inp.setAttribute('aria-label', 'Clear name for ' + (it.name || h.name));
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

    function change(buys) {
        if (buys.length < 2) return el('td', { className: 'num sm', textContent: '' });

        const a = buys[buys.length - 2].each, b = buys[buys.length - 1].each, diff = b - a;

        if (!diff) return el('td', { className: 'num sm', textContent: 'same' });

        return el('td', {
            className: 'num ' + (diff > 0 ? 'neg' : 'pos'),
            textContent: (diff > 0 ? '▲ ' : '▼ ') + money(Math.abs(diff)).slice(3) + (a ? ' (' + Math.round(Math.abs(diff) / a * 100) + '%)' : '')
        });
    }

    let open = new Set();

    function renderPrices(d) {
        const q = keyOf($('q').value);
        const all = Object.values(history(d)).sort((a, b) => b.buys[b.buys.length - 1].date.localeCompare(a.buys[a.buys.length - 1].date) || label(d, a.key, a.name).localeCompare(label(d, b.key, b.name)));
        const rows = q ? all.filter(h => [label(d, h.key, h.name), (d.items[h.key] || {}).name || h.name, h.code].some(s => keyOf(s || '').includes(q))) : all;
        const tb = $('prices');

        tb.replaceChildren(el('tr', {}, [el('th', { textContent: 'Item' }), el('th', { className: 'num', textContent: 'Last' }), el('th', { className: 'num', textContent: 'Change' }), el('th', { className: 'num', textContent: 'Lowest' }), el('th', { className: 'num', textContent: 'Bought' })]));

        rows.forEach(h => {
            const last = h.buys[h.buys.length - 1], low = Math.min(...h.buys.map(b => b.each));
            const more = el('button', { type: 'button', textContent: h.buys.length + '×', title: 'Show every price' });

            more.setAttribute('aria-expanded', open.has(h.key));
            more.onclick = () => {
                open.has(h.key) ? open.delete(h.key) : open.add(h.key);
                renderPrices(data());
            };

            tb.append(el('tr', {}, [
                nameCell(d, h),
                el('td', { className: 'num' }, [money(last.each), el('div', { className: 'sm', textContent: dateText(last.date) })]),
                change(h.buys),
                el('td', { className: 'num' + (low === last.each ? ' pos' : ''), textContent: money(low) }),
                el('td', { className: 'num' }, [more])
            ]));

            if (open.has(h.key)) {
                tb.append(el('tr', { className: 'more' }, [el('td', { colSpan: 5 }, [el('div', { className: 'hist' }, h.buys.slice().reverse().map(b =>
                    el('div', {}, [el('span', { textContent: dateText(b.date) + ' ' }), money(b.each) + (b.qty !== 1 ? ' × ' + b.qty + ' = ' + money(b.price) : '')])))])]));
            }
        });

        $('pNote').textContent = !rows[store] ? waiting() : !all.length ? 'No receipts for ' + store + ' yet.' : q && !rows.length ? 'Nothing matches.' : 'Prices are for one (per kg for weighed items). ✎ gives an item a clear name; the name on the receipt stays underneath.';
    }

    $('q').oninput = () => renderPrices(data());

    /* ---------- saved receipts ---------- */
    let shown = null;

    function renderReceipts(d) {
        const tb = $('receipts'), list = d.receipts.slice().sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));

        tb.replaceChildren(el('tr', {}, [el('th', { textContent: 'Date' }), el('th', { className: 'num', textContent: 'Lines' }), el('th', { className: 'num', textContent: 'Total' }), el('th')]));

        list.forEach(r => {
            const sum = r.lines.reduce((s, l) => s + l.price, 0);

            const view = el('button', { type: 'button', textContent: shown === r.id ? 'Hide' : 'View', onclick: () => {
                shown = shown === r.id ? null : r.id;
                renderReceipts(data());
            } });

            const edit = el('button', { type: 'button', textContent: 'Edit', onclick: () => {
                $('scanMsg').textContent = '';
                openReview({ id: r.id, date: r.date, total: r.total, items: r.lines }, {});
            } });

            const del = el('button', { type: 'button', textContent: 'Delete', onclick: async () => {
                if (!armed(del, 'Sure?')) return;

                const s = store, { error } = await db.from('receipts').delete().eq('id', r.id);

                if (error) {
                    $('rNote').textContent = 'Delete failed: ' + error.message;

                    return;
                }

                rows[s] = rows[s].filter(x => x.id !== r.id);

                if (review && review.id === r.id) closeReview();

                renderData();
            } });

            tb.append(el('tr', {}, [
                el('td', { textContent: dateText(r.date) }),
                el('td', { className: 'num', textContent: r.lines.length }),
                el('td', { className: 'num' }, [money(r.total != null ? r.total : sum), r.total != null && r.total !== sum ? el('div', { className: 'sm', textContent: 'lines ' + money(sum) }) : null]),
                el('td', {}, [el('div', { className: 'btns' }, [view, edit, del])])
            ]));

            if (shown === r.id) {
                tb.append(el('tr', { className: 'more' }, [el('td', { colSpan: 4 }, [el('div', { className: 'hist' }, r.lines.map(l =>
                    el('div', {}, [el('span', { textContent: label(d, itemKey(l), l.name) + ' ' }), (l.qty !== 1 ? l.qty + ' × ' : '') + money(l.price)])))])]));
            }
        });

        $('rNote').textContent = !rows[store] ? waiting() : list.length ? '' : 'None yet.';
    }

    function renderData() {
        const d = data();

        renderPrices(d);
        renderReceipts(d);

        if (review) renderReview();
    }

    watch(Stores.list());
    renderStores();
    renderData();

    if (db) {
        db.auth.onAuthStateChange((_, session) => {
            if (session && !signedIn) {
                signedIn = true;
                setTimeout(loadStore, 0);
            }
        });
    }
})();
