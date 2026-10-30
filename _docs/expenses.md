# Expenses page (`personal/expenses/`)

Sorts the saved statement rows into **bills & utilities**, **subscriptions** and **transport**, and estimates what
the next cycle will cost. It only reads the `statements` and `transactions` tables from
[statements.md](statements.md), so there's no SQL to run and nothing to import here. Import statements on the
Statements page as usual and this page follows.

## Months

A month is a **statement's period**. The card's cycle (e.g. 11 Sep to 11 Oct) and the debit account's calendar
month both count as that month, so every bill in a statement lands in one bucket.

The page opens on the **current cycle**: the earliest month that some account has no statement for yet. If the
October card statement is in but the October debit statement isn't, October is current.

## Real or estimated

For each account, once its statement for the month is imported, its lines show the **real** amount (*Posted*,
or *Not charged* if the line isn't in it). Until then they're **estimates**:

| Line | Estimate |
| --- | --- |
| Same amount the last 3 times (or 2, if that's all there is) | That amount (*Expected*) |
| Bill whose amount varies (electricity, water…) | Average of the last 3 amounts charged (*Estimate*) |
| Transport | Average of the last 3 statements, months without rides counting as 0 |

Posted lines still show what the estimate would have been, so you can see how close it was. A line is only
expected if it was charged in one of the account's last 2 statements, so cancelled services drop out.

## Sorting (automatic)

Card purchases are grouped by merchant (the payment processor prefix like `DLC*` or `PAYPAL *` and anything with
digits are dropped), so the different spellings of one merchant are one line. Everything else is one line per exact
description. In order:

1. **Ignore**: card payments from the debit account (`PAGO VISA`, `PAG.T.PROP.VISA…`). The spending is already on the card.
2. **Transport**: anything with `DIDI` in it, except DiDi Food.
3. **Yearly**: charged once in each of 2 or more statements, 11 to 13 months apart, for about the same amount (within
   10%). A card purchase becomes a **yearly subscription** (Namecheap), anything else a **yearly bill**. This needs two
   years of history, so a yearly payment seen only once (Zoho) has to be marked by hand: search for it under
   **Everything else**.
4. **Bill**: card service payments (`PAGOSERVIC`), named from the provider code (`LUZ` = electricity,
   `SEDA` = water, `BITE`, `CLAR`, `WIN`…) plus the account number's last 4 digits.
5. **Recurring**: in 3 or more of the last 6 statements, about once per statement:
   - a card purchase whose amount also repeats (within 5%) is a **subscription**; a shop visited monthly for
     similar amounts (groceries) stays other
   - anything else (installments, card insurance, a monthly transfer, a loan payment) is a **bill**
6. Everything else is **other**: it counts in the history's last column but isn't forecast.

## Yearly payments

A yearly line is due 12 months after its last charge and is expected at the last amount paid. It's added to
Bills or Subscriptions only in that month (*Due*). If that month's statement comes in without it, it's expected one
more month, since a charge near the card's closing day can fall into the next cycle. The **Yearly** card lists every
yearly line with its last payment and next due month (*not seen* = overdue by more than a month), and the yearly total
with what that comes to per month.

### On the Calendar

Every yearly line is also a yearly event on the Calendar (and so on Today and the dashboard): "<name> payment", on
the date of its last charge, with ⏱ on so it counts down two weeks ahead. The Expenses page keeps these events in step
each time it's opened, after the first sync so an old copy on the device can't win:

- a new yearly line adds its event; a newer charge moves the date; a rename changes the event's name
- a line that stops being yearly, or is marked cancelled, loses its event
- an icon or countdown changed on the Calendar is kept

Their ids start with `exp-` (`Tasks.syncEvents` in `/assets/tasks.js`). Removing one on the Calendar doesn't stick:
it comes back the next time Expenses is opened. Change the line's group instead.

## Corrections

Every line has a group menu. **Everything else** lists the biggest other lines from the last 12 statements (the search
covers all of them), so anything missed can be moved into a group. Choices are saved under the synced key
`expense-rules` and apply to every month. **Your changes** lists them (including ignored lines) with an **Undo**.

### Renaming

**✎** next to a line's name renames it ("Mobile (Bitel)", "Rent"); an empty name goes back to the automatic one.
The statement rows aren't touched: the `transactions` table keeps each row's `description` and `raw` PDF line as
imported, and the line keeps showing that description under the new name. The name is saved in the synced key
`expense-lines` as `{ name, original }`, where `original` is the description the line had when it was renamed.
Renames are listed under **Your changes**, with the original and an **Undo**.

## Subscription review

Subscriptions (monthly or yearly) still being charged that started 12 or more months ago, with what each has cost in
total and in the last 12 months, and its latest price.

- **Still using** hides the prompt for 6 months (`reviewed` date in `expense-lines`).
- **Cancelled** stops expecting it after the current cycle and removes its Calendar event. If it's charged again
  anyway, the charge still shows as real. Undo it under **Your changes**.

## Import reminder

A statement is expected 3 days after its cycle closes: the card's closing day one month after the last imported card
statement's end, or the end of the next calendar month for the debit account. Once that date has passed without the
statement being imported, the hub's Statements tile, Today and this page say so, with a link to the Statements page.
The check is `/assets/statements-due.js` and reads only the `statements` table.

## Currency

Totals are shown per currency and combined in soles at the site-wide exchange rate (`/assets/fx.js`, the same one the
dashboard shows). It's fetched at most every 12 hours by whichever page needs it first and synced (`fx-rate`), so every
page and device uses the same value. A note under the total says which rate was used (its date and source) whenever
the total includes US$ amounts.

## Spending insights

For the month shown, everything actually spent (every group except Ignore), from the statements that are in. A
month with a pending statement only covers the account that's in, and says so. It shows the total, the number of
charges, how much was paid in US$, the biggest line, a bar per category and the top merchants. Each figure is
compared with the average of the 3 months before that have the same statements in.

Categories, in order:

1. Bills, subscriptions and transport (including yearly ones) keep their group.
2. Otherwise the line's **Category** from the Statements page, if any of its rows has one (the most used wins). Set a
   category there to fix anything below.
3. Otherwise the first match on the description: groceries & snacks, food & delivery, games, creators & art,
   health, pets, shopping, travel, bills & utilities, web & domains, transfers (Yape, Plin), loans, taxes & fees.
   The list is `CATS` at the top of `personal/expenses/script.js`.
4. Otherwise Other.

## On the hub

Each time the page shows the current cycle, it saves `{ m, pen, est }` (month, total in céntimos, number of
estimated lines) under the synced key `expense-summary`. The hub's Expenses tile reads it, so it shows the last total
seen here without loading the transactions itself.
