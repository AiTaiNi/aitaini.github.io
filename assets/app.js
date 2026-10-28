/* Blog engine. You normally don't need to edit this file.
   Posts live in /posts, pages in /pages. */

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const md = t => marked.parse(t);
const SITE = document.title;
/* Sidebar boxes that only appear on one page: { box id: page path }. Everything else is always visible. */
const SIDEBAR_ON = { 'w-cats': 'archive', 'w-tags': 'archive', 'w-mal': 'about' };
const coverUrl = p => !p.image ? '' : /^(https?:)?\/\//.test(p.image) ? p.image : 'posts/' + encodeURI(p.image);
const POSTS_PER_PAGE = 5;   /* posts shown per page on the front page, tags, categories and search */
const yr = $('#yr'); if (yr) yr.textContent = new Date().getFullYear();

/* ---------- File loading ---------- */
const cache = {};
const getText = path => cache[path] ||= fetch(path).then(r => {
  if (!r.ok) throw new Error(`${path} (${r.status})`);
  return r.text();
});

/* Split "---\nkey: value\n---\nbody" into {meta, body} */
function parse(raw) {
  raw = raw.replace(/\r\n/g, '\n');
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/);
  if (!m) return { meta: {}, body: raw.trim() };

  const meta = {};
  m[1].split('\n').forEach(l => {
    const i = l.indexOf(':');
    if (i > 0) meta[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  });

  return { meta, body: (m[2] || '').trim() };
}

let posts = [], loadError = null;
const postPath = p => 'posts/' + encodeURI(p.file);

/* Only the small index (posts/posts.json) is loaded up front */
async function loadPosts() {
  const list = JSON.parse(await getText('posts/posts.json'));
  posts = list.map(e => ({
    id: e.id, file: e.file, title: e.title || e.id, date: e.date || '', cat: e.category || '',
    tags: e.tags || [], desc: e.description || '', words: e.words || 0, image: e.image || '', md: null, plain: null
  })).sort((a, b) => b.date.localeCompare(a.date));

  buildSidebar();
}

/* A post's body is fetched only when it's opened or searched (then cached) */
async function body(p) {
  if (p.md === null) {
    p.md = parse(await getText(postPath(p))).body;
    const el = document.createElement('div');
    el.innerHTML = md(p.md);
    p.plain = el.textContent.replace(/\s+/g, ' ').trim();
  }

  return p;
}

/* ---------- Menu ---------- */
let pagesIdx = [], folderTitles = {};
const prettify = t => t.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

async function loadMenu() {
  try {
    const data = JSON.parse(await getText('pages/pages.json'));
    pagesIdx = data.pages || []; folderTitles = data.folders || {};
  } catch (e) { return; }               /* don't index yet since the menu is just empty */

  const root = { kids: new Map() };
  pagesIdx.filter(p => p.menu !== false).forEach(p => {
    let node = root, acc = '';
    p.path.split('/').forEach(seg => {
      acc += (acc ? '/' : '') + seg;
      if (!node.kids.has(seg)) node.kids.set(seg, { path: acc, seg, kids: new Map(), page: null });
      node = node.kids.get(seg);
    });
    node.page = p;
  });

  const order = n => n.page ? n.page.order : Math.min(...[...n.kids.values()].map(order));
  const label = n => n.page ? n.page.title : (folderTitles[n.path] || prettify(n.seg));
  const render = node => [...node.kids.values()]
    .sort((a, b) => order(a) - order(b) || label(a).localeCompare(label(b)))
    .map(n => {
      if (!n.kids.size) return `<a class="btn" href="#/${n.path}" data-nav="${n.path}">${esc(label(n))}</a>`;
      const l = n.page
        ? `<a class="btn dd-label" href="#/${n.path}" data-nav="${n.path}">${esc(label(n))} ▾</a>`
        : `<button class="btn dd-label" type="button">${esc(label(n))} ▾</button>`;
      return `<div class="dd">${l}<div class="sub card">${render(n)}</div></div>`;
    }).join('');

  $('#menu').innerHTML = render(root);

  pagesIdx.forEach(p => getText('pages/' + encodeURI(p.file)).catch(() => { }));   /* preload */
}

/* Dropdowns open on hover; click/tap toggles them (touch screens) */
document.addEventListener('click', e => {
  const l = e.target.closest('.dd-label');
  document.querySelectorAll('.dd.open').forEach(d => { if (!l || !d.contains(l)) d.classList.remove('open'); });
  if (l) l.parentElement.classList.toggle('open');
});

addEventListener('hashchange', () => document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open')));

const init = Promise.all([loadPosts(), loadMenu()]).catch(e => { loadError = e; });

/* ---------- Sidebar widgets ---------- */
function buildSidebar() {
  const count = arr => arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
  const cats = count(posts.map(p => p.cat).filter(Boolean));
  const tags = count(posts.flatMap(p => p.tags));

  $('#w-cats').innerHTML = '<h4>Categories</h4>' + Object.entries(cats).map(([k, n]) =>
    `<a class="row" href="#/category/${enc(k)}">${esc(k)}<span>${n}</span></a>`).join('');
  $('#w-tags').innerHTML = '<h4>Tags</h4>' + Object.keys(tags).map(k =>
    `<a class="chip" href="#/tag/${enc(k)}">${esc(k)}</a>`).join('');

  if (!Object.keys(cats).length) $('#w-cats').remove();
  if (!Object.keys(tags).length) $('#w-tags').remove();
}

/* ---------- Views ---------- */
const metaLine = p => `<div class="meta">${esc(p.date)}` +
  (p.cat ? ` · <a href="#/category/${enc(p.cat)}">${esc(p.cat)}</a>` : '') +
  p.tags.map(t => `<a class="tag" href="#/tag/${enc(t)}">${esc(t)}</a>`).join('') + '</div>';

function pager(pages, page, href) {
  if (pages < 2) return '';

  let out = page > 1 ? `<a class="btn" href="${href(page - 1)}">← Newer</a>` : '', last = 0;

  for (let n = 1; n <= pages; n++) {
    if (n !== 1 && n !== pages && Math.abs(n - page) > 1) continue;

    if (n - last > 1) out += '<span class="gap">…</span>';

    out += `<a class="btn${n === page ? ' on' : ''}" href="${href(n)}">${n}</a>`;
    last = n;
  }

  if (page < pages) out += `<a class="btn" href="${href(page + 1)}">Older →</a>`;

  return `<nav class="pager">${out}</nav>`;
}

/* A page of post entries (+ pager). href(n) gives the link for page n. */
function cards(items, head, page = 1, href = () => '#/') {
  const pages = Math.max(1, Math.ceil(items.length / POSTS_PER_PAGE));
  page = Math.min(Math.max(1, page), pages);
  const slice = items.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE);

  return (head ? `<h1 class="heading">${head}</h1>` : '') + (slice.length ? slice.map(p => `
    <article class="entry">
      <h2><a href="#/post/${enc(p.id)}">${esc(p.title)}</a></h2>
      ${metaLine(p)}<p class="desc">${esc(p.desc)}</p>
    </article>`).join('') : '<div class="card empty">Nothing here yet.</div>') + pager(pages, page, href);
}

function timeline() {
  const years = {};
  posts.forEach(p => (years[p.date.slice(0, 4)] ||= []).push(p));

  return Object.keys(years).sort().reverse().map(y => `
    <section class="entry year"><h3>${esc(y)}<small>${years[y].length} post${years[y].length > 1 ? 's' : ''}</small></h3>
    ${years[y].map(p => `<a class="arow" href="#/post/${enc(p.id)}"><span class="d">${esc(p.date.slice(5))}</span>
      <span class="dot"></span><span class="t">${esc(p.title)}</span><span class="tg">${p.tags.map(esc).join(' · ')}</span></a>`).join('')}
    </section>`).join('') || '<div class="card empty">No posts yet.</div>';
}

const notFound = () => ({
  title: 'Not found', nav: '', html:
    '<div class="card empty">Page not found. <a href="#/">Go home</a></div>'
});

/* Any #/path that isn't built in opens the matching file in pages/ (e.g. #/more/links) */
async function pageView(hash) {
  const path = decodeURIComponent(hash.slice(2)).replace(/\/+$/, '');
  if (!/^[\w-]+(\/[\w-]+)*$/.test(path)) return notFound();

  const entry = pagesIdx.find(x => x.path === path);

  let raw;
  try { raw = await getText('pages/' + encodeURI(entry ? entry.file : path + '.md')); } catch (e) { return notFound(); }
  const { meta, body } = parse(raw);

  let html = body ? `<article class="entry full"><div class="md">${md(body)}</div></article>` : '';
  if (path === 'archive') html += timeline();
  return { title: meta.title || (entry && entry.title) || prettify(path.split('/').pop()), nav: path, page: path, html };
}

async function view(hash) {
  await init;

  const [, route = '', arg = '', arg2 = ''] = hash.split('/');
  const a = decodeURIComponent(arg);
  const num = x => Math.max(1, parseInt(x, 10) || 1);
  const paged = base => n => n === 1 ? base : `${base}/${n}`;
  const homeHref = n => n === 1 ? '#/' : `#/page/${n}`;

  if (route === '') return { title: '', nav: '', html: cards(posts, '', 1, homeHref) };

  if (route === 'page') { const n = num(arg); return { title: n > 1 ? `Page ${n}` : '', nav: '', html: cards(posts, '', n, homeHref) }; }

  if (route === 'post') {
    const p = posts.find(x => x.id === a);
    if (!p) return notFound();
    try { await body(p); } catch (e) { return notFound(); }

    return {
      title: p.title, nav: '', html: `
      <article class="entry full"><h1>${esc(p.title)}</h1>${metaLine(p)}
      ${coverUrl(p) ? `<img class="cover" src="${esc(coverUrl(p))}" alt="">` : ''}
      <div class="md">${md(p.md)}</div></article>
      <p class="backlink"><a href="#/">← All posts</a></p>` };
  }

  if (route === 'category') return { title: a, nav: 'archive', html: cards(posts.filter(p => p.cat === a), `Category: ${esc(a)}`, num(arg2), paged(`#/category/${enc(a)}`)) };
  if (route === 'tag') return { title: '#' + a, nav: 'archive', html: cards(posts.filter(p => p.tags.includes(a)), `Tag: ${esc(a)}`, num(arg2), paged(`#/tag/${enc(a)}`)) };

  if (route === 'search') {
    const q = a.toLowerCase();
    await Promise.all(posts.map(p => body(p).catch(() => { })));
    const r = posts.filter(p => (p.title + ' ' + p.cat + ' ' + p.tags.join(' ') + ' ' + (p.plain || '')).toLowerCase().includes(q));

    return { title: 'Search', nav: 'none', html: cards(r, `${r.length} result${r.length === 1 ? '' : 's'} for “${esc(a)}”`, num(arg2), paged(`#/search/${enc(a)}`)) };
  }

  return pageView(hash);
}

/* ---------- Router with fade transition  ---------- */
let first = true, prev = '', token = 0;
const isSearchTyping = h => /^#\/search\/[^/]*$/.test(h);

async function go() {
  const my = ++token, hash = location.hash || '#/', main = $('#main');
  const typing = isSearchTyping(prev) && isSearchTyping(hash);   /* live search: no fade/scroll */

  let fadeOut = Promise.resolve();
  if (!first && !typing) { main.classList.add('out'); fadeOut = new Promise(r => setTimeout(r, 200)); }
  const [v] = await Promise.all([view(hash), fadeOut]);           /* content is fetched while fading */
  if (my !== token) return;

  main.innerHTML = v.html;
  document.title = v.title ? `${v.title} - ${SITE}` : SITE;

  document.querySelectorAll('.links a[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === v.nav));
  document.querySelectorAll('.dd').forEach(d => {
    const l = d.querySelector('.dd-label');
    if (l) l.classList.toggle('on', !!d.querySelector('.sub .on') || l.dataset.nav === v.nav);
  });
  Object.entries(SIDEBAR_ON).forEach(([id, page]) => { const w = $('#' + id); if (w) w.classList.toggle('side-off', v.page !== page); });

  if (!typing) window.scrollTo(0, 0);
  requestAnimationFrame(() => requestAnimationFrame(() => main.classList.remove('out')));

  prev = hash; first = false;
}
window.addEventListener('hashchange', go);

/* ---------- Search ---------- */
let st;
const q = $('#q');

if (q) {
  q.addEventListener('input', e => {
    clearTimeout(st);
    st = setTimeout(() => { const v = e.target.value.trim(); location.hash = v ? '#/search/' + enc(v) : '#/'; }, 180);
  });

  q.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
}

/* ---------- Preload a post when the pointer nears its link ---------- */
const warm = e => {
  const a = e.target.closest && e.target.closest('a[href^="#/post/"]');
  const p = a && posts.find(x => x.id === decodeURIComponent(a.getAttribute('href').slice(7)));
  if (p) getText(postPath(p)).catch(() => {});
};
document.addEventListener('mouseover', warm);
document.addEventListener('touchstart', warm, { passive: true });

/* Stronger header shadow once the page is scrolled */
addEventListener('scroll', () => $('.top')?.classList.toggle('scrolled', scrollY > 4), { passive: true });

/* ---------- MyAnimeList sidebar widget --------- */
const MAL = {
  anime: { keys: [['watching','Watching','#2db039'],['completed','Completed','#2e51a2'],['on_hold','On hold','#f9d457'],['dropped','Dropped','#a12f31'],['plan_to_watch','Plan to watch','#9aa0a6']],
           top: [['total_entries','Entries'],['episodes_watched','Episodes'],['days_watched','Days']] },
  manga: { keys: [['reading','Reading','#2db039'],['completed','Completed','#2e51a2'],['on_hold','On hold','#f9d457'],['dropped','Dropped','#a12f31'],['plan_to_read','Plan to read','#9aa0a6']],
           top: [['total_entries','Entries'],['chapters_read','Chapters'],['days_read','Days']] }
};
let malData = null, malTab = 'anime';
const fmt = (n, d = 0) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: d });

function drawMal() {
  const box = $('#w-mal'), { profile = {}, stats = {} } = malData, d = stats[malTab] || {}, m = MAL[malTab];
  const img = profile.images && profile.images.jpg ? profile.images.jpg.image_url : '';
  const url = /^https:\/\//.test(profile.url || '') ? profile.url : '';
  const total = m.keys.reduce((a, [k]) => a + (d[k] || 0), 0) || 1;

  box.innerHTML = `
    <h4>MyAnimeList</h4>
    <div class="mal-tabs">${['anime', 'manga'].map(t =>
      `<button type="button" class="btn${t === malTab ? ' on' : ''}" data-t="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
    <div class="mal-user">${/^https:\/\//.test(img) ? `<img src="${esc(img)}" alt="">` : ''}
      <div>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(profile.username || '')}</a>` : `<b>${esc(profile.username || '')}</b>`}
      <span>Mean score ${fmt(d.mean_score, 2)}</span></div></div>
    <div class="mal-stats">${m.top.map(([k, l]) => `<div><b>${fmt(d[k], k.startsWith('days') ? 1 : 0)}</b><span>${l}</span></div>`).join('')}</div>
    <div class="mal-bar" role="img" aria-label="Status breakdown">${m.keys.map(([k, , c]) => `<div style="width:${(d[k] || 0) / total * 100}%;background:${c}"></div>`).join('')}</div>
    <div class="mal-legend">${m.keys.map(([k, l, c]) => `<span><i style="background:${c}"></i>${l} ${fmt(d[k])}</span>`).join('')}</div>` +
    (malData.updated ? `<p class="mal-note">Updated ${esc(new Date(malData.updated).toLocaleDateString())}</p>` : '');
}

async function loadMal() {
  const box = $('#w-mal');
  if (!box) return;

  try {
    const r = await fetch('data/mal-stats.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);

    malData = await r.json();
    drawMal();
    box.hidden = false;

    box.addEventListener('click', e => {
      const b = e.target.closest('[data-t]');
      if (b && MAL[b.dataset.t]) { malTab = b.dataset.t; drawMal(); }
    });
  } catch (e) { console.warn('MyAnimeList widget hidden: could not load data/mal-stats.json', e); }
}
loadMal();

go();
