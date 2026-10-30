"""
Build the data for the Indonesian learning pages (personal/learning/indonesian/), and turn your own Indonesian PDFs
into private import candidates. Background: _docs/indonesian-data.md.

`python build_indonesian.py`         public data -> personal/learning/indonesian/data/ (dictionary, deck, forms, sentences, slang)
`python build_indonesian.py pdfs`    private -> tools/indonesian/out-private/pdf-candidates.json, from tools/indonesian/pdfs/
`python build_indonesian.py all`     both

Sources go in tools/indonesian/raw/ (git-ignored): the kaikki.org Indonesian Wiktionary extract, Tatoeba's Indonesian
and English sentences with their links, and the FrequencyWords Indonesian list. Hand-written content is in
tools/indonesian/content/. Needs PySastrawi and PyYAML (`pip install PySastrawi pyyaml`); the PDF step also needs
PyMuPDF (already used by parse_statements.py).

The public output contains only freely licensed material (see SOURCES); nothing from the PDFs ever goes there.
"""

import argparse
import bz2
import hashlib
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT / "tools" / "indonesian"
RAW = TOOLS / "raw"
CONTENT = TOOLS / "content"
PDFS = TOOLS / "pdfs"
PRIVATE = TOOLS / "out-private"
OUT = ROOT / "personal" / "learning" / "indonesian" / "data"

KAIKKI = RAW / "kaikki.org-dictionary-Indonesian.jsonl"
FREQ = RAW / "id_50k.txt"
TATOEBA_IND = RAW / "ind_sentences.tsv.bz2"
TATOEBA_ENG = RAW / "eng_sentences.tsv.bz2"
TATOEBA_LINKS = RAW / "ind-eng_links.tsv.bz2"

SOURCES = [
    {"name": "Wiktionary (via kaikki.org)", "url": "https://kaikki.org/dictionary/Indonesian/", "license": "CC BY-SA 4.0 / GFDL", "used_for": "dictionary, roots, examples, casual forms"},
    {"name": "Tatoeba", "url": "https://tatoeba.org", "license": "CC BY 2.0 FR", "used_for": "example sentences"},
    {"name": "FrequencyWords (OpenSubtitles 2018)", "url": "https://github.com/hermitdave/FrequencyWords", "license": "CC BY-SA 4.0", "used_for": "word order"},
    {"name": "Hand-written (this site)", "url": "", "license": "CC BY-SA 4.0", "used_for": "slang list"},
]

DECK_SIZE = 3000       # about a year at the study plan's pace (_docs/indonesian-study-plan.md)
SLANG_START = 20       # hand-written casual words are mixed into the deck from this position…
SLANG_EVERY = 10       # …one every this many words
FORMS_TOP = 30000      # how many of the most frequent words get an entry in forms.json
EXAMPLES = 3           # example sentences kept per deck word
MAX_SENSES = 6

WORD = re.compile(r"^[a-z]+(?:-[a-z]+)*$")
TOKEN = re.compile(r"[a-z]+(?:-[a-z]+)*")
SKIP_POS = {"name", "character", "symbol", "punct", "romanization", "proverb"}
OLD = {"archaic", "obsolete", "dated", "historical"}
SLANG_TAGS = {"Internet", "slang"}
CASUAL_TAGS = {"colloquial", "informal", "Jakarta", "nonstandard"}
KEEP_TAGS = OLD | SLANG_TAGS | CASUAL_TAGS | {"formal", "dialectal", "rare", "vulgar", "derogatory", "figuratively", "abbreviation", "transitive", "intransitive", "passive", "imperative", "alt-of", "form-of"}
CLITICS = ("nya", "ku", "mu", "lah", "kah", "pun")
FORM_OF_GLOSS = re.compile(r"^(?:\w+ )?(?:active|passive|imperative|reflexive|causative)(?: form)? of (\S+)", re.I)
# "synonym of datang (“to arrive”)", "apheretic form of aku", "basic form of menceritakan (“to tell”)"
REF_GLOSS = re.compile(r"^(synonym|(?:\w+ )?(?:form|abbreviation|spelling)) of ([^\s(;]+)(?: \(“(.+?)”\))?", re.I)
SHORTENED = re.compile(r"apheretic|apocopic|syncopic|clipping|contraction", re.I)
ENGLISH = {"the", "he", "she", "is", "are", "was", "and", "of", "you", "it", "to"}   # Tatoeba sentences with English left in

# Wiktionary writes the meN-/peN- variants out; the pages show them as one affix, and casual nasal prefixes as N-
AFFIX_NAMES = {
    "me-": "meN-", "mem-": "meN-", "men-": "meN-", "meng-": "meN-", "meny-": "meN-", "menge-": "meN-",
    "pe-": "peN-", "pem-": "peN-", "pen-": "peN-", "peng-": "peN-", "peny-": "peN-", "penge-": "peN-",
    "ng-": "N-", "nge-": "N-", "ny-": "N-", "m-": "N-", "n-": "N-", "-in": "-in",
}

# Casual nasal prefix + optional -in, undone to find the root: nulis -> tulis, ngirim -> kirim, bacain -> baca
CASUAL_PREFIXES = [("nge", ""), ("ng", "k"), ("ng", ""), ("ny", "s"), ("ny", "c"), ("m", "p"), ("m", "b"), ("n", "t"), ("n", "")]


def say(*a: object) -> None:
    print(*a, flush=True)


def need(*paths: Path) -> None:
    missing = [p.name for p in paths if not p.exists()]

    if missing:
        sys.exit("Missing in " + str(RAW) + ": " + ", ".join(missing) + ". See _docs/indonesian-data.md for the downloads.")


def write_json(path: Path, data: object) -> dict:
    """Compact UTF-8 JSON; returns its manifest entry (short hash, size)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    path.write_bytes(raw)

    return {"hash": hashlib.sha256(raw).hexdigest()[:12], "bytes": len(raw)}


def norm_affix(a: str) -> str:
    a = a.strip()

    return AFFIX_NAMES.get(a, a)


# ---------- dictionary ----------
def affix_info(templates: list[dict]) -> tuple[str, list[str]] | None:
    """Root and affixes from Wiktionary's etymology templates (af/pre/suf/con/reduplication)."""
    for t in templates:
        name, args = t.get("name"), t.get("args") or {}

        if args.get("1") != "id":
            continue

        parts = [args[k].strip() for k in sorted((k for k in args if k.isdigit() and k != "1"), key=int) if args[k].strip()]

        if name in ("af", "affix", "con", "confix", "circumfix"):
            is_affix = [any(x.startswith("-") or x.endswith("-") for x in p.split()) for p in parts]
            roots = [p for p, a in zip(parts, is_affix, strict=True) if not a]
            affixes = [norm_affix(x) for p, a in zip(parts, is_affix, strict=True) if a for x in p.split()]
        elif name in ("pre", "prefix") and len(parts) >= 2:
            roots, affixes = [parts[-1]], [norm_affix(p if p.endswith("-") else p + "-") for p in parts[:-1]]
        elif name in ("suf", "suffix") and len(parts) >= 2:
            roots, affixes = [parts[0]], [norm_affix(p if p.startswith("-") else "-" + p) for p in parts[1:]]
        elif name in ("reduplication", "redup") and parts:
            roots, affixes = [parts[0]], ["reduplication"]
        else:
            continue

        if len(roots) == 1 and WORD.match(roots[0]):
            return roots[0], affixes

    return None


def clean_gloss(g: str) -> str:
    return re.sub(r"\s+", " ", g).strip().rstrip(".")


def load_lexicon() -> tuple[dict[str, list[dict]], dict[str, str], dict[str, list[str]]]:
    """word -> entries (one per part of speech), word -> immediate root, word -> affixes."""
    say("Reading the Wiktionary extract…")
    lex: dict[str, list[dict]] = defaultdict(list)
    root_of: dict[str, str] = {}
    affixes_of: dict[str, list[str]] = {}
    derived_of: dict[str, str] = {}

    with open(KAIKKI, encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            w, pos = e.get("word", "").strip(), e.get("pos")

            if e.get("lang_code") != "id" or pos in SKIP_POS or not w or w[0].isupper():
                continue

            senses = []

            for s in e.get("senses", []):
                gl, tags = s.get("glosses") or [], set(s.get("tags") or [])

                if not gl or "no-gloss" in tags:
                    continue

                sense: dict = {"g": clean_gloss(gl[-1])}
                kept = sorted(tags & KEEP_TAGS)
                target = (s.get("alt_of") or s.get("form_of") or [{}])[0].get("word")

                if kept:
                    sense["t"] = kept

                if target and target != w:
                    sense["to"] = target

                ex = next((x for x in s.get("examples") or [] if x.get("text") and x.get("english") and len(x["text"]) <= 140), None)

                if ex:
                    sense["x"] = [ex["text"].strip(), ex["english"].strip()]

                senses.append(sense)

            if not senses:
                continue

            entry: dict = {"p": pos, "s": senses[:MAX_SENSES]}
            pron = next((f["form"] for f in e.get("forms") or [] if "canonical" in (f.get("tags") or []) and re.search("[êé]", f.get("form", ""))), None)

            if pron:
                entry["pr"] = pron

            af = affix_info(e.get("etymology_templates") or [])

            if af and af[0] != w:
                root_of.setdefault(w, af[0])
                affixes_of.setdefault(w, af[1])

            for d in e.get("derived") or []:
                dw = (d.get("word") or "").strip()

                if WORD.match(dw) and dw != w:
                    derived_of.setdefault(dw, w)

            if pos == "verb":
                for fm in e.get("forms") or []:
                    fw = fm.get("form", "")

                    if WORD.match(fw) and fw != w and {"active", "passive"} & set(fm.get("tags") or []):
                        derived_of.setdefault(fw, w)

            lex[w].append(entry)

    for w, r in derived_of.items():
        root_of.setdefault(w, r)

    say(f"  {len(lex):,} words, {len(root_of):,} with a known root")

    return lex, root_of, affixes_of


def base_root(w: str, root_of: dict[str, str]) -> str:
    """Follow roots down to the base: pelajaran -> pelajar -> ajar."""
    seen = {w}

    while w in root_of and root_of[w] not in seen:
        w = root_of[w]
        seen.add(w)

    return w


def primary(entries: list[dict]) -> tuple[dict, dict] | None:
    """The entry and sense to show first. A word with several entries (bisa: "venom" and "can") shows the one with
    the most current senses, which is nearly always the everyday one; archaic senses only when there's nothing else."""
    current = lambda e: [s for s in e["s"] if not OLD & set(s.get("t", []))]   # noqa: E731
    ranked = sorted(entries, key=lambda e: -len(current(e)))

    for e in ranked:
        if current(e):
            return e, current(e)[0]

    return (entries[0], entries[0]["s"][0]) if entries else None


def inflection_of(lex: dict[str, list[dict]], w: str) -> str | None:
    """The base word when w is only an inflected form (dilakukan -> lakukan, jadilah -> jadi), so the deck doesn't
    get a card for each. Casual and alternative spellings (tau -> tahu) aren't inflections: they keep their own card."""
    p = primary(lex.get(w, []))

    if not p:
        return None

    tags, target = set(p[1].get("t", [])), p[1].get("to")

    if target in lex and "form-of" in tags and not tags & (SLANG_TAGS | CASUAL_TAGS | {"abbreviation"}) and ("passive" in tags or "imperative" in tags or w.endswith(("lah", "kah"))):
        return target

    return None


def register(tags: set[str]) -> str:
    if tags & SLANG_TAGS:
        return "slang"

    if tags & CASUAL_TAGS:
        return "casual"

    return "formal" if "formal" in tags else "neutral"


def short_gloss(lex: dict[str, list[dict]], w: str, depth: int = 0) -> tuple[str, str | None]:
    """A card-sized meaning (up to two senses), and the standard form when w is a casual/alternative spelling."""
    p = primary(lex.get(w, []))

    if not p:
        return "", None

    e, s = p
    m = FORM_OF_GLOSS.match(s["g"])

    # "active of penuhi": the meaning is the base word's; the word itself is the standard form, so no std
    if m and m.group(1) in lex and depth < 2:
        return short_gloss(lex, m.group(1), depth + 1)[0], None

    if s.get("to") and s["to"] in lex and depth < 2:
        g, _ = short_gloss(lex, s["to"], depth + 1)
        tags = set(s.get("t", []))

        return g, (s["to"] if "alt-of" in tags or tags & (SLANG_TAGS | CASUAL_TAGS | {"abbreviation"}) else None)

    std = None
    gl = []

    for x in e["s"]:
        if OLD & set(x.get("t", [])) or x.get("to") or FORM_OF_GLOSS.match(x["g"]):
            continue

        g, r = x["g"], REF_GLOSS.match(x["g"])

        # a cross-reference: use the quoted meaning, else the target's; a shortened form (ku, ni, nak) is casual for it
        if r:
            g = r.group(3) or (short_gloss(lex, r.group(2), depth + 1)[0] if r.group(2) in lex and depth < 2 else "")
            std = std or (r.group(2) if SHORTENED.search(r.group(1)) else None)

        if g and g not in gl:
            gl.append(g)

        if len(gl) == 2:
            break

    text = "; ".join(gl or [s["g"]])

    return (text[:110].rsplit(" ", 1)[0] + "…" if len(text) > 110 else text), std


# ---------- forms ----------
class Analyser:
    """Maps any surface form to a dictionary word: itself, minus clitics (-nya, -ku…), casual affixes, or a stem."""

    def __init__(self, lex: dict[str, list[dict]]) -> None:
        from Sastrawi.Stemmer.StemmerFactory import StemmerFactory

        self.lex = lex
        self.stemmer = StemmerFactory().create_stemmer()
        self.cache: dict[str, str | None] = {}

    def casual(self, f: str) -> str | None:
        for base in (f, f[:-2] if f.endswith("in") and len(f) > 4 else ""):
            if not base:
                continue

            if base != f and base in self.lex:
                return base

            for p, add in CASUAL_PREFIXES:
                if base.startswith(p) and len(base) - len(p) >= 3:
                    r = add + base[len(p):]

                    if r in self.lex:
                        return r

        return None

    def lemma(self, f: str) -> str | None:
        if f in self.cache:
            return self.cache[f]

        found = f if f in self.lex else None
        bases = [f[: -len(c)] for c in CLITICS if f.endswith(c) and len(f) - len(c) >= 3]

        found = found or next((b for b in bases if b in self.lex), None)
        found = found or next((x for x in (self.casual(b) for b in [f, *bases]) if x), None)

        if not found:
            s = self.stemmer.stem(f)
            found = s if s in self.lex else None

        self.cache[f] = found

        return found


def load_freq() -> list[str]:
    words = []

    with open(FREQ, encoding="utf-8") as f:
        for line in f:
            w = line.split(" ", 1)[0].strip()

            if WORD.match(w):
                words.append(w)

    return words


# ---------- sentences ----------
def load_tatoeba() -> dict[int, tuple[str, str]]:
    say("Reading Tatoeba sentences…")
    ind: dict[int, str] = {}

    with bz2.open(TATOEBA_IND, "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")

            if len(parts) >= 3:
                ind[int(parts[0])] = parts[2].strip()

    links: dict[int, list[int]] = defaultdict(list)

    with bz2.open(TATOEBA_LINKS, "rt", encoding="utf-8") as f:
        for line in f:
            a, b = line.split("\t")[:2]

            if int(a) in ind:
                links[int(a)].append(int(b))

    want = {b for v in links.values() for b in v}
    eng: dict[int, str] = {}

    with bz2.open(TATOEBA_ENG, "rt", encoding="utf-8") as f:
        for line in f:
            i, _, rest = line.partition("\t")

            if int(i) in want:
                eng[int(i)] = rest.split("\t", 1)[1].strip()

    pairs = {}

    for i, text in ind.items():
        en = next((eng[b] for b in links.get(i, []) if b in eng), None)

        if en:
            pairs[i] = (text, en)

    say(f"  {len(pairs):,} Indonesian-English pairs")

    return pairs


def pick_examples(pairs: dict[int, tuple[str, str]], an: Analyser, rank: dict[str, int], wanted: set[str]) -> dict[str, list[int]]:
    """Up to EXAMPLES sentences per word: short, and with the easiest other words (lowest frequency rank)."""
    say("Choosing example sentences…")
    found: dict[str, list[tuple[tuple[int, int], int]]] = defaultdict(list)

    for sid, (text, _) in pairs.items():
        tokens = TOKEN.findall(text.lower())

        if not 3 <= len(tokens) <= 14 or ENGLISH & set(tokens):
            continue

        lemmas = [an.lemma(t) for t in tokens]
        ranks = [rank.get(t, 50000) for t in tokens]

        for i, lm in enumerate(lemmas):
            if lm in wanted:
                hardest = max((r for j, r in enumerate(ranks) if j != i), default=0)
                found[lm].append(((hardest // 500, abs(len(tokens) - 7)), sid))

    return {w: [sid for _, sid in sorted(v)[:EXAMPLES]] for w, v in found.items()}


# ---------- slang ----------
def load_slang() -> list[dict]:
    items = yaml.safe_load((CONTENT / "slang.yaml").read_text(encoding="utf-8")) or []

    for it in items:
        it["form"] = str(it["form"]).lower()
        it["also"] = [str(a).lower() for a in it.get("also") or []]

    return items


def slang_table(items: list[dict], lex: dict[str, list[dict]]) -> dict[str, dict]:
    """Every casual/chat spelling -> its meaning and standard form. Hand-written entries win over Wiktionary's."""
    table: dict[str, dict] = {}

    for w, entries in lex.items():
        for e in entries:
            for s in e["s"]:
                tags = set(s.get("t", []))

                if s.get("to") and tags & (SLANG_TAGS | CASUAL_TAGS | {"abbreviation"}) and " " not in w:
                    g, _ = short_gloss(lex, s["to"])

                    table.setdefault(w, {"std": s["to"], "en": g, "kind": "abbrev" if "abbreviation" in tags else register(tags), "src": "wiktionary"})

    for it in items:
        row = {k: it[k] for k in ("std", "en", "kind", "note") if it.get(k)}
        row["src"] = "hand"

        if it["also"]:
            row["also"] = it["also"]

        table[it["form"]] = row

        for a in it["also"]:
            table[a] = {"see": it["form"]}

    return table


# ---------- public build ----------
def build() -> None:
    need(KAIKKI, FREQ, TATOEBA_IND, TATOEBA_ENG, TATOEBA_LINKS)
    lex, root_of, affixes_of = load_lexicon()
    overrides = yaml.safe_load((CONTENT / "overrides.yaml").read_text(encoding="utf-8")) or {}
    gloss_fix = overrides.get("gloss") or {}

    for w, r in (overrides.get("roots") or {}).items():
        if r:
            root_of[w] = r
        else:
            root_of.pop(w, None)
            affixes_of.pop(w, None)

    freq = load_freq()
    rank = {w: i + 1 for i, w in enumerate(freq)}
    an = Analyser(lex)
    slang = load_slang()
    manifest: dict = {"files": {}}

    def root(w: str) -> str:
        return base_root(w, root_of)

    # forms: the most frequent words (and every casual spelling) -> dictionary word and root
    say("Analysing word forms…")
    forms: dict[str, list[str]] = {}

    for w in freq[:FORMS_TOP] + [s["form"] for s in slang] + [a for s in slang for a in s["also"]]:
        lm = an.lemma(w)

        if not lm:
            continue

        r = root(lm)

        if lm != w or r != lm:
            forms[w] = ["" if lm == w else lm, "" if r == lm else r]

    say(f"  {len(forms):,} forms mapped")

    # deck: dictionary words in order of first appearance in the frequency list
    say("Building the deck…")
    # hand-written casual words get their own (early) place; their alternative spellings (nggak for gak) no card
    slang_forms = {s["form"] for s in slang if s.get("deck")} | {a for s in slang for a in s["also"]} | set(overrides.get("skip") or [])
    main, seen = [], set()

    for w in freq:
        lm = an.lemma(w)
        lm = (inflection_of(lex, lm) or lm) if lm else None

        if not lm or lm in seen or len(lm) < 2 or lm in slang_forms:
            continue

        p = primary(lex[lm])

        if not p or p[0]["p"] in ("prefix", "suffix", "root", "infix", "circumfix"):
            continue

        g, std = short_gloss(lex, lm)
        g = gloss_fix.get(lm, g)

        if not g:
            continue

        seen.add(lm)
        item = {"id": lm, "w": lm, "g": g, "p": p[0]["p"], "reg": register(set(p[1].get("t", []))), "rank": rank[w]}

        if std:
            item["std"] = std

        if root(lm) != lm:
            item["r"] = root(lm)

        if p[0].get("pr"):
            item["pr"] = p[0]["pr"]

        main.append(item)

        if len(main) >= DECK_SIZE:
            break

    extra = []

    for s in slang:
        if not s.get("deck"):
            continue

        item = {"id": s["form"], "w": s["form"], "g": s["en"], "p": (primary(lex[s["form"]]) or ({"p": "phrase"},))[0]["p"] if s["form"] in lex else "phrase",
                "reg": "slang" if s.get("kind") in ("slang", "laugh", "abbrev") else "casual", "rank": rank.get(s["form"], 0), "sl": 1}

        for k_in, k_out in (("std", "std"), ("note", "n"), ("also", "also")):
            if s.get(k_in):
                item[k_out] = s[k_in]

        extra.append(item)

    deck, ei = [], 0

    for i, item in enumerate(main):
        if ei < len(extra) and i >= SLANG_START and (i - SLANG_START) % SLANG_EVERY == 0:
            deck.append(extra[ei])
            ei += 1

        deck.append(item)

    deck.extend(extra[ei:])
    deck = deck[:DECK_SIZE]

    # examples: Tatoeba first, Wiktionary's own example as the fallback
    pairs = load_tatoeba()
    chosen = pick_examples(pairs, an, rank, {d["id"] for d in deck})
    used: dict[int, list[str]] = {}

    for d in deck:
        ids = chosen.get(d["id"], [])

        if ids:
            d["x"] = ids
            used.update({i: list(pairs[i]) for i in ids})
        elif d["id"] in lex:
            ex = next((s["x"] for e in lex[d["id"]] for s in e["s"] if s.get("x")), None)

            if ex:
                d["xi"] = ex

    with_ex = sum(1 for d in deck if d.get("x") or d.get("xi"))
    say(f"  {len(deck):,} deck words ({sum(1 for d in deck if d.get('sl'))} hand-written casual), {with_ex:,} with an example")

    # dictionary shards by first letter; root families
    say("Writing files…")
    shards: dict[str, dict] = defaultdict(dict)
    families: dict[str, list[str]] = defaultdict(list)

    for w, entries in lex.items():
        out = []

        for e in entries:
            e = dict(e)
            r = root(w)

            if r != w:
                e["r"] = r

            if w in affixes_of:
                e["af"] = affixes_of[w]

            out.append(e)

        shards[w[0] if "a" <= w[0] <= "z" else "_"][w] = out

        if root(w) != w and " " not in w:
            families[root(w)].append(w)

    for k, v in sorted(shards.items()):
        manifest["files"][f"lexicon/{k}.json"] = write_json(OUT / "lexicon" / f"{k}.json", v)

    families = {r: sorted(ws) for r, ws in sorted(families.items()) if r in lex}

    manifest["files"]["deck.json"] = write_json(OUT / "deck.json", deck)
    manifest["files"]["forms.json"] = write_json(OUT / "forms.json", forms)
    manifest["files"]["families.json"] = write_json(OUT / "families.json", families)
    manifest["files"]["sentences.json"] = write_json(OUT / "sentences.json", used)
    manifest["files"]["slang.json"] = write_json(OUT / "slang.json", slang_table(slang, lex))

    manifest["version"] = hashlib.sha256(json.dumps(manifest["files"], sort_keys=True).encode()).hexdigest()[:12]
    manifest["built"] = date.today().isoformat()
    manifest["counts"] = {"words": len(lex), "deck": len(deck), "forms": len(forms), "families": len(families), "sentences": len(used)}
    manifest["sources"] = SOURCES
    write_json(OUT / "manifest.json", manifest)

    total = sum(f["bytes"] for f in manifest["files"].values())
    say(f"✓ {OUT.relative_to(ROOT)}: {len(manifest['files'])} files, {total / 1e6:.1f} MB before compression (version {manifest['version']})")


# ---------- PDFs (private) ----------
BOILERPLATE = re.compile(r"indonesianpod101|click|here|writing practice|^meaning$|^indonesian$|copy this line|write it here|copyright|free|lifetime|worksheet|workbook|^note:|^practice$|cakap\.com|^\d+$", re.I)


def clean_text(s: str) -> str:
    s = s.replace("\xad", "").replace("‐", "-").replace("’", "'").replace("‘", "'")
    s = re.sub(r"[\t\r\xa0]+", " ", s)
    s = re.sub(r"-+", "-", s)

    return re.sub(r"\s+", " ", s).strip()


def spans_of(page) -> list[dict]:
    out = []

    for b in page.get_text("dict")["blocks"]:
        for line in b.get("lines", []):
            for s in line["spans"]:
                t = clean_text(s["text"])

                if t:
                    out.append({"t": t, "x": s["bbox"][0], "x1": s["bbox"][2], "y": s["bbox"][1], "size": s["size"], "font": s["font"],
                                "bold": "Bold" in s["font"] or "-700" in s["font"] or bool(s["flags"] & 16), "line": id(line)})

    return out


class PdfReader:
    """Recognises the layouts seen so far (_docs/indonesian-data.md) and turns them into candidates."""

    def __init__(self) -> None:
        self.words: set[str] = set()

        for f in (OUT / "lexicon").glob("*.json"):
            self.words.update(json.loads(f.read_text(encoding="utf-8")))

        self.forms: dict[str, list[str]] = json.loads((OUT / "forms.json").read_text(encoding="utf-8"))
        self.deck = {d["id"]: i for i, d in enumerate(json.loads((OUT / "deck.json").read_text(encoding="utf-8")))}

    def lemma(self, w: str) -> str | None:
        w = w.lower()

        if w in self.forms:
            return self.forms[w][0] or w

        return w if w in self.words else None

    def indonesian_share(self, text: str) -> float:
        toks = TOKEN.findall(text.lower())

        return sum(1 for t in toks if self.lemma(t)) / len(toks) if toks else 0

    def candidate(self, kind: str, ind: str, en: str, src: dict, **extra: object) -> dict:
        ind, en = ind.strip(" ;,"), en.strip(" ;,")
        head = ind.split(",")[0].strip().lower()
        lm = self.lemma(head) if " " not in head else (head if head in self.words else None)
        c = {"id": hashlib.sha1(f"{src['file']}|{ind}|{en}".encode()).hexdigest()[:12], "kind": kind, "indonesian": ind, "english": en, **{k: v for k, v in extra.items() if v}, **src}
        c["lemma"] = lm
        c["status"] = "in-deck" if lm in self.deck else "dictionary" if lm else "new"

        if lm in self.deck:
            c["deck_pos"] = self.deck[lm] + 1

        return c

    # The 300-word card books: "CARD 001", "root, form ~ meaning", a bold example + translation, numbered derived forms
    def cards(self, doc, name: str) -> list[dict]:
        out, card = [], None

        for pno, page in enumerate(doc, 1):
            lines: dict[int, list[dict]] = defaultdict(list)

            for s in spans_of(page):
                lines[s["line"]].append(s)

            for spans in lines.values():
                text = " ".join(s["t"] for s in spans)
                src = {"file": name, "page": pno}

                if m := re.match(r"^CARD (\d{3})$", text):
                    card = {"no": int(m.group(1)), "head": None}
                elif card and card["head"] is None and "~" in text:
                    left, right = text.split("~", 1)
                    heads = [h.strip() for h in left.split(",") if h.strip()]   # "makan, memakan": root first, then the meN- form
                    card["head"] = self.candidate("word", heads[0], right, src, topic="300 most common words", card=card["no"], also=heads[1:])
                    card["head"]["root"] = heads[0]
                    out.append(card["head"])
                elif card and card["head"] and spans[0]["bold"] and not re.match(r"^\d+$", spans[0]["t"]) and any(not s["bold"] for s in spans):
                    card["head"]["example"] = " ".join(s["t"] for s in spans if s["bold"])
                    card["head"]["example_en"] = " ".join(s["t"] for s in spans if not s["bold"])
                elif card and card["head"] and re.match(r"^\d+$", spans[0]["t"]) and len(spans) >= 3:
                    ind = " ".join(s["t"] for s in spans[1:] if s["bold"])
                    en = " ".join(s["t"] for s in spans[1:] if not s["bold"])
                    out.append(self.candidate("derived", ind, en, src, topic="300 most common words", card=card["no"], root=card["head"]["root"]))

        return out

    # Word lists in three columns: word, part of speech, "=meaning"
    def word_list(self, doc, name: str) -> list[dict]:
        out = []
        pos_names = {"v.": "verb", "n.": "noun", "adj.": "adj", "adv.": "adv", "p.": "particle", "pron.": "pron", "conj.": "conj", "prep.": "prep", "num.": "num"}

        for pno, page in enumerate(doc, 1):
            rows: dict[int, list[dict]] = defaultdict(list)

            for s in spans_of(page):
                rows[round(s["y"])].append(s)

            for spans in rows.values():
                gloss = next((s for s in spans if s["t"].startswith("=")), None)
                pos = next((s for s in spans if s["t"] in pos_names), None)

                if gloss and pos:
                    word = re.sub(r"\(\d+\)", "", " ".join(s["t"] for s in spans if s["x"] < pos["x"])).strip()
                    out.append(self.candidate("word", word, gloss["t"][1:], {"file": name, "page": pno}, pos=pos_names[pos["t"]], topic=Path(name).stem))

        return out

    # Worksheets and similar. A table under an "Indonesian | Meaning" header pairs by column; otherwise a bold
    # Indonesian line pairs with plain English on the same row (to the right) or just below it.
    def pairs(self, doc, name: str) -> list[dict]:
        out, seen = [], set()
        topic = re.sub(r"^\d+\+?\s*", "", Path(name).stem).strip()

        def add(ind: str, en: str, pno: int) -> None:
            key = (ind.lower(), en.lower())

            if key in seen or not ind or not en or re.search(r"@|https?:|www\.", en):
                return

            seen.add(key)
            kind = "phrase" if len(TOKEN.findall(ind.lower())) > 1 or re.search(r"[.?!]$", ind) else "word"
            out.append(self.candidate(kind, ind, en, {"file": name, "page": pno}, topic=topic))

        for pno, page in enumerate(doc, 1):
            every = spans_of(page)
            head_ind = next((s for s in every if s["t"].lower() == "indonesian" and s["bold"]), None)
            head_en = next((s for s in every if s["t"].lower() == "meaning" and s["bold"] and head_ind and abs(s["y"] - head_ind["y"]) <= 4), None)
            spans = [s for s in every if 8 <= s["size"] <= 16 and "Bradley" not in s["font"] and not BOILERPLATE.search(s["t"])]

            if head_ind and head_en:
                left = [s for s in spans if abs(s["x"] - head_ind["x"]) <= 12 and s["y"] > head_ind["y"]]
                right = [s for s in spans if abs(s["x"] - head_en["x"]) <= 12 and s["y"] > head_ind["y"]]

                for s in left:
                    r = min((r for r in right if abs(r["y"] - s["y"]) <= 5), key=lambda r: abs(r["y"] - s["y"]), default=None)

                    if r:
                        add(s["t"], r["t"], pno)

                continue

            before = len(out)
            plain = [s for s in spans if not s["bold"]]

            for b in (s for s in spans if s["bold"]):
                right = [r for r in plain if abs(r["y"] - b["y"]) <= 4 and r["x"] > b["x1"] and r["x"] - b["x1"] < 260]
                below = [r for r in plain if abs(r["x"] - b["x"]) <= 8 and 0 < r["y"] - b["y"] <= 30]
                r = min(right, key=lambda r: r["x"]) if right else min(below, key=lambda r: r["y"]) if below else None

                if r and self.indonesian_share(b["t"]) >= 0.5 and self.indonesian_share(r["t"]) < 0.5:
                    add(b["t"], r["t"], pno)

            if len(out) > before:
                continue

            # Numbered sentences: Indonesian in larger type (possibly wrapped over two lines), English smaller below
            column = sorted((s for s in plain if not re.match(r"^\d+$", s["t"])), key=lambda s: (round(s["x"] / 8), s["y"]))
            merged: list[dict] = []

            for s in column:
                m = merged[-1] if merged else None

                if m and abs(m["x"] - s["x"]) <= 6 and abs(m["size"] - s["size"]) < 1 and 0 < s["y"] - m["y"] <= 22 * (m["t"].count("\n") + 1):
                    m["t"] += "\n" + s["t"]
                else:
                    merged.append(dict(s))

            for a, b in zip(merged, merged[1:], strict=False):
                if abs(a["x"] - b["x"]) <= 6 and a["size"] - b["size"] >= 3 and 0 < b["y"] - a["y"] <= 60:
                    ind, en = a["t"].replace("\n", " "), b["t"].replace("\n", " ")

                    if self.indonesian_share(ind) >= 0.5 and self.indonesian_share(en) < 0.5:
                        add(ind, en, pno)

        return out

    def read(self, path: Path) -> tuple[str, list[dict], str]:
        import pymupdf

        doc = pymupdf.open(path)

        if doc.needs_pass:
            return "locked", [], "password protected, skipped"

        text = "".join(p.get_text() for p in doc[: min(30, doc.page_count)])

        if len(text.strip()) < 50:
            return "none", [], "no text layer (scanned?), skipped"

        # Worksheets open with pages of English instructions, so judge by how much Indonesian there is overall
        known = sum(1 for t in TOKEN.findall(text.lower()) if self.lemma(t))

        if known < 40 and self.indonesian_share(text) < 0.15:
            return "none", [], "doesn't look like Indonesian material, skipped"

        if re.search(r"CARD\s+\d{3}", clean_text(text)):
            return "cards", self.cards(doc, path.name), ""

        found = self.word_list(doc, path.name)

        if len(found) >= 20:
            return "word-list", found, ""

        found = self.pairs(doc, path.name)

        # A long book with only the odd "pair" (credits, captions) is reading material, not a word list
        if doc.page_count > 40 and len(found) < doc.page_count / 2:
            return "reading", [], f"{doc.page_count} pages of Indonesian text without translations: reading material, kept for later"

        return ("pairs", found, "") if found else ("none", [], "no word/translation pairs found (reading material? kept for later)")


def build_pdfs() -> None:
    if not (OUT / "forms.json").exists():
        sys.exit("Run `python build_indonesian.py` first: the PDF step checks words against the built dictionary.")

    files = sorted(PDFS.glob("*.pdf"))

    if not files:
        sys.exit(f"No PDFs in {PDFS}")

    reader, report, cands = PdfReader(), [], []

    for f in files:
        try:
            parser, found, note = reader.read(f)
        except Exception as e:
            parser, found, note = "error", [], str(e)

        report.append({"file": f.name, "parser": parser, "candidates": len(found), "note": note})
        cands.extend(found)
        say(f"{'✓' if found else '-'} {f.name}: {parser}, {len(found)} candidates" + (f"  ({note})" if note else ""))

    by_id = {c["id"]: c for c in cands}
    status = defaultdict(int)

    for c in by_id.values():
        status[c["status"]] += 1

    write_json(PRIVATE / "pdf-candidates.json", {"format": "idn-pdf-candidates", "version": 1, "built": date.today().isoformat(), "files": report, "candidates": list(by_id.values())})
    say(f"✓ {(PRIVATE / 'pdf-candidates.json').relative_to(ROOT)}: {len(by_id)} candidates ({', '.join(f'{v} {k}' for k, v in sorted(status.items()))}). Private: never commit it.")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Build the Indonesian learning data.")
    ap.add_argument("what", nargs="?", default="data", choices=["data", "pdfs", "all"])
    what = ap.parse_args().what

    if what in ("data", "all"):
        build()

    if what in ("pdfs", "all"):
        build_pdfs()


if __name__ == "__main__":
    main()
