/* Today page: one general, synced notepad (not per day; it stays until edited). The checklist and countdowns next to it come from /assets/tasks.js (same data as the calendar and dashboard). */
(() => {
    const KEY = 'notepad';
    const box = document.getElementById('notes'), state = document.getElementById('notesState');

    Sync.use([KEY]);
    box.value = Sync.get(KEY, '');

    let timer = null;

    function flush() {
        clearTimeout(timer);
        timer = null;
        Sync.set(KEY, box.value);
        state.textContent = 'Saved';
    }

    /* Spaces out saves while typing; Sync uploads shortly after each save */
    box.addEventListener('input', () => {
        state.textContent = 'Saving...';
        clearTimeout(timer);
        timer = setTimeout(flush, 400);
    });

    box.addEventListener('blur', () => {
        if (timer) flush();
    });

    /* A newer copy from another device. While typing here, this device's text is the newer one and wins. */
    Sync.on(KEY, v => {
        if (typeof v !== 'string' || v === box.value || timer || document.activeElement === box) return;

        box.value = v;
    });

    /* Statements that should be out by now but aren't imported (/assets/statements-due.js) */
    const db = Sync.db;
    let checked = false;

    if (db) db.auth.onAuthStateChange((_, session) => {
        if (!session || checked) return;

        checked = true;

        setTimeout(async () => {
            const t = StatementsDue.text(await StatementsDue.check()), p = document.getElementById('stmtDue');

            p.querySelector('span').textContent = t;
            p.hidden = !t;
        }, 0);
    });

    /* The site-wide rate from /assets/fx.js (fetched at most every 12 hours, synced), with a USD <-> PEN converter; the same widget as on the dashboard */
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function showFx(v) {
        const old = document.getElementById('usd'), usd = old ? old.value : 100;

        document.getElementById('fx').innerHTML = `
        <div class="fxtop"><div class="big">S/ ${v.rate.toFixed(3)}<small>per $1</small></div>
        <span class="note" style="margin:0">S/ 1 = $${(1 / v.rate).toFixed(4)}</span></div>
        <div class="conv">
          <label>USD<input id="usd" type="number" min="0" step="any" value="${esc(usd)}"></label>
          <label>PEN<input id="pen" type="number" min="0" step="any"></label>
        </div>
        <p class="note">${esc(FX.note(v))}</p>`;

        const u = document.getElementById('usd'), p = document.getElementById('pen');

        p.value = (u.value * v.rate).toFixed(2);
        u.oninput = () => p.value = (u.value * v.rate).toFixed(2);
        p.oninput = () => u.value = (p.value / v.rate).toFixed(2);
    }

    FX.on(showFx);
    FX.get().then(showFx);
})();
