/* The US$ -> S/ exchange rate, the same on every page (dashboard, expenses) and device. Load after sync.js.
   Whichever page needs it first fetches it, at most once every 12 hours, and stores it in the synced key `fx-rate`:
   { rate, at (when it was fetched), date (the rate's own date), source }. Everyone else uses that copy, so the free
   rate services get a request or two a day.

     FX.get()    promise of { rate, at, date, source, stale }; stale = the fetch failed and this is the last known
                 rate (or a rough default if there has never been one)
     FX.on(fn)   fn(value) when a newer rate arrives from another page or device
     FX.note(v)  a short line for the page: "rate of 2026-10-30, open.er-api.com" */
window.FX = (() => {
    const KEY = 'fx-rate', MAX_AGE = 12 * 3600e3, FALLBACK = 3.40;

    Sync.use([KEY]);

    const fresh = v => v && v.rate > 0 && v.at && Date.now() - Date.parse(v.at) < MAX_AGE;

    /* Two free sources, no key needed; the second is a backup */
    async function fetchRate() {
        try {
            const j = await (await fetch('https://open.er-api.com/v6/latest/USD')).json();

            if (j.rates && j.rates.PEN > 0) return { rate: j.rates.PEN, date: new Date(j.time_last_update_utc).toISOString().slice(0, 10), source: 'open.er-api.com' };
        } catch {
        }

        const j = await (await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json')).json();

        if (j.usd && j.usd.pen > 0) return { rate: j.usd.pen, date: j.date, source: 'fawazahmed0 currency-api' };

        throw new Error('no rate');
    }

    let pending = null;

    function get() {
        return pending = pending || (async () => {
            let v = Sync.get(KEY);

            if (fresh(v)) return v;

            /* Another device may have fetched it recently: wait briefly for the synced copy before fetching */
            await Promise.race([Sync.ready(), new Promise(r => setTimeout(r, 4000))]);
            v = Sync.get(KEY);

            if (fresh(v)) return v;

            try {
                const got = Object.assign(await fetchRate(), { at: new Date().toISOString() });

                Sync.set(KEY, got);

                return got;
            } catch {
                return v && v.rate > 0 ? Object.assign({}, v, { stale: true }) : { rate: FALLBACK, at: null, date: null, source: 'rough default', stale: true };
            }
        })().finally(() => setTimeout(() => pending = null, 0));
    }

    function note(v) {
        if (!v.at) return 'Approximate rate: no live rate could be fetched yet.';

        return 'Rate of ' + (v.date || v.at.slice(0, 10)) + ', ' + v.source + (v.stale ? ' (couldn’t update, last known rate)' : '');
    }

    return { get, note, on: fn => Sync.on(KEY, v => v && v.rate > 0 && fn(v)) };
})();
