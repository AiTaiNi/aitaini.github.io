/* Import reminders: which BCP statements should be out by now but haven't been imported (_docs/expenses.md).
   Used by the hub, Today and Expenses. Needs sync.js (for Sync.db) and a signed-in user.

     StatementsDue.check()  → Promise of [{ account, label, month: 'YYYY-MM', ready: 'YYYY-MM-DD' }], oldest first
     StatementsDue.text(list) → one line for a page, or '' when nothing is due

   A statement is expected GRACE days after its cycle closes: the card's closing day a month after the last
   imported statement's end, or the end of the next calendar month for the debit account. */
(() => {
    const GRACE = 3;
    const LABEL = { credit: 'Credit card', debit: 'Debit account' };

    const pad = n => String(n).padStart(2, '0');
    const key = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();   /* m is 0-based */

    /* The same day a month later (clamped: 31 Jan → 28 Feb), and month ends stay month ends (30 Apr → 31 May) */
    function nextClose(end) {
        const [y, m, d] = end.split('-').map(Number), n = new Date(y, m, 1);
        const day = d === lastDay(y, m - 1) ? lastDay(n.getFullYear(), n.getMonth()) : Math.min(d, lastDay(n.getFullYear(), n.getMonth()));

        return new Date(n.getFullYear(), n.getMonth(), day);
    }

    async function check() {
        const db = window.Sync && Sync.db;

        if (!db) return [];   /* signed out, the database refuses and this returns nothing */

        const { data, error } = await db.from('statements').select('account,period,period_end');

        if (error || !data.length) return [];

        const latest = {};

        data.forEach(s => {
            if (!latest[s.account] || s.period > latest[s.account].period) latest[s.account] = s;
        });

        const today = key(new Date());

        return Object.values(latest).map(s => {
            const [y, m] = s.period.split('-').map(Number);
            const end = s.period_end || y + '-' + pad(m) + '-' + pad(lastDay(y, m - 1));
            const close = nextClose(end), ready = new Date(close.getFullYear(), close.getMonth(), close.getDate() + GRACE);

            return { account: s.account, label: LABEL[s.account] || s.account, month: close.getFullYear() + '-' + pad(close.getMonth() + 1), ready: key(ready) };
        }).filter(x => x.ready <= today).sort((a, b) => a.ready.localeCompare(b.ready));
    }

    function text(list) {
        if (!list.length) return '';

        const month = p => new Date(p + '-01T00:00').toLocaleDateString('en-US', { month: 'long' });

        return 'To import: ' + list.map(x => x.label.toLowerCase() + ' ' + month(x.month)).join(', ') + ' statement' + (list.length > 1 ? 's' : '');
    }

    window.StatementsDue = { check, text };
})();
