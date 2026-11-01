# Receipts page (`personal/expenses/receipts/`)

Price history per store, from receipts. Scan a photo, check what was read, save. Linked from Expenses and
Shopping (and back), but it doesn't read or change either: no statements, no shopping history.

Assumes [sync-setup.md](sync-setup.md) is done, plus the one-time SQL below.

## Why a table

Receipts never stop coming, and a `kv` key is uploaded whole on every change (and kept whole in the browser), so
they get their own table, like [statements](statements.md). Each receipt is one row with its lines inside it as JSON:
the page loads one store's receipts and works out the prices itself, so a separate lines table isn't needed. The
item names you give are small and edited often, so they stay in synced keys.

## One-time setup: create the table

In Supabase: **SQL Editor → New query**, paste, **Run**. It should say *Success. No rows returned*.

```sql
-- One row per receipt. Amounts in céntimos (S/ 36.48 = 3648).
create table public.receipts (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  store       text        not null,                 -- the store's name, as on the Shopping list
  date        date        not null,
  total       int,                                  -- the receipt's total, null if unknown
  lines       jsonb       not null default '[]',    -- [{"code": "20512345", "name": "LECHE GLORIA", "qty": 1, "price": 420}]
  created_at  timestamptz not null default now()
);

create index receipts_user_store_date on public.receipts (user_id, store, date);

-- Same rule as kv: signed-in users only, own rows only.
alter table public.receipts enable row level security;

create policy "own rows" on public.receipts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.receipts from anon;
grant select, insert, update, delete on public.receipts to authenticated;
```

Until it's run, the page says *Couldn’t load … Has the SQL in _docs/receipts.md been run?* It needs the network to
show and save receipts, like Statements and Expenses.

## Stores

The stores are the Shopping list's, edited in Shopping's **Settings** (add, reorder, remove). They're one synced key,
`shopping-stores`, read through [personal/shopping/stores.js](../personal/shopping/stores.js), which both pages load.
The defaults are Market, Corner store, Mass, Plaza Vea and Dollar City.

Removing a store keeps its receipts: they show again if a store with the same name is added back. Renaming isn't
offered for the same reason: the receipts are saved under the store's name (the `store` column).

## Adding a receipt

### From the QR code and the XML (best)

Every Peruvian e-receipt (boleta or factura) has SUNAT's QR code:

```
20608280333|03|BF62|1407961|26.08|192.58|2026-10-30|0|0|
  RUC        type series number IGV  total  date   buyer's ID type, ID
```

**Scan QR code…** reads it from a photo (the browser's own QR reader on Chrome for Android, otherwise
[jsQR](https://github.com/cozmo/jsQR) 1.4.0 from jsDelivr, loaded on first use). **Paste text** also takes the QR
code's text, from any QR scanner app. Only the RUC, type, series-number, total and date are used; the IGV and the
buyer's ID are ignored.

- The **RUC** picks the store: Mass is `20608280333` (from its receipt), Plaza Vea `20100070970` (Supermercados
  Peruanos, from SUNAT's registry; not yet seen on a receipt). Any other RUC is asked once ("Which store is this?") and
  remembered in the synced key `receipt-rucs` (`{ ruc: store }`). Both lists are in the script (`RUCS`).
- The page then shows the store's **lookup site** form, value by value with a **Copy** button: *Tipo de documento*
  (Boleta de venta, or Factura), *Serie - Correlativo* (series and number joined by a hyphen: `BF62-1407961`),
  *Fecha de emisión* (DD-MM-YYYY, as the site's date picker shows it) and *Total*. It warns if a receipt with the same
  date and total is already saved for that store.
- **Open the lookup site** goes to `https://ax.axteroid.com/consulta/<RUC>`. Mass and Plaza Vea both use Axteroid;
  Dollar City is still to check (`lookupUrl` in the script). There: fill in the four values, tick the captcha,
  **Descargar XML**.
- **Import XML…** reads the downloaded file. Axteroid names it like `03-BF62-1407961` without an extension, so the
  file picker accepts any file. A zip is refused with a hint to open it first.
- **Scan photo instead…** reads a photo as below, with the QR code's date and total filled in (they're exact).

**What the lookup site allows** (from its page code, `ax.axteroid.com/consulta/assets/Home.*.js`): the URL only
carries the RUC (`/consulta/<RUC>`; `/consulta/ose` asks for it, and an id with a hyphen switches to Chile). The form
(`type`, `number`, `date`, `amount_total`) always starts empty and doesn't read the query string, so it can't be
pre-filled from a link, and each lookup needs its reCAPTCHA. Hence the copy buttons.

The XML is the receipt as filed with SUNAT (UBL 2.1). Each `cac:InvoiceLine` gives:

| Field | From |
| --- | --- |
| code | `cac:Item/cac:SellersItemIdentification/cbc:ID`, or the barcode in `cac:StandardItemIdentification` (whichever is 8 to 14 digits) |
| name | `cac:Item/cbc:Description` |
| qty | `cbc:InvoicedQuantity` (kg for weighed items, `unitCode="KGM"`) |
| price | `cbc:LineExtensionAmount` (after discounts, before tax) + the line's `cac:TaxTotal/cbc:TaxAmount`: what was paid. Without those, `qty` × the price with tax (`cac:PricingReference`, `PriceTypeCode` 01) |

Plus the store's RUC (`cac:AccountingSupplierParty`), the receipt's `cbc:ID` and `cbc:IssueDate`, and the total
(`cac:LegalMonetaryTotal/cbc:PayableAmount`). Nothing else is kept.

What Mass's XML (from Axteroid) does differently, all handled:

- It's encoded as ISO-8859-1, so the file is decoded as its first line says, not always as UTF-8.
- The code is padded to 14 digits (`02200204244226`); the leading 0 is dropped to get the 13-digit barcode printed
  on the receipt, so items from XML and from photos share one history.
- The description is the printed line in `@@` fields: `2200204244226@@FRSTFREC500G@@ 2 X      6.90@@13.80@@`
  (code, name, quantity line, amount). The name is the field after the code.

Checked on the first Mass receipt (`BF62-1407961`): all 24 lines match the paper (codes, names, quantities, weights and
amounts), adding up to its total.

### Other ways

- **Scan photo…** reads the photo in the browser with [Tesseract.js](https://github.com/naptha/tesseract.js) (Spanish).
  It's loaded from jsDelivr on the first scan, so scanning needs the network; the photo itself never leaves the device
  and isn't saved.
- **Paste text** reads text the same way (an e-receipt, or text copied from elsewhere).
- **Enter by hand** starts with one empty line.

Every way ends in the check table: code, name as on the receipt, quantity and what the line cost, with the price of
one worked out. Fix anything misread (the photo and the raw text are under the table to compare), add or remove
lines, and check the line under the table before saving: **Lines add up to** against the receipt's total, and the
units against the receipt's unit count (Mass prints `37 UNIDAD(ES)`; a weighed item counts as one). Lines the reader
wasn't sure about are marked, with what to check: a code that isn't a valid barcode, a quantity × price that didn't
match the line, or no amount read. A line can't be saved without a name and an amount. A code already seen at that
store shows its clear name and last price under the line.

### Taking the photo

Lay the receipt flat on something darker than the paper and photograph it straight from above, in good light, with
the whole receipt in the photo. Curls are the main problem: on a curled receipt the lines slope, so a price can end up
level with the item above or below it. The first Mass receipt (a 720×1280 photo, curled at the top) read 16 to 19 of
its 24 amounts right; everything below the curl was right.

### Cleaning up the photo

Before reading, the photo is turned grey, the paper is found (the biggest bright area, which is why a darker
background helps), straightened from its four corners into a 1000px-wide image, and sharpened. Tesseract then reads it
as one column of lines (`--psm 4`), keeping the gaps between columns. Without a clear paper outline the whole photo is
used.

### How lines are read

Item lines, until the subtotal or total:

| Line | Read as |
| --- | --- |
| `7750243043915 ALACENA CREM      6.40` | item: code, name, and the amount in the right-hand column (after a gap of 3+ spaces) |
| `7750243043915 ALACENA CREM` then `2 X   3.20   6.40` | item, then its quantity line: 2 × 3.20 = 6.40 |
| `0000000196888 PAPA BLANCA` then `.525 KG X   2.60   1.36` | weighed item: 0.525 kg at 2.60 a kg |
| `DSCTO PROMO   -1.00` | taken off the item above |
| `BOLSA REGALO   7.50` | item without a code (other stores) |

Then `SUBTOTAL`, `IMPORTE TOTAL`, `TOTAL A PAGAR` and `TARJ` give the total: the amount that equals the lines' sum, else
the one they agree on most (one of them is often misread). `37 UNIDAD(ES)` is the unit count. Tax, payment and header
lines are skipped (`SKIP` in the script). The first date on the receipt is its date, today if none is found.

Misreads it fixes, all seen on the Mass receipt:

- In amounts, `O o U D Q` → 0, `l I |` → 1, `S` → 5, `B` → 8; a comma, colon or space for the point (`4,42`, `7:80`,
  `3 20`); one decimal (`4.4`); and no point at all after a code's name (`520` → 5.20).
- In quantity lines, `X` read as `Y` or `YX`, `KG X` read as `KEY`, and `.525` read as `525` (a weight over 10 kg
  with no point is taken as grams).
- When quantity × price doesn't match the line's amount, quantity × price wins for counted items (the amount is the
  likelier misread, and the line is marked); for weighed items the weight is worked out from the amount.
- A coded line whose amount wasn't read is kept, marked, to be filled in, instead of being dropped.
- Codes are checked against their barcode check digit (EAN-13, EAN-8). One that fails is compared with the codes
  already saved for that store: if exactly one matches with at most one digit wrong (two for a 12 or 13-digit code),
  lined up with its start or end since digits get lost at the paper's edge, it's used, and so is its saved name.
  So the second receipt from a store reads better than the first.

### Tuning on a PC

[tools/purchase-receipts/read-receipt.py](../tools/purchase-receipts/read-receipt.py) runs the same steps (the same
Spanish model as Tesseract.js, `4.0.0_best_int`, the same cleanup with OpenCV, the same rules) on a photo, and prints
the lines it found with the totals and unit check:

```
winget install UB-Mannheim.TesseractOCR
pip install opencv-python pytesseract
python tools/purchase-receipts/read-receipt.py "tools/purchase-receipts/mass 2026-10-30.jpg" --text --image out.png
```

The model is downloaded to `tools/purchase-receipts/tessdata/` on the first run. Photos in that folder and the model
are git-ignored (receipts show card digits and IDs). When a receipt reads badly, run it there, change the rules in
both `read-receipt.py` and the page's script (`parse` and the cleanup under *cleaning up the photo*), and check both
give the same lines.

## Prices

One row per item at the chosen store: last price of one (per kg for weighed items), the change from the time before,
the lowest seen, and how many times it was bought (tap it for every price). Search covers names and codes.

An item is its **code** on the receipt, or its name when there's no code, so the same product keeps one history even
if the text reader spells it differently. **✎** gives it a clear name; the name as first read stays underneath, and an
empty name goes back to it.

**Saved receipts** lists them newest first, with **View**, **Edit** (back into the check table) and **Delete** (tap
twice within 3 seconds).

## Storage

- Receipts: the `receipts` table above. `price` in a line is what the line cost in total, in céntimos.
- Item names: one synced key per store, `receipt-names-<store>` (`receipt-names-plaza-vea`):

  ```js
  { "20512345": { name: "LECHE GLORIA AZUL 400G", alias: "Milk (Gloria, can)" } }
  ```

  Items without a code are keyed `n:<lowercased name>`. A name is added the first time a receipt with it is saved.
- The last chosen store is remembered on each device (`receipts-store` in localStorage, not synced).
