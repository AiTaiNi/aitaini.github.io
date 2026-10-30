/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);

const store = {
    get(k, d) {
        try {
            const v = localStorage.getItem(k);

            return v ? JSON.parse(v) : d;
        } catch {
            return d;
        }
    },
    set(k, v) {
        try {
            localStorage.setItem(k, JSON.stringify(v));
        } catch {
        }
    }
};

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
const DEFAULTS = { mal: 'AisareTai' };
const cfg = Object.assign({}, DEFAULTS, Sync.get('dash-cfg', {}));

/* Settings follow you across devices; dash-mal is a cache and stays local. The exchange rate is site-wide (/assets/fx.js). */
Sync.use(['dash-cfg']);
Sync.on('dash-cfg', v => {
    Object.assign(cfg, DEFAULTS, v);
    loadMal();
});
let malTab = 'anime', malData = null, malNote = '';

/* ---------- header ---------- */
function header() {
    const h = new Date().getHours();

    $('#hello').textContent = h < 12 ? 'Good morning' : h < 19 ? 'Good afternoon' : 'Good evening';
    $('#date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/* ---------- exchange rate ---------- */
/* The site-wide rate from /assets/fx.js (fetched at most every 12 hours, synced), with a USD <-> PEN converter */
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

/* ---------- MyAnimeList (stats scraped to JSON) ---------- */
const MAL = {
    anime: { keys: [['watching', 'Watching', '#2db039'], ['completed', 'Completed', '#2e51a2'], ['on_hold', 'On hold', '#f9d457'], ['dropped', 'Dropped', '#a12f31'], ['plan_to_watch', 'Plan to watch', '#9aa0a6']],
        top: [['total_entries', 'Entries'], ['episodes_watched', 'Episodes'], ['days_watched', 'Days watched']] },
    manga: { keys: [['reading', 'Reading', '#2db039'], ['completed', 'Completed', '#2e51a2'], ['on_hold', 'On hold', '#f9d457'], ['dropped', 'Dropped', '#a12f31'], ['plan_to_read', 'Plan to read', '#9aa0a6']],
        top: [['total_entries', 'Entries'], ['chapters_read', 'Chapters'], ['days_read', 'Days read']] }
};

function useMal(d, note) {
    malData = d;
    malNote = d.updated ? note + ' ' + new Date(d.updated).toLocaleDateString() + '.' : '';
    drawMal();
}

async function loadMal() {
    try {
        const r = await fetch('../../data/mal-stats.json', { cache: 'no-cache' });

        if (!r.ok) throw 0;

        const d = await r.json();

        store.set('dash-mal', d);
        useMal(d, 'Stats saved on');
    } catch {
        const d = store.get('dash-mal');

        if (d) {
            useMal(d, 'Stats loaded from file on');
        } else {
            $('#mal').innerHTML = `<p class="note">No stats yet. Run python tools/scrape-mal.py ${esc(cfg.mal)}, then press “Load stats file…” and choose data/mal-stats.json.</p>`;
        }
    }
}

$('#malLoad').onclick = () => $('#malFile').click();

$('#malFile').onchange = e => {
    const f = e.target.files && e.target.files[0];

    if (!f) return;

    f.text().then(t => {
        const d = JSON.parse(t);

        if (!d.profile || !d.stats) throw 0;

        store.set('dash-mal', d);
        useMal(d, 'Stats saved on');
    }).catch(() => {
        $('#mal').innerHTML = '<p class="err">That file doesn’t look like mal-stats.json.</p>';
    });

    e.target.value = '';
};

function drawMal() {
    if (!malData) return;

    const { profile, stats } = malData, d = stats[malTab], m = MAL[malTab];
    const img = profile.images && profile.images.jpg ? profile.images.jpg.image_url : '';
    const total = m.keys.reduce((a, [k]) => a + (d[k] || 0), 0) || 1;
    const mismatch = profile.username && cfg.mal && profile.username.toLowerCase() !== cfg.mal.toLowerCase();
    const hint = mismatch ? `<p class="note">These stats are for ${esc(profile.username)}. Run python tools/scrape-mal.py ${esc(cfg.mal)} to switch.</p>` : '';
    const stamp = malNote ? `<p class="note">${esc(malNote)}</p>` : '';

    $('#mal').innerHTML = `
    <div class="user">${img ? `<img src="${esc(img)}" alt="">` : ''}
      <div><a href="${esc(profile.url)}" target="_blank" rel="noopener">${esc(profile.username)}</a>
      <div class="note" style="margin:0">Mean score ${fmt(d.mean_score, 2)}</div></div></div>
    <div class="stats">${m.top.map(([k, l]) => `<div><b>${fmt(d[k], k.startsWith('days') ? 1 : 0)}</b><span>${l}</span></div>`).join('')}</div>
    <div class="bar" role="img" aria-label="Status breakdown">${m.keys.map(([k, , c]) => `<div style="width:${(d[k] || 0) / total * 100}%;background:${c}"></div>`).join('')}</div>
    <div class="legend">${m.keys.map(([k, l, c]) => `<span><i style="background:${c}"></i>${l} ${fmt(d[k] || 0)}</span>`).join('')}</div>` + hint + stamp;
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    malTab = b.dataset.t;
    document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-pressed', x === b));
    drawMal();
});

/* ---------- settings ---------- */
const dlg = $('#dlg');

$('#open').onclick = () => {
    $('#malUser').value = cfg.mal;
    dlg.showModal();
};

$('#cancel').onclick = () => dlg.close();

$('#save').onclick = () => {
    cfg.mal = $('#malUser').value.trim() || DEFAULTS.mal;
    Sync.set('dash-cfg', cfg);
    dlg.close();
    loadAll();
};

$('#refresh').onclick = () => loadAll();

function loadAll() {
    header();
    loadFx();
    loadMal();
}
loadAll();
