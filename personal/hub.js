/* Personal hub: greeting plus a live line on some tiles. Task data comes from /assets/tasks.js (window.Tasks). */
(() => {
    const $ = id => document.getElementById(id);
    const h = new Date().getHours();

    $('hello').textContent = h < 12 ? 'Good morning' : h < 19 ? 'Good afternoon' : 'Good evening';
    $('date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    function renderTasks() {
        const t = Tasks.today(), cds = Tasks.countdowns();

        $('liveToday').textContent = t.total ? t.done + ' of ' + t.total + ' tasks done' + (t.done === t.total ? ' ✓' : '') : '';

        $('liveCal').textContent = cds.length
            ? 'Next: ' + (cds[0].icon ? cds[0].icon + ' ' : '') + cds[0].name + (cds[0].days === 0 ? ', today' : cds[0].days === 1 ? ', tomorrow' : ' in ' + cds[0].days + ' days') + (cds.length > 1 ? ' (+' + (cds.length - 1) + ' more)' : '')
            : '';
    }

    Tasks.onChange(renderTasks);
    renderTasks();

    /* Current cycle's total, saved by the Expenses page each time it's opened */
    Sync.use(['expense-summary']);

    function renderExp(s) {
        $('liveExp').textContent = s && s.m
            ? new Date(s.m + '-01T00:00').toLocaleDateString(undefined, { month: 'long' }) + ' ≈ S/ ' + (s.pen / 100).toLocaleString('en-US', { maximumFractionDigits: 0 }) + (s.est ? ', ' + s.est + ' estimated' : '')
            : '';
    }

    Sync.on('expense-summary', renderExp);
    renderExp(Sync.get('expense-summary'));

    /* ---------- install as an app ---------- */
    /* The service worker makes the pages open offline from the home screen; its scope is /personal/ */
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/personal/sw.js', { scope: '/personal/' }).catch(e => console.warn('Service worker:', e));

    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    let installEvt = null;

    /* Chrome, Edge and Android offer their own install prompt; keep it for the button */
    addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        installEvt = e;
        $('install').hidden = false;
        $('installHelp').hidden = true;
    });

    $('install').onclick = async () => {
        if (!installEvt) return;

        installEvt.prompt();
        await installEvt.userChoice;
        installEvt = null;
        $('install').hidden = true;
    };

    addEventListener('appinstalled', () => $('install').hidden = true);

    /* Safari has no prompt: explain the menu step instead */
    if (!standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
        $('installHelp').textContent = 'To install: tap Share, then Add to Home Screen.';
        $('installHelp').hidden = false;
    }

    /* Latest saved statement month, or which statements are waiting to be imported, once signed in */
    const db = Sync.db;

    if (!db) return;

    let done = false;

    db.auth.onAuthStateChange((_, session) => {
        if (!session || done) return;

        done = true;

        setTimeout(async () => {
            const due = await StatementsDue.check();

            if (due.length) {
                $('liveStmt').textContent = StatementsDue.text(due);
                $('liveStmt').classList.add('due');

                return;
            }

            const { data, error } = await db.from('statements').select('account,period').order('period', { ascending: false }).limit(1);

            if (!error && data.length) $('liveStmt').textContent = 'Latest: ' + data[0].period.slice(0, 7);
        }, 0);
    });
})();
