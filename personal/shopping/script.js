/* Shopping list. Two synced keys (see _docs/private-pages.md):
     shopping-list   the current list: [{ id, name, store, amount, added }]; amount is free text ("4", "2kg")
     shopping-items  what's been bought before: { lowercased name: { name, store, n, last } }, the suggestions
   Only ✓ (bought) adds an item to shopping-items or updates its store; × just removes it from the list. */
(() => {
    const LIST = 'shopping-list', KNOWN = 'shopping-items';
    const STORES = ['Market', 'Corner store', 'Mass', 'Plaza Vea'];

    /* First sync on a device that already has data: keep both copies. List items by id; remembered items by name,
       the most recently bought copy winning. */
    const merge = {
        [LIST]: (local, remote) => {
            const ids = new Set(remote.map(i => i.id));

            return remote.concat(local.filter(i => !ids.has(i.id)));
        },
        [KNOWN]: (local, remote) => {
            const out = Object.assign({}, local);

            Object.entries(remote).forEach(([k, v]) => {
                if (!out[k] || (v.last || '') >= (out[k].last || '')) out[k] = Object.assign({}, v, { n: Math.max(v.n || 0, (out[k] || {}).n || 0) });
            });

            return out;
        }
    };

    Sync.use([LIST, KNOWN], { merge });

    let list = Sync.get(LIST, []), known = Sync.get(KNOWN, {});

    Sync.on(LIST, v => {
        list = Array.isArray(v) ? v : [];
        render();
    });

    Sync.on(KNOWN, v => {
        known = v && typeof v === 'object' ? v : {};
        renderKnown();
    });

    const $ = id => document.getElementById(id);
    const keyOf = name => name.trim().toLowerCase().replace(/\s+/g, ' ');
    const today = () => new Date().toLocaleDateString('en-CA');

    function el(tag, props, kids) {
        const e = document.createElement(tag);

        Object.assign(e, props || {});
        (kids || []).forEach(k => e.append(k));

        return e;
    }

    function storeSelect(value, onchange) {
        const s = el('select', {}, STORES.map(n => el('option', { value: n, textContent: n })));

        s.value = STORES.includes(value) ? value : STORES[0];
        s.onchange = () => onchange(s.value);

        return s;
    }

    function saveList() {
        Sync.set(LIST, list);
        render();
    }

    /* ---------- the list, one block per store ---------- */
    function render() {
        const box = $('lists');

        box.innerHTML = '';
        $('empty').hidden = list.length > 0;

        STORES.forEach(store => {
            const items = list.filter(i => (STORES.includes(i.store) ? i.store : STORES[0]) === store);

            if (!items.length) return;

            const ul = el('ul', { className: 'items' });

            items.forEach(it => {
                const amount = el('input', { value: it.amount || '', placeholder: 'Amount', maxLength: 20 });

                amount.setAttribute('aria-label', 'Amount of ' + it.name);

                /* saved when you leave the field, so typing isn't interrupted */
                amount.onchange = () => {
                    it.amount = amount.value.trim();
                    saveList();
                };

                const store = storeSelect(it.store, v => {
                    it.store = v;
                    saveList();
                });

                store.setAttribute('aria-label', 'Store for ' + it.name);

                const ok = el('button', { className: 'ok', textContent: '✓', title: 'Bought' });
                const rm = el('button', { className: 'rm', textContent: '×', title: 'Remove without buying' });

                ok.setAttribute('aria-label', 'Bought ' + it.name);
                rm.setAttribute('aria-label', 'Remove ' + it.name);

                ok.onclick = () => {
                    const k = keyOf(it.name), prev = known[k] || {};

                    known = Object.assign({}, known, { [k]: { name: it.name.trim(), store: it.store, n: (prev.n || 0) + 1, last: today() } });
                    Sync.set(KNOWN, known);
                    list = list.filter(x => x.id !== it.id);
                    saveList();
                    renderKnown();
                };

                rm.onclick = () => {
                    list = list.filter(x => x.id !== it.id);
                    saveList();
                };

                ul.append(el('li', {}, [el('span', { className: 'nm', textContent: it.name }), amount, store, ok, rm]));
            });

            box.append(el('div', { className: 'store' }, [el('h2', {}, [store, el('span', { textContent: items.length + (items.length > 1 ? ' items' : ' item') })]), ul]));
        });
    }

    /* ---------- suggestions and remembered items ---------- */
    const sorted = () => Object.values(known).sort((a, b) => (b.n || 0) - (a.n || 0) || a.name.localeCompare(b.name));

    function renderKnown() {
        const all = sorted();

        $('known').replaceChildren(...all.map(k => el('option', { value: k.name })));
        $('knownN').textContent = all.length;

        $('knownList').replaceChildren(...all.map(k => {
            const rm = el('button', { textContent: '×', title: 'Forget this item' });

            rm.setAttribute('aria-label', 'Forget ' + k.name);

            rm.onclick = () => {
                known = Object.assign({}, known);
                delete known[keyOf(k.name)];
                Sync.set(KNOWN, known);
                renderKnown();
            };

            return el('li', {}, [el('span', { textContent: k.name }), el('em', { textContent: k.store + ' · ' + k.n + '×' }), rm]);
        }));
    }

    /* ---------- adding ---------- */
    const addStore = storeSelect(STORES[0], () => {});

    addStore.id = 'store';
    addStore.setAttribute('aria-label', 'Store');
    $('store').replaceWith(addStore);

    /* A remembered item picks its last store by itself (you can still change it before adding) */
    $('name').addEventListener('input', () => {
        const k = known[keyOf($('name').value)];

        if (k) addStore.value = k.store;
    });

    $('addForm').onsubmit = e => {
        e.preventDefault();

        const name = $('name').value.trim().replace(/\s+/g, ' ');

        if (!name) return;

        const amount = $('amount').value.trim(), existing = list.find(i => keyOf(i.name) === keyOf(name));

        /* already on the list: update it rather than adding it twice */
        if (existing) {
            existing.store = addStore.value;

            if (amount) existing.amount = amount;
        } else {
            list.push({ id: 'i' + Date.now(), name, store: addStore.value, amount, added: today() });
        }

        $('name').value = '';
        $('amount').value = '';
        $('name').focus();
        saveList();
    };

    render();
    renderKnown();
})();
