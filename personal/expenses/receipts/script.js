/* Receipts: price history per store, from scanned receipts (see _docs/receipts.md).
     receipts table                one row per receipt: { id, store, date, total, lines: [{ code, name, qty, price }] }
     receipt-names-<store slug>    synced key, the store's item names: { key: { name, alias } }
   An item's key is its code on the receipt, or n:<lowercased name> when it has none. `name` is the name as first read
   off a receipt, `alias` is a natural/readable name. Amounts are céntimos; `price` is what the line cost in total.
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

    /* MARK: Names (db keys) */
    /* First sync on a device that already has names. Custom name preferred over default. */
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

    /* MARK: Receipts table */
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

    /* MARK: Store picker */
    function renderStores() {
        const list = Stores.list();

        if (!list.includes(store)) {
            let saved;

            try { saved = localStorage.getItem(PICK); } catch { }

            store = list.includes(saved) ? saved : list[0];
        }

        $('stores').replaceChildren(...list.map(n => {
            const b = el('button', { type: 'button', textContent: n, onclick: () => pick(n) });

            b.setAttribute('aria-pressed', n === store);

            return b;
        }));
    }

    /* Switch to a store (by its button, or a receipt's QR code or XML) */
    function pick(n) {
        if (n === store) return;

        store = n;

        try { localStorage.setItem(PICK, n); } catch { }

        closeReview();
        renderStores();
        renderData();
        loadStore();
    }

    Stores.onChange(list => {
        watch(list);
        renderStores();
        renderData();
        loadStore();
    });

    /* MARK: Reading a receipt
       Tuned on real receipts with tools/purchase-receipts/read-receipt.py, which runs these same steps on a PC: change
       both together (_docs/receipts.md has the rules and the receipts behind them). Line by line:
       - an item starts with its code (a 13-digit barcode at Mass) and has its amount in the right-hand column, after
         a gap of 3+ spaces; a coded line with no amount is kept and flagged, to be filled in
       - a quantity or weight line ("2 X 3.50  7.00", ".525 KG X 2.60  1.36") belongs to the item just above it
       - a discount line comes off the item above; items stop at the subtotal, totals and the unit count come after
       - common misreads are fixed: O→0, l→1, S→5, a comma or colon for the point, X read as Y, a lost point (520)
       Codes seen before at the store fix misread codes and bring their saved names. */
    const DIG = '0-9OoUDQlI|SB';
    const FIXES = { O: '0', o: '0', U: '0', D: '0', Q: '0', l: '1', I: '1', '|': '1', S: '5', B: '8', ',': '.', ':': '.', ';': '.' };
    const fix = s => s.replace(/[OoUDQlI|SB,:;]/g, c => FIXES[c]);
    const AMOUNT = new RegExp('^-?[' + DIG + ']{1,4} ?[.,:;] ?[' + DIG + ']{1,2}$');
    const AMOUNTS = new RegExp('-?[' + DIG + ']{1,4} ?[.,:;] ?[' + DIG + ']{1,2}(?![0-9])|\\b\\d{1,3} \\d{2}\\b', 'g');
    const CODE = new RegExp('^\\W{0,2}([' + DIG + ']{8,14})\\s+(.*)$');
    const QTY = /^\W*(\.?\d+(?:[.,]\d+)?)?\s*(?:(K[GE]\w?|UN\w{0,2})\s*[xXyY×*@]{0,2}|[xXyY×*@]{1,2})\s+(.*)$/;
    const TAIL = /(-?\d{1,4}[.,]\d{2})\s*[A-Z*]{0,2}$/;
    const SKIP = /\bIGV\b|I\.G\.V|GRAVAD|EXONERAD|INAFECT|REDONDEO|EFECTIVO|VUELTO|CAMBIO|\bVISA\b|MASTERCARD|\bPAGO\b|\bRUC\b|BOLETA|FACTURA|\bCAJA\b|CAJERO|FECHA|\bHORA\b|\bSON\b|ICBPER|\bDNI\b|CLIENTE|PUNTOS/i;
    const TOTALS = /TOTAL|PAGAR|TARJ/i;
    const DISC = /DSCTO|DESCUENTO|\bDESC\b|AHORRO|PROMOCI/i;
    const LETTERS = /[A-Za-zÑñÁÉÍÓÚáéíóú].*[A-Za-zÑñÁÉÍÓÚáéíóú]/;
    const num = s => parseFloat(s.replace(',', '.'));
    const squash = s => s.replace(/\s+/g, ' ').trim();

    /* A price in céntimos, misreads fixed. With whole, three or four bare digits count too (520 → 5.20). */
    function priceOf(tok, whole) {
        let t = tok.trim();

        if (whole && /^\d{3,4}$/.test(t)) return +t;

        if (!(AMOUNT.test(t) || /^\d{1,3} \d{2}$/.test(t)) || !/\d/.test(t)) return null;

        t = fix(t).replace(/ /g, '');

        if (!t.includes('.')) t = t.slice(0, -2) + '.' + t.slice(-2);

        const [a, b] = t.split('.');

        return Math.round(parseFloat(a + '.' + b.padEnd(2, '0')) * 100);
    }

    /* The amount in the right-hand column (after a gap of 3+ spaces), else one right at the end of the line */
    function lastAmount(raw, whole) {
        const cols = raw.trim().split(/\s{3,}/);

        if (cols.length > 1) {
            const v = priceOf(cols[cols.length - 1], whole);

            if (v != null) return [v, cols];
        }

        const m = squash(raw).match(TAIL);

        return [m ? priceOf(m[1]) : null, cols];
    }

    /* EAN-13 or EAN-8 check digit */
    function eanOk(c) {
        if (!/^(\d{8}|\d{13})$/.test(c)) return false;

        const w = c.length === 8 ? [3, 1] : [1, 3];
        const sum = [...c.slice(0, -1)].reduce((s, d, i) => s + d * w[i % 2], 0);

        return sum * 9 % 10 === +c.slice(-1);
    }

    /* A code that isn't a valid barcode: the one known code it matches with at most one digit wrong (two for a
       full-length code), lined up with its start or its end, since digits get lost at the edge of the paper.
       Returns [code, still doubtful]. */
    function repair(code, known) {
        const codes = Object.keys(known);

        if (eanOk(code) || !codes.length) return [code, !eanOk(code)];

        const diff = (a, b) => [...a].filter((x, i) => x !== b[i]).length;
        const most = code.length >= 12 ? 2 : 1;
        const near = codes.filter(k => code.length >= 8 && k.length >= code.length && Math.min(diff(code, k.slice(0, code.length)), diff(code, k.slice(-code.length))) <= most);

        return near.length === 1 ? [near[0], false] : [code, true];
    }

    /* Drops what the reader left after a name: an amount, or bits starting with a symbol ("+90", '"90') */
    const cleanName = name => name.replace(TAIL, '').replace(/(\s+[^\p{L}\p{N}_\s]\S*|[^\p{L}\p{N}_.%/)]+)+$/u, '').trim();

    /* Receipt text → { date, total, units, items: [{ code, name, qty, price, warn }] }. known: { code: name } */
    function parse(text, known) {
        const items = [], totals = [];
        let date = null, units = null, done = false, pend = null, last = -9;

        text.split(/\r?\n/).forEach((raw, n) => {
            const line = squash(raw);

            if (!line) return;

            if (!date) {
                const d = line.match(/\b(\d{2})[/.-](\d{2})[/.-](\d{4}|\d{2})\b/);

                if (d && +d[2] >= 1 && +d[2] <= 12 && +d[1] >= 1 && +d[1] <= 31) date = (d[3].length === 2 ? '20' + d[3] : d[3]) + '-' + d[2] + '-' + d[1];
            }

            const u = line.match(/(\d+)\s*UNIDAD/i);

            if (u) {
                units = +u[1];
                done = true;

                return;
            }

            if (TOTALS.test(line) && !DISC.test(line)) {
                const [v] = lastAmount(raw);

                if (v != null) totals.push(v);

                done = true;

                return;
            }

            if (done || SKIP.test(line)) return;

            const c = raw.trim().match(CODE), q = c ? null : line.match(QTY);

            /* quantity or weight line: belongs to the item just above */
            if (q && (q[1] || q[2])) {
                const vals = (q[3].match(AMOUNTS) || []).map(t => priceOf(t)).filter(v => v);
                const each = vals[0] || null, kg = (q[2] || '')[0] === 'K' || (q[1] || '').startsWith('.');
                let paid = vals.length > 1 ? vals[vals.length - 1] : null, qty = q[1] ? num(q[1]) : null, warn = '';

                if (kg && qty >= 10 && !q[1].includes('.')) qty /= 1000;   /* ".525" read as "525" */

                if (each && paid) {
                    if (qty && Math.abs(qty * each - paid) <= 1) {
                        /* all agree */
                    } else if (kg) {
                        qty = Math.round(paid / each * 1000) / 1000;
                    } else if (qty && Number.isInteger(qty) && qty >= 1 && qty < 100) {
                        paid = Math.round(qty * each);   /* the total is the likelier misread */
                        warn = 'amount';
                    } else {
                        qty = Math.max(1, Math.round(paid / each));
                    }
                } else if (each && qty) {
                    paid = Math.round(qty * each);
                }

                if (!(qty && paid)) return;

                const prev = items[items.length - 1];

                if (prev && n - last <= 2) Object.assign(prev, { qty, price: paid, warn: prev.warn || warn });
                else if (pend) items.push({ code: '', name: pend, qty, price: paid, warn });

                pend = null;

                return;
            }

            const [v, cols] = lastAmount(raw, !!c);

            if (v != null && (DISC.test(line) || cols[cols.length - 1].trim().startsWith('-'))) {
                const prev = items[items.length - 1];

                if (prev) prev.price = Math.max(0, prev.price - Math.abs(v));

                return;
            }

            if (c) {
                const [code, bad] = repair(fix(c[1]), known);

                items.push({ code, name: known[code] || cleanName(c[2].trim().split(/\s{3,}/)[0]), qty: 1, price: v || 0, warn: bad ? 'code' : '' });
                last = n;
                pend = null;

                return;
            }

            if (v != null) {
                const name = cols.length > 1 ? cols[0] : line.replace(TAIL, '');

                if (LETTERS.test(name) || pend) {
                    items.push({ code: '', name: LETTERS.test(name) ? name.trim() : pend, qty: 1, price: v, warn: '' });
                    last = n;
                    pend = null;
                }

                return;
            }

            if (LETTERS.test(line)) pend = line;
        });

        items.forEach(i => {
            if (!i.price) i.warn ||= 'no amount';
        });

        const sum = items.reduce((s, i) => s + i.price, 0), tally = {};

        totals.forEach(t => tally[t] = (tally[t] || 0) + 1);

        const mode = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];

        return { date, units, total: totals.includes(sum) ? sum : mode != null ? +mode : null, items: items.filter(i => i.code || i.price) };
    }

    /* MARK: Tesseract text reader */
    let reader = null, onProgress = () => {};

    function loadScript(src, what) {
        return new Promise((ok, fail) => {
            const s = el('script', { src, onload: ok, onerror: () => fail(new Error('couldn’t load ' + what + ' (offline?)')) });

            document.head.append(s);
        });
    }

    async function getReader() {
        if (!window.Tesseract) await loadScript(TESS, 'the text reader');

        if (!reader) {
            reader = await Tesseract.createWorker('spa', 1, { logger: m => onProgress(m) });
            /* one column of lines, keeping the gaps between name and price */
            await reader.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
        }

        return reader;
    }

    /* MARK: Cleaning up the photo
       Grey, the paper found and straightened to 1000px wide, then sharpened, as read-receipt.py does with OpenCV.
       Without a clear paper outline (a busy background, or the photo is all receipt) the whole photo is used. */
    function grey(bmp, w, h) {
        const cv = el('canvas', { width: w, height: h }), ctx = cv.getContext('2d', { willReadFrequently: true });

        ctx.drawImage(bmp, 0, 0, w, h);

        const px = ctx.getImageData(0, 0, w, h).data, d = new Uint8ClampedArray(w * h);

        for (let i = 0; i < d.length; i++) d[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];

        return { w, h, d };
    }

    /* Separable blur with the given 1-D kernel, edges clamped */
    function blur(g, kern) {
        const { w, h, d } = g, r = kern.length >> 1, tmp = new Float32Array(w * h), out = new Uint8ClampedArray(w * h);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let s = 0;

                for (let k = -r; k <= r; k++) s += kern[k + r] * d[y * w + Math.min(w - 1, Math.max(0, x + k))];

                tmp[y * w + x] = s;
            }
        }

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let s = 0;

                for (let k = -r; k <= r; k++) s += kern[k + r] * tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];

                out[y * w + x] = s;
            }
        }

        return { w, h, d: out };
    }

    /* The paper's corners [tl, tr, br, bl]: the biggest bright blob after an Otsu threshold, if it's big enough */
    function paper(g) {
        const { w, h, d } = blur(g, [.2, .2, .2, .2, .2]), hist = new Array(256).fill(0);

        d.forEach(v => hist[v]++);

        /* Otsu: the threshold that best splits the histogram in two */
        let sum = 0, sumB = 0, wB = 0, best = -1, t = 127;

        hist.forEach((c, i) => sum += c * i);

        for (let i = 0; i < 256; i++) {
            wB += hist[i];

            if (!wB || wB === d.length) continue;

            sumB += hist[i] * i;

            const mB = sumB / wB, mF = (sum - sumB) / (d.length - wB), v = wB * (d.length - wB) * (mB - mF) ** 2;

            if (v > best) {
                best = v;
                t = i;
            }
        }

        const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
        let top = null;

        for (let s = 0; s < d.length; s++) {
            if (seen[s] || d[s] <= t) continue;

            /* flood fill one blob, keeping its extreme points */
            const ext = [s, s, s, s];   /* min x+y, max x-y, max x+y, min x-y */
            let n = 0, sp = 0;

            seen[s] = 1;
            stack[sp++] = s;

            while (sp) {
                const p = stack[--sp], x = p % w, y = (p - x) / w;
                const e = i => [ext[i] % w, (ext[i] - ext[i] % w) / w];

                n++;

                if (x + y < e(0)[0] + e(0)[1]) ext[0] = p;
                if (x - y > e(1)[0] - e(1)[1]) ext[1] = p;
                if (x + y > e(2)[0] + e(2)[1]) ext[2] = p;
                if (x - y < e(3)[0] - e(3)[1]) ext[3] = p;

                for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
                    if (q >= 0 && !seen[q] && d[q] > t) {
                        seen[q] = 1;
                        stack[sp++] = q;
                    }
                }
            }

            if (!top || n > top.n) top = { n, ext };
        }

        return top && top.n > 0.15 * d.length ? top.ext.map(p => [p % w, (p - p % w) / w]) : null;
    }

    /* The perspective transform taking (u, v) in the output rectangle to (x, y) in the photo: 8 equations, solved */
    function homography(from, to) {
        const A = [];

        from.forEach(([u, v], i) => {
            const [x, y] = to[i];

            A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x], [0, 0, 0, u, v, 1, -u * y, -v * y, y]);
        });

        for (let c = 0; c < 8; c++) {
            const p = A.slice(c).reduce((m, r, i) => Math.abs(r[c]) > Math.abs(A[m][c]) ? c + i : m, c);

            [A[c], A[p]] = [A[p], A[c]];

            for (let r = 0; r < 8; r++) {
                if (r === c) continue;

                const f = A[r][c] / A[c][c];

                for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
            }
        }

        return A.map((r, i) => r[8] / r[i]);
    }

    /* The paper straightened into a W-wide rectangle, sampling the photo between pixels (bilinear); white outside */
    function warp(big, corners, W) {
        const [tl, tr, br, bl] = corners, side = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        const H = Math.round(W * (side(tl, bl) + side(tr, br)) / (side(tl, tr) + side(bl, br)));
        const [a, b, c, d, e, f, g, h] = homography([[0, 0], [W, 0], [W, H], [0, H]], corners);
        const out = new Uint8ClampedArray(W * H), src = big.d, bw = big.w;

        for (let v = 0; v < H; v++) {
            for (let u = 0; u < W; u++) {
                const z = g * u + h * v + 1, x = (a * u + b * v + c) / z, y = (d * u + e * v + f) / z;
                const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;

                if (x0 < 0 || y0 < 0 || x0 >= bw - 1 || y0 >= big.h - 1) {
                    out[v * W + u] = 255;
                    continue;
                }

                const i = y0 * bw + x0;

                out[v * W + u] = (src[i] * (1 - fx) + src[i + 1] * fx) * (1 - fy) + (src[i + bw] * (1 - fx) + src[i + bw + 1] * fx) * fy;
            }
        }

        return { w: W, h: H, d: out };
    }

    /* 1.6 × the image − 0.6 × a Gaussian blur of it (sigma 2) */
    function sharpen(g) {
        const kern = Array.from({ length: 13 }, (_, i) => Math.exp(-((i - 6) ** 2) / 8)), ks = kern.reduce((s, v) => s + v, 0);
        const soft = blur(g, kern.map(v => v / ks)), out = new Uint8ClampedArray(g.d.length);

        for (let i = 0; i < out.length; i++) out[i] = Math.round(1.6 * g.d[i] - 0.6 * soft.d[i]);

        return { w: g.w, h: g.h, d: out };
    }

    async function prepare(file) {
        const bmp = await createImageBitmap(file), W = 1000, long = Math.max(bmp.width, bmp.height);
        const fit = Math.min(1, 2400 / long), k = 300 / long;
        const big = grey(bmp, Math.round(bmp.width * fit), Math.round(bmp.height * fit));
        const small = grey(bmp, Math.round(bmp.width * k), Math.round(bmp.height * k));
        const corners = paper(small);
        const g = sharpen(corners ? warp(big, corners.map(([x, y]) => [x * big.w / small.w, y * big.h / small.h]), W) : grey(bmp, W, Math.round(bmp.height * W / bmp.width)));
        const cv = el('canvas', { width: g.w, height: g.h }), ctx = cv.getContext('2d'), img = ctx.createImageData(g.w, g.h);

        for (let i = 0; i < g.d.length; i++) {
            img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g.d[i];
            img.data[i * 4 + 3] = 255;
        }

        ctx.putImageData(img, 0, 0);

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
            const r = parse(text, knownCodes()), flagged = r.items.filter(i => i.warn).length;

            /* the QR code's date and total are exact */
            if (qr) Object.assign(r, { date: qr.date, total: qr.total });

            msg.textContent = r.items.length ? 'Found ' + r.items.length + ' lines' + (flagged ? ', ' + flagged + ' to check (marked)' : '') + '. Check them against the photo before saving.' : 'No item lines found. Add them by hand, or try a sharper, straighter photo.';
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
        const text = $('pasteText').value, r = parse(text, knownCodes());

        $('pasteBox').hidden = true;
        $('pasteText').value = '';

        /* the QR code's text, from any QR scanner app */
        if (parseQr(text)) return useQr(text);

        if (qr) Object.assign(r, { date: qr.date, total: qr.total });

        $('scanMsg').textContent = r.items.length ? 'Found ' + r.items.length + ' lines.' : 'No item lines found. Add them by hand.';
        openReview(r, { text });
    };

    $('handBtn').onclick = () => {
        $('scanMsg').textContent = '';
        openReview({ date: null, total: null, items: [{ code: '', name: '', qty: 1, price: 0 }] }, {});
    };

    /* MARK: QR code
       Peruvian e-receipts carry SUNAT's QR: RUC | type | series | number | IGV | total | date | buyer's ID type |
       buyer's ID | …
       Only the store's RUC, the type, series-number, total and date are kept.
       The RUC picks the store and its lookup site, where the receipt's XML can be downloaded (after a captcha) and imported below. */
    const JSQR = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    const TYPES = { '01': 'Factura', '03': 'Boleta de venta' };
    const RUCS = { '20608280333': 'Mass', '20100070970': 'Plaza Vea' };   /* any other RUC is asked once, then synced */
    const RUC_KEY = 'receipt-rucs';                                        /* { ruc: store } */
    const lookupUrl = ruc => 'https://ax.axteroid.com/consulta/' + ruc;   /* Axteroid serves Mass and Plaza Vea */
    let qr = null;

    Sync.use([RUC_KEY], { merge: { [RUC_KEY]: (local, remote) => Object.assign({}, local, remote) } });

    const storeOf = ruc => {
        const n = RUCS[ruc] || (Sync.get(RUC_KEY, {}) || {})[ruc];

        return Stores.list().includes(n) ? n : null;
    };

    /* "BF62-01407961" and "BF62-1407961" are the same receipt */
    const sameRef = (a, b) => a.replace(/-0+(?=\d)/, '-') === b.replace(/-0+(?=\d)/, '-');

    function parseQr(text) {
        const f = text.trim().split('|');

        if (f.length < 7 || !/^\d{11}$/.test(f[0]) || !TYPES[f[1]]) return null;

        const dmy = f[6].trim().match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/), date = dmy ? dmy[3] + '-' + dmy[2] + '-' + dmy[1] : f[6].trim();
        const total = toCents(f[5]);

        return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(total) ? { ruc: f[0], type: f[1], ref: f[2].trim() + '-' + f[3].trim(), total, date } : null;
    }

    /* The browser's own reader where there is one (Chrome on Android), else jsQR at a few sizes */
    async function decodeQr(file) {
        const bmp = await createImageBitmap(file);

        if ('BarcodeDetector' in window) {
            try {
                const found = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bmp);

                if (found.length) return found[0].rawValue;
            } catch { }
        }

        if (!window.jsQR) await loadScript(JSQR, 'the QR reader');

        for (const size of [1200, 2000, 800]) {
            const k = Math.min(1, size / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
            const ctx = el('canvas', { width: w, height: h }).getContext('2d', { willReadFrequently: true });

            ctx.drawImage(bmp, 0, 0, w, h);

            const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });

            if (hit) return hit.data;
        }

        return null;
    }

    /* The lookup site's form, value by value with copy buttons (the site can't be filled in from a link) */
    function renderQr() {
        const box = $('qrBox');

        box.hidden = !qr;

        if (!qr) return;

        const s = storeOf(qr.ruc), d = qr.date.split('-');
        const dup = s && (rows[s] || []).some(r => r.date === qr.date && r.total === qr.total);

        const row = (label, value) => {
            const b = el('button', { type: 'button', textContent: 'Copy' });

            b.setAttribute('aria-label', 'Copy ' + label);
            b.onclick = () => navigator.clipboard.writeText(value).then(() => {
                b.textContent = 'Copied';
                setTimeout(() => b.textContent = 'Copy', 1500);
            }, () => b.textContent = 'Copy failed');

            return el('div', { className: 'qrrow' }, [el('span', { className: 'sm', textContent: label }), el('b', { textContent: value }), b]);
        };

        const close = el('button', { type: 'button', className: 'qrx', textContent: '×', title: 'Close', onclick: () => {
            qr = null;
            renderQr();
        } });

        const link = el('a', { href: lookupUrl(qr.ruc), target: '_blank', rel: 'noopener', textContent: 'Open the lookup site ↗' });
        const xml = el('button', { type: 'button', className: 'pri', textContent: 'Import XML…', onclick: () => $('xmlFile').click() });
        const ocr = el('button', { type: 'button', textContent: 'Scan photo instead…', onclick: () => $('photo').click() });

        box.replaceChildren(
            el('div', { className: 'qrhead' }, [el('b', { textContent: TYPES[qr.type] + ' ' + qr.ref + (s ? ' · ' + s : '') }), close]),
            s ? null : el('div', {}, [
                el('p', { className: 'msg', textContent: 'Which store is this? (RUC ' + qr.ruc + ')' }),
                el('div', { className: 'btns' }, Stores.list().map(n => el('button', { type: 'button', textContent: n, onclick: () => {
                    Sync.set(RUC_KEY, Object.assign({}, Sync.get(RUC_KEY, {}), { [qr.ruc]: n }));
                    pick(n);
                    renderQr();
                } })))
            ]),
            dup ? el('p', { className: 'msg warn', textContent: 'A receipt from this date with this total is already saved for ' + s + '.' }) : null,
            row('Tipo de documento', TYPES[qr.type]),
            row('Serie - Correlativo', qr.ref),
            row('Fecha de emisión', d[2] + '-' + d[1] + '-' + d[0]),
            row('Total', (qr.total / 100).toFixed(2)),
            el('p', { className: 'note', textContent: 'On the lookup site, fill these in, tick the captcha and press Descargar XML, then import the file here.' }),
            el('div', { className: 'btns qrfoot' }, [link, xml, ocr])
        );
    }

    $('qrBtn').onclick = () => $('qrPhoto').click();
    $('qrCamBtn').onclick = () => $('qrCamera').click();

    /* the same reader for a picked photo and one just taken with the camera */
    $('qrPhoto').onchange = $('qrCamera').onchange = async e => {
        const input = e.target, file = input.files[0], msg = $('scanMsg');

        input.value = '';

        if (!file) return;

        msg.textContent = 'Looking for the QR code…';

        try {
            const text = await decodeQr(file);

            useQr(text);
        } catch (e) {
            msg.textContent = 'Couldn’t read the QR code: ' + e.message;
        }
    };

    function useQr(text) {
        const q = text ? parseQr(text) : null, msg = $('scanMsg');

        if (!q) {
            msg.textContent = text ? 'That QR code isn’t a receipt’s (' + text.slice(0, 60) + ').' : 'No QR code found. Try closer, with the QR code filling more of the photo.';

            return false;
        }

        qr = q;
        msg.textContent = '';

        const s = storeOf(q.ruc);

        if (s) pick(s);

        renderQr();

        return true;
    }

    /* MARK: XML import
       Each InvoiceLine has the quantity, the store's code (SellersItemIdentification, or the barcode in
       StandardItemIdentification), the description, and the line's value before tax plus its taxes: together what
       was paid. The receipt's taxes themselves aren't kept.
       Mass (Axteroid) pads the code to 14 digits (02200204244226: the 13-digit barcode on the receipt with a 0 in
       front) and puts the printed line in the description, in fields: "2200204244226@@FRSTFREC500G@@ 2 X 6.90@@13.80@@". */
    const kids = (node, name) => node ? [...node.children].filter(c => c.localName === name) : [];
    const kid = (node, ...path) => path.reduce((n, p) => kids(n, p)[0] || null, node);
    const txt = (node, ...path) => (kid(node, ...path) || { textContent: '' }).textContent.trim();
    const cents = s => s ? Math.round(parseFloat(s) * 100) : NaN;
    const gtin13 = c => /^0\d{13}$/.test(c) ? c.slice(1) : c;

    /* The name from a description: the field after the code when it's in @@ fields, else all of it */
    function descName(desc) {
        const f = desc.split('@@').map(s => s.trim());

        return f.length > 1 ? (/^\d+$/.test(f[0]) ? f[1] : f[0]) : desc;
    }

    /* Decoded as the file says it's encoded (Mass's are ISO-8859-1), not always as UTF-8 */
    async function readText(file) {
        const buf = await file.arrayBuffer(), head = new TextDecoder('latin1').decode(buf.slice(0, 200));
        const enc = (head.match(/encoding=["']([\w-]+)["']/i) || [])[1] || 'utf-8';

        try {
            return new TextDecoder(enc).decode(buf);
        } catch {
            return new TextDecoder().decode(buf);
        }
    }

    /* Mass's XML declares xmlns:schemaLocation="urn:… ..\xsd\maindoc\UBLPE-Invoice-2.1.xsd" (meant as
       xsi:schemaLocation): not a valid namespace, so browsers refuse the whole file. Elements are only matched by their
       local names here, so namespace declarations with spaces or backslashes are dropped before parsing. */
    function parseXml(text) {
        text = text.replace(/\s+xmlns:[\w.-]+\s*=\s*("[^"]*[\s\\][^"]*"|'[^']*[\s\\][^']*')/g, '');

        const doc = new DOMParser().parseFromString(text, 'application/xml'), inv = doc.documentElement;

        if (doc.getElementsByTagName('parsererror').length || inv.localName !== 'Invoice') return null;

        const items = kids(inv, 'InvoiceLine').map(line => {
            const item = kid(line, 'Item'), qty = parseFloat(txt(line, 'InvoicedQuantity')) || 1;
            const codes = [txt(item, 'SellersItemIdentification', 'ID'), txt(item, 'StandardItemIdentification', 'ID')].filter(Boolean);
            const net = cents(txt(line, 'LineExtensionAmount')), tax = kids(line, 'TaxTotal').reduce((s, t) => s + (cents(txt(t, 'TaxAmount')) || 0), 0);
            const each = kids(kid(line, 'PricingReference'), 'AlternativeConditionPrice').find(p => txt(p, 'PriceTypeCode') === '01');
            const price = !isNaN(net) ? net + tax : each ? Math.round(cents(txt(each, 'PriceAmount')) * qty) : 0;

            return {
                code: gtin13(codes.find(c => /^\d{8,14}$/.test(c)) || codes[0] || ''),
                name: descName(squash(kids(item, 'Description').map(d => d.textContent).join(' '))),
                qty, price, warn: price ? '' : 'no amount'
            };
        });

        return {
            ruc: txt(inv, 'AccountingSupplierParty', 'Party', 'PartyIdentification', 'ID'),
            ref: txt(inv, 'ID'), date: txt(inv, 'IssueDate'), total: cents(txt(inv, 'LegalMonetaryTotal', 'PayableAmount')), items
        };
    }

    $('xmlBtn').onclick = () => $('xmlFile').click();

    $('xmlFile').onchange = async () => {
        const file = $('xmlFile').files[0], msg = $('scanMsg');

        $('xmlFile').value = '';

        if (!file) return;

        const text = await readText(file);

        if (text.startsWith('PK')) {
            msg.textContent = 'That’s a zip file: open it and import the XML inside.';

            return;
        }

        const x = parseXml(text);

        if (!x || !x.items.length) {
            msg.textContent = x ? 'No item lines in that XML.' : 'That doesn’t look like a receipt’s XML.';

            return;
        }

        const s = storeOf(x.ruc);

        if (s) {
            pick(s);
        } else if (!qr || qr.ruc !== x.ruc) {
            /* an unknown store: ask, as for a QR code, then import again */
            qr = { ruc: x.ruc, type: '03', ref: x.ref, total: x.total, date: x.date };
            renderQr();
            msg.textContent = 'Pick the store below, then import the XML again.';

            return;
        }

        const other = qr && !sameRef(qr.ref, x.ref);

        msg.textContent = 'Read ' + x.items.length + ' lines from ' + x.ref + '.' + (other ? ' That isn’t the receipt from the QR code (' + qr.ref + ').' : '');
        qr = null;
        renderQr();
        openReview(x, {});
    };

    //* MARK: Checking what was read */
    /* The store's codes with their names as on the receipt, for parse to fix misread codes and names */
    const knownCodes = () => Object.fromEntries(Object.entries(names()).filter(([k]) => !k.startsWith('n:')).map(([k, v]) => [k, v.name]));

    const WARN = { code: 'Check the code: not a valid barcode', amount: 'Check the amount: quantity × price didn’t match the line', 'no amount': 'No amount read' };

    function openReview(r, extra) {
        closeReview();
        review = { id: r.id || null, lines: r.items.map(i => Object.assign({}, i)), units: r.units || null, photo: extra.photo || null };
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

                    /* a fixed field clears its warning */
                    if (field === 'price' && l.price && (l.warn === 'amount' || l.warn === 'no amount')) l.warn = '';
                    if (field === 'code' && l.warn === 'code' && (eanOk(l.code) || !l.code)) l.warn = '';

                    row.classList.toggle('warn', !!l.warn);
                    hint.textContent = known();
                    each.textContent = l.price ? money(Math.round(l.price / l.qty)) : '';
                    renderSum();
                };

                return e;
            };

            /* what to check, and a code (or name) already seen at this store: what it's called, its last price */
            const known = () => {
                const k = itemKey(l), it = d.items[k], h = hist[k];

                return [WARN[l.warn], it ? 'Known' + (it.alias ? ' as ' + it.alias : '') + (h ? ' · last ' + money(h.buys[h.buys.length - 1].each) : '') : ''].filter(Boolean).join(' · ');
            };

            const hint = el('div', { className: 'sm', textContent: known() });
            const each = el('td', { className: 'num each', textContent: l.price ? money(Math.round(l.price / l.qty)) : '' });
            const rm = el('button', { type: 'button', textContent: '×', title: 'Remove line' });

            rm.setAttribute('aria-label', 'Remove line ' + (i + 1));
            rm.onclick = () => {
                review.lines.splice(i, 1);
                renderReview();
            };

            const row = el('tr', { className: l.warn ? 'warn' : '' }, [
                el('td', {}, [inp('code', { value: l.code, inputMode: 'numeric', maxLength: 20, ariaLabel: 'Code' })]),
                el('td', {}, [inp('name', { value: l.name, maxLength: 80, ariaLabel: 'Name on receipt' }), hint]),
                el('td', { className: 'num' }, [inp('qty', { value: l.qty, inputMode: 'decimal', maxLength: 8, ariaLabel: 'Quantity' })]),
                el('td', { className: 'num' }, [inp('price', { value: l.price ? (l.price / 100).toFixed(2) : '', inputMode: 'decimal', maxLength: 10, placeholder: '0.00', ariaLabel: 'Paid' })]),
                each,
                el('td', {}, [rm])
            ]);

            return row;
        }));

        renderSum();
    }

    /* Against the receipt's total and its unit count (Mass prints "37 UNIDAD(ES)"; a weighed item is one unit) */
    function renderSum() {
        const sum = review.lines.reduce((s, l) => s + (l.price || 0), 0), total = toCents($('rTotal').value);
        const units = review.lines.reduce((s, l) => s + (Number.isInteger(l.qty) ? l.qty : 1), 0);

        $('rSum').textContent = 'Lines add up to ' + money(sum) + (isNaN(total) ? '' : total === sum ? ' ✓ matches the total' : ' · ' + money(Math.abs(total - sum)) + (total > sum ? ' missing' : ' too much') + ' against the total') +
            (review.units ? ' · ' + units + ' units' + (units === review.units ? ' ✓' : ', the receipt says ' + review.units + (units < review.units ? ' (a quantity may be missing)' : '')) : '');
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
        const unfinished = review.lines.findIndex(l => (l.code || l.name) && !(l.name && l.price > 0));
        const err = !db ? 'Supabase isn’t set up, so this can’t be saved.' : !signedIn ? 'Sign in first.' : unfinished >= 0 ? 'Line ' + (unfinished + 1) + ' needs a name and an amount, or remove it.' : !lines.length ? 'Nothing to save: every line needs a name and an amount.' : '';

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
        qr = null;
        renderQr();
        renderData();
    };

    /* MARK: Prices */
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
        const hits = q ? all.filter(h => [label(d, h.key, h.name), (d.items[h.key] || {}).name || h.name, h.code].some(s => keyOf(s || '').includes(q))) : all;
        const tb = $('prices');

        tb.replaceChildren(el('tr', {}, [el('th', { textContent: 'Item' }), el('th', { className: 'num', textContent: 'Last' }), el('th', { className: 'num', textContent: 'Change' }), el('th', { className: 'num', textContent: 'Lowest' }), el('th', { className: 'num', textContent: 'Bought' })]));

        hits.forEach(h => {
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

        $('pNote').textContent = !rows[store] ? waiting() : !all.length ? 'No receipts for ' + store + ' yet.' : q && !hits.length ? 'Nothing matches.' : 'Prices are for one (per kg for weighed items).';
    }

    $('q').oninput = () => renderPrices(data());

    /* MARK: Saved receipts */
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
