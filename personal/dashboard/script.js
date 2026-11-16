/* MARK: Helpers */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* The to-do list syncs as dash-todo: [{ id, text, done }]. The exchange rate is site-wide (/assets/fx.js). */
/* On a device's first sync, items from both copies are kept (matched by id, server copy wins). */
Sync.use(['dash-todo'], {
    merge: { 'dash-todo': (local, remote) => remote.concat(local.filter(l => !remote.some(r => r.id === l.id))) }
});
Sync.on('dash-todo', drawTodos);

/* MARK: Header */
function header() {
    const h = new Date().getHours();

    $('#hello').textContent = h < 12 ? 'Good morning' : h < 19 ? 'Good afternoon' : 'Good evening';
    $('#date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/* MARK: Exchange rate */
/* The site-wide rate from /assets/fx.js (fetched at most every 12 hours, synced), USD-PEN converter */
function showFx(v) {
    const usd = $('#usd') ? $('#usd').value : 100;

    $('#fx').innerHTML = `
    <div class="fxtop"><div class="big">S/ ${v.rate.toFixed(3)}<small>per $1</small></div>
    <span class="note" style="margin:0">S/ 1 = $${(1 / v.rate).toFixed(4)}</span></div>
    <div class="conv">
      <label>USD<input id="usd" type="number" min="0" step="any" value="${esc(usd)}"></label>
      <label>PEN<input id="pen" type="number" min="0" step="any"></label>
    </div>
    <p class="note">${esc(FX.note(v))}</p>`;

    const u = $('#usd'), p = $('#pen');

    p.value = (u.value * v.rate).toFixed(2);
    u.oninput = () => p.value = (u.value * v.rate).toFixed(2);
    p.oninput = () => u.value = (p.value / v.rate).toFixed(2);
}

FX.on(showFx);

async function loadFx() {
    showFx(await FX.get());
}

/* MARK: To do */
const todos = () => Sync.get('dash-todo', []);

function saveTodos(list) {
    Sync.set('dash-todo', list);
    drawTodos();
}

function drawTodos() {
    const list = todos();

    $('#todos').innerHTML = list.length ? list.map(t => `
    <label class="t${t.done ? ' done' : ''}" data-id="${esc(t.id)}">
      <input type="checkbox"${t.done ? ' checked' : ''}>
      <span>${esc(t.text)}</span>
      <button type="button" class="del" aria-label="Delete ${esc(t.text)}">Delete</button>
    </label>`).join('') : '<p class="note">Nothing to do.</p>';
}

$('#todoForm').onsubmit = e => {
    e.preventDefault();

    const text = $('#todoText').value.trim();

    if (!text) return;

    saveTodos(todos().concat({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, done: false }));
    $('#todoText').value = '';
};

$('#todos').onchange = e => {
    const id = e.target.closest('[data-id]').dataset.id;

    saveTodos(todos().map(t => t.id === id ? { ...t, done: e.target.checked } : t));
};

$('#todos').onclick = e => {
    if (!e.target.classList.contains('del')) return;

    /* Inside the label, so stop the click from also toggling the checkbox */
    e.preventDefault();

    const id = e.target.closest('[data-id]').dataset.id;

    saveTodos(todos().filter(t => t.id !== id));
};

/* MARK: Settings */
const dlg = $('#dlg');

$('#open').onclick = () => dlg.showModal();
$('#close').onclick = () => dlg.close();
$('#refresh').onclick = () => loadAll();

function loadAll() {
    header();
    loadFx();
    drawTodos();
}
loadAll();
