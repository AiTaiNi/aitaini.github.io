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

- **Scan photo…** reads the photo in the browser with [Tesseract.js](https://github.com/naptha/tesseract.js) (Spanish).
  It's loaded from jsDelivr on the first scan, so scanning needs the network; the photo itself never leaves the device
  and isn't saved.
- **Paste text** reads text the same way (an e-receipt, or text copied from elsewhere).
- **Enter by hand** starts with one empty line.

Every way ends in the check table: code, name as on the receipt, quantity and what the line cost, with the price of
one worked out. Fix anything misread (the photo and the raw text are under the table to compare), add or remove
lines, and check **Lines add up to** against the receipt's total before saving. A code already seen at that store
shows its clear name under the line.

### How lines are read

Line by line, stopping at the total:

| Line | Read as |
| --- | --- |
| `20512345 LECHE GLORIA 400G 4.20` | item: code, name, amount (a tax letter after the amount is ignored) |
| `PLATANO 1.250 KG X 3.50 4.38` | item with its quantity |
| `2 X 3.50` | quantity for the item before (if the amounts agree) or the next one |
| `BOLSA REGALO` then `3 @ 2.50 7.50` | a name waiting for its amount |
| `DSCTO PROMO -1.00` | taken off the item before |
| `TOTAL S/ 36.48` | the receipt total; reading stops |

Subtotals, tax, payment and header lines are skipped (`SKIP` in the script). The first date on the receipt is its
date, today if none is found.

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
