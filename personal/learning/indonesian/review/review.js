/* Indonesian review session: learning cards due now, then today's reviews, then new cards. Recognise cards show the
   Indonesian; recall cards show the meaning and ask you to type the word. Scheduling and saving are in ../idn.js. */
(() => {
    const $ = id => document.getElementById(id), el = Idn.el;
    let learn = [], review = [], news = [], item = null, face = null, shownAt = 0, revealed = false, hint = 0;
    let families = {}, libLemma = new Map(), libRoot = new Map();
    const stats = { n: 0, fresh: 0, again: 0, start: Date.now() };

    const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\- ]/g, ' ').replace(/\s+/g, ' ').trim();
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    function counts() {
        $('counts').textContent = learn.length + ' learning · ' + review.length + ' due · ' + news.length + ' new';
    }

    /* Learning cards whose few minutes are up come first; if only learning cards are left, take them a little early */
    function pick() {
        learn.sort((a, b) => Date.parse(a.s.due) - Date.parse(b.s.due));

        if (learn.length && Date.parse(learn[0].s.due) <= Date.now()) return learn.shift();

        return review.shift() || news.shift() || learn.shift() || null;
    }

    function sayButton(text) {
        const b = el('button', { className: 'say', textContent: '🔊', title: 'Listen' });

        b.setAttribute('aria-label', 'Listen to ' + text);
        b.onclick = e => {
            e.stopPropagation();
            Idn.speak(text);
        };

        return b;
    }

    /* The card's word highlighted in an example sentence */
    function marked(text, word) {
        const p = el('span', { className: 'id' });

        if (!word) return p.append(text), p;

        text.split(new RegExp('(' + esc(word) + ')', 'ig')).forEach((part, i) => p.append(i % 2 ? el('mark', { textContent: part }) : part));

        return p;
    }

    /* ---------- front ---------- */
    function show() {
        item = pick();
        counts();

        if (!item) return finish();

        face = Idn.face(item.card, item.deck);
        revealed = false;
        hint = 0;
        $('back').hidden = true;
        $('rate').hidden = true;
        $('show').hidden = false;
        $('tools2').hidden = false;
        $('rate').querySelectorAll('button').forEach(b => b.classList.remove('hint'));

        const chip = el('span', { className: 'reg ' + face.reg, textContent: face.reg });
        const tag = el('span', { className: 'sm', textContent: item.isNew ? 'New word' + (face.pos ? ' · #' + face.pos : '') : item.dir === 'recall' ? 'Type it in Indonesian' : '' });

        if (item.dir === 'recall') {
            const inp = el('input', { id: 'typed', autocomplete: 'off', spellcheck: false, placeholder: 'in Indonesian…' });

            inp.setAttribute('autocapitalize', 'off');
            inp.setAttribute('aria-label', 'The Indonesian word');
            $('front').replaceChildren(tag, el('div', { className: 'meaning', textContent: face.en }), chip, inp);
            inp.focus();
        } else {
            $('front').replaceChildren(tag, el('div', { className: 'word', textContent: face.w }), el('div', {}, [chip, ' ', sayButton(face.w)]));

            if (Idn.settings.autoplay) Idn.speak(face.w);

            $('show').focus();
        }

        shownAt = Date.now();
    }

    /* ---------- back ---------- */
    function reveal() {
        if (revealed || !item) return;

        revealed = true;

        if (item.dir === 'recall') {
            const typed = norm($('typed').value), ok = [face.w, face.std, ...face.also].filter(Boolean).map(norm).includes(typed);

            hint = ok ? 3 : 1;
            $('typed').disabled = true;
            $('front').append(el('div', { className: 'verdict ' + (ok ? 'pos' : 'neg'), textContent: ok ? '✓ Correct' : typed ? '✗ Not quite' : 'Not answered' }));
        }

        const back = [];

        if (item.dir === 'recall') back.push(el('div', { className: 'word', style: 'text-align:center' }, [face.w, ' ', sayButton(face.w)]));
        else back.push(el('div', { className: 'meaning', textContent: face.en }));

        const facts = [];

        if (face.std) facts.push(el('span', {}, ['standard: ', el('b', { textContent: face.std })]));

        if (face.also.length) facts.push(el('span', {}, ['also written: ', el('b', { textContent: face.also.join(', ') })]));

        if (face.root && face.root !== face.w) facts.push(el('span', {}, ['root: ', el('b', { textContent: face.root })]));

        if (face.pr) facts.push(el('span', {}, ['say: ', el('b', { textContent: face.pr }), ' (ê = the "uh" sound)']));

        if (facts.length) back.push(el('div', { className: 'facts' }, facts));

        if (face.note) back.push(el('p', { className: 'sm', style: 'text-align:center;margin:0', textContent: face.note }));

        face.ex.slice(0, 2).forEach(([id, en]) => back.push(el('div', { className: 'ex' }, [el('div', {}, [marked(id, face.w), ' ', sayButton(id)]), el('span', { className: 'en', textContent: en })])));

        /* From your PDFs: their example for this word, and derived forms built on it */
        const extra = el('div', { className: 'extra' });
        const mine = (libLemma.get(face.lemma) || []).filter(r => r.example);
        const derived = (libRoot.get(face.root || face.lemma) || []).filter(r => r.indonesian !== face.w).slice(0, 8);
        const fam = (families[face.root || face.lemma] || []).filter(w => w !== face.w && !derived.some(r => r.indonesian === w)).slice(0, 10);

        if (mine.length) {
            extra.append(el('h3', { textContent: 'From your PDFs' }));
            mine.slice(0, 1).forEach(r => extra.append(el('div', { className: 'ex' }, [el('div', {}, [marked(r.example, face.w)]), el('span', { className: 'en', textContent: r.example_en || '' })])));
        }

        if (derived.length) {
            extra.append(el('h3', { textContent: 'Built on ' + (face.root || face.lemma) + ' (your PDFs)' }));
            extra.append(el('div', { className: 'family' }, derived.map(r => el('span', {}, [r.indonesian, ' ', el('i', { textContent: r.english })]))));
        }

        if (fam.length) {
            extra.append(el('h3', { textContent: 'Same root' }));
            extra.append(el('div', { className: 'family' }, fam.map(w => el('span', { textContent: w }))));
        }

        if (extra.childNodes.length) back.push(extra);

        $('back').replaceChildren(...back);
        $('back').hidden = false;
        $('show').hidden = true;

        const p = Idn.preview(item);

        $('rate').querySelectorAll('button').forEach(b => {
            b.querySelector('span').textContent = p[b.dataset.g];
            b.classList.toggle('hint', Number(b.dataset.g) === hint);
        });

        $('rate').hidden = false;
    }

    function answer(g) {
        if (!revealed || !item) return;

        const s = Idn.answer(item, g, Date.now() - shownAt);

        stats.n++;

        if (item.isNew) stats.fresh++;

        if (g === 1) stats.again++;

        /* still learning: it comes back in a few minutes */
        if (s.state === 1 || s.state === 3) learn.push({ card: item.card, dir: item.dir, s });

        show();
    }

    function finish() {
        const mins = Math.round((Date.now() - stats.start) / 6e4);

        $('front').replaceChildren(el('div', { className: 'done' }, [
            el('div', { className: 'word', textContent: 'Selesai! ✓' }),
            el('p', { className: 'sm', textContent: stats.n ? stats.n + ' reviews (' + stats.fresh + ' new words, ' + stats.again + ' again) in about ' + Math.max(1, mins) + ' min.' : 'Nothing due right now.' }),
            el('a', { className: 'go', href: '../', textContent: 'Back to today' })
        ]));
        $('back').hidden = true;
        $('show').hidden = true;
        $('rate').hidden = true;
        $('tools2').hidden = true;
    }

    /* ---------- controls ---------- */
    $('show').onclick = reveal;
    $('rate').querySelectorAll('button').forEach(b => b.onclick = () => answer(Number(b.dataset.g)));

    $('suspend').onclick = () => {
        if (!item) return;

        if (item.card) Idn.patchCard(item.card, { suspended: true });
        else Idn.addCards([{ deck_id: item.deck.id, suspended: true, active: false }]);

        const id = item.card && item.card.id;

        if (id) [learn, review, news] = [learn, review, news].map(list => list.filter(x => !x.card || x.card.id !== id));

        $('msg').textContent = 'Suspended “' + face.w + '”.';
        show();
    };

    addEventListener('keydown', e => {
        const typing = e.target.id === 'typed';

        if (typing && e.key === 'Enter' && !revealed) {
            e.preventDefault();

            return reveal();
        }

        if (typing && !revealed) return;

        if (e.key === ' ' || (e.key === 'Enter' && !revealed)) {
            e.preventDefault();

            if (!revealed) reveal();
        } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
            answer(Number(e.key));
        } else if (revealed && e.key === 'Enter' && hint) {
            answer(hint);
        }
    });

    /* ---------- start ---------- */
    Idn.start('review').then(async () => {
        const q = Idn.queue();

        learn = q.learn;
        review = q.review;
        news = q.news;

        if (Idn.pending) $('msg').textContent = Idn.pending + ' changes waiting to upload (offline?)';

        show();

        /* extras load after the first card is up */
        families = await Idn.data('families.json').catch(() => ({}));

        (await Idn.library()).forEach(r => {
            if (r.lemma) libLemma.set(r.lemma, (libLemma.get(r.lemma) || []).concat(r));

            if (r.kind === 'derived' && r.root) libRoot.set(r.root, (libRoot.get(r.root) || []).concat(r));
        });
    }, e => $('counts').textContent = 'Couldn’t load: ' + e.message);
})();
