"""
Save MyAnimeList profile stats to data/mal-stats.json.

`python scrape_mal.py AisareTai`
"""

import argparse
import json
import re
import sys
import urllib.request
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

SPEC: dict[str, list[tuple[str, str, float | int]]] = {
    "anime": [
        ("days_watched", "Days:", float),
        ("mean_score", "Mean Score:", float),
        ("watching", "Watching", int),
        ("completed", "Completed", int),
        ("on_hold", "On-Hold", int),
        ("dropped", "Dropped", int),
        ("plan_to_watch", "Plan to Watch", int),
        ("total_entries", "Total Entries", int),
        ("rewatched", "Rewatched", int),
        ("episodes_watched", "Episodes", int),
    ],
    "manga": [
        ("days_read", "Days:", float),
        ("mean_score", "Mean Score:", float),
        ("reading", "Reading", int),
        ("completed", "Completed", int),
        ("on_hold", "On-Hold", int),
        ("dropped", "Dropped", int),
        ("plan_to_read", "Plan to Read", int),
        ("total_entries", "Total Entries", int),
        ("reread", "Reread", int),
        ("chapters_read", "Chapters", int),
        ("volumes_read", "Volumes", int),
    ],
}


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list):  # noqa: ARG002
        if tag in ("script", "style"):
            self.skip += 1

    def handle_endtag(self, tag: str):
        if tag in ("script", "style") and self.skip:
            self.skip -= 1

    def handle_data(self, data: Any):  # noqa: ANN401
        if not self.skip:
            self.parts.append(data)


def page_text(html: str) -> str:
    p = Text()
    p.feed(html)
    return " ".join(" ".join(p.parts).split())


def section(text: str, kind: str) -> str | None:
    m = re.search(kind.capitalize() + r" Stats\s+Days:", text)
    if not m:
        return None
    end = m.start() + 600
    o = re.search(("Manga" if kind == "anime" else "Anime") + r" Stats\s+Days:", text)
    if o and o.start() > m.start():
        end = min(end, o.start())
    return text[m.start() : end]


def parse(text: str, kind: str) -> tuple[dict[str, int | float], bool]:
    sec = section(text, kind)
    out: dict[str, int | float] = {}
    for key, label, cast in SPEC[kind]:
        m = sec and re.search(re.escape(label) + r"\s*(\d[\d,]*\.?\d*)", sec)
        out[key] = cast(m.group(1).replace(",", "")) if m else 0
    return out, sec is not None


def avatar(html: str) -> str:
    """Find the profile picture. MAL's og:image is only the site logo, so read the user-image block instead."""

    block = re.search(r'class="user-image[^"]*"[^>]*>(.*?)</div>', html, re.S)
    if not block:
        return ""
    for attr in ("data-src", "src"):
        m = re.search(attr + r'="(https?://[^"]*/userimages/[^"]+)"', block.group(1))
        if m:
            return m.group(1).replace("&amp;", "&")
    return ""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("user")
    ap.add_argument("--file")
    a = ap.parse_args()
    if a.file:
        html = Path(a.file).read_text(encoding = "utf-8", errors = "ignore")
    else:
        req = urllib.request.Request(f"https://myanimelist.net/profile/{a.user}", headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept-Language": "en-US,en;q=0.9"})
        try:
            html = urllib.request.urlopen(req, timeout = 30).read().decode("utf-8", "ignore")  # noqa: S310
        except Exception as e:
            sys.exit(f"Could not fetch the profile ({e}). Save the page from your browser and use --file profile.html")
    text = page_text(html)
    stats, found = {}, {}
    for kind in SPEC:
        stats[kind], found[kind] = parse(text, kind)
    if not any(found.values()):
        sys.exit("Found no stats. Is the profile public and in English? If MAL changed its layout, the labels in SPEC need updating.")
    for kind, ok in found.items():
        if not ok:
            print(f"Note: no {kind} stats section found; filled with zeros.")
    img = avatar(html)
    if not img:
        print("Note: no profile picture found. The profile may have none set, or MAL changed its layout.")
    data = {"updated": datetime.now(UTC).isoformat(timespec="seconds"), "profile": {"username": a.user, "url": f"https://myanimelist.net/profile/{a.user}", "images": {"jpg": {"image_url": img}}}, "stats": stats}
    out = Path(__file__).parent / "data" / "mal-stats.json"
    out.parent.mkdir(exist_ok = True)
    out.write_text(json.dumps(data, indent = 2), encoding = "utf-8")
    print(f"Saved {out}")
    print(json.dumps(stats, indent = 1))


main()
