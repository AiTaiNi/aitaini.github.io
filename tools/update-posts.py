"""
Scans the posts/ folder (including sub-folders) for .md files and rebuilds posts/posts.json, the index the blog reads. Run it after adding, editing or deleting a post.

    python tools/update-posts.py        (or double-click tools/update-posts.bat on Windows)

Post front matter (between --- lines at the top of each file):
    title, date (YYYY-MM-DD), category, tags (comma separated),
    description (optional), id (optional), draft: true (skips the post)
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # this script is in tools/
POSTS = ROOT / "posts"
OUT = POSTS / "posts.json"


def parse(text: str) -> tuple[dict[str, str], str]:
    text = text.replace("\r\n", "\n").lstrip("\ufeff")
    m = re.match(r"^---[ \t]*\n(.*?)\n---[ \t]*(?:\n(.*))?$", text, re.S)
    if not m:
        return {}, text.strip()
    meta: dict[str, str] = {}
    for line in m.group(1).split("\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip().lower()] = v.strip().strip("\"'")
    return meta, (m.group(2) or "").strip()


def plain(md: str) -> str:
    s = re.sub(r"```.*?```", " ", md, flags=re.S)
    s = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", s)          # images
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)       # links -> text
    s = re.sub(r"<[^>]+>", " ", s)                        # html tags
    s = re.sub(r"^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+", "", s, flags=re.M)
    s = re.sub(r"[*_`~]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def main():
    if not POSTS.is_dir():
        sys.exit(f"Can't find the posts folder: {POSTS}")
    entries, seen = [], {}
    for f in sorted(POSTS.rglob("*.md")):
        rel = f.relative_to(POSTS).as_posix()
        meta, body = parse(f.read_text(encoding="utf-8"))
        if meta.get("draft", "").lower() in ("true", "yes", "1"):
            print(f"  skipped draft: {rel}")
            continue
        pid = meta.get("id") or re.sub(r"[^\w.-]+", "-", rel[:-3]).strip("-")
        if pid in seen:
            print(f"  WARNING: id '{pid}' used by both {seen[pid]} and {rel}; skipping the second")
            continue
        seen[pid] = rel
        text = plain(body)
        date = meta.get("date") or datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d")
        if not meta.get("date"):
            print(f"  note: {rel} has no date, using file date {date}")
        entries.append({
            "id": pid,
            "file": rel,
            "title": meta.get("title") or f.stem.replace("-", " ").replace("_", " ").title(),
            "date": date,
            "category": meta.get("category", ""),
            "tags": [t.strip() for t in meta.get("tags", "").split(",") if t.strip()],
            "description": meta.get("description") or (text[:160] + "…" if len(text) > 160 else text),
            "words": len(text.split()),
        })
    entries.sort(key=lambda e: e["date"], reverse=True)
    OUT.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Done: {len(entries)} post(s) written to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
