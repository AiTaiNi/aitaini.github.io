# YouTube subscription feed: notes for a future project

The dashboard used to show the newest videos from your subscriptions. It was removed on 2026-10-30 because the free
route it depended on stopped working (below), and a reliable route needs more setup than it's worth here: the YouTube
app does the job. This file keeps everything learned, plus the removed code, for reuse elsewhere (a local script, a PC
app, another site).

## Getting your subscription list

Google Takeout gives every subscribed channel with its ID:

1. <https://takeout.google.com>, signed in with your YouTube account.
2. **Deselect all**, then tick **YouTube and YouTube Music**.
3. **All YouTube data included** → **Deselect all** → tick only **subscriptions** → OK.
4. **Next step** → **Create export**. With only subscriptions it's usually ready in minutes (email or the Takeout page).
5. Unzip: `Takeout/YouTube and YouTube Music/subscriptions/subscriptions.csv` has `Channel Id, Channel Url, Channel Title`.

Channel IDs always look like `UC` + 22 characters, so the regex `/UC[\w-]{22}/g` pulls them out of anything pasted
(the whole CSV, URLs, a list). Feeds and the API need the ID, not the @handle or a custom URL.

The old dashboard stored the list in its synced settings key `dash-cfg` as `channels: [...]`. That value is still
there in the `kv` table (the dashboard just ignores it now) until the dashboard settings are saved over it.

## How the feed worked

Every channel has a public Atom feed with its 15 newest uploads, no key needed:

```
https://www.youtube.com/feeds/videos.xml?channel_id=UC…
https://www.youtube.com/feeds/videos.xml?playlist_id=UU…   (the uploads playlist: UC… with UC replaced by UU)
```

Per `<entry>`: `<yt:videoId>`, `<title>`, `<link href>`, `<published>`, plus `<author><name>` on the feed. Thumbnails
need no request: `https://i.ytimg.com/vi/<videoId>/mqdefault.jpg` (320×180; also `hqdefault`, `maxresdefault`).

A web page can't fetch the feed directly: YouTube doesn't send CORS headers, so the browser blocks the response.
The dashboard went through free CORS proxies, four channels at a time, took the 5 newest per channel and showed the
24 newest overall. The removed code:

```js
/* ---------- YouTube RSS ---------- */
const PROXIES = [u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u), u => 'https://corsproxy.io/?' + encodeURIComponent(u)];

async function fetchFeed(id) {
    const url = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + id;

    for (const p of PROXIES) {
        try {
            const r = await fetch(p(url));

            if (!r.ok) continue;

            const xml = new DOMParser().parseFromString(await r.text(), 'text/xml');
            const author = (xml.querySelector('feed > author > name') || {}).textContent || '';

            return [...xml.querySelectorAll('entry')].map(e => {
                const link = e.querySelector('link').getAttribute('href');
                const idEl = e.getElementsByTagName('yt:videoId')[0];

                return { id: idEl ? idEl.textContent : link.split('v=')[1], title: e.querySelector('title').textContent, link, author, date: new Date(e.querySelector('published').textContent) };
            });
        } catch {
        }
    }

    return null;
}

function ago(d) {
    const s = (Date.now() - d) / 1000;
    const u = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];

    for (const [n, l] of u) {
        if (s >= n) {
            const v = Math.floor(s / n);

            return `${v} ${l}${v > 1 ? 's' : ''} ago`;
        }
    }

    return 'just now';
}

async function loadYt() {
    const box = $('#yt');

    if (!cfg.channels.length) {
        box.innerHTML = '<p class="note">Add YouTube channel IDs in Settings to see new videos here.</p>';
        return;
    }

    box.innerHTML = '<p class="note">Loading videos…</p>';

    const all = [];
    let failed = 0, i = 0;

    /* four channels at a time */
    const worker = async () => {
        while (i < cfg.channels.length) {
            const r = await fetchFeed(cfg.channels[i++]);

            if (r) all.push(...r.slice(0, 5)); else failed++;
        }
    };

    await Promise.all([worker(), worker(), worker(), worker()]);
    all.sort((a, b) => b.date - a.date);

    if (!all.length) {
        box.innerHTML = '<p class="err">Couldn’t load any feeds. The free CORS proxies may be busy; press Refresh to retry.</p>';
        return;
    }

    box.innerHTML = `<div class="vids">${all.slice(0, 24).map(v => `
    <a class="vid" href="${esc(v.link)}" target="_blank" rel="noopener">
      <img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt="">
      <p>${esc(v.title)}</p><span>${esc(v.author)}, ${ago(v.date)}</span></a>`).join('')}</div>`
        + (failed ? `<p class="note">${failed} channel${failed > 1 ? 's' : ''} failed to load.</p>` : '');
}

/* in the settings dialog: keep every channel ID found in the pasted text, without duplicates */
cfg.channels = [...new Set($('#ch').value.match(/UC[\w-]{22}/g) || [])];
```

```css
/* thumbnail grid */
.vids { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px }
.vid { color: inherit }
.vid img { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: var(--radius-chip); background: var(--line); display: block }
.vid p { margin: 6px 0 0; font-weight: 500; font-size: .95rem; line-height: 1.3; color: var(--title);
         display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden }
.vid span { font-size: .8rem; color: var(--sub) }
.vid:hover p { color: var(--link) }
```

## What broke (tested 2026-10-30, ~05:30 UTC, from a home connection in Peru)

**YouTube's feed itself:** 404 for every channel tried, 8 of 8 attempts, with curl, Python and a browser User-Agent,
for both `channel_id` and `playlist_id`. It's not local: the endpoint has failed on and off since December 2025 and
still does ([FreeTube #8443](https://github.com/FreeTubeApp/FreeTube/issues/8443),
[newsboat #3269](https://github.com/newsboat/newsboat/issues/3269),
[obsidian-rss-dashboard #1625](https://github.com/amatya-aditya/obsidian-rss-dashboard/issues/1625),
[web-boris #61](https://github.com/nelsonmarro/web-boris/issues/61),
[n8n community](https://community.n8n.io/t/youtube-rss-feed-endpoint-returns-404-errors/241692)). Patterns people
report:

- random mixes of 200 / 404 / 500 for the same URL minutes apart (retrying 1–2 times helps then)
- fixed daily windows of failure (one report: 09:00–12:00 UTC)
- datacenter IPs (Vercel, AWS…) failing far more than home connections
- a browser User-Agent helping in some setups (it didn't on the test day)

**Proxies and front-ends**, same day, same feed (status, and whether a browser could read it):

| Route | Result |
| --- | --- |
| api.allorigins.win (`/raw`, `/get`) | 522 / timeout |
| corsproxy.io (`?url=` and old `?`) | 401 / 403: now needs a key for this kind of use |
| api.codetabs.com, thingproxy.freeboard.io | no response |
| cors.eu.org, api.rss2json.com | 403 |
| api.cors.lol | 429 (rate-limited) |
| whateverorigin.org | 500 |
| Piped API (kavin.rocks, adminforge.de, private.coffee) `/feed/unauthenticated?channels=…` | 526 / 301 / timeout |
| Invidious (yewtu.be, nerdvpn.de, nadeko.net) `/api/v1/channels/<id>/latest` | 403 / no response |

Free proxies and volunteer front-ends come and go and are themselves blocked by YouTube: fine as a last resort, never
as the main route. (Piped's `feed/unauthenticated?channels=a,b,c` is handy when an instance works: one request for
all channels, CORS-enabled.)

## Options, best first

| | Route | Reliability | Setup and limits |
|---|---|---|---|
| 1 | **YouTube Data API v3 with an API key**: `playlistItems.list?part=snippet&playlistId=UU…&maxResults=5&key=…` per channel (or `channels.list` for up to 50 IDs at once, for names and avatars) | Official; not affected by the feed outages. CORS-enabled, so a page can call it directly | Free Google Cloud project + API key. Quota 10,000 units/day; `playlistItems.list` and `channels.list` cost 1 unit each, `search.list` costs 100 (avoid). 100 channels ≈ 100 units per refresh; cache each channel 30–60 min. In a public page, restrict the key to the site's address (HTTP referrers) and to YouTube Data API v3 only; the worst case is someone using your quota |
| 2 | **Own server-side proxy** (e.g. a Supabase Edge Function, Cloudflare Worker) that calls the API with the key kept secret, or fetches the feed with retries | Good with the API; poor with the feed (server IPs fail more) | Key never in page code; one more piece to deploy and maintain |
| 3 | **Feed with retries**: 2–3 tries, short pauses, on 404/5xx/timeouts | Helps only while YouTube's feed is partly up | Tiny; in a browser it still needs a working proxy, so it's best in a local script or app, where CORS doesn't apply |
| 4 | **Local script on the PC** (Python), from a home IP, fetching feeds or the API and writing results to a file or database; run by hand or by Task Scheduler | Home IPs do better than servers with the feed, but on the test day the feed was down from home too | No CORS problem at all; results only as fresh as the last run |
| 5 | **Keep the last good result** and show it with "last updated …" when everything fails | Always shows something | Worth adding to any of the above |

Suggested combination for a new project: **1 → 3 → 5** (API first, the feed with retries as a fallback, the last
result when both fail), or **4** if it runs on the PC anyway: a local program avoids CORS entirely, so the feed can be
fetched directly with retries and the API used only as the fallback.

### Python sketch for a local tool (feed first, API fallback)

```python
import time, urllib.request, xml.etree.ElementTree as ET

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}

def feed(channel_id: str, tries: int = 3) -> list[dict] | None:
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            root = ET.fromstring(urllib.request.urlopen(req, timeout=15).read())
            author = root.findtext("a:author/a:name", "", NS)
            return [{"id": e.findtext("yt:videoId", "", NS), "title": e.findtext("a:title", "", NS),
                     "published": e.findtext("a:published", "", NS), "author": author} for e in root.findall("a:entry", NS)]
        except Exception:
            time.sleep(2 * (i + 1))   # outages are often random: wait a little and retry
    return None                       # caller falls back to the API, then to the last saved result
```

The API equivalent: `GET https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=5&playlistId=UU<id without UC>&key=<key>`;
each item's `snippet` has `title`, `publishedAt`, `channelTitle` and `resourceId.videoId`.
