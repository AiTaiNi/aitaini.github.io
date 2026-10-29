# Bank statements page (`personal/statements/`)

BCP statements (one Visa credit card, one savings/debit account) go through two steps:

1. **[parse_statements.py](../parse_statements.py)** (run on your PC) reads the PDFs and writes one JSON file per
   statement to `personal/statements/json/`.
2. **The page** loads those JSON files, lets you review and correct them, and saves them to Supabase.

Assumes [sync-setup.md](sync-setup.md) is done.

- **The PDFs never leave your PC.** Only the extracted rows (date, description, amount, currency, original text
  line) are uploaded. The page doesn't keep loaded files in browser storage either.
- PDFs under `personal/statements/` and the `personal/statements/json/` output are **git-ignored**. Check `git status`
  before committing anything in that folder.

## Why tables and not `kv`

`kv` stores one JSON value per key and re-uploads all of it on every change. Statements grow every month, for
years, and you'll want to query them (by month, currency, description), so they get two dedicated tables:

- `statements`: one row per imported PDF (account, month, balances, totals, file fingerprint).
- `transactions`: one row per movement, linked to its statement. Deleting a statement deletes its transactions.

Amounts are **signed from your point of view**: negative = money out (purchases, withdrawals, fees, interest),
positive = money in (deposits, card payments, refunds). That holds for both accounts, so totals add up the same way.
A card payment shows up twice (out of debit, into credit). That's correct per account, but leave it out when
adding up spending.

## One-time setup: create the tables

In Supabase: **SQL Editor → New query**, paste, **Run**. It should say *Success. No rows returned*.

```sql
-- One row per imported statement (one PDF = one account + month).
create table public.statements (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null default auth.uid() references auth.users on delete cascade,
  account      text        not null check (account in ('credit', 'debit')),
  period       date        not null check (extract(day from period) = 1),   -- first day of the statement's month
  period_start date,
  period_end   date,
  parser       text        not null,                -- which layout reader produced it
  file_name    text        not null,
  file_hash    text        not null,                -- SHA-256 of the PDF, to spot re-imports
  page_count   int,
  balances     jsonb       not null default '{}',   -- {"PEN": {"opening": 100.00, "closing": 80.00}, "USD": {...}}
  totals       jsonb       not null default '{}',   -- {"PEN": {"in": 50.00, "out": -70.00, "count": 12}, ...}
  tx_count     int         not null default 0,
  imported_at  timestamptz not null default now(),
  unique (user_id, account, period),
  unique (user_id, file_hash)
);

-- One row per movement. amount < 0 = money out, > 0 = money in.
create table public.transactions (
  id           bigint      generated always as identity primary key,
  user_id      uuid        not null default auth.uid() references auth.users on delete cascade,
  statement_id uuid        not null references public.statements on delete cascade,
  account      text        not null check (account in ('credit', 'debit')),
  line_no      int         not null,                -- order within the statement
  posted_on    date        not null,
  value_date   date,
  description  text        not null default '',
  amount       numeric(14, 2) not null,
  currency     text        not null check (currency in ('PEN', 'USD')),
  reference    text,
  category     text,                                -- free for later use (budgeting etc.)
  note         text,
  raw          text,                                -- the original text line(s) from the PDF
  unique (statement_id, line_no)
);

create index transactions_user_date on public.transactions (user_id, posted_on);

-- Same rule as kv: signed-in users only, own rows only.
alter table public.statements   enable row level security;
alter table public.transactions enable row level security;

create policy "own rows" on public.statements
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own rows" on public.transactions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.statements, public.transactions from anon;
grant select, insert, update, delete on public.statements, public.transactions to authenticated;

-- Saves a statement and its transactions in one step (all or nothing).
-- Re-importing the same month, or the same file, replaces the earlier copy.
create or replace function public.import_statement(s jsonb, txs jsonb)
returns uuid
language plpgsql
security invoker            -- runs as the signed-in user, so the rules above still apply
set search_path = ''
as $$
declare
  sid uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  delete from public.statements
  where user_id = auth.uid()
    and ((account = s->>'account' and period = (s->>'period')::date) or file_hash = s->>'file_hash');

  insert into public.statements
    (account, period, period_start, period_end, parser, file_name, file_hash, page_count, balances, totals, tx_count)
  values
    (s->>'account', (s->>'period')::date, (s->>'period_start')::date, (s->>'period_end')::date,
     s->>'parser', s->>'file_name', s->>'file_hash', (s->>'page_count')::int,
     coalesce(s->'balances', '{}'), coalesce(s->'totals', '{}'), coalesce((s->>'tx_count')::int, 0))
  returning id into sid;

  insert into public.transactions
    (statement_id, account, line_no, posted_on, value_date, description, amount, currency, reference, raw)
  select sid, s->>'account', t.line_no, t.posted_on, t.value_date, coalesce(t.description, ''),
         t.amount, t.currency, t.reference, t.raw
  from jsonb_to_recordset(txs) as t(line_no int, posted_on date, value_date date, description text,
                                    amount numeric, currency text, reference text, raw text);

  return sid;
end;
$$;

revoke execute on function public.import_statement(jsonb, jsonb) from public, anon;
grant execute on function public.import_statement(jsonb, jsonb) to authenticated;
```

Check **Table Editor**: `statements` and `transactions` both show **RLS enabled**.

⚠ Re-importing a month replaces it completely, including any `category`/`note` you set on its transactions.

## Monthly routine

1. Download the statements from BCP into `personal/statements/examples/` (or any folder). Keep BCP's names: files
   starting `EECC_AHORRO` are the debit account, `EECC_VISA` the credit card. `EECC_VISA (3).PDF` style
   duplicates are fine, since the month is read from inside the PDF.
2. Run `python parse_statements.py` (or `python parse_statements.py path/to/folder-or-file.pdf …`). It asks for
   the PDF password once; set `BCP_PDF_PASSWORD` to skip the prompt. It needs PyMuPDF (`pip install pymupdf`).
   Each file prints a line like:

   ```
   ✓ EECC_VISA (3).PDF → credit 2026-01.json: 82 rows  PEN balance ✓  USD balance ✓
   ```

   ✗ or `!` lines explain what didn't add up or what was skipped.
3. Open `/personal/statements/`, sign in, press **⚙ Manage** and drop the JSON files from `personal/statements/json/`.
4. **Review** if anything is flagged; rows can be edited, added or removed, and the balance check updates live.
   Then **Save** (or **Save all ready**). Saved statements are listed under the import box; **View** shows the
   stored rows.

## The viewer

The page opens on the latest credit card statement. You can switch between the credit card and the debit
account, pick another statement or **All statements**, and filter by:
- posting date (from/to)
- text, which searches the description, the original PDF line, the operation type, category and note
- expenses or income
- currency
- amount range (by size, ignoring the sign)

**Reset** goes back to the latest statement. Totals (in, out, net per currency) follow the filters. The
**Category** and **Note** cells save as you edit them, and categories autocomplete from ones already used.
Re-importing a month replaces its rows, and with them any categories or notes on that month.

## What the parser checks

- **Debit:** opening balance (SALDO ANTERIOR) + movements = closing balance (SALDO), and the sums of charges and
  deposits match the printed TOTAL MOVIMIENTO.
- **Credit, per currency:** previous debt (SALDO ANTERIOR) + charges − payments = MONTO TOTAL FACTURADO.

If every check passes, no movement was missed or misread. All 16 example statements (Dec 2025 to Oct 2026)
pass.

## How it reads the PDFs

Both layouts are fixed-position text, so the script works from each word's position on the page, not the file
name:

- **Account**: "Estado de Cuenta de Ahorros" = debit, "Estado de Cuenta Tarjeta" = credit (the file name is the
  fallback, and a mismatch is reported).
- **Period**: the first line with two full dates (`DEL 01/12/25 AL 31/12/25`, or the card's billing cycle). The
  statement's month is the month of the end date. Short dates like `05DIC` get their year from that period, so
  December rows on a January card statement land in the right year.
- **Debit**: dated rows have the amount under either CARGOS / DEBE (money out) or ABONOS / HABER (money in),
  decided by position. The currency comes from the MONEDA field.
- **Credit**: rows between SALDO ANTERIOR and MONTO TOTAL FACTURADO. The currency is decided by whether the amount
  sits under **Soles** or **Dólares**. A trailing `-` marks payments, refunds and reversals (money in). Undated
  charges such as insurance, interest and fees are dated at the close of the cycle. The installment plan
  (DETALLE PLAN CUOTAS) is skipped, since its monthly share already appears as CUOTA DEL MES.
- `reference` holds the card's operation type (CONSUMO, PAGO, PAGOSERVIC, DEVOLUCION, CARGO); it's empty for debit.

If BCP changes a layout, the checks fail or lines are reported as skipped. Adjust `parse_debit` / `parse_credit` in
the script and bump the parser name (`bcp-credit-v2`), which is stored with each statement.

## JSON format

One file per statement, named `<account> <YYYY-MM>.json`:

```json
{
  "format": "bcp-statement",
  "version": 1,
  "statement": {
    "account": "credit", "period": "2026-01", "period_start": "2025-12-11", "period_end": "2026-01-11",
    "parser": "bcp-credit-v1", "file_name": "EECC_VISA (3).PDF", "file_hash": "<sha256>", "page_count": 4,
    "balances": { "PEN": { "opening": 1580.58, "closing": 1835.60 }, "USD": { "opening": 158.17, "closing": 234.47 } }
  },
  "transactions": [
    { "posted_on": "2025-12-12", "value_date": "2025-12-11", "description": "PAG*DIDI DRIVE LIMA PE",
      "amount": -19.30, "currency": "PEN", "reference": "CONSUMO", "raw": "12Dic  11Dic  PAG*DIDI DRIVE …", "flags": [] }
  ],
  "checks": [ { "check": "PEN balance", "ok": true, "expected": 1835.60, "printed": 1835.60 } ],
  "warnings": []
}
```

`statement` and `transactions` map onto the two tables (the page adds `line_no`, `totals` and `tx_count` when
saving). `flags` mark rows worth a second look and are highlighted on the page; they aren't stored.
