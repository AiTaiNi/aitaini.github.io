/* Private page template: a synced list. Replace KEY and the example feature with the page's own.
   Sync API (from /assets/sync.js): use, get, set, on. See _docs/private-pages.md. */
(() => {
    const KEY = 'template-items';   /* TODO: unique per page, lowercase-with-dashes. Same key on two pages = shared data. */

    /* First sync on a device that already has data: keep items from both copies (matched by id) */
    const merge = {
        [KEY]: (local, remote) => {
            const ids = new Set(remote.map(i => i.id));

            return remote.concat(local.filter(i => !ids.has(i.id)));
        }
    };

    Sync.use([KEY], { merge });

    let items = Sync.get(KEY, []);

    /* A newer copy arrived from another device */
    Sync.on(KEY, v => {
        items = Array.isArray(v) ? v : [];
        render();
    });

    function save() {
        Sync.set(KEY, items);
        render();
    }

    const $ = id => document.getElementById(id);

    function render() {
        const ul = $('list');
        ul.innerHTML = '';
        $('empty').hidden = items.length > 0;

        items.forEach(it => {
            const li = document.createElement('li');
            li.className = it.done ? 'done' : '';

            const lab = document.createElement('label');

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!it.done;

            cb.onchange = () => {
                it.done = cb.checked;
                save();
            };

            const sp = document.createElement('span');
            sp.textContent = it.name;   /* textContent, never innerHTML, for anything typed or synced */

            const rm = document.createElement('button');
            rm.type = 'button';
            rm.textContent = 'Remove';
            rm.setAttribute('aria-label', 'Remove ' + it.name);

            rm.onclick = () => {
                items = items.filter(x => x.id !== it.id);
                save();
            };

            lab.append(cb, sp);
            li.append(lab, rm);
            ul.appendChild(li);
        });
    }

    $('addForm').onsubmit = e => {
        e.preventDefault();

        const inp = $('newItem'), name = inp.value.trim();

        if (!name) return;

        items.push({ id: 'i' + Date.now(), name, done: false });
        inp.value = '';
        save();
    };

    render();
})();
