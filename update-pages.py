"""
Scans the pages/ folder (including sub-folders) for .md files and rebuilds pages/pages.json, which the blog uses to build the top menu.

    python update-pages.py        (or double-click update-pages.bat on Windows)

* pages/about.md            -> menu item "About"       (address: #/about)
* pages/more/links.md       -> "More" dropdown > Links (address: #/more/links)
* pages/more/index.md       -> makes the "More" label itself a link to that page
* Deeper folders make nested dropdowns.

Front matter (between --- lines at the top of a page), all optional:
    title: Text shown in the menu (default: the file name, prettified)
    order: 10              (lower numbers come first; default 100, then A-Z)
    menu: false            (page still works but is left out of the menu)
    draft: true            (page is skipped entirely)
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGES = ROOT / "pages"
OUT = PAGES / "pages.json"
RESERVED = {"post", "page", "tag", "category", "search"}   # used by the blog itself


def parse(text: str) -> dict[str, str]:
    text = text.replace("\r\n", "\n").lstrip("\ufeff")
    m = re.match(r"^---[ \t]*\n(.*?)\n---[ \t]*(?:\n(.*))?$", text, re.S)
    meta: dict[str, str] = {}
    if m:
        for line in m.group(1).split("\n"):
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip().lower()] = v.strip().strip("\"'")
    return meta


def pretty(name: str) -> str:
    return re.sub(r"[-_]+", " ", name).strip().title()


def slug(seg: str) -> str:
    return re.sub(r"[^\w-]+", "-", seg).strip("-")


def main():
    if not PAGES.is_dir():
        sys.exit(f"Can't find the pages folder: {PAGES}")
    pages, folders, seen = [], {}, {}
    for f in sorted(PAGES.rglob("*.md")):
        rel = f.relative_to(PAGES).as_posix()
        meta = parse(f.read_text(encoding="utf-8"))
        if meta.get("draft", "").lower() in ("true", "yes", "1"):
            print(f"  skipped draft: {rel}")
            continue
        parts = [slug(p) for p in rel[:-3].split("/")]
        if parts[-1] == "index" and len(parts) > 1:      # folder/index.md -> the folder's own page
            parts = parts[:-1]
        path = "/".join(parts)
        if parts[0] in RESERVED:
            print(f"  WARNING: '{parts[0]}' is a reserved name; skipping {rel}")
            continue
        if path in seen:
            print(f"  WARNING: {rel} has the same address as {seen[path]}; skipping it")
            continue
        seen[path] = rel
        for i in range(1, len(parts)):                    # every parent folder gets a label
            folders.setdefault("/".join(parts[:i]), pretty(parts[i - 1]))
        try:
            order = int(meta.get("order", 100))
        except ValueError:
            order = 100
        pages.append({
            "path": path,
            "file": rel,
            "title": meta.get("title") or pretty(parts[-1]),
            "order": order,
            "menu": meta.get("menu", "").lower() not in ("false", "no", "0"),
        })
    pages.sort(key=lambda p: (p["order"], p["title"].lower()))
    OUT.write_text(json.dumps({"pages": pages, "folders": folders}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Done: {len(pages)} page(s) written to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
