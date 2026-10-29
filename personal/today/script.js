/* Today page: one general, synced notepad (not per day; it stays until edited). The checklist and countdowns next to
   it come from /assets/tasks.js (same data as the calendar and dashboard). */
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
        state.textContent = 'Saving…';
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
})();
