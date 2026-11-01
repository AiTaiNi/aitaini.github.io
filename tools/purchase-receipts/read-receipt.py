"""Reads a receipt photo the way the Receipts page (personal/expenses/receipts/) does, to tune its rules on a PC.

    python tools/purchase-receipts/read-receipt.py "tools/purchase-receipts/mass 2026-10-30.jpg"
    python tools/purchase-receipts/read-receipt.py photo.jpg --text          also print the raw text
    python tools/purchase-receipts/read-receipt.py photo.jpg --image out.png save the cleaned-up image
    python tools/purchase-receipts/read-receipt.py --from-text ocr.txt       rules only, on text already read

Mirrors the page step by step: the same Spanish model as Tesseract.js (4.0.0_best_int, downloaded to ./tessdata on
the first run), the same image cleanup (prepare) and the same line rules (parse). Change both together; see
_docs/receipts.md. Needs Tesseract (winget install UB-Mannheim.TesseractOCR) and: pip install opencv-python pytesseract
"""
import argparse, gzip, os, re, shutil, sys, urllib.request
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
TESSDATA = HERE / 'tessdata'
MODEL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz'


# ---------- image ----------
def prepare(path):
    """Grey, paper found and straightened to 1000px wide, then sharpened. Falls back to the whole photo."""
    import cv2, numpy as np

    g = cv2.cvtColor(cv2.imread(str(path)), cv2.COLOR_BGR2GRAY)
    h, w = g.shape

    # the paper: biggest bright blob on a small blurred copy
    k = 300 / max(h, w)
    small = cv2.blur(cv2.resize(g, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA), (5, 5))
    _, m = cv2.threshold(small, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
    quad = None

    if n > 1:
        big = 1 + stats[1:, cv2.CC_STAT_AREA].argmax()

        if stats[big, cv2.CC_STAT_AREA] > 0.15 * m.size:
            ys, xs = np.nonzero(lab == big)
            s, d = xs + ys, xs - ys
            pts = [(xs[i], ys[i]) for i in (s.argmin(), d.argmax(), s.argmax(), d.argmin())]   # tl tr br bl
            quad = np.float32(pts) / k

    W = 1000

    if quad is not None:
        tl, tr, br, bl = quad
        side = lambda a, b: float(np.hypot(*(a - b)))
        H = round(W * (side(tl, bl) + side(tr, br)) / (side(tl, tr) + side(bl, br)))
        M = cv2.getPerspectiveTransform(quad, np.float32([[0, 0], [W, 0], [W, H], [0, H]]))
        out = cv2.warpPerspective(g, M, (W, H), flags=cv2.INTER_LINEAR, borderValue=255)
    else:
        out = cv2.resize(g, (W, round(h * W / w)), interpolation=cv2.INTER_AREA if w > W else cv2.INTER_CUBIC)

    return cv2.addWeighted(out, 1.6, cv2.GaussianBlur(out, (0, 0), 2), -0.6, 0)


def read(img):
    import pytesseract

    exe = shutil.which('tesseract') or r'C:\Program Files\Tesseract-OCR\tesseract.exe'
    pytesseract.pytesseract.tesseract_cmd = exe

    if not (TESSDATA / 'spa.traineddata').exists():
        TESSDATA.mkdir(exist_ok=True)
        print('Downloading the Spanish model…', file=sys.stderr)

        with urllib.request.urlopen(MODEL) as r, open(TESSDATA / 'spa.traineddata', 'wb') as f:
            f.write(gzip.decompress(r.read()))

    os.environ['TESSDATA_PREFIX'] = str(TESSDATA)

    # one column of lines, keeping the gaps between name and price
    return pytesseract.image_to_string(img, lang='spa', config='--psm 4 -c preserve_interword_spaces=1')


# ---------- text ----------
DIG = '0-9OoUDQlI|SB'
FIX = str.maketrans({'O': '0', 'o': '0', 'U': '0', 'D': '0', 'Q': '0', 'l': '1', 'I': '1', '|': '1', 'S': '5', 'B': '8',
                     ',': '.', ':': '.', ';': '.'})
AMOUNT = re.compile(rf'^-?[{DIG}]{{1,4}} ?[.,:;] ?[{DIG}]{{1,2}}$')
AMOUNTS = re.compile(rf'-?[{DIG}]{{1,4}} ?[.,:;] ?[{DIG}]{{1,2}}(?![0-9])|\b\d{{1,3}} \d{{2}}\b')
CODE = re.compile(rf'^\W{{0,2}}([{DIG}]{{8,14}})\s+(.*)$')
QTY = re.compile(r'^\W*(\.?\d+(?:[.,]\d+)?)?\s*(?:(K[GE]\w?|UN\w{0,2})\s*[xXyY×*@]{0,2}|[xXyY×*@]{1,2})\s+(.*)$')
TAIL = re.compile(r'(-?\d{1,4}[.,]\d{2})\s*[A-Z*]{0,2}$')
SKIP = re.compile(r'\bIGV\b|I\.G\.V|GRAVAD|EXONERAD|INAFECT|REDONDEO|EFECTIVO|VUELTO|CAMBIO|\bVISA\b|MASTERCARD|\bPAGO\b|\bRUC\b|BOLETA|FACTURA|\bCAJA\b|CAJERO|FECHA|\bHORA\b|\bSON\b|ICBPER|\bDNI\b|CLIENTE|PUNTOS', re.I)
TOTALS = re.compile(r'TOTAL|PAGAR|TARJ', re.I)
DISC = re.compile(r'DSCTO|DESCUENTO|\bDESC\b|AHORRO|PROMOCI', re.I)
LETTERS = re.compile(r'[A-Za-zÑñÁÉÍÓÚáéíóú].*[A-Za-zÑñÁÉÍÓÚáéíóú]')


def money(tok, whole=False):
    """A price token in céntimos, fixing common misreads (O→0, l→1, S→5, comma or colon for the point). With whole,
    three or four bare digits count too (520 → 5.20): the point is often lost."""
    t = tok.strip()

    if whole and re.fullmatch(r'\d{3,4}', t):
        return int(t)

    if not (AMOUNT.match(t) or re.fullmatch(r'\d{1,3} \d{2}', t)) or not re.search(r'\d', t):
        return None

    t = t.translate(FIX).replace(' ', '')

    if '.' not in t:
        t = t[:-2] + '.' + t[-2:]

    a, b = t.split('.')

    return round(float(a + '.' + b.ljust(2, '0')) * 100)


def last_amount(raw, whole=False):
    """The amount in the right-hand column (after a gap of 3+ spaces), else one right at the end of the line."""
    cols = re.split(r'\s{3,}', raw.strip())

    if len(cols) > 1:
        v = money(cols[-1], whole)

        if v is not None:
            return v, cols

    m = TAIL.search(' '.join(raw.split()))

    return (money(m[1]) if m else None), cols


def ean_ok(c):
    if len(c) not in (8, 13) or not c.isdigit():
        return False

    d = [int(x) for x in c]
    w = [3, 1] if len(c) == 8 else [1, 3]

    return sum(v * w[i % 2] for i, v in enumerate(d[:-1])) * 9 % 10 == d[-1]


def repair(code, known):
    """A code that isn't a valid barcode: the one known code it matches with at most one digit wrong, lining up with
    its start or its end (digits are often lost at the edge of the paper); two wrong for a full-length code. Returns
    (code, still doubtful)."""
    if ean_ok(code) or not known:
        return code, not ean_ok(code)

    diff = lambda a, b: sum(x != y for x, y in zip(a, b))
    most = 2 if len(code) >= 12 else 1
    near = [k for k in known if len(code) >= 8 and len(k) >= len(code) and min(diff(code, k[:len(code)]), diff(code, k[-len(code):])) <= most]

    return (near[0], False) if len(near) == 1 else (code, True)


def clean_name(name):
    """Drops what the reader left after the name: an amount, or bits starting with a symbol ("+90", '"90')"""
    name = TAIL.sub('', name)

    return re.sub(r'(\s+[^\w\s]\S*|[^\w.%/)]+)+$', '', name).strip()


def parse(text, known=None):
    """Receipt text → { date, total, units, items: [{ code, name, qty, price, warn }] }. known: { code: name } for
    the store, used to fix misread codes and names."""
    known = known or {}
    items, totals = [], []
    date = units = None
    done = False      # past the subtotal: only totals from here
    pend = None       # a name without code or amount, waiting for one (stores that wrap long names)
    last = -9         # line number of the last item, so a quantity line can find it

    for n, raw in enumerate(text.splitlines()):
        line = ' '.join(raw.split())

        if not line:
            continue

        if not date:
            d = re.search(r'\b(\d{2})[/.-](\d{2})[/.-](\d{4}|\d{2})\b', line)

            if d and 1 <= int(d[2]) <= 12 and 1 <= int(d[1]) <= 31:
                date = (('20' + d[3]) if len(d[3]) == 2 else d[3]) + '-' + d[2] + '-' + d[1]

        u = re.search(r'(\d+)\s*UNIDAD', line, re.I)

        if u:
            units = int(u[1])
            done = True
            continue

        if TOTALS.search(line) and not DISC.search(line):
            v, _ = last_amount(raw)

            if v is not None:
                totals.append(v)

            done = True
            continue

        if done or SKIP.search(line):
            continue

        c = CODE.match(raw.strip())
        q = None if c else QTY.match(line)

        # quantity or weight line: "2 X 3.50 7.00", ".525 KG X 2.60 1.36"; belongs to the item just above
        if q and (q[1] or q[2]):
            vals = [money(t) for t in AMOUNTS.findall(q[3])]
            vals = [v for v in vals if v]
            each = vals[0] if vals else None
            paid = vals[-1] if len(vals) > 1 else None
            kg = bool(q[2] and q[2][0] in 'Kk') or (q[1] or '').startswith('.')
            qty = float(q[1].replace(',', '.')) if q[1] and re.search(r'\d', q[1]) else None
            warn = ''

            if kg and qty and qty >= 10 and '.' not in q[1]:
                qty /= 1000     # ".525" read as "525"

            if each and paid:
                if qty and abs(qty * each - paid) <= 1:
                    pass
                elif kg:
                    qty = round(paid / each, 3)
                elif qty and qty == int(qty) and 1 <= qty < 100:
                    paid, warn = round(qty * each), 'amount'   # the total is the likelier misread
                else:
                    qty = max(1, round(paid / each))
            elif each and qty:
                paid = round(qty * each)

            if not (qty and paid):
                continue

            prev = items[-1] if items else None

            if prev and n - last <= 2:
                prev.update(qty=qty, price=paid, warn=prev['warn'] or warn)
            elif pend:
                items.append({'code': '', 'name': pend, 'qty': qty, 'price': paid, 'warn': warn})

            pend = None
            continue

        v, cols = last_amount(raw, whole=bool(c))

        if v is not None and (DISC.search(line) or cols[-1].strip().startswith('-')):
            if items:
                items[-1]['price'] = max(0, items[-1]['price'] - abs(v))

            continue

        if c:
            code = c[1].translate(FIX)
            code, bad = repair(code, known)
            name = re.split(r'\s{3,}', c[2].strip())[0]
            name = known.get(code) or clean_name(name)
            items.append({'code': code, 'name': name, 'qty': 1, 'price': v or 0, 'warn': 'code' if bad else ''})
            last, pend = n, None
            continue

        if v is not None:
            name = re.split(r'\s{3,}', raw.strip())[0] if len(cols) > 1 else line[:TAIL.search(line).start()] if TAIL.search(line) else ''

            if LETTERS.search(name):
                items.append({'code': '', 'name': name.strip(), 'qty': 1, 'price': v, 'warn': ''})
                last, pend = n, None
            elif pend:
                items.append({'code': '', 'name': pend, 'qty': 1, 'price': v, 'warn': ''})
                last, pend = n, None

            continue

        if LETTERS.search(line):
            pend = line

    for i in items:
        if not i['price']:
            i['warn'] = i['warn'] or 'no amount'

    s = sum(i['price'] for i in items)
    tally = Counter(totals).most_common()
    total = s if s in totals else tally[0][0] if tally else None

    return {'date': date, 'total': total, 'units': units, 'items': [i for i in items if i['code'] or i['price']]}


def show(r):
    for i in r['items']:
        qty = '' if i['qty'] == 1 else f"{i['qty']:g} ×"
        print(f"{i['code']:>14}  {i['name'][:24]:24} {qty:>8} {i['price'] / 100:8.2f}  {i['warn']}")

    s = sum(i['price'] for i in r['items'])
    u = sum(1 if i['qty'] != int(i['qty']) else int(i['qty']) for i in r['items'])
    print(f"\nlines {s / 100:.2f}   total {'?' if r['total'] is None else f'{r['total'] / 100:.2f}'}   "
          f"units {u} (receipt says {r['units'] or '?'})   date {r['date'] or '?'}")


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('photo', nargs='?')
    ap.add_argument('--from-text', help='a text file already read, instead of a photo')
    ap.add_argument('--text', action='store_true', help='print the raw text too')
    ap.add_argument('--image', help='save the cleaned-up image here')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')

    if a.from_text:
        text = Path(a.from_text).read_text(encoding='utf-8', errors='replace')
    elif a.photo:
        img = prepare(a.photo)

        if a.image:
            import cv2
            cv2.imwrite(a.image, img)

        text = read(img)
    else:
        sys.exit(ap.print_help())

    if a.text:
        print(text, '\n' + '-' * 60)

    show(parse(text))
