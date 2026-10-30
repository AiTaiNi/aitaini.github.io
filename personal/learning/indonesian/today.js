/* Indonesian Today page: today's numbers, where you are in the plan, topic sets from your PDFs, immersion log and
   settings. Shared logic (cards, scheduling, time, summary) is in idn.js. */
(() => {
    const $ = id => document.getElementById(id), el = Idn.el;
    let plan = null;

    const hours = m => (m / 60).toFixed(1).replace(/\.0$/, '') + ' h';

    function stat(value, label) {
        return el('div', { className: 'stat' }, [el('b', { textContent: value }), el('span', { textContent: label })]);
    }

    function renderStats(t) {
        const p = plan ? Idn.plan(plan) : null, goal = p ? p.day.minutes : 60;

        $('stats').replaceChildren(
            stat(String(t.due), t.due === 1 ? 'review due' : 'reviews due'),
            stat(t.newToday + ' / ' + t.newLimit, 'new cards today'),
            stat(Math.floor(t.minutes) + ' / ' + goal, 'minutes today'),
            stat(hours(t.week) + ' / 5 h', 'this week'),
            stat(String(t.streak), t.streak === 1 ? 'day streak' : 'day streak'),
            stat(String(t.known), 'words learned')
        );

        const work = t.due + t.newLeft;

        $('go').textContent = work ? 'Start review (' + work + ')' : 'All done for today ✓';
        $('go').classList.toggle('quiet', !work);
    }

    function renderPlan() {
        const p = Idn.plan(plan), m = p.month, t = Idn.today();

        $('focus').textContent = 'Today (' + ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][p.wd] + '): ' + p.day.label + '. Week ' + p.week + ' of the plan.';
        $('mTitle').textContent = 'Month ' + m.n + ': ' + m.phase;

        const fill = el('i');

        fill.style.width = Math.min(100, t.known / m.words * 100) + '%';

        $('month').replaceChildren(
            el('h3', { textContent: 'Grammar and topics' }),
            el('ul', { className: 'plain' }, m.focus.map(f => el('li', { textContent: f }))),
            el('div', { className: 'words' }, [
                el('span', { className: 'sm', textContent: t.known + ' of ' + m.words + ' words by the end of the month' }),
                el('div', { className: 'bar' }, [fill])
            ]),
            el('h3', { textContent: 'Watch and read' }), el('p', { className: 'sm', textContent: m.immersion }),
            el('h3', { textContent: 'Write' }), el('p', { className: 'sm', textContent: m.writing }),
            el('h3', { textContent: 'End-of-month check' }), el('p', { className: 'sm', textContent: m.checkpoint })
        );

        $('session').replaceChildren(...plan.session.map(s => el('li', {}, [el('b', { textContent: s.minutes + ' min · ' + s.block }), ' ', el('span', { className: 'sm', textContent: s.note })])));
    }

    /* Topic sets from the PDF library. Adding one makes its words your new cards (before the deck order); words that
       are in the deck are pulled forward as deck cards, the rest become your own cards. */
    async function renderLibrary() {
        const rows = await Idn.library(), t = $('lib');

        t.innerHTML = '';

        if (!rows.length) {
            $('libNote').textContent = 'Nothing yet. Put PDFs in tools/indonesian/pdfs/ and run tools/update-indonesian.bat; it uploads what it finds (see _docs/indonesian-data.md).';

            return;
        }

        const haveDeck = new Set([...Idn.cards.values()].map(c => c.deck_id).filter(Boolean));
        const haveOwn = new Set([...Idn.cards.values()].map(c => (c.indonesian || '').toLowerCase()).filter(Boolean));
        const derived = rows.filter(r => r.kind === 'derived' && r.status === 'in-deck').length;
        const topics = new Map();

        rows.filter(r => r.kind !== 'derived').forEach(r => {
            const k = r.topic || r.file;

            if (!topics.has(k)) topics.set(k, []);

            topics.get(k).push(r);
        });

        $('libNote').textContent = rows.length + ' entries from your PDFs. Examples and ' + derived + ' derived forms already show on the matching cards during review. ' +
            'Adding a set puts its words at the front of your new cards (still ' + Idn.newLimit() + ' a day).';

        t.append(el('tr', {}, ['Set', 'Words', 'In the deck', 'Already yours', ''].map((h, i) => el('th', { textContent: h, className: i && i < 4 ? 'num' : '' }))));

        [...topics.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([topic, list]) => {
            const mine = list.filter(r => (r.lemma && haveDeck.has(r.lemma)) || haveOwn.has(r.indonesian.toLowerCase()));
            const todo = list.filter(r => !mine.includes(r));
            const btn = el('button', { textContent: todo.length ? 'Add ' + todo.length : 'Added ✓', disabled: !todo.length });

            btn.onclick = () => {
                const seen = new Set();

                Idn.addCards(todo.filter(r => {
                    const k = r.lemma && r.status === 'in-deck' ? 'd:' + r.lemma : 'o:' + r.indonesian.toLowerCase();

                    return !seen.has(k) && seen.add(k);
                }).map(r => r.lemma && r.status === 'in-deck'
                    ? { deck_id: r.lemma, active: true, tags: [topic] }
                    : { indonesian: r.indonesian, english: r.english, root: r.root || null, example: r.example || null, example_en: r.example_en || null, register: 'neutral', tags: [topic] }));

                renderLibrary();
            };

            t.append(el('tr', {}, [
                el('td', { className: 'topic', textContent: topic }),
                el('td', { className: 'num', textContent: list.length }),
                el('td', { className: 'num', textContent: list.filter(r => r.status === 'in-deck').length }),
                el('td', { className: 'num', textContent: mine.length }),
                el('td', {}, [btn])
            ]));
        });
    }

    /* ---------- immersion ---------- */
    $('imm').onsubmit = e => {
        e.preventDefault();

        const m = parseInt($('immMin').value, 10);

        if (!(m > 0)) return;

        Idn.logSession({ kind: 'immersion', activity: $('immAct').value, minutes: m, note: $('immNote').value.trim() || null });
        $('immMin').value = '';
        $('immNote').value = '';
        $('immMsg').textContent = 'Logged ' + m + ' min.';
    };

    /* ---------- settings ---------- */
    const S = { sStart: 'start', sNewWd: 'newWeekday', sNewWe: 'newWeekend', sRet: 'retention', sActive: 'activeUpTo', sMax: 'maxReviews', sVoice: 'voice' };

    function fillSettings() {
        const s = Idn.settings;

        Object.entries(S).forEach(([id, k]) => $(id).value = s[k]);
        $('sAuto').checked = !!s.autoplay;
        $('sTasks').checked = !!s.tasks;
    }

    function fillVoices() {
        const vs = Idn.voices(), sel = $('sVoice');

        sel.replaceChildren(el('option', { value: '', textContent: vs.length ? 'First Indonesian voice' : 'No Indonesian voice on this device' }), ...vs.map(v => el('option', { value: v.voiceURI, textContent: v.name + ' (' + v.lang + ')' })));
        sel.value = Idn.settings.voice;
    }

    Object.entries(S).forEach(([id, k]) => $(id).addEventListener('change', () => {
        const v = $(id).value, num = id !== 'sStart' && id !== 'sVoice';

        Idn.setSettings({ [k]: num ? Number(v) : v });
        refresh();
    }));

    $('sAuto').onchange = () => Idn.setSettings({ autoplay: $('sAuto').checked });

    $('sTasks').onchange = () => {
        Idn.setSettings({ tasks: $('sTasks').checked });
        refresh();
    };

    if (window.speechSynthesis) speechSynthesis.onvoiceschanged = fillVoices;

    /* ---------- start ---------- */
    function refresh() {
        renderStats(Idn.today());

        if (plan) renderPlan();
    }

    Idn.onChange(renderStats);

    Idn.start('other').then(async () => {
        plan = await Idn.data('plan.json');
        $('msg').textContent = Idn.pending ? Idn.pending + ' changes waiting to upload (offline?)' : '';
        fillSettings();
        fillVoices();
        refresh();
        renderLibrary();
    }, e => $('msg').textContent = 'Couldn’t load: ' + e.message + '. Have the tables in _docs/indonesian-database.md been created?');
})();
