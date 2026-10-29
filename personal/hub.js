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

    /* Latest saved statement month, once signed in */
    const db = Sync.db;

    if (!db) return;

    let done = false;

    db.auth.onAuthStateChange((_, session) => {
        if (!session || done) return;

        done = true;

        setTimeout(async () => {
            const { data, error } = await db.from('statements').select('account,period').order('period', { ascending: false }).limit(1);

            if (!error && data.length) $('liveStmt').textContent = 'Latest: ' + data[0].period.slice(0, 7);
        }, 0);
    });
})();
