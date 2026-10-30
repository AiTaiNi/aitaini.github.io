# Private page ideas

Candidates for new signed-in pages. Build them from [template/](template/) (see its README). Tick an item when it's
built, and move it to **Done** with a link.

Remember: page code is public; only data saved through `Sync` or Supabase tables is private.

## Built on what's already tracked

- [ ] **Watch log**: anime/manga/shows in progress, with episode counters (like the daily-task counters),
      ratings and a dropped list. Could pull from the MAL stats file.
- [ ] **Habit insights**: streaks, best/worst weekdays and completion rate per task, from the daily-task history.
      Read-only, so it adds no new data. *Suggested first: quick win.*
- [ ] **Places log**: cafés and restaurants with a rating and a note, pre-filled from the merchants that keep showing
      up in the statements (Aliaga Café, La Higuera…) with visit counts and what was spent there.

## Expenses page, next steps

- [ ] **Card payment due**: the card statement's closing balance (already in `statements.balances`), its due date
      and how much of it the debit account has paid so far. The forecast covers what's charged; this covers what
      has to be paid, and when.
- [ ] **Price changes**: flag a subscription or fixed bill whose amount changed from the previous month (Microsoft
      21.99 → 37.99, Claro 53.90 → 49.90, YouTube creeping up with the exchange rate).
- [ ] **Seasonal estimates**: electricity and water swing with the season. Blend the last-3 average with the same
      month last year once there are two years of data.
- [ ] **Budgets**: a monthly limit per group or insight category (transport, food & delivery) with a bar on each
      tile, plus a days-left-in-cycle pace ("S/ 240 of 300, 9 days to go").
- [ ] **Transport stats**: DiDi rides per week, average fare, busiest weekdays (posting dates are in the rows;
      times aren't).
- [ ] **Insight trends**: a 12-month view per insight category (is food delivery growing?), and a click on a category
      or merchant that opens the Statements viewer filtered to its rows.
- [ ] **Income side**: money in (salary, refunds) against money out per month, and the savings rate.

## Personal records

- [ ] **Journal**: one entry per day, linked from the Calendar page. Split storage per year
      (`journal-2026`, `journal-2027`) or use its own table.
- [ ] **Mood / sleep log**: one tap a day, shown as a heatmap with the calendar's colour scale.
- [ ] **Health**: weight, workouts, medication/supplement checklist; doctor and pharmacy visits could be linked from
      the Health insight category.
- [ ] **Reading / wishlist**: books, games and things to buy, with status, priority and price. A "bought" button could
      match it to the statement charge later.
- [ ] **Renewals & documents**: expiry dates for ID, passport, licences, warranties and domains, with countdowns
      a month ahead. Pairs with the yearly payments on the Expenses page.
- [ ] **Savings goals**: a target, a date and what's put aside each month, with the Expenses page's yearly
      "set aside per month" as one goal.
- [ ] **People**: birthdays (as Calendar countdowns), gift ideas, and small notes per person (sizes, likes, last
      gift given).
- [ ] **Collection**: figures, games, art books and other things owned, with where they're kept, what they cost and
      a wishlist side. Game purchases are already in the Games insight category.
- [ ] **Learning log**: courses, languages or skills with a streak counter (like the daily tasks) and notes.

## Utility

- [ ] **Bookmarks / read later**: private link board with tags, usable as a start page, with an inbox for links
      saved from the phone.
- [ ] **Recipes / meal plan**: weekly plan that builds a shopping list. Could compare against the Groceries &
      snacks insight to see what cooking at home saves over delivery.
- [ ] **Packing & routine lists**: reusable checklists (trip, gym bag, monthly chores) that reset on each use,
      unlike the daily tasks.
- [ ] **Focus timer**: a Pomodoro timer whose sessions count toward a daily-task counter.
- [ ] **Snippets vault**: code snippets, commands and templates with tags and one-click copy.
- [ ] **Private file drop**: scans, receipts and documents in a private Supabase Storage bucket, reachable only
      when signed in.

## Across all pages

- [ ] **Quick search (Ctrl+K)**: one box on every private page that searches tasks, events, notes, statements and
      expense lines, and jumps to the right page.
- [ ] **Settings page**: theme and hue, signed-in devices, sign out everywhere, and which hub tiles are shown.
- [ ] **Backup & export**: download every `kv` key and the statement tables as one JSON file, and restore from it.
- [ ] **Reminders**: browser notifications for countdowns, yearly payments and the import reminder, while a private
      page is open.

## Bigger

- [ ] **Year in review**: automatic summary combining tasks, watch log, spending and journal.
- [ ] **Shared pages**: a second account (e.g. a partner) with a shared list. The database rules currently allow
      per-user rows only, so this needs a policy change.

## Indonesian

- [ ] **Bahasa Indonesia** (`/personal/learning/indonesian/`, in progress: data, Today and Review are built): casual Indonesian for VTubers, chat and social
      media. Spaced repetition, affixes, drills, sentence mining, slang, lessons and a time log, on a 1-year plan
      at 5 h a week; data prepared in Python, progress in Supabase. Design: [indonesian.md](indonesian.md),
      tables: [indonesian-database.md](indonesian-database.md), plan: [indonesian-study-plan.md](indonesian-study-plan.md).

## Second batch

Storage hint after each: **kv** = one synced key (small, whole value), **table** = its own Supabase table with the
usual RLS rule (grows over time, needs querying), **storage** = a private Storage bucket (files).

### Reflection & time

- [ ] **Decision journal**: write down a decision, what you expect to happen and how sure you are (50–95%), plus a
      "check back" date that becomes a Calendar countdown. Scoring old decisions shows how well calibrated you are.
      *table*
- [ ] **Weekly review**: a short guided form every Sunday (what went well, what didn't, three priorities for next
      week), with last week's priorities shown so they can be ticked off. *table*
- [ ] **Letters to future me**: write a note and seal it until a date; it can't be opened early (the page hides it,
      and it's stored encrypted with a passphrase). *table*
- [ ] **Life in weeks**: every week of a life as one small square, past weeks filled, milestones marked and
      labelled. A quiet perspective page. *kv*
- [ ] **"Last time I…"**: days since haircut, changing the toothbrush, calling family, backing up the PC; each with a
      target interval, turning amber then red when overdue. One tap resets it. *kv*
- [ ] **Idea garden**: project and content ideas that "ripen": new ones sit for a week before they can be promoted,
      old ones get a monthly prompt to keep, merge or compost. *kv*

### Games & hobbies

- [ ] **Gacha tracker**: per game (Wuthering Waves, Arknights, Genshin, Reverse 1999…), pity counter, guaranteed
      status, premium currency, pull history and current banners with their end dates as Calendar countdowns.
      *table*
- [ ] **Daily check-ins**: games and apps with a daily reset (login rewards, dailies, energy), each with its server's
      reset time shown as a local countdown, and a checkbox that clears at that reset rather than at midnight. *kv*
- [ ] **Tonight picker**: answer "how much time / how much energy / alone or with friends", get a game, show or
      book from your own lists, with a reroll and a "not this" that remembers. *kv*
- [ ] **Commissions**: art commissions in progress: artist, what was ordered, price and currency, paid/deposit,
      stage (queued, sketch, final), delivery files. *table + storage*
- [ ] **Art practice**: timed gesture/figure drawing sessions from your own reference folder, random prompts, and a
      practice log with thumbnails to see progress over months. *table + storage*
- [ ] **Quotes & highlights**: lines from books, anime, games and songs with source, episode/page and tags; a random
      one on the hub. *table*

### Home & life admin

- [ ] **Home maintenance**: interval chores that aren't daily (filters, descaling, deep cleaning, pet supplies), with
      "due in" bars, the next ones on Today. *kv*
- [ ] **Pet care**: feeding schedule, vet visits, vaccines, weight chart and medication doses with reminders. *table*
- [ ] **Where is it?**: a searchable home inventory of *where things are* (which box has the HDMI cables), with
      optional photos. *table + storage*
- [ ] **Plants**: watering and fertilising intervals per plant, a photo timeline, and a "water today" list. *kv +
      storage*
- [ ] **Trip planner**: itinerary by day, bookings, budget in several currencies (soles, US$, rupiah), documents and a
      packing list; a map of everywhere visited. *table*
- [ ] **Bucket list**: things to do once, with a photo and date when done, grouped by place or theme. *kv*

### Tools & infrastructure

- [ ] **Private vault**: notes encrypted in the browser with a passphrase (Web Crypto, AES-GCM) before upload, so
      even the database only holds ciphertext. For recovery codes, Wi-Fi passwords and similar. *table*
- [ ] **Quick capture**: add a task, link or note from the phone without opening the site, e.g. a phone shortcut
      that posts to a small Supabase Edge Function with a personal token. *table*
- [ ] **Personal wiki**: Markdown pages with `[[links]]` and backlinks, for notes that outgrow the notepad. *table*
- [ ] **Time zones**: friends and places with their local time and "good time to message?" shading, handy for
      Discord friends abroad. *kv*
- [ ] **Flashcard engine**: the spaced repetition core from the Indonesian page as a shared `/assets/` script, so any
      page (art terms, programming, trivia) can have its own decks. *table*
- [ ] **On this day**: everything from this date in earlier years across pages (events, finished tasks, journal,
      quotes added, places visited). *reads other pages*

## Done

- [x] **Page hub**: index of all private pages with live status (today's progress, next countdown, latest
      statement, current expense cycle). [personal/](../personal/)
- [x] **Today**: today's checklist, upcoming countdowns, and a general synced notepad. The notepad also covers the
      "quick notes / clipboard" idea (paste on one device, copy on another). [personal/today/](../personal/today/)
- [x] **Calendar**: month view coloured by task completion, daily tasks (with counters), one-time and recurring
      events, countdowns (⏱ on an event, shown when at most 2 weeks away), list of all events, Today button.
      [personal/calendar/](../personal/calendar/)
- [x] **Dashboard**: calendar and today's checklist (managed on the Calendar page), exchange rate, MAL. (A YouTube subscription feed was removed 2026-10-30; notes in [youtube-feed.md](youtube-feed.md).)
      [personal/dashboard/](../personal/dashboard/)
- [x] **Bank statements**: BCP credit/debit PDFs parsed locally (`tools/parse-statements.py`), stored in Supabase, with
      a filterable viewer, categories and notes. Covers the import side of the "money in two currencies" idea.
      [personal/statements/](../personal/statements/), [statements.md](statements.md)
- [x] **Expenses** (was "Subscriptions"): reads the saved statements and sorts spending into bills & utilities,
      subscriptions and transport (DiDi), detected automatically with per-line corrections synced across devices.
      Forecasts the current cycle: real amounts once a statement is imported, estimates before that (fixed amounts
      repeat, variable bills average the last 3). Yearly payments (Namecheap, Zoho) are due 12 months after their last
      charge and listed with the yearly total. Also a 12-month history and a searchable "everything else" list.
      [personal/expenses/](../personal/expenses/), [expenses.md](expenses.md)
- [x] **Spending insights** (on the Expenses page): the month's real spending by category (groceries, food &
      delivery, games, transfers…) and top merchants, US$ share and biggest charge, each against the 3 months
      before. Categories from the Statements page take priority over the automatic ones.
- [x] **Expenses on the hub**: the current cycle's estimate on the hub tile, from a small `expense-summary` key the
      Expenses page saves, so the hub doesn't load any transactions.
- [x] **Renaming lines**: ✎ on any Expenses line. Names live in `expense-lines` next to the original description; the
      statement rows are never changed. [expenses.md](expenses.md#renaming)
- [x] **Subscription review**: subscriptions running a year or more with their total cost, "Still using" (asks
      again in 6 months) or "Cancelled" (stops the forecast). [expenses.md](expenses.md#subscription-review)
- [x] **Yearly payments in the Calendar**: kept in step by the Expenses page as yearly events with a countdown.
      [expenses.md](expenses.md#on-the-calendar)
- [x] **Import reminder**: on the hub, Today and Expenses when a statement should be out but isn't imported.
      `/assets/statements-due.js`, [expenses.md](expenses.md#import-reminder)
- [x] **Install as an app**: `/personal/` installs from the hub (manifest, icons, network-first service worker),
      with shortcuts to Today, Calendar and Expenses. [private-pages.md](private-pages.md#installed-app)

### Groundwork

- [x] Sign-in and cross-device sync for private pages (Supabase). [sync-setup.md](sync-setup.md)
- [x] Page template and guide. [template/](template/)
- [x] Shared look with the main site: theme, hue and shapes in `/assets/base.css`, tool-page layout in
      `/assets/app.css`, task/calendar feature in `/assets/tasks.js` + `tasks.css` (one shared data set).
