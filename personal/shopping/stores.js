/* The store list, shared by Shopping (which edits it in its Settings) and Receipts. One synced key:
     shopping-stores   ['Market', 'Corner store', …] in the order they're shown
   Load after /assets/sync.js. Stores.list() reads it, Stores.save(list) saves it, Stores.onChange(fn) runs fn(list)
   when another device or tab changes it. Stores.slug(name) is the name as a key part ('Plaza Vea' → 'plaza-vea'). */
(() => {
    const KEY = 'shopping-stores';
    const DEFAULTS = ['Market', 'Corner store', 'Mass', 'Plaza Vea', 'Dollar City'];

    /* First sync on a device that already has a list: keep the server's order, add any store only this device had */
    Sync.use([KEY], { merge: { [KEY]: (local, remote) => remote.concat(local.filter(s => !remote.includes(s))) } });

    const clean = v => Array.isArray(v) && v.length ? v : DEFAULTS.slice();
    let list = clean(Sync.get(KEY));
    const fns = [];

    Sync.on(KEY, v => {
        list = clean(v);
        fns.forEach(fn => fn(list));
    });

    window.Stores = {
        list: () => list,
        save(v) {
            list = clean(v);
            Sync.set(KEY, list);
            fns.forEach(fn => fn(list));
        },
        onChange: fn => fns.push(fn),
        slug: name => name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    };
})();
