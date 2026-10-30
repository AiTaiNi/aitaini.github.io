"""
Turn BCP statement PDFs into JSON files for the statements page (personal/statements/).

`python parse_statements.py`                     every PDF in personal/statements/examples
`python parse_statements.py FILE_OR_FOLDER ...`  specific PDFs or folders
`--out DIR`                                      where the JSON goes (default personal/statements/json, git-ignored)

EECC_AHORRO* is the debit (savings) account and EECC_VISA* the credit card. The account, period and currency are
read from the PDF itself. The PDF password is asked for once (or set BCP_PDF_PASSWORD).
Output format: _docs/statements.md.
"""

import argparse
import getpass
import hashlib
import json
import os
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import pymupdf

ROOT = Path(__file__).parent
DEFAULT_IN = ROOT / "personal" / "statements" / "examples"
DEFAULT_OUT = ROOT / "personal" / "statements" / "json"

MONTHS = {"ENE": 1, "FEB": 2, "MAR": 3, "ABR": 4, "MAY": 5, "JUN": 6, "JUL": 7, "AGO": 8, "SET": 9, "SEP": 9, "OCT": 10, "NOV": 11, "DIC": 12}
SHORT_DATE = re.compile(r"^(\d{1,2})([A-Za-z]{3})$")   # 05DIC, 11Set
FULL_DATE = re.compile(r"^(\d{2})/(\d{2})/(\d{2}|\d{4})$")   # 11/12/25
AMOUNT = re.compile(r"^(-?)(\d{1,3}(?:,\d{3})*|\d*)\.(\d{2})(-?)$")   # 1,234.56  .71  1,580.58-
MARKER = re.compile(r"^[*\d]$")   # footnote marks after a debit description ("*" = ITF exempt, "1" = fee note)


class ParseError(Exception):
    pass


def norm(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c)).upper()


# ---------- PDF → rows of positioned words ----------
@dataclass
class Word:
    x0: float
    x1: float
    s: str

    @property
    def c(self) -> float:
        return (self.x0 + self.x1) / 2


@dataclass
class Row:
    page: int
    y: float
    words: list[Word]

    @property
    def text(self) -> str:
        """The line as printed, with wide gaps kept as double spaces."""
        out = ""

        for i, w in enumerate(self.words):
            if i: out += "  " if w.x0 - self.words[i - 1].x1 > 8 else " "
            out += w.s

        return out

    @property
    def norm(self) -> str:
        return norm(" ".join(w.s for w in self.words))

    @property
    def label(self) -> str:
        """The line's text without its amounts."""
        return norm(" ".join(w.s for w in self.words if not cents(w.s)))

    def find(self, s: str) -> Word | None:
        return next((w for w in self.words if norm(w.s) == s), None)


def read_rows(doc: pymupdf.Document) -> list[Row]:
    rows: list[Row] = []

    for pi, page in enumerate(doc, 1):
        page_rows: list[Row] = []

        for x0, _y0, x1, y1, s, *_ in sorted(page.get_text("words"), key=lambda w: (w[3], w[0])):
            if page_rows and abs(page_rows[-1].y - y1) <= 2.5:
                page_rows[-1].words.append(Word(x0, x1, s))
            else:
                page_rows.append(Row(pi, y1, [Word(x0, x1, s)]))

        for r in page_rows:
            r.words.sort(key=lambda w: w.x0)

        rows += page_rows

    return rows


# ---------- tokens ----------
def cents(s: str) -> tuple[int, bool] | None:
    """'1,234.56' → (123456, False); '45.00-' → (4500, True)."""
    m = AMOUNT.match(s)

    if not m: return None

    return int((m[2] or "0").replace(",", "") + m[3]), bool(m[1] or m[4])


def full_date(s: str) -> date | None:
    m = FULL_DATE.match(s)

    if not m: return None

    y = int(m[3])

    try:
        return date(y + 2000 if y < 100 else y, int(m[2]), int(m[1]))
    except ValueError:
        return None


def short_date(s: str, end: date) -> date | None:
    """'05DIC' → the latest such date on or shortly after the statement's end (so December rows in a January statement get last year)."""
    m = SHORT_DATE.match(s)

    if not m or norm(m[2]) not in MONTHS: return None

    for y in (end.year, end.year - 1):
        try:
            d = date(y, MONTHS[norm(m[2])], int(m[1]))
        except ValueError:
            continue

        if d <= end + timedelta(days=7): return d

    return None


def nearest(cols: dict[str, float], w: Word) -> tuple[str, float]:
    k = min(cols, key=lambda k: abs(cols[k] - w.c))

    return k, abs(cols[k] - w.c)


def amounts_above(rows: list[Row], label: Row) -> list[Word]:
    """Totals are printed just above their label ("TOTAL MOVIMIENTO", "SALDO"); sometimes on the same line."""
    own = [w for w in label.words if cents(w.s)]

    if own: return own

    above = [r for r in rows if r.page == label.page and 0 < label.y - r.y <= 14 and all(cents(w.s) for w in r.words)]

    return above[-1].words if above else []


# ---------- statements ----------
@dataclass
class Tx:
    posted_on: date
    value_date: date | None
    description: str
    cents: int   # < 0 money out, > 0 money in
    currency: str
    reference: str | None
    raw: str
    flags: list[str] = field(default_factory=list)


@dataclass
class Statement:
    account: str
    parser: str
    start: date
    end: date
    txs: list[Tx] = field(default_factory=list)
    balances: dict[str, dict[str, int]] = field(default_factory=dict)   # {"PEN": {"opening": cents, "closing": cents}}; card balances are debt
    totals: dict[str, int] = field(default_factory=dict)   # debit only: printed total charges/deposits, for checking
    warnings: list[str] = field(default_factory=list)


def find_period(rows: list[Row]) -> tuple[date, date]:
    """First line with two full dates: "DEL 01/12/25 AL 31/12/25" (debit) or the card's "Del … Al …" line (credit)."""
    for r in rows:
        if r.page > 1: break

        ds = [d for d in (full_date(w.s) for w in r.words) if d]

        if len(ds) >= 2: return ds[0], ds[1]

    raise ParseError("couldn't find the statement period")


def parse_debit(rows: list[Row], start: date, end: date) -> Statement:
    """Savings account: FECHA PROC. | FECHA VALOR | DESCRIPCION | CARGOS / DEBE | ABONOS / HABER, one currency per account."""
    st = Statement("debit", "bcp-debit-v1", start, end)
    cols: dict[int, dict[str, float]] = {}
    first_header = None

    for i, r in enumerate(rows):
        out, inn = r.find("CARGOS"), r.find("ABONOS")

        if out and inn:
            debe, haber = r.find("DEBE"), r.find("HABER")
            cols[r.page] = {"out": (out.x0 + (debe.x1 if debe else out.x1)) / 2, "in": (inn.x0 + (haber.x1 if haber else inn.x1)) / 2}

            if first_header is None: first_header = i

    if first_header is None: raise ParseError("no CARGOS / ABONOS column header")

    # The account's currency is printed under MONEDA, above the table
    found = {norm(w.s) for r in rows[:first_header] for w in r.words} & {"SOLES", "DOLARES"}

    if len(found) != 1:
        st.warnings.append("couldn't read the account currency (MONEDA); assumed PEN")

    currency = "USD" if found == {"DOLARES"} else "PEN"
    col: dict[str, float] = {}

    for r in rows:
        col = cols.get(r.page, col)
        ws = r.words

        if not col: continue

        if "SALDO ANTERIOR" in r.norm:
            a = [w for w in ws if cents(w.s)]

            if a:
                c, neg = cents(a[-1].s)
                st.balances.setdefault(currency, {})["opening"] = -c if neg else c

            continue

        if r.label == "TOTAL MOVIMIENTO":
            for w in amounts_above(rows, r):
                st.totals[nearest(col, w)[0]] = cents(w.s)[0]

            continue

        if r.label == "SALDO":
            a = amounts_above(rows, r)

            if a:
                c, neg = cents(a[-1].s)
                st.balances.setdefault(currency, {})["closing"] = -c if neg else c

            continue

        d1 = short_date(ws[0].s, end) if ws else None
        d2 = short_date(ws[1].s, end) if len(ws) > 1 else None

        if not (d1 and d2): continue

        amts = [w for w in ws[2:] if cents(w.s)]

        if len(amts) != 1:
            st.warnings.append(f"p{r.page}: skipped, expected one amount: {r.text}")
            continue

        a, flags = amts[0], []
        c, neg = cents(a.s)
        side, dist = nearest(col, a)

        if dist > 60: flags.append("amount isn't clearly under CARGOS or ABONOS")

        if neg: flags.append("amount printed with a minus sign")

        desc = [w.s for i, w in enumerate(ws[2:], 2) if w is not a and not (MARKER.match(w.s) and w.x0 - ws[i - 1].x1 > 15)]
        st.txs.append(Tx(d1, d2, " ".join(desc), -c if side == "out" else c, currency, None, r.text, flags))

    return st


def parse_credit(rows: list[Row], start: date, end: date) -> Statement:
    """Visa card: Fecha de proceso | Fecha de consumo | Descripción | Tipo de Operación | Soles | Dólares.
    Movements run from SALDO ANTERIOR to MONTO TOTAL FACTURADO; the installment plan after that is not a movement."""
    st = Statement("credit", "bcp-credit-v1", start, end)
    cols: dict[int, dict[str, float]] = {}
    tipo_x: dict[int, float] = {}

    for r in rows:
        soles, dolares, tipo = r.find("SOLES"), r.find("DOLARES"), r.find("TIPO")

        if soles and dolares and tipo:
            cols[r.page] = {"PEN": soles.c, "USD": dolares.c}
            tipo_x[r.page] = tipo.x0

    if not cols: raise ParseError("no Soles / Dólares column header")

    def by_currency(r: Row) -> dict[str, int]:
        out = {}

        for w in r.words:
            if (v := cents(w.s)) and nearest(col, w)[1] < 45:
                out[nearest(col, w)[0]] = -v[0] if v[1] else v[0]

        return out

    col: dict[str, float] = {}
    tx_x = 0.0
    started = done = False

    for r in rows:
        col = cols.get(r.page, col)
        tx_x = tipo_x.get(r.page, tx_x)
        ws, t = r.words, r.norm

        if not col: continue

        if "SALDO ANTERIOR" in t:
            for k, v in by_currency(r).items():
                st.balances.setdefault(k, {})["opening"] = v

            started = True
            continue

        if not started: continue

        if "MONTO TOTAL FACTURADO" in t:
            for k, v in by_currency(r).items():
                st.balances.setdefault(k, {})["closing"] = v

            done = True
            break

        if "SUB TOTAL" in t: continue

        amts = [w for w in ws if cents(w.s) and nearest(col, w)[1] < 45]
        d1 = short_date(ws[0].s, end) if ws else None
        d2 = short_date(ws[1].s, end) if len(ws) > 1 else None

        if d1 and d2:
            if len(amts) != 1:
                st.warnings.append(f"p{r.page}: skipped, expected one amount: {r.text}")
                continue

            a = amts[0]
            c, neg = cents(a.s)
            desc = [w.s for w in ws[2:] if w is not a and w.x0 < tx_x - 5]
            kind = [w.s for w in ws[2:] if w is not a and w.x0 >= tx_x - 5]
            # Charges are money out; "-" marks payments, refunds and reversals (money in)
            st.txs.append(Tx(d1, d2, " ".join(desc), c if neg else -c, nearest(col, a)[0], " ".join(kind) or None, r.text))
        elif amts and not cents(ws[0].s) and ws[0].x0 > 120:
            # Undated charges billed at the close: insurance, interest, fees
            a = amts[0]
            c, neg = cents(a.s)

            if c: st.txs.append(Tx(end, None, " ".join(w.s for w in ws if w not in amts), c if neg else -c, nearest(col, a)[0], "CARGO", r.text))
        elif d1 and not amts:
            st.warnings.append(f"p{r.page}: skipped dated line with no amount: {r.text}")

    if not done: st.warnings.append("didn't find MONTO TOTAL FACTURADO; the statement may be cut short")

    # A currency printed on one balance line but blank on the other means zero there
    for b in st.balances.values():
        b.setdefault("opening", 0)
        b.setdefault("closing", 0)

    return st


# ---------- checks + output ----------
def checks(st: Statement) -> list[dict]:
    """Opening + movements = closing, per currency (card balances are debt, so spending raises them). Debit also checks the printed totals."""
    out = []

    for cur, b in sorted(st.balances.items()):
        if "opening" not in b or "closing" not in b: continue

        s = sum(t.cents for t in st.txs if t.currency == cur)
        expected = b["opening"] - s if st.account == "credit" else b["opening"] + s
        out.append({"check": f"{cur} balance", "ok": expected == b["closing"], "expected": expected / 100, "printed": b["closing"] / 100})

    for side, label in (("out", "charges"), ("in", "deposits")):
        if side in st.totals:
            got = sum(abs(t.cents) for t in st.txs if (t.cents < 0) == (side == "out") and t.cents)
            out.append({"check": f"total {label}", "ok": got == st.totals[side], "expected": got / 100, "printed": st.totals[side] / 100})

    for cur in {t.currency for t in st.txs} - set(st.balances):
        out.append({"check": f"{cur} balance", "ok": False, "expected": None, "printed": None})

    return out


def parse_pdf(path: Path, password: str) -> tuple[Statement, dict]:
    data = path.read_bytes()
    doc = pymupdf.open(stream=data, filetype="pdf")

    if doc.needs_pass and not doc.authenticate(password):
        raise ParseError("wrong PDF password")

    rows = read_rows(doc)
    first = norm(" ".join(r.text for r in rows if r.page == 1))
    by_text = "debit" if "ESTADO DE CUENTA DE AHORROS" in first else "credit" if "ESTADO DE CUENTA TARJETA" in first else None
    by_name = "debit" if norm(path.name).startswith("EECC_AHORRO") else "credit" if norm(path.name).startswith("EECC_VISA") else None
    account = by_text or by_name

    if not account: raise ParseError("not a BCP savings or Visa statement")

    start, end = find_period(rows)
    st = (parse_debit if account == "debit" else parse_credit)(rows, start, end)

    if by_text and by_name and by_text != by_name:
        st.warnings.append(f"file name suggests {by_name}, contents say {by_text}")

    if not st.txs: st.warnings.append("no transactions found")

    out = {
        "format": "bcp-statement",
        "version": 1,
        "statement": {
            "account": account,
            "period": f"{end:%Y-%m}",
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "parser": st.parser,
            "file_name": path.name,
            "file_hash": hashlib.sha256(data).hexdigest(),
            "page_count": doc.page_count,
            "balances": {k: {n: v / 100 for n, v in b.items()} for k, b in st.balances.items()},
        },
        "transactions": [
            {
                "posted_on": t.posted_on.isoformat(),
                "value_date": t.value_date.isoformat() if t.value_date else None,
                "description": t.description,
                "amount": t.cents / 100,
                "currency": t.currency,
                "reference": t.reference,
                "raw": t.raw,
                "flags": t.flags,
            }
            for t in st.txs
        ],
        "checks": checks(st),
        "warnings": st.warnings,
    }

    return st, out


def main() -> int:
    ap = argparse.ArgumentParser(description="Turn BCP statement PDFs into JSON for personal/statements/.")
    ap.add_argument("paths", nargs="*", type=Path, default=[DEFAULT_IN], help="PDF files or folders (default: personal/statements/examples)")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output folder (default: personal/statements/json)")
    args = ap.parse_args()

    pdfs = sorted({f for p in args.paths for f in ([p] if p.is_file() else p.glob("*")) if f.suffix.lower() == ".pdf"})

    if not pdfs:
        print("No PDFs found.")
        return 1

    password = os.environ.get("BCP_PDF_PASSWORD") or getpass.getpass("PDF password (blank if none): ")
    args.out.mkdir(parents=True, exist_ok=True)
    written: dict[str, tuple[Path, list]] = {}
    failed = dupes = 0

    for pdf in pdfs:
        try:
            st, out = parse_pdf(pdf, password)
        except Exception as e:
            print(f"✗ {pdf.name}: {e}")
            failed += 1
            continue

        name = f"{st.account} {st.end:%Y-%m}.json"

        if name in written:
            # BCP re-downloads get a new file (and hash) but the same contents: skip those quietly
            first, txs = written[name]

            if txs == out["transactions"]:
                dupes += 1
                continue

            print(f"! {pdf.name}: {name} differs from {first.name}; keeping {pdf.name}, check which is right")

        written[name] = (pdf, out["transactions"])
        (args.out / name).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

        marks = "  ".join(f"{c['check']} {'✓' if c['ok'] else '✗'}" for c in out["checks"]) or "no balances to check"
        flagged = sum(1 for t in st.txs if t.flags)
        print(f"{'✓' if all(c['ok'] for c in out['checks']) and not st.warnings else '!'} {pdf.name} → {name}: {len(st.txs)} rows{f' ({flagged} flagged)' if flagged else ''}  {marks}")

        for c in out["checks"]:
            if not c["ok"]: print(f"    {c['check']}: movements give {c['expected']}, statement says {c['printed']}")

        for w in st.warnings:
            print(f"    {w}")

    print(f"\n{len(written)} file(s) written to {args.out}" + (f", {dupes} duplicate(s) skipped" if dupes else "") + (f", {failed} failed" if failed else ""))
    coverage(written)

    return 1 if failed else 0


def coverage(written: dict[str, tuple[Path, list]]) -> None:
    """Months covered per account, and any gaps between the first and last."""
    for account in ("debit", "credit"):
        months = sorted(n.split()[1][:7] for n in written if n.startswith(account))

        if not months: continue

        y, m = map(int, months[0].split("-"))
        gaps = []

        while f"{y}-{m:02d}" < months[-1]:
            if f"{y}-{m:02d}" not in months: gaps.append(f"{y}-{m:02d}")

            y, m = (y + 1, 1) if m == 12 else (y, m + 1)

        print(f"{account}: {months[0]} to {months[-1]}, {len(months)} months" + (f", missing {', '.join(gaps)}" if gaps else ", none missing"))


if __name__ == "__main__":
    sys.exit(main())
